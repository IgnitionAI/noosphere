import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  CAMPAIGN_COMPOSITION_JOB_TYPE,
  CAMPAIGN_PROSPECT_SCORE_VERSION,
  scoreCampaignProspect,
} from "@outbound/application/campaigns/autonomous-prospecting";
import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";
import type { Clock } from "@outbound/application/shared/ports";
import type { ProspectingChannel } from "@outbound/domain/campaigns/prospecting-plan";
import type { ProspectChannels } from "@outbound/domain/crm/prospect-channels";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  campaignProspects,
  campaigns,
  companies,
  contactChannelAssignments,
  contactEmployments,
  contactIdentities,
  contacts,
  contactSuppressions,
  jobs,
  outboxEvents,
  prospectDiscoveryCandidates,
  sequenceEnrollments,
} from "@outbound/infrastructure/database/schema";
import { suppressionFingerprint } from "@outbound/infrastructure/crm/suppression-fingerprint";

export class CampaignAutomationJobProcessor {
  constructor(
    private readonly database: Database,
    private readonly queue: JobQueue,
    private readonly clock: Clock,
  ) {}

  async process(job: LeasedJob): Promise<void> {
    const payload = campaignPayload(job.payload);
    const campaign = await this.#campaign(payload);
    if (!campaign || (!payload.incremental && ["composing", "preflight", "scheduled", "running", "completed"].includes(campaign.automationStage))) {
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return;
    }
    if (!campaign.channel) {
      await this.#needsAttention(payload, "CAMPAIGN_CHANNEL_MISSING", "La campagne n’a aucun canal.");
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return;
    }
    try {
      const candidates = await this.#candidates(payload);
      const eligibleCandidateIds: string[] = [];
      for (const candidate of candidates) {
        const eligible = await this.#importDeduplicateAndScore({
          ...payload,
          channel: campaign.channel,
          candidate,
        });
        if (eligible) eligibleCandidateIds.push(candidate.id);
      }
      await this.#completeScoring({
        ...payload,
        eligibleCandidateIds,
        sourceJobId: job.id,
      });
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const outcome = await this.queue.retry({
        jobId: job.id,
        workerId: job.lockedBy,
        availableAt: new Date(this.clock.now().getTime() + 30_000 * job.attempts),
        errorCode: "CAMPAIGN_ENRICH_SCORE_FAILED",
        errorMessage: message,
      });
      if (outcome === "dead_lettered") {
        await this.#needsAttention(payload, "CAMPAIGN_ENRICH_SCORE_FAILED", message);
      }
    }
  }

  async #campaign(input: { workspaceId: string; campaignId: string }) {
    const [row] = await this.database
      .select({
        id: campaigns.id,
        channel: campaigns.channel,
        automationStage: campaigns.automationStage,
      })
      .from(campaigns)
      .where(and(eq(campaigns.workspaceId, input.workspaceId), eq(campaigns.id, input.campaignId)))
      .limit(1);
    return row ?? null;
  }

  #candidates(input: {
    workspaceId: string;
    campaignId: string;
    candidateIds: readonly string[];
  }) {
    return this.database
      .select({
        id: prospectDiscoveryCandidates.id,
        fullName: prospectDiscoveryCandidates.fullName,
        headline: prospectDiscoveryCandidates.headline,
        location: prospectDiscoveryCandidates.location,
        companyName: prospectDiscoveryCandidates.companyName,
        companyWebsite: prospectDiscoveryCandidates.companyWebsite,
        companyDomain: prospectDiscoveryCandidates.companyDomain,
        channels: prospectDiscoveryCandidates.channels,
        providerData: prospectDiscoveryCandidates.providerData,
        icpFit: prospectDiscoveryCandidates.icpFit,
      })
      .from(campaignProspects)
      .innerJoin(
        prospectDiscoveryCandidates,
        and(
          eq(prospectDiscoveryCandidates.workspaceId, campaignProspects.workspaceId),
          eq(prospectDiscoveryCandidates.id, campaignProspects.candidateId),
        ),
      )
      .where(
        and(
          eq(campaignProspects.workspaceId, input.workspaceId),
          eq(campaignProspects.campaignId, input.campaignId),
          input.candidateIds.length
            ? inArray(campaignProspects.candidateId, [...input.candidateIds])
            : undefined,
        ),
      );
  }

  async #importDeduplicateAndScore(input: {
    workspaceId: string;
    campaignId: string;
    channel: ProspectingChannel;
    candidate: CandidateRow;
  }): Promise<boolean> {
    const channels = input.candidate.channels as ProspectChannels;
    const identity = channels[input.channel];
    const scored = scoreCampaignProspect({
      channel: input.channel,
      icpFit: input.candidate.icpFit,
      channelIdentity: identity,
    });
    if (!scored.eligible || !identity.normalizedValue || !identity.value) {
      await this.#excludeCandidate(input, scored.exclusionReason ?? "CHANNEL_IDENTITY_MISSING", scored);
      return false;
    }
    const normalizedValue = identity.normalizedValue;
    const identityValue = identity.value;
    return this.database.transaction(async (tx) => {
      const lockKey = `${input.workspaceId}:${input.channel}:${normalizedValue}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
      const identityFingerprint = suppressionFingerprint({
        workspaceId: input.workspaceId,
        identityType: input.channel === "whatsapp" ? "whatsapp" : input.channel,
        normalizedValue,
      });
      const [suppression] = await tx
        .select({ id: contactSuppressions.id })
        .from(contactSuppressions)
        .where(
          and(
            eq(contactSuppressions.workspaceId, input.workspaceId),
            or(
              eq(contactSuppressions.identityFingerprint, identityFingerprint),
              eq(contactSuppressions.normalizedValue, normalizedValue),
            ),
            inArray(contactSuppressions.channel, ["global", input.channel]),
          ),
        )
        .limit(1);
      if (suppression) {
        await tx
          .update(campaignProspects)
          .set({
            state: "excluded",
            eligible: false,
            score: scored.score,
            scoreVersion: CAMPAIGN_PROSPECT_SCORE_VERSION,
            scoreExplanation: [...scored.factors],
            exclusionReason: "CONTACT_SUPPRESSED",
            updatedAt: this.clock.now(),
          })
          .where(campaignProspectKey(input));
        return false;
      }
      const identityType = input.channel === "whatsapp" ? "whatsapp" : input.channel;
      const [existingIdentity] = await tx
        .select({ contactId: contactIdentities.contactId })
        .from(contactIdentities)
        .where(
          and(
            eq(contactIdentities.workspaceId, input.workspaceId),
            eq(contactIdentities.type, identityType),
            eq(contactIdentities.normalizedValue, normalizedValue),
          ),
        )
        .limit(1);
      const contactId = existingIdentity?.contactId ?? await createCandidateContact(tx, {
        workspaceId: input.workspaceId,
        channel: input.channel,
        candidate: input.candidate,
        identity: { ...identity, normalizedValue, value: identityValue },
        now: this.clock.now(),
      });
      if (input.channel === "whatsapp") {
        const assigned = await assignWhatsappCampaign(tx, {
          workspaceId: input.workspaceId,
          contactId,
          campaignId: input.campaignId,
          candidateId: input.candidate.id,
          score: scored.score,
          now: this.clock.now(),
        });
        if (!assigned) {
          await tx
            .update(campaignProspects)
            .set({
              contactId,
              state: "excluded",
              eligible: false,
              score: scored.score,
              scoreVersion: CAMPAIGN_PROSPECT_SCORE_VERSION,
              scoreExplanation: [...scored.factors],
              exclusionReason: "CONTACT_ASSIGNED_TO_OTHER_WHATSAPP_CAMPAIGN",
              updatedAt: this.clock.now(),
            })
            .where(campaignProspectKey(input));
          return false;
        }
      }
      await tx
        .update(prospectDiscoveryCandidates)
        .set({ importedContactId: contactId })
        .where(
          and(
            eq(prospectDiscoveryCandidates.workspaceId, input.workspaceId),
            eq(prospectDiscoveryCandidates.id, input.candidate.id),
          ),
        );
      await tx
        .update(campaignProspects)
        .set({
          contactId,
          state: "imported",
          eligible: true,
          score: scored.score,
          scoreVersion: CAMPAIGN_PROSPECT_SCORE_VERSION,
          scoreExplanation: [...scored.factors],
          exclusionReason: null,
          updatedAt: this.clock.now(),
        })
        .where(campaignProspectKey(input));
      return true;
    });
  }

  async #excludeCandidate(
    input: { workspaceId: string; campaignId: string; candidate: { id: string } },
    reason: string,
    scored: ReturnType<typeof scoreCampaignProspect>,
  ): Promise<void> {
    await this.database
      .update(campaignProspects)
      .set({
        state: "excluded",
        eligible: false,
        score: scored.score,
        scoreVersion: CAMPAIGN_PROSPECT_SCORE_VERSION,
        scoreExplanation: [...scored.factors],
        exclusionReason: reason,
        updatedAt: this.clock.now(),
      })
      .where(campaignProspectKey(input));
  }

  async #completeScoring(input: {
    workspaceId: string;
    campaignId: string;
    incremental: boolean;
    eligibleCandidateIds: readonly string[];
    sourceJobId: string;
  }) {
    const now = this.clock.now();
    const eligibleCount = input.eligibleCandidateIds.length;
    await this.database.transaction(async (tx) => {
      if (!input.incremental) {
        await tx
          .update(campaigns)
          .set({
            automationStage: eligibleCount ? "composing" : "attention",
            automationErrorCode: eligibleCount ? null : "NO_ELIGIBLE_PROSPECTS",
            automationErrorMessage: eligibleCount
              ? null
              : "Aucun prospect ne passe le score et les contrôles de canal.",
            updatedAt: now,
          })
          .where(and(eq(campaigns.workspaceId, input.workspaceId), eq(campaigns.id, input.campaignId)));
      }
      if (eligibleCount) {
        await tx.insert(jobs).values({
          id: crypto.randomUUID(),
          workspaceId: input.workspaceId,
          type: CAMPAIGN_COMPOSITION_JOB_TYPE,
          payload: {
            workspaceId: input.workspaceId,
            campaignId: input.campaignId,
            incremental: input.incremental,
            candidateIds: [...input.eligibleCandidateIds],
          },
          idempotencyKey: input.incremental
            ? `${input.campaignId}:compose:${input.sourceJobId}:v1`
            : `${input.campaignId}:compose:v1`,
          correlationId: `campaign:${input.campaignId}`,
          maxAttempts: 3,
          availableAt: now,
          createdAt: now,
          updatedAt: now,
        }).onConflictDoNothing();
      }
      await tx.insert(outboxEvents).values({
        workspaceId: input.workspaceId,
        aggregateType: "Campaign",
        aggregateId: input.campaignId,
        eventType: input.incremental
          ? "CampaignDailyProspectsScored"
          : eligibleCount
            ? "CampaignProspectsScored"
            : "CampaignAutomationNeedsAttention",
        payload: { campaignId: input.campaignId, eligibleCount, incremental: input.incremental },
      });
    });
  }

  async #needsAttention(
    input: { workspaceId: string; campaignId: string },
    errorCode: string,
    errorMessage: string,
  ) {
    await this.database
      .update(campaigns)
      .set({
        automationStage: "attention",
        automationErrorCode: errorCode,
        automationErrorMessage: errorMessage.slice(0, 4_000),
        updatedAt: this.clock.now(),
      })
      .where(and(eq(campaigns.workspaceId, input.workspaceId), eq(campaigns.id, input.campaignId)));
  }
}

type CandidateRow = {
  id: string;
  fullName: string;
  headline: string | null;
  location: string | null;
  companyName: string | null;
  companyWebsite: string | null;
  companyDomain: string | null;
  channels: unknown;
  providerData: unknown;
  icpFit: unknown;
};

async function createCandidateContact(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  input: {
    workspaceId: string;
    channel: ProspectingChannel;
    candidate: CandidateRow;
    identity: ProspectChannels[ProspectingChannel];
    now: Date;
  },
): Promise<string> {
  const companyId = input.candidate.companyName
    ? await ensureCompany(tx, input)
    : null;
  const contactId = crypto.randomUUID();
  const name = contactName(input.candidate, input.channel, input.identity.value!);
  await tx.insert(contacts).values({
    id: contactId,
    workspaceId: input.workspaceId,
    firstName: name.firstName,
    lastName: name.lastName,
    preferredChannel: input.channel,
    source: input.channel === "linkedin" ? "provider" : "icp_research",
    createdAt: input.now,
    updatedAt: input.now,
  });
  await tx.insert(contactIdentities).values({
    id: crypto.randomUUID(),
    workspaceId: input.workspaceId,
    contactId,
    type: input.channel === "whatsapp" ? "whatsapp" : input.channel,
    value: input.identity.value!,
    normalizedValue: input.identity.normalizedValue!,
    verificationStatus: input.identity.status === "verified" ? "verified" : "unknown",
    source: input.channel === "linkedin" ? "provider" : "icp_research",
    createdAt: input.now,
    updatedAt: input.now,
  });
  if (companyId) {
    await tx.insert(contactEmployments).values({
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      contactId,
      companyId,
      title: input.candidate.headline ?? "Contact professionnel",
      isCurrent: true,
      createdAt: input.now,
    });
  }
  return contactId;
}

async function ensureCompany(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  input: { workspaceId: string; candidate: CandidateRow; now: Date },
): Promise<string> {
  const domain = input.candidate.companyDomain;
  const condition = domain
    ? and(eq(companies.workspaceId, input.workspaceId), eq(companies.normalizedDomain, domain))
    : and(eq(companies.workspaceId, input.workspaceId), eq(companies.name, input.candidate.companyName!));
  const [existing] = await tx.select({ id: companies.id }).from(companies).where(condition).limit(1);
  if (existing) return existing.id;
  const companyId = crypto.randomUUID();
  await tx.insert(companies).values({
    id: companyId,
    workspaceId: input.workspaceId,
    name: input.candidate.companyName!,
    normalizedDomain: domain,
    linkedinUrl: input.candidate.channels && typeof input.candidate.channels === "object"
      ? ((input.candidate.channels as ProspectChannels).linkedin.value ?? null)
      : null,
    source: "icp_research",
    createdAt: input.now,
    updatedAt: input.now,
  }).onConflictDoNothing();
  const [persisted] = await tx.select({ id: companies.id }).from(companies).where(condition).limit(1);
  return persisted?.id ?? companyId;
}

function contactName(candidate: CandidateRow, channel: ProspectingChannel, identity: string) {
  const providerData = candidate.providerData && typeof candidate.providerData === "object"
    ? candidate.providerData as Record<string, unknown>
    : {};
  if (providerData.candidateKind === "company" && channel === "email") {
    const tokens = (identity.split("@")[0] ?? "").split(/[._-]+/).filter((token) => /^[a-zA-ZÀ-ÿ]{2,}$/.test(token));
    if (tokens.length >= 2) {
      return { firstName: capitalize(tokens[0]!), lastName: tokens.slice(1).map(capitalize).join(" ") };
    }
  }
  if (providerData.candidateKind === "company") {
    return {
      firstName: candidate.companyName ?? "Entreprise",
      lastName: "Point de contact entreprise",
    };
  }
  if (providerData.candidateKind === "company_endpoint") {
    return {
      firstName: candidate.companyName ?? "Entreprise",
      lastName: "Point de contact entreprise",
    };
  }
  const parts = candidate.fullName.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "Contact",
    lastName: parts.slice(1).join(" ") || candidate.companyName || "Professionnel",
  };
}

async function assignWhatsappCampaign(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  input: {
    workspaceId: string;
    contactId: string;
    campaignId: string;
    candidateId: string;
    score: number;
    now: Date;
  },
): Promise<boolean> {
  const [existing] = await tx
    .select()
    .from(contactChannelAssignments)
    .where(
      and(
        eq(contactChannelAssignments.workspaceId, input.workspaceId),
        eq(contactChannelAssignments.contactId, input.contactId),
        eq(contactChannelAssignments.channel, "whatsapp"),
      ),
    )
    .limit(1);
  if (!existing) {
    await tx.insert(contactChannelAssignments).values({
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      channel: "whatsapp",
      campaignId: input.campaignId,
      candidateId: input.candidateId,
      score: input.score,
      scoreVersion: CAMPAIGN_PROSPECT_SCORE_VERSION,
      assignedAt: input.now,
      updatedAt: input.now,
    });
    return true;
  }
  if (existing.campaignId === input.campaignId) return true;
  const [started] = await tx
    .select({ id: sequenceEnrollments.id })
    .from(sequenceEnrollments)
    .where(
      and(
        eq(sequenceEnrollments.workspaceId, input.workspaceId),
        eq(sequenceEnrollments.contactId, input.contactId),
        eq(sequenceEnrollments.campaignId, existing.campaignId),
      ),
    )
    .limit(1);
  const currentWins = !started && (
    input.score > existing.score
    || (input.score === existing.score && input.campaignId.localeCompare(existing.campaignId) < 0)
  );
  if (!currentWins) return false;
  await tx
    .update(campaignProspects)
    .set({
      state: "excluded",
      eligible: false,
      exclusionReason: "CONTACT_REASSIGNED_TO_BETTER_WHATSAPP_CAMPAIGN",
      updatedAt: input.now,
    })
    .where(
      and(
        eq(campaignProspects.workspaceId, input.workspaceId),
        eq(campaignProspects.campaignId, existing.campaignId),
        eq(campaignProspects.candidateId, existing.candidateId),
      ),
    );
  await tx
    .update(contactChannelAssignments)
    .set({
      campaignId: input.campaignId,
      candidateId: input.candidateId,
      score: input.score,
      scoreVersion: CAMPAIGN_PROSPECT_SCORE_VERSION,
      assignedAt: input.now,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(contactChannelAssignments.workspaceId, input.workspaceId),
        eq(contactChannelAssignments.contactId, input.contactId),
        eq(contactChannelAssignments.channel, "whatsapp"),
      ),
    );
  return true;
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}`;
}

function campaignProspectKey(input: { workspaceId: string; campaignId: string; candidate: { id: string } }) {
  return and(
    eq(campaignProspects.workspaceId, input.workspaceId),
    eq(campaignProspects.campaignId, input.campaignId),
    eq(campaignProspects.candidateId, input.candidate.id),
  );
}

function campaignPayload(value: unknown): {
  workspaceId: string;
  campaignId: string;
  incremental: boolean;
  candidateIds: readonly string[];
} {
  if (!value || typeof value !== "object") throw new Error("INVALID_CAMPAIGN_AUTOMATION_JOB");
  const payload = value as Record<string, unknown>;
  if (typeof payload.workspaceId !== "string" || typeof payload.campaignId !== "string") {
    throw new Error("INVALID_CAMPAIGN_AUTOMATION_JOB");
  }
  return {
    workspaceId: payload.workspaceId,
    campaignId: payload.campaignId,
    incremental: payload.incremental === true,
    candidateIds: Array.isArray(payload.candidateIds)
      ? payload.candidateIds.filter((value): value is string => typeof value === "string")
      : [],
  };
}
