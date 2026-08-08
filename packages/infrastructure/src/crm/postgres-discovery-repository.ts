import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@outbound/infrastructure/database/client";
import type { ProspectChannels } from "@outbound/domain/crm/prospect-channels";
import type { CompanyPhoneObservation } from "@outbound/application/crm/company-prospect-source";
import {
  CAMPAIGN_AUTOMATION_JOB_TYPE,
} from "@outbound/application/campaigns/autonomous-prospecting";
import {
  auditLogs,
  companies,
  campaigns,
  campaignProspects,
  icpVersions,
  icps,
  jobs,
  outboxEvents,
  prospectDiscoveryCandidates,
  prospectDiscoveryRuns,
  phoneObservations,
  sourcingFrontiers,
  dailySourcingCycles,
} from "@outbound/infrastructure/database/schema";

export class PostgresDiscoveryRepository {
  constructor(private readonly db: Database) {}

  async listIcps(workspaceId: string) {
    return this.db.select().from(icps)
      .where(and(eq(icps.workspaceId, workspaceId), isNull(icps.deletedAt)))
      .orderBy(asc(icps.name));
  }

  async getIcp(input: { workspaceId: string; icpId: string }) {
    const rows = await this.db.select().from(icps).where(and(
      eq(icps.workspaceId, input.workspaceId), eq(icps.id, input.icpId),
    )).limit(1);
    if (!rows[0]) return null;
    const versions = await this.db.select().from(icpVersions).where(and(
      eq(icpVersions.workspaceId, input.workspaceId), eq(icpVersions.icpId, input.icpId),
    )).orderBy(desc(icpVersions.version));
    return { ...rows[0], versions };
  }

  async listIcpVersions(workspaceId: string) {
    return this.db
      .select()
      .from(icpVersions)
      .where(eq(icpVersions.workspaceId, workspaceId))
      .orderBy(desc(icpVersions.publishedAt));
  }

  async getIcpVersion(input: { workspaceId: string; versionId: string }) {
    const rows = await this.db
      .select()
      .from(icpVersions)
      .where(
        and(
          eq(icpVersions.workspaceId, input.workspaceId),
          eq(icpVersions.id, input.versionId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async createRun(input: {
    id: string;
    workspaceId: string;
    icpVersionId: string;
    filters: unknown;
    createdBy: string;
  }) {
    const rows = await this.db
      .insert(prospectDiscoveryRuns)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
        icpVersionId: input.icpVersionId,
        filters: input.filters,
        createdBy: input.createdBy,
      })
      .onConflictDoNothing()
      .returning();
    if (rows[0]) return { run: rows[0], created: true as const };
    const active = await this.findActiveRun({
      workspaceId: input.workspaceId,
      icpVersionId: input.icpVersionId,
    });
    if (!active) throw new Error("DISCOVERY_RUN_CREATE_CONFLICT");
    return { run: active, created: false as const };
  }

  async findActiveRun(input: { workspaceId: string; icpVersionId: string }) {
    const rows = await this.db
      .select()
      .from(prospectDiscoveryRuns)
      .where(
        and(
          eq(prospectDiscoveryRuns.workspaceId, input.workspaceId),
          eq(prospectDiscoveryRuns.icpVersionId, input.icpVersionId),
          eq(prospectDiscoveryRuns.status, "running"),
        ),
      )
      .orderBy(desc(prospectDiscoveryRuns.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async completeRun(input: {
    workspaceId: string;
    runId: string;
    now?: Date;
    candidates: readonly {
      id: string;
      fullName: string;
      headline: string | null;
      linkedinUrl: string | null;
      linkedinNormalized: string | null;
      location: string | null;
      companyName: string | null;
      companyWebsite: string | null;
      companyDomain: string | null;
      channels: ProspectChannels;
      providerData: unknown;
      icpFit: unknown;
    }[];
    observations?: readonly CompanyPhoneObservation[];
    sourcingMetrics?: {
      searchResultCount: number;
      pageAttemptCount: number;
      rawPhoneCount: number;
      admissiblePhoneCount: number;
      verificationAttemptCount: number;
      verifiedPhoneCount: number;
    };
  }) {
    return this.db.transaction(async (tx) => {
      const [run] = await tx
        .select({
          campaignId: prospectDiscoveryRuns.campaignId,
          trigger: prospectDiscoveryRuns.trigger,
          sourcingCycleId: prospectDiscoveryRuns.sourcingCycleId,
          sourcingFrontierId: prospectDiscoveryRuns.sourcingFrontierId,
        })
        .from(prospectDiscoveryRuns)
        .where(
          and(
            eq(prospectDiscoveryRuns.workspaceId, input.workspaceId),
            eq(prospectDiscoveryRuns.id, input.runId),
          ),
        )
        .limit(1);
      if (!run) throw new Error("DISCOVERY_RUN_NOT_FOUND");
      const [legacyCampaign] = run.campaignId
        ? []
        : await tx
            .select({ id: campaigns.id })
            .from(campaigns)
            .where(
              and(
                eq(campaigns.workspaceId, input.workspaceId),
                eq(campaigns.discoveryRunId, input.runId),
              ),
            )
            .limit(1);
      const campaignId = run.campaignId ?? legacyCampaign?.id ?? null;
      if (input.observations?.length) {
        const now = input.now ?? new Date();
        const inserted = await tx
          .insert(phoneObservations)
          .values(input.observations.map((observation) => ({
            id: crypto.randomUUID(),
            workspaceId: input.workspaceId,
            runId: input.runId,
            sourcingCycleId: run.sourcingCycleId,
            sourcingFrontierId: run.sourcingFrontierId,
            logicalFingerprint: observationFingerprint(observation),
            e164: observation.e164,
            rawValue: observation.rawValue,
            endpointKind: observation.endpointKind,
            companyName: observation.companyName,
            companyDomain: observation.companyDomain,
            companyFingerprint: companyFingerprint(observation.companyName, observation.companyDomain),
            personName: observation.personName,
            personRole: observation.personRole,
            attributionStatus: observation.attributionStatus,
            attributionReason: observation.attributionReason,
            sourceKind: observation.sourceKind,
            sourceUrl: observation.sourceUrl,
            evidenceSnippet: observation.evidenceSnippet,
            contentHash: observation.contentHash,
            reachabilityStatus: observation.reachabilityStatus,
            providerAccountId: observation.providerAccountId,
            reachabilityCheckedAt: parseDate(observation.reachabilityCheckedAt),
            reachabilityExpiresAt: parseDate(observation.reachabilityExpiresAt),
            rejectionReason: observation.rejectionReason,
            firstObservedAt: parseDate(observation.observedAt) ?? now,
            lastObservedAt: parseDate(observation.observedAt) ?? now,
            rawRetainUntil: observation.rejectionReason
              ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000)
              : null,
            updatedAt: now,
          })))
          .onConflictDoUpdate({
            target: [phoneObservations.workspaceId, phoneObservations.logicalFingerprint],
            set: {
              lastObservedAt: now,
              reachabilityStatus: sql`excluded.reachability_status`,
              providerAccountId: sql`excluded.provider_account_id`,
              reachabilityCheckedAt: sql`excluded.reachability_checked_at`,
              reachabilityExpiresAt: sql`excluded.reachability_expires_at`,
              updatedAt: now,
            },
          });
      }
      const existingFingerprints = campaignId
        ? await this.#campaignFingerprints(tx, input.workspaceId, campaignId)
        : new Set<string>();
      const candidates = input.candidates.filter((candidate) => {
        const fingerprints = candidateFingerprints(candidate);
        if (fingerprints.some((fingerprint) => existingFingerprints.has(fingerprint))) return false;
        for (const fingerprint of fingerprints) existingFingerprints.add(fingerprint);
        return true;
      });
      if (candidates.length) {
        const inserted = await tx
          .insert(prospectDiscoveryCandidates)
          .values(
            candidates.map((candidate) => ({
              id: candidate.id,
              workspaceId: input.workspaceId,
              runId: input.runId,
              fullName: candidate.fullName,
              headline: candidate.headline,
              linkedinUrl: candidate.linkedinUrl,
              linkedinNormalized: candidate.linkedinNormalized,
              location: candidate.location,
              companyName: candidate.companyName,
              companyWebsite: candidate.companyWebsite,
              companyDomain: candidate.companyDomain,
              channels: candidate.channels,
              providerData: candidate.providerData as Record<string, unknown>,
              icpFit: candidate.icpFit as Record<string, unknown>,
            })),
          )
          .onConflictDoNothing()
          .returning({ id: prospectDiscoveryCandidates.id });
        if (inserted.length) {
          const events = await tx.insert(outboxEvents).values(inserted.map((candidate) => ({
            workspaceId: input.workspaceId,
            aggregateType: "Prospect",
            aggregateId: candidate.id,
            eventType: "ProspectDiscovered",
            payload: {
              type: "ProspectDiscovered",
              workspaceId: input.workspaceId,
              runId: input.runId,
              candidateId: candidate.id,
            },
          }))).returning({ id: outboxEvents.id, aggregateId: outboxEvents.aggregateId, payload: outboxEvents.payload });
          await tx.insert(auditLogs).values(events.map((event) => ({
            workspaceId: input.workspaceId,
            actorUserId: null,
            action: "ProspectDiscovered",
            subjectType: "Prospect",
            subjectId: event.aggregateId,
            changes: event.payload,
            sourceEventId: event.id,
          })));
        }
      }
      const persistedCandidates = await tx
        .select({ id: prospectDiscoveryCandidates.id })
        .from(prospectDiscoveryCandidates)
        .where(
          and(
            eq(prospectDiscoveryCandidates.workspaceId, input.workspaceId),
            eq(prospectDiscoveryCandidates.runId, input.runId),
          ),
        );
      if (campaignId && persistedCandidates.length) {
        await tx
          .insert(campaignProspects)
          .values(
            persistedCandidates.map((candidate) => ({
              workspaceId: input.workspaceId,
              campaignId,
              candidateId: candidate.id,
              state: "candidate" as const,
            })),
          )
          .onConflictDoNothing();
      }
      const now = input.now ?? new Date();
      const rows = await tx
        .update(prospectDiscoveryRuns)
        .set({
          status: "completed",
          errorCode: null,
          errorMessage: null,
          candidateCount: persistedCandidates.length,
          completedAt: now,
        })
        .where(
          and(
            eq(prospectDiscoveryRuns.workspaceId, input.workspaceId),
            eq(prospectDiscoveryRuns.id, input.runId),
          ),
        )
        .returning();
      if (rows.length !== 1) throw new Error("DISCOVERY_RUN_NOT_FOUND");
      if (campaignId) {
        if (run.trigger !== "daily") {
          await tx
            .update(campaigns)
            .set({
              prospectCount: persistedCandidates.length,
              automationStage: persistedCandidates.length ? "enriching" : "attention",
              automationErrorCode: persistedCandidates.length ? null : "NO_PROSPECTS_FOUND",
              automationErrorMessage: persistedCandidates.length
                ? null
                : "Le sourcing n’a trouvé aucun prospect éligible.",
              updatedAt: now,
            })
            .where(
              and(
                eq(campaigns.workspaceId, input.workspaceId),
                eq(campaigns.id, campaignId),
              ),
            );
        } else if (persistedCandidates.length) {
          await tx
            .update(campaigns)
            .set({
              prospectCount: sql`${campaigns.prospectCount} + ${persistedCandidates.length}`,
              updatedAt: now,
            })
            .where(and(eq(campaigns.workspaceId, input.workspaceId), eq(campaigns.id, campaignId)));
        }
        if (persistedCandidates.length) {
          await tx.insert(jobs).values({
            id: crypto.randomUUID(),
            workspaceId: input.workspaceId,
            type: CAMPAIGN_AUTOMATION_JOB_TYPE,
            payload: {
              workspaceId: input.workspaceId,
              campaignId,
              incremental: run.trigger === "daily",
              candidateIds: persistedCandidates.map((candidate) => candidate.id),
            },
            idempotencyKey: run.trigger === "daily"
              ? `${campaignId}:enrich-score:${input.runId}:v1`
              : `${campaignId}:enrich-score:v1`,
            correlationId: `campaign:${campaignId}`,
            maxAttempts: 3,
            availableAt: now,
            createdAt: now,
            updatedAt: now,
          }).onConflictDoNothing();
        }
        await tx.insert(outboxEvents).values({
          workspaceId: input.workspaceId,
          aggregateType: "Campaign",
          aggregateId: campaignId,
          eventType: run.trigger === "daily"
            ? "CampaignDailySourcingCompleted"
            : persistedCandidates.length
              ? "CampaignSourcingCompleted"
              : "CampaignAutomationNeedsAttention",
          payload: {
            campaignId,
            runId: input.runId,
            candidateCount: persistedCandidates.length,
            discardedDuplicateCount: input.candidates.length - candidates.length,
          },
        });
      }
      if (run.sourcingFrontierId && input.sourcingMetrics) {
        const pages = input.sourcingMetrics.pageAttemptCount;
        const verifiedCount = input.sourcingMetrics.verifiedPhoneCount;
        const [frontier] = await tx
          .select({
            yieldEma: sourcingFrontiers.yieldEma,
            consecutiveEmptyRuns: sourcingFrontiers.consecutiveEmptyRuns,
          })
          .from(sourcingFrontiers)
          .where(eq(sourcingFrontiers.id, run.sourcingFrontierId))
          .limit(1);
        const previousYield = Number(frontier?.yieldEma ?? 0);
        const currentYield = pages > 0 ? verifiedCount / pages : 0;
        const nextEma = previousYield === 0 ? currentYield : previousYield * 0.7 + currentYield * 0.3;
        const emptyRuns = verifiedCount > 0 ? 0 : (frontier?.consecutiveEmptyRuns ?? 0) + 1;
        await tx
          .update(sourcingFrontiers)
          .set({
            pageAttempts: sql`${sourcingFrontiers.pageAttempts} + ${pages}`,
            verifiedFound: sql`${sourcingFrontiers.verifiedFound} + ${verifiedCount}`,
            yieldEma: String(nextEma),
            consecutiveEmptyRuns: emptyRuns,
            status: emptyRuns >= 5 ? "saturated" : "active",
            nextEligibleAt: new Date(now.getTime() + frontierDelayMs(emptyRuns)),
            lastRunAt: now,
            lastYieldAt: verifiedCount > 0 ? now : undefined,
            rotationOrdinal: sql`${sourcingFrontiers.rotationOrdinal} + 1`,
            updatedAt: now,
          })
          .where(eq(sourcingFrontiers.id, run.sourcingFrontierId));
      }
      if (run.sourcingCycleId) {
        const [active] = await tx
          .select({ id: prospectDiscoveryRuns.id })
          .from(prospectDiscoveryRuns)
          .where(
            and(
              eq(prospectDiscoveryRuns.sourcingCycleId, run.sourcingCycleId),
              eq(prospectDiscoveryRuns.status, "running"),
            ),
          )
          .limit(1);
        if (!active) {
          await tx
            .update(dailySourcingCycles)
            .set({
              status: "completed",
              completedAt: now,
              summary: sql`jsonb_build_object(
                'candidateCount', (
                  select coalesce(sum(${prospectDiscoveryRuns.candidateCount}), 0)
                  from ${prospectDiscoveryRuns}
                  where ${prospectDiscoveryRuns.sourcingCycleId} = ${run.sourcingCycleId}
                )
              )`,
              updatedAt: now,
            })
            .where(eq(dailySourcingCycles.id, run.sourcingCycleId));
        }
      }
      return rows[0]!;
    });
  }

  async #campaignFingerprints(
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    workspaceId: string,
    campaignId: string,
  ): Promise<Set<string>> {
    const rows = await tx
      .select({
        linkedinNormalized: prospectDiscoveryCandidates.linkedinNormalized,
        fullName: prospectDiscoveryCandidates.fullName,
        companyName: prospectDiscoveryCandidates.companyName,
        companyDomain: prospectDiscoveryCandidates.companyDomain,
        channels: prospectDiscoveryCandidates.channels,
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
          eq(campaignProspects.workspaceId, workspaceId),
          eq(campaignProspects.campaignId, campaignId),
        ),
      );
    return new Set(rows.flatMap(candidateFingerprints));
  }

  async failRun(input: {
    workspaceId: string;
    runId: string;
    errorCode: string;
    errorMessage: string;
  }) {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const rows = await tx
        .update(prospectDiscoveryRuns)
        .set({
          status: "failed",
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          completedAt: now,
        })
        .where(
          and(
            eq(prospectDiscoveryRuns.workspaceId, input.workspaceId),
            eq(prospectDiscoveryRuns.id, input.runId),
          ),
        )
        .returning({
          id: prospectDiscoveryRuns.id,
          sourcingCycleId: prospectDiscoveryRuns.sourcingCycleId,
          sourcingFrontierId: prospectDiscoveryRuns.sourcingFrontierId,
        });
      if (rows.length !== 1) throw new Error("DISCOVERY_RUN_NOT_FOUND");
      const run = rows[0]!;
      if (run.sourcingFrontierId) {
        await tx
          .update(sourcingFrontiers)
          .set({
            nextEligibleAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000),
            lastRunAt: now,
            updatedAt: now,
          })
          .where(eq(sourcingFrontiers.id, run.sourcingFrontierId));
      }
      if (run.sourcingCycleId) {
        const [running] = await tx
          .select({ id: prospectDiscoveryRuns.id })
          .from(prospectDiscoveryRuns)
          .where(
            and(
              eq(prospectDiscoveryRuns.sourcingCycleId, run.sourcingCycleId),
              eq(prospectDiscoveryRuns.status, "running"),
            ),
          )
          .limit(1);
        if (!running) {
          await tx
            .update(dailySourcingCycles)
            .set({
              status: input.errorCode === "WHATSAPP_ACCOUNT_DISCONNECTED"
                ? "action_required"
                : "partial",
              errorCode: input.errorCode,
              errorMessage: input.errorMessage.slice(0, 4_000),
              completedAt: now,
              updatedAt: now,
            })
            .where(eq(dailySourcingCycles.id, run.sourcingCycleId));
        }
      }
      const [persisted] = await tx
        .select()
        .from(prospectDiscoveryRuns)
        .where(
          and(
            eq(prospectDiscoveryRuns.workspaceId, input.workspaceId),
            eq(prospectDiscoveryRuns.id, input.runId),
          ),
        )
        .limit(1);
      return persisted!;
    });
  }

  async restartRun(input: { workspaceId: string; runId: string }) {
    const rows = await this.db
      .update(prospectDiscoveryRuns)
      .set({
        status: "running",
        errorCode: null,
        errorMessage: null,
        candidateCount: 0,
        completedAt: null,
      })
      .where(
        and(
          eq(prospectDiscoveryRuns.workspaceId, input.workspaceId),
          eq(prospectDiscoveryRuns.id, input.runId),
        ),
      )
      .returning();
    if (rows.length !== 1) throw new Error("DISCOVERY_RUN_NOT_FOUND");
    return rows[0]!;
  }

  async beginRetry(input: { workspaceId: string; runId: string; maxRetries: number }) {
    const rows = await this.db
      .update(prospectDiscoveryRuns)
      .set({
        status: "running",
        errorCode: null,
        errorMessage: null,
        completedAt: null,
        retryCount: sql`${prospectDiscoveryRuns.retryCount} + 1`,
      })
      .where(and(
        eq(prospectDiscoveryRuns.workspaceId, input.workspaceId),
        eq(prospectDiscoveryRuns.id, input.runId),
        eq(prospectDiscoveryRuns.status, "failed"),
        sql`${prospectDiscoveryRuns.retryCount} < ${input.maxRetries}`,
      ))
      .returning();
    if (rows.length === 1) return rows[0]!;
    const current = await this.getRun({ workspaceId: input.workspaceId, runId: input.runId });
    if (!current) throw new Error("DISCOVERY_RUN_NOT_FOUND");
    if (current.retryCount >= input.maxRetries) throw new Error("DISCOVERY_RETRY_EXHAUSTED");
    throw new Error("DISCOVERY_RUN_NOT_FAILED");
  }

  async listRuns(input: { workspaceId: string; icpVersionId?: string }) {
    return this.db
      .select()
      .from(prospectDiscoveryRuns)
      .where(
        and(
          eq(prospectDiscoveryRuns.workspaceId, input.workspaceId),
          ...(input.icpVersionId
            ? [eq(prospectDiscoveryRuns.icpVersionId, input.icpVersionId)]
            : []),
        ),
      )
      .orderBy(desc(prospectDiscoveryRuns.createdAt))
      .limit(50);
  }

  async getRun(input: { workspaceId: string; runId: string }) {
    const rows = await this.db
      .select()
      .from(prospectDiscoveryRuns)
      .where(
        and(
          eq(prospectDiscoveryRuns.workspaceId, input.workspaceId),
          eq(prospectDiscoveryRuns.id, input.runId),
        ),
      )
      .limit(1);
    const run = rows[0];
    if (!run) return null;
    const candidates = await this.db
      .select()
      .from(prospectDiscoveryCandidates)
      .where(
        and(
          eq(prospectDiscoveryCandidates.workspaceId, input.workspaceId),
          eq(prospectDiscoveryCandidates.runId, input.runId),
        ),
      )
      .orderBy(asc(prospectDiscoveryCandidates.createdAt));
    return { ...run, candidates };
  }

  async getCandidate(input: { workspaceId: string; runId: string; candidateId: string }) {
    const rows = await this.db
      .select()
      .from(prospectDiscoveryCandidates)
      .where(
        and(
          eq(prospectDiscoveryCandidates.workspaceId, input.workspaceId),
          eq(prospectDiscoveryCandidates.runId, input.runId),
          eq(prospectDiscoveryCandidates.id, input.candidateId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findCompanyByName(input: { workspaceId: string; name: string }) {
    const rows = await this.db
      .select()
      .from(companies)
      .where(
        and(
          eq(companies.workspaceId, input.workspaceId),
          eq(companies.name, input.name),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findCompanyByDomain(input: { workspaceId: string; normalizedDomain: string }) {
    const rows = await this.db
      .select()
      .from(companies)
      .where(
        and(
          eq(companies.workspaceId, input.workspaceId),
          eq(companies.normalizedDomain, input.normalizedDomain),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async markCandidateImported(input: {
    workspaceId: string;
    candidateId: string;
    contactId: string;
  }) {
    await this.db.transaction(async (tx) => {
      await tx
        .update(prospectDiscoveryCandidates)
        .set({ importedContactId: input.contactId })
        .where(
          and(
            eq(prospectDiscoveryCandidates.workspaceId, input.workspaceId),
            eq(prospectDiscoveryCandidates.id, input.candidateId),
          ),
        );
      await tx
        .update(campaignProspects)
        .set({ contactId: input.contactId, state: "imported", updatedAt: new Date() })
        .where(
          and(
            eq(campaignProspects.workspaceId, input.workspaceId),
            eq(campaignProspects.candidateId, input.candidateId),
          ),
        );
    });
  }
}

function candidateFingerprints(candidate: {
  linkedinNormalized?: string | null;
  fullName: string;
  companyName: string | null;
  companyDomain: string | null;
  channels: ProspectChannels;
}): string[] {
  const values = [
    candidate.linkedinNormalized ? `linkedin:${candidate.linkedinNormalized}` : null,
    candidate.channels.linkedin.normalizedValue
      ? `linkedin:${candidate.channels.linkedin.normalizedValue}`
      : null,
    candidate.channels.email.normalizedValue ? `email:${candidate.channels.email.normalizedValue}` : null,
    candidate.channels.whatsapp.normalizedValue
      ? `whatsapp:${candidate.channels.whatsapp.normalizedValue}`
      : null,
    candidate.companyDomain
      ? `person:${candidate.fullName.trim().toLowerCase()}@${candidate.companyDomain}`
      : candidate.companyName
        ? `person:${candidate.fullName.trim().toLowerCase()}@${candidate.companyName.trim().toLowerCase()}`
        : null,
  ];
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function observationFingerprint(observation: CompanyPhoneObservation): string {
  return new Bun.CryptoHasher("sha256")
    .update([
      observation.e164 ?? observation.rawValue.replace(/\s+/g, ""),
      observation.companyDomain ?? observation.companyName.toLocaleLowerCase("fr"),
      observation.sourceUrl,
    ].join("|"))
    .digest("hex");
}

function companyFingerprint(companyName: string, companyDomain: string | null): string {
  return new Bun.CryptoHasher("sha256")
    .update(companyDomain ?? companyName.trim().toLocaleLowerCase("fr"))
    .digest("hex");
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function frontierDelayMs(consecutiveEmptyRuns: number): number {
  if (consecutiveEmptyRuns >= 5) return 30 * 24 * 60 * 60 * 1_000;
  if (consecutiveEmptyRuns >= 3) return 7 * 24 * 60 * 60 * 1_000;
  if (consecutiveEmptyRuns >= 1) return 2 * 24 * 60 * 60 * 1_000;
  return 24 * 60 * 60 * 1_000;
}
