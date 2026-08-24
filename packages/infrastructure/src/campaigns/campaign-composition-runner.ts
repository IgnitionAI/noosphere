import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type {
  CampaignChannelReadiness,
  CampaignContentGenerator,
  CampaignEditorialContextReader,
  PersonalizedCampaignStep,
} from "@outbound/application/campaigns/campaign-content-generator";
import { PROSPECT_DECISION_JOB_TYPE } from "@outbound/application/campaigns/prospect-decision";
import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";
import type { Clock } from "@outbound/application/shared/ports";
import type { ProspectingChannel } from "@outbound/domain/campaigns/prospecting-plan";
import {
  nextAllowedCampaignSendAt,
  recipientTimezoneFromEvidence,
  resolveCampaignAutopilotPolicy,
} from "@outbound/domain/campaigns/campaign-autopilot-policy";
import { prepareAutomatedSequenceSteps } from "@outbound/domain/campaigns/campaign-sequence";
import type { SequenceStepInput } from "@outbound/domain/campaigns/sequence-validation";
import {
  fitSequenceStepContent,
  validateSequenceSteps,
} from "@outbound/domain/campaigns/sequence-validation";
import type { ProspectChannels } from "@outbound/domain/crm/prospect-channels";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  campaignProspects,
  campaigns,
  contacts,
  icpVersions,
  jobs,
  outboxEvents,
  outreachActions,
  prospectDecisions,
  prospectDiscoveryCandidates,
  campaignEnrollments,
  sequences,
  sequenceSteps,
  sequenceVersions,
} from "@outbound/infrastructure/database/schema";
import { captureProspectDecisionMutation } from "@outbound/infrastructure/prospect-memory/capture-prospect-decision-mutation";
import { captureProspectMemoryMutation } from "@outbound/infrastructure/prospect-memory/capture-prospect-memory-mutation";
import { PostgresCampaignEditorialContextReader } from "./postgres-campaign-editorial-context";

export class CampaignCompositionJobProcessor {
  readonly #editorialContext: CampaignEditorialContextReader;

  constructor(
    private readonly database: Database,
    private readonly queue: JobQueue,
    private readonly generator: CampaignContentGenerator,
    private readonly readiness: CampaignChannelReadiness,
    private readonly clock: Clock,
    editorialContext?: CampaignEditorialContextReader,
  ) {
    this.#editorialContext = editorialContext ?? new PostgresCampaignEditorialContextReader(database);
  }

  async process(job: LeasedJob): Promise<void> {
    const payload = campaignPayload(job.payload);
    const campaign = await this.#campaign(payload);
    if (!campaign || (!payload.incremental && ["scheduled", "running", "completed"].includes(campaign.automationStage))) {
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return;
    }
    if (!campaign.channel || (!payload.incremental && campaign.automationStage !== "composing")) {
      await this.#needsAttention(payload, "CAMPAIGN_NOT_READY_FOR_COMPOSITION", "La campagne n’est pas prête pour la composition.");
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return;
    }
    try {
      const autopilotPolicy = resolveCampaignAutopilotPolicy(campaign.autopilotPolicy, campaign.channel);
      if (!autopilotPolicy.enabled) {
        await this.database
          .update(campaigns)
          .set({ status: "paused", updatedAt: this.clock.now() })
          .where(and(eq(campaigns.workspaceId, payload.workspaceId), eq(campaigns.id, payload.campaignId)));
        await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
        return;
      }
      const account = await this.readiness.resolveHealthyAccount(payload.workspaceId, campaign.channel);
      const templateSteps = prepareAutomatedSequenceSteps(
        await this.#templateSteps(payload, campaign.sequenceId),
      );
      const validation = validateSequenceSteps(templateSteps);
      if (validation.length || templateSteps.length === 0) {
        throw new Error(`CAMPAIGN_SEQUENCE_PREFLIGHT_FAILED:${JSON.stringify(validation)}`);
      }
      const prospects = await this.#eligibleProspects(payload);
      if (!prospects.length) throw new Error("NO_ELIGIBLE_PROSPECTS");
      for (const prospect of prospects) {
        const existingSteps = readPersonalizedSteps(prospect.personalizedSteps);
        const assessmentMissing = !prospect.aiAssessment
          || typeof prospect.aiAssessment !== "object"
          || Array.isArray(prospect.aiAssessment)
          || Object.keys(prospect.aiAssessment as Record<string, unknown>).length === 0;
        if (existingSteps.length && !assessmentMissing) continue;
        const firstTemplate = templateSteps[0];
        if (!firstTemplate) throw new Error("CAMPAIGN_SEQUENCE_EMPTY");
        if (!prospect.contactId) throw new Error("ELIGIBLE_PROSPECT_CONTACT_MISSING");
        const editorial = await this.#editorialContext.read({
          workspaceId: payload.workspaceId,
          campaignId: payload.campaignId,
          contactId: prospect.contactId,
          step: firstTemplate,
          totalSteps: templateSteps.length,
          prospectEvidence: {
            publicData: prospect.providerData,
            scoreFactors: prospect.scoreExplanation,
          },
        });
        const generated = await this.generator.generate({
          workspaceId: payload.workspaceId,
          channel: campaign.channel,
          campaignObjective: editorial.campaignObjective,
          icpName: campaign.icpName,
          problems: campaign.problems,
          signals: campaign.signals,
          offer: editorial.offer,
          previousMessages: editorial.previousMessages,
          stepObjective: editorial.stepObjective,
          policy: campaign.channel === "email"
            ? {
                language: autopilotPolicy.email.language,
                firstMessageInstructions: autopilotPolicy.email.firstMessageInstructions,
                followUpInstructions: autopilotPolicy.email.followUpInstructions,
              }
            : null,
          prospect: {
            contactId: prospect.contactId,
            firstName: prospect.firstName,
            lastName: prospect.lastName,
            headline: prospect.headline,
            companyName: prospect.companyName ?? "Entreprise",
            location: prospect.location,
            score: prospect.score ?? 0,
            scoreExplanation: prospect.scoreExplanation,
            evidence: editorial.prospectEvidence,
          },
          templateSteps: [firstTemplate],
        });
        const [firstPersonalized] = validatePersonalizedSteps([firstTemplate], generated.steps);
        if (!firstPersonalized) throw new Error("CAMPAIGN_FIRST_MESSAGE_MISSING");
        const personalizedSteps: PersonalizedStoredStep[] = existingSteps.length
          ? existingSteps
          : templateSteps.map((step) => step.position === firstTemplate.position
            ? {
                ...firstPersonalized,
                generation: generated.metadata,
                generationPending: false,
              }
            : {
                ...step,
                generation: {
                  provider: "pending",
                  model: "pending",
                  promptVersion: "campaign-personalization-jit-v1",
                },
                generationPending: true,
              });
        await this.database
          .update(campaignProspects)
          .set({
            personalizedSteps,
            aiAssessment: generated.assessment ?? {
              summary: "Prospect qualifié par le moteur ICP.",
              strengths: [],
              risks: [],
              recommendedAngle: "S’appuyer uniquement sur les signaux publics collectés.",
            },
            updatedAt: this.clock.now(),
          })
          .where(
            and(
              eq(campaignProspects.workspaceId, payload.workspaceId),
              eq(campaignProspects.campaignId, payload.campaignId),
              eq(campaignProspects.candidateId, prospect.candidateId),
            ),
          );
      }
      await this.#activateAndSchedule({
        ...payload,
        campaign,
        account,
        templateSteps,
        autopilotPolicy,
        incremental: payload.incremental,
        candidateIds: payload.candidateIds,
      });
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const outcome = await this.queue.retry({
        jobId: job.id,
        workerId: job.lockedBy,
        availableAt: new Date(this.clock.now().getTime() + 30_000 * job.attempts),
        errorCode: "CAMPAIGN_COMPOSITION_FAILED",
        errorMessage: message,
      });
      if (outcome === "dead_lettered") {
        await this.#needsAttention(payload, "CAMPAIGN_COMPOSITION_FAILED", message);
      }
    }
  }

  async #campaign(input: { workspaceId: string; campaignId: string }) {
    const [row] = await this.database
      .select({
        id: campaigns.id,
        channel: campaigns.channel,
        status: campaigns.status,
        automationStage: campaigns.automationStage,
        sequenceId: campaigns.sequenceId,
        sequenceVersionId: campaigns.sequenceVersionId,
        icpName: icpVersions.name,
        problems: icpVersions.problems,
        signals: icpVersions.signals,
        autopilotPolicy: campaigns.autopilotPolicy,
      })
      .from(campaigns)
      .innerJoin(
        icpVersions,
        and(eq(icpVersions.workspaceId, campaigns.workspaceId), eq(icpVersions.id, campaigns.icpVersionId)),
      )
      .where(and(eq(campaigns.workspaceId, input.workspaceId), eq(campaigns.id, input.campaignId)))
      .limit(1);
    return row ?? null;
  }

  async #templateSteps(input: { workspaceId: string }, sequenceId: string): Promise<SequenceStepInput[]> {
    return this.database
      .select({
        position: sequenceSteps.position,
        kind: sequenceSteps.kind,
        delayDays: sequenceSteps.delayDays,
        windowStart: sequenceSteps.windowStart,
        windowEnd: sequenceSteps.windowEnd,
        subject: sequenceSteps.subject,
        body: sequenceSteps.body,
        fallbackKind: sequenceSteps.fallbackKind,
      })
      .from(sequenceSteps)
      .where(and(eq(sequenceSteps.workspaceId, input.workspaceId), eq(sequenceSteps.sequenceId, sequenceId)))
      .orderBy(asc(sequenceSteps.position));
  }

  #eligibleProspects(input: {
    workspaceId: string;
    campaignId: string;
    candidateIds: readonly string[];
  }) {
    return this.database
      .select({
        candidateId: campaignProspects.candidateId,
        contactId: campaignProspects.contactId,
        score: campaignProspects.score,
        scoreExplanation: campaignProspects.scoreExplanation,
        personalizedSteps: campaignProspects.personalizedSteps,
        aiAssessment: campaignProspects.aiAssessment,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        headline: prospectDiscoveryCandidates.headline,
        location: prospectDiscoveryCandidates.location,
        companyName: prospectDiscoveryCandidates.companyName,
        channels: prospectDiscoveryCandidates.channels,
        providerData: prospectDiscoveryCandidates.providerData,
      })
      .from(campaignProspects)
      .innerJoin(
        prospectDiscoveryCandidates,
        and(
          eq(prospectDiscoveryCandidates.workspaceId, campaignProspects.workspaceId),
          eq(prospectDiscoveryCandidates.id, campaignProspects.candidateId),
        ),
      )
      .innerJoin(
        contacts,
        and(eq(contacts.workspaceId, campaignProspects.workspaceId), eq(contacts.id, campaignProspects.contactId)),
      )
      .where(
        and(
          eq(campaignProspects.workspaceId, input.workspaceId),
          eq(campaignProspects.campaignId, input.campaignId),
          eq(campaignProspects.eligible, true),
          eq(campaignProspects.state, "imported"),
          input.candidateIds.length
            ? inArray(campaignProspects.candidateId, [...input.candidateIds])
            : undefined,
        ),
      );
  }

  async #activateAndSchedule(input: {
    workspaceId: string;
    campaignId: string;
    campaign: CampaignCompositionRecord;
    account: { provider: "unipile"; accountId: string };
    templateSteps: readonly SequenceStepInput[];
    autopilotPolicy: ReturnType<typeof resolveCampaignAutopilotPolicy>;
    incremental: boolean;
    candidateIds: readonly string[];
  }) {
    const now = this.clock.now();
    await this.database.transaction(async (tx) => {
      let sequenceVersionId = input.campaign.sequenceVersionId;
      if (!sequenceVersionId) {
        const [latest] = await tx
          .select({ version: sequenceVersions.version })
          .from(sequenceVersions)
          .where(
            and(
              eq(sequenceVersions.workspaceId, input.workspaceId),
              eq(sequenceVersions.sequenceId, input.campaign.sequenceId),
            ),
          )
          .orderBy(desc(sequenceVersions.version))
          .limit(1);
        sequenceVersionId = crypto.randomUUID();
        await tx.insert(sequenceVersions).values({
          id: sequenceVersionId,
          workspaceId: input.workspaceId,
          sequenceId: input.campaign.sequenceId,
          version: (latest?.version ?? 0) + 1,
          steps: [...input.templateSteps],
          publishedBy: null,
          publishedAt: now,
          createdAt: now,
        });
        await tx
          .update(sequences)
          .set({ status: "published", updatedAt: now })
          .where(and(eq(sequences.workspaceId, input.workspaceId), eq(sequences.id, input.campaign.sequenceId)));
      }
      const prospects = await tx
        .select({
          candidateId: campaignProspects.candidateId,
          contactId: campaignProspects.contactId,
          personalizedSteps: campaignProspects.personalizedSteps,
          channels: prospectDiscoveryCandidates.channels,
          providerData: prospectDiscoveryCandidates.providerData,
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
            eq(campaignProspects.eligible, true),
            eq(campaignProspects.state, "imported"),
            input.candidateIds.length
              ? inArray(campaignProspects.candidateId, [...input.candidateIds])
              : undefined,
          ),
        );
      let earliestDueAt: Date | null = null;
      for (const prospect of prospects) {
        if (!prospect.contactId) throw new Error("ELIGIBLE_PROSPECT_CONTACT_MISSING");
        const personalized = readPersonalizedSteps(prospect.personalizedSteps);
        if (personalized.length !== input.templateSteps.length) {
          throw new Error("PROSPECT_PERSONALIZATION_INCOMPLETE");
        }
        const enrollmentId = await ensureEnrollment(tx, {
          workspaceId: input.workspaceId,
          campaignId: input.campaignId,
          candidateId: prospect.candidateId,
          contactId: prospect.contactId,
          sequenceVersionId,
          now,
        });
        if (!enrollmentId) {
          const [excludedProspect] = await tx.update(campaignProspects).set({
            status: "excluded",
            state: "excluded",
            eligible: false,
            exclusionReason: "ACTIVE_SEQUENCE_CONFLICT",
            excludedAt: now,
            updatedAt: now,
          }).where(and(
            eq(campaignProspects.workspaceId, input.workspaceId),
            eq(campaignProspects.campaignId, input.campaignId),
            eq(campaignProspects.candidateId, prospect.candidateId),
          )).returning({
            id: campaignProspects.id,
            state: campaignProspects.state,
            status: campaignProspects.status,
            updatedAt: campaignProspects.updatedAt,
          });
          if (excludedProspect) {
            await captureProspectMemoryMutation(tx, {
              workspaceId: input.workspaceId,
              sourceContactId: prospect.contactId,
              sourceKind: "campaign_prospect",
              sourceId: excludedProspect.id,
              sourceVersion: excludedProspect.updatedAt.getTime(),
              kind: "campaign_changed",
              occurredAt: excludedProspect.updatedAt,
              observedAt: excludedProspect.updatedAt,
              payload: {
                campaignId: input.campaignId,
                state: excludedProspect.state,
                status: excludedProspect.status,
                reason: "ACTIVE_SEQUENCE_CONFLICT",
              },
              correlationId: `campaign:${input.campaignId}`,
            });
          }
          continue;
        }
        const channels = prospect.channels as ProspectChannels;
        const identity = channels[input.campaign.channel!];
        if (!identity.value || !identity.normalizedValue) throw new Error("OUTREACH_IDENTITY_MISSING");
        const recipientTimezone = recipientTimezoneFromEvidence(
          prospect.providerData,
          input.autopilotPolicy.schedule.fallbackTimezone,
        );
        let previousDueAt = now;
        for (const step of personalized) {
          const dueAt = nextAllowedCampaignSendAt({
            from: previousDueAt,
            delayBusinessDays: step.delayDays,
            schedule: input.autopilotPolicy.schedule,
            recipientTimezone,
          });
          previousDueAt = dueAt;
          if (!earliestDueAt || dueAt < earliestDueAt) earliestDueAt = dueAt;
          const actionId = crypto.randomUUID();
          const actionIdempotencyKey = `${input.campaignId}:${prospect.contactId}:step:${step.position}:v1`;
          const [insertedAction] = await tx.insert(outreachActions).values({
            id: actionId,
            workspaceId: input.workspaceId,
            enrollmentId,
            campaignId: input.campaignId,
            candidateId: prospect.candidateId,
            contactId: prospect.contactId,
            provider: input.account.provider,
            providerAccountId: input.account.accountId,
            channel: input.campaign.channel!,
            stepPosition: step.position,
            stepKind: step.kind,
            status: "scheduled",
            idempotencyKey: actionIdempotencyKey,
            dueAt,
            contentSnapshot: {
              subject: step.subject,
              body: step.body,
              windowStart: step.windowStart,
              windowEnd: step.windowEnd,
              recipient: {
                value: identity.value,
                normalizedValue: identity.normalizedValue,
                providerUserId: providerUserId(prospect.providerData),
              },
              generation: step.generation,
              generationPending: step.generationPending,
              template: {
                position: step.position,
                kind: step.kind,
                delayDays: step.delayDays,
                windowStart: step.windowStart,
                windowEnd: step.windowEnd,
                subject: step.subject,
                body: step.body,
                fallbackKind: step.fallbackKind,
              },
              schedule: {
                activeDays: input.autopilotPolicy.schedule.activeDays,
                windowStart: input.autopilotPolicy.schedule.windowStart,
                windowEnd: input.autopilotPolicy.schedule.windowEnd,
                timezone: recipientTimezone,
                policyVersion: input.autopilotPolicy.version,
              },
            },
            createdAt: now,
            updatedAt: now,
          }).onConflictDoNothing().returning({ id: outreachActions.id });
          const [storedAction] = insertedAction
            ? [insertedAction]
            : await tx
                .select({ id: outreachActions.id })
                .from(outreachActions)
                .where(and(
                  eq(outreachActions.workspaceId, input.workspaceId),
                  eq(outreachActions.idempotencyKey, actionIdempotencyKey),
                ))
                .limit(1);
          if (!storedAction) throw new Error("OUTREACH_ACTION_IDEMPOTENCY_CONFLICT");
          const decisionIdempotencyKey = `${actionIdempotencyKey}:decision:v1`;
          const decisionId = crypto.randomUUID();
          const decisionJobId = crypto.randomUUID();
          const [insertedJob] = await tx.insert(jobs).values({
            id: decisionJobId,
            workspaceId: input.workspaceId,
            type: PROSPECT_DECISION_JOB_TYPE,
            payload: { workspaceId: input.workspaceId, decisionId },
            idempotencyKey: `${decisionIdempotencyKey}:execute`,
            correlationId: `campaign:${input.campaignId}`,
            maxAttempts: 5,
            priority: step.position === 1 ? 50 : 20,
            availableAt: dueAt,
            createdAt: now,
            updatedAt: now,
          }).onConflictDoNothing().returning({ id: jobs.id });
          const [storedJob] = insertedJob
            ? [insertedJob]
            : await tx
                .select({ id: jobs.id })
                .from(jobs)
                .where(and(
                  eq(jobs.workspaceId, input.workspaceId),
                  eq(jobs.type, PROSPECT_DECISION_JOB_TYPE),
                  eq(jobs.idempotencyKey, `${decisionIdempotencyKey}:execute`),
                ))
                .limit(1);
          if (!storedJob) throw new Error("PROSPECT_DECISION_JOB_IDEMPOTENCY_CONFLICT");
          const [insertedDecision] = await tx.insert(prospectDecisions).values({
            id: decisionId,
            workspaceId: input.workspaceId,
            contactId: prospect.contactId,
            campaignId: input.campaignId,
            outreachActionId: storedAction.id,
            jobId: storedJob.id,
            kind: "outreach_action_due",
            reason: `Évaluer l’étape ${step.position} de la séquence avant toute action externe.`,
            dueAt,
            priority: step.position === 1 ? 50 : 20,
            maxAttempts: 5,
            idempotencyKey: decisionIdempotencyKey,
            correlationId: `campaign:${input.campaignId}`,
            payload: { sequenceVersionId, stepPosition: step.position },
            createdAt: now,
            updatedAt: now,
          }).onConflictDoNothing().returning();
          if (insertedDecision) {
            await captureProspectDecisionMutation(
              tx,
              insertedDecision,
              `campaign:${input.campaignId}`,
            );
          }
        }
        const [enrolledProspect] = await tx.update(campaignProspects).set({
          status: "enrolled",
          enrolledAt: now,
          updatedAt: now,
        }).where(and(
          eq(campaignProspects.workspaceId, input.workspaceId),
          eq(campaignProspects.campaignId, input.campaignId),
          eq(campaignProspects.candidateId, prospect.candidateId),
        )).returning({
          id: campaignProspects.id,
          state: campaignProspects.state,
          status: campaignProspects.status,
          updatedAt: campaignProspects.updatedAt,
        });
        if (enrolledProspect) {
          await captureProspectMemoryMutation(tx, {
            workspaceId: input.workspaceId,
            sourceContactId: prospect.contactId,
            sourceKind: "campaign_prospect",
            sourceId: enrolledProspect.id,
            sourceVersion: enrolledProspect.updatedAt.getTime(),
            kind: "campaign_changed",
            occurredAt: enrolledProspect.updatedAt,
            observedAt: enrolledProspect.updatedAt,
            payload: {
              campaignId: input.campaignId,
              state: enrolledProspect.state,
              status: enrolledProspect.status,
            },
            correlationId: `campaign:${input.campaignId}`,
          });
        }
      }
      if (!earliestDueAt) {
        await tx.update(campaigns).set({
          status: "active",
          automationStage: "sourcing",
          automationErrorCode: null,
          automationErrorMessage: null,
          updatedAt: now,
        }).where(and(eq(campaigns.workspaceId, input.workspaceId), eq(campaigns.id, input.campaignId)));
        await tx.insert(outboxEvents).values({
          workspaceId: input.workspaceId,
          aggregateType: "Campaign",
          aggregateId: input.campaignId,
          eventType: "CampaignProspectsSkipped",
          payload: {
            campaignId: input.campaignId,
            reason: "ACTIVE_SEQUENCE_CONFLICT",
            prospectCount: prospects.length,
          },
        });
        return;
      }
      const activatesCampaign = !input.incremental || input.campaign.status === "draft";
      await tx
        .update(campaigns)
        .set(!activatesCampaign
          ? {
              sequenceVersionId,
              ...(input.campaign.automationStage === "attention"
                ? { automationStage: "scheduled" as const }
                : {}),
              automationErrorCode: null,
              automationErrorMessage: null,
              updatedAt: now,
            }
          : {
              sequenceVersionId,
              status: "active",
              automationStage: "scheduled",
              automationErrorCode: null,
              automationErrorMessage: null,
              updatedAt: now,
            })
        .where(and(eq(campaigns.workspaceId, input.workspaceId), eq(campaigns.id, input.campaignId)));
      await tx.insert(outboxEvents).values({
        workspaceId: input.workspaceId,
        aggregateType: "Campaign",
        aggregateId: input.campaignId,
        eventType: input.incremental && !activatesCampaign
          ? "CampaignDailyProspectsScheduled"
          : "CampaignActivatedAutomatically",
        payload: {
          campaignId: input.campaignId,
          sequenceVersionId,
          providerAccountId: input.account.accountId,
          prospectCount: prospects.length,
        },
      });
    });
  }

  async #needsAttention(input: { workspaceId: string; campaignId: string }, code: string, message: string) {
    await this.database
      .update(campaigns)
      .set({
        automationStage: "attention",
        automationErrorCode: code,
        automationErrorMessage: message.slice(0, 4_000),
        updatedAt: this.clock.now(),
      })
      .where(and(eq(campaigns.workspaceId, input.workspaceId), eq(campaigns.id, input.campaignId)));
  }
}

type CampaignCompositionRecord = {
  id: string;
  channel: ProspectingChannel | null;
  status: "draft" | "active" | "paused" | "completed" | "archived";
  automationStage: string;
  sequenceId: string;
  sequenceVersionId: string | null;
  icpName: string;
  problems: unknown;
  signals: unknown;
  autopilotPolicy: unknown;
};

type PersonalizedStoredStep = SequenceStepInput & {
  generation: { provider: string; model: string; promptVersion: string };
  generationPending: boolean;
};

function validatePersonalizedSteps(
  templates: readonly SequenceStepInput[],
  generated: readonly PersonalizedCampaignStep[],
): SequenceStepInput[] {
  if (generated.length !== templates.length) throw new Error("PERSONALIZED_STEP_COUNT_MISMATCH");
  const generatedByPosition = new Map(generated.map((step) => [step.position, step]));
  const merged = templates.map((template) => {
    const content = generatedByPosition.get(template.position);
    if (!content) throw new Error(`PERSONALIZED_STEP_MISSING:${template.position}`);
    return fitSequenceStepContent({
      ...template,
      subject: content.subject,
      body: content.body,
    });
  });
  const errors = validateSequenceSteps(merged);
  if (errors.length) throw new Error(`PERSONALIZED_SEQUENCE_INVALID:${JSON.stringify(errors)}`);
  return merged;
}

function readPersonalizedSteps(value: unknown): PersonalizedStoredStep[] {
  if (!Array.isArray(value)) return [];
  return value.filter((step): step is PersonalizedStoredStep =>
    Boolean(step && typeof step === "object" && typeof (step as { body?: unknown }).body === "string"),
  );
}

async function ensureEnrollment(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  input: {
    workspaceId: string;
    campaignId: string;
    candidateId: string;
    contactId: string;
    sequenceVersionId: string;
    now: Date;
  },
): Promise<string | null> {
  const id = crypto.randomUUID();
  const [inserted] = await tx.insert(campaignEnrollments).values({
    id,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    contactId: input.contactId,
    sequenceVersionId: input.sequenceVersionId,
    status: "active",
    enrolledAt: input.now,
    createdAt: input.now,
  }).onConflictDoNothing().returning({ id: campaignEnrollments.id });
  if (inserted) return inserted.id;
  const [existing] = await tx
    .select({ id: campaignEnrollments.id, status: campaignEnrollments.status })
    .from(campaignEnrollments)
    .where(
      and(
        eq(campaignEnrollments.workspaceId, input.workspaceId),
        eq(campaignEnrollments.campaignId, input.campaignId),
        eq(campaignEnrollments.contactId, input.contactId),
      ),
    )
    .limit(1);
  if (existing?.status === "active") return existing.id;
  const [activeConflict] = await tx
    .select({ id: campaignEnrollments.id, campaignId: campaignEnrollments.campaignId })
    .from(campaignEnrollments)
    .where(and(
      eq(campaignEnrollments.workspaceId, input.workspaceId),
      eq(campaignEnrollments.contactId, input.contactId),
      eq(campaignEnrollments.status, "active"),
    ))
    .limit(1);
  if (activeConflict && activeConflict.campaignId !== input.campaignId) return null;
  if (!existing) throw new Error("SEQUENCE_ENROLLMENT_CREATE_FAILED");
  const [reactivated] = await tx.update(campaignEnrollments).set({
    status: "active",
    sequenceVersionId: input.sequenceVersionId,
    enrolledAt: input.now,
    completedAt: null,
  }).where(and(
    eq(campaignEnrollments.workspaceId, input.workspaceId),
    eq(campaignEnrollments.id, existing.id),
  )).returning({ id: campaignEnrollments.id });
  if (!reactivated) throw new Error("SEQUENCE_ENROLLMENT_CREATE_FAILED");
  return reactivated.id;
}

function providerUserId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  for (const key of ["providerId", "profileProviderId", "publicIdentifier"]) {
    if (typeof data[key] === "string" && data[key]) return data[key];
  }
  return null;
}

function campaignPayload(value: unknown): {
  workspaceId: string;
  campaignId: string;
  incremental: boolean;
  candidateIds: readonly string[];
} {
  if (!value || typeof value !== "object") throw new Error("INVALID_CAMPAIGN_COMPOSITION_JOB");
  const payload = value as Record<string, unknown>;
  if (typeof payload.workspaceId !== "string" || typeof payload.campaignId !== "string") {
    throw new Error("INVALID_CAMPAIGN_COMPOSITION_JOB");
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
