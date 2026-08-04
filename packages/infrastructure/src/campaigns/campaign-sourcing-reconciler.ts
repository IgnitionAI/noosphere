import { and, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { ChannelStrategy } from "@outbound/application/campaigns/channel-assessment";
import {
  buildAutonomousSourcingFilters,
  PROSPECT_DISCOVERY_JOB_TYPE,
} from "@outbound/application/campaigns/autonomous-prospecting";
import type { Clock } from "@outbound/application/shared/ports";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  campaigns,
  channelAssessments,
  icpVersions,
  jobs,
  outboxEvents,
  prospectDiscoveryRuns,
} from "@outbound/infrastructure/database/schema";

export class CampaignSourcingReconciler {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async reconcile(options: { workspaceId?: string; limit?: number } = {}): Promise<number> {
    const limit = options.limit ?? 100;
    return this.database.transaction(async (tx) => {
      const stalled = await tx
        .select({
          campaignId: campaigns.id,
          workspaceId: campaigns.workspaceId,
          icpVersionId: campaigns.icpVersionId,
          channel: campaigns.channel,
          strategy: channelAssessments.strategy,
          icpName: icpVersions.name,
        })
        .from(campaigns)
        .innerJoin(
          channelAssessments,
          and(
            eq(channelAssessments.workspaceId, campaigns.workspaceId),
            eq(channelAssessments.id, campaigns.assessmentId),
          ),
        )
        .innerJoin(
          icpVersions,
          and(
            eq(icpVersions.workspaceId, campaigns.workspaceId),
            eq(icpVersions.id, campaigns.icpVersionId),
          ),
        )
        .where(
          and(
            eq(campaigns.automationStage, "sourcing"),
            ne(campaigns.status, "archived"),
            isNull(campaigns.discoveryRunId),
            isNotNull(campaigns.channel),
            options.workspaceId ? eq(campaigns.workspaceId, options.workspaceId) : undefined,
          ),
        )
        .limit(limit)
        .for("update", { skipLocked: true });

      let repaired = 0;
      for (const campaign of stalled) {
        if (!campaign.channel) continue;
        const now = this.clock.now();
        const [running] = await tx
          .select({ id: prospectDiscoveryRuns.id })
          .from(prospectDiscoveryRuns)
          .where(
            and(
              eq(prospectDiscoveryRuns.workspaceId, campaign.workspaceId),
              eq(prospectDiscoveryRuns.icpVersionId, campaign.icpVersionId),
              eq(prospectDiscoveryRuns.channel, campaign.channel),
              eq(prospectDiscoveryRuns.status, "running"),
            ),
          )
          .limit(1);
        const runId = running?.id ?? crypto.randomUUID();
        if (!running) {
          const strategy = normalizeStrategy(campaign.strategy, campaign.channel, campaign.icpName);
          await tx.insert(prospectDiscoveryRuns).values({
            id: runId,
            workspaceId: campaign.workspaceId,
            icpVersionId: campaign.icpVersionId,
            provider: campaign.channel === "linkedin" ? "unipile" : "crawler",
            channel: campaign.channel,
            filters: buildAutonomousSourcingFilters(campaign.channel, strategy),
            status: "running",
            createdBy: null,
            createdAt: now,
          });
        }

        const [updated] = await tx
          .update(campaigns)
          .set({
            discoveryRunId: runId,
            automationErrorCode: null,
            automationErrorMessage: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(campaigns.workspaceId, campaign.workspaceId),
              eq(campaigns.id, campaign.campaignId),
              isNull(campaigns.discoveryRunId),
            ),
          )
          .returning({ id: campaigns.id });
        if (!updated) continue;

        const [activeJob] = await tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(
            and(
              eq(jobs.workspaceId, campaign.workspaceId),
              eq(jobs.type, PROSPECT_DISCOVERY_JOB_TYPE),
              inArray(jobs.status, ["pending", "running"]),
              sql`${jobs.payload} ->> 'runId' = ${runId}`,
            ),
          )
          .limit(1);
        if (!activeJob) {
          await tx.insert(jobs).values({
            id: crypto.randomUUID(),
            workspaceId: campaign.workspaceId,
            type: PROSPECT_DISCOVERY_JOB_TYPE,
            payload: { workspaceId: campaign.workspaceId, runId },
            idempotencyKey: `${campaign.campaignId}:sourcing:v2`,
            correlationId: `campaign:${campaign.campaignId}`,
            maxAttempts: 3,
            availableAt: now,
            createdAt: now,
            updatedAt: now,
          }).onConflictDoNothing();
        }
        await tx.insert(outboxEvents).values({
          workspaceId: campaign.workspaceId,
          aggregateType: "Campaign",
          aggregateId: campaign.campaignId,
          eventType: "CampaignSourcingReconciled",
          payload: { campaignId: campaign.campaignId, runId },
          createdAt: now,
        });
        repaired += 1;
      }

      const rejectedQueries = await tx
        .select({
          campaignId: campaigns.id,
          workspaceId: campaigns.workspaceId,
          channel: campaigns.channel,
          runId: prospectDiscoveryRuns.id,
          strategy: channelAssessments.strategy,
          icpName: icpVersions.name,
        })
        .from(campaigns)
        .innerJoin(
          prospectDiscoveryRuns,
          and(
            eq(prospectDiscoveryRuns.workspaceId, campaigns.workspaceId),
            eq(prospectDiscoveryRuns.id, campaigns.discoveryRunId),
          ),
        )
        .innerJoin(
          channelAssessments,
          and(
            eq(channelAssessments.workspaceId, campaigns.workspaceId),
            eq(channelAssessments.id, campaigns.assessmentId),
          ),
        )
        .innerJoin(
          icpVersions,
          and(
            eq(icpVersions.workspaceId, campaigns.workspaceId),
            eq(icpVersions.id, campaigns.icpVersionId),
          ),
        )
        .where(
          and(
            eq(campaigns.automationStage, "sourcing"),
            ne(campaigns.status, "archived"),
            isNotNull(campaigns.channel),
            eq(prospectDiscoveryRuns.status, "failed"),
            sql`${prospectDiscoveryRuns.errorMessage} ilike '%content%too%large%'`,
            options.workspaceId ? eq(campaigns.workspaceId, options.workspaceId) : undefined,
          ),
        )
        .limit(Math.max(0, limit - repaired))
        .for("update", { skipLocked: true });

      for (const campaign of rejectedQueries) {
        if (!campaign.channel) continue;
        const retryKey = `${campaign.campaignId}:sourcing:normalized:v1`;
        const [alreadyRetried] = await tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(
            and(
              eq(jobs.workspaceId, campaign.workspaceId),
              eq(jobs.idempotencyKey, retryKey),
            ),
          )
          .limit(1);
        if (alreadyRetried) continue;

        const now = this.clock.now();
        const strategy = normalizeStrategy(campaign.strategy, campaign.channel, campaign.icpName);
        await tx
          .update(prospectDiscoveryRuns)
          .set({
            filters: buildAutonomousSourcingFilters(campaign.channel, strategy),
            status: "running",
            errorCode: null,
            errorMessage: null,
            candidateCount: 0,
            completedAt: null,
          })
          .where(
            and(
              eq(prospectDiscoveryRuns.workspaceId, campaign.workspaceId),
              eq(prospectDiscoveryRuns.id, campaign.runId),
              eq(prospectDiscoveryRuns.status, "failed"),
            ),
          );
        await tx
          .update(campaigns)
          .set({
            automationErrorCode: null,
            automationErrorMessage: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(campaigns.workspaceId, campaign.workspaceId),
              eq(campaigns.id, campaign.campaignId),
            ),
          );
        await tx.insert(jobs).values({
          id: crypto.randomUUID(),
          workspaceId: campaign.workspaceId,
          type: PROSPECT_DISCOVERY_JOB_TYPE,
          payload: { workspaceId: campaign.workspaceId, runId: campaign.runId },
          idempotencyKey: retryKey,
          correlationId: `campaign:${campaign.campaignId}`,
          maxAttempts: 3,
          availableAt: now,
          createdAt: now,
          updatedAt: now,
        });
        await tx.insert(outboxEvents).values({
          workspaceId: campaign.workspaceId,
          aggregateType: "Campaign",
          aggregateId: campaign.campaignId,
          eventType: "CampaignSourcingQueryNormalized",
          payload: { campaignId: campaign.campaignId, runId: campaign.runId },
          createdAt: now,
        });
        repaired += 1;
      }
      return repaired;
    });
  }
}

const SOURCE_KINDS = new Set<ChannelStrategy["sourceKinds"][number]>([
  "linkedin",
  "web",
  "maps",
  "official_registry",
  "professional_directory",
  "jobs",
  "news",
]);

export function normalizeStrategy(
  value: unknown,
  channel: "linkedin" | "email" | "whatsapp",
  icpName: string,
): ChannelStrategy {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const sourceKinds = Array.isArray(input.sourceKinds)
    ? input.sourceKinds.filter(
      (item): item is ChannelStrategy["sourceKinds"][number] =>
        typeof item === "string" && SOURCE_KINDS.has(item as ChannelStrategy["sourceKinds"][number]),
    )
    : [];
  return {
    query: typeof input.query === "string" && input.query.trim()
      ? input.query.trim()
      : icpName,
    sourceKinds: sourceKinds.length
      ? sourceKinds
      : channel === "linkedin"
        ? ["linkedin"]
        : channel === "email"
          ? ["official_registry", "professional_directory", "web"]
          : ["maps", "professional_directory", "web"],
    rationale: typeof input.rationale === "string" && input.rationale.trim()
      ? input.rationale.trim()
      : "Réparation automatique du sourcing d’une campagne existante.",
    sampleSize: typeof input.sampleSize === "number" && Number.isSafeInteger(input.sampleSize)
      ? Math.max(5, Math.min(25, input.sampleSize))
      : 12,
  };
}
