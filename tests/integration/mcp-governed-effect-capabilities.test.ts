import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { and, eq } from "drizzle-orm";
import type { ExternalEffectFacts } from "@outbound/application/mcp/external-effect-policy";
import type { McpExecutionContext } from "@outbound/application/mcp/mcp-governed-effects";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { approvalItems, jobs, mcpEffectIntentions, mcpEffectProposals, mcpEffectTraces, outboxEvents, workspaces } from "@outbound/infrastructure/database/schema";
import { ExternalEffectPolicy } from "@outbound/application/mcp/external-effect-policy";
import { PostgresExternalEffectFactsReader } from "@outbound/infrastructure/mcp/postgres-external-effect-facts-reader";
import { PostgresMcpGovernedEffectRepository } from "@outbound/infrastructure/mcp/postgres-mcp-governed-effect-repository";
import { PostgresMcpGovernedEffectCapabilities } from "@outbound/infrastructure/mcp/postgres-mcp-governed-effect-capabilities";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("MCP governed-effect production capability", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const context: McpExecutionContext = {
    userId: crypto.randomUUID(), workspaceId, clientId: "capability-integration", role: "reviewer",
    scopes: ["mcp:read", "mcp:write", "mcp:approve"], audience: "https://example.test/mcp",
  };
  const now = new Date("2026-08-29T12:00:00.000Z");
  const conversationId = crypto.randomUUID();
  const assetId = crypto.randomUUID();
  const publicationId = crypto.randomUUID();
  const meetingId = crypto.randomUUID();
  const campaignId = crypto.randomUUID();

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values({ id: workspaceId, slug: `capability-${workspaceId}`, name: "Capability fixture" });
  });

  afterAll(async () => {
    await database.client`update mcp_effect_proposals set approval_item_id = null where workspace_id = ${workspaceId}`;
    await database.client`delete from mcp_effect_traces where workspace_id = ${workspaceId}`;
    await database.client`delete from outbox_events where workspace_id = ${workspaceId}`;
    await database.client`delete from mcp_effect_intentions where workspace_id = ${workspaceId}`;
    await database.client`delete from approval_items where workspace_id = ${workspaceId}`;
    await database.client`delete from mcp_effect_proposals where workspace_id = ${workspaceId}`;
    await database.db.delete(jobs).where(eq(jobs.workspaceId, workspaceId));
    await database.db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await database.close();
  });

  test("persists authoritative prepare proposals for supported kinds without execution artifacts", async () => {
    const facts = (kind: ExternalEffectFacts["kind"], aggregateId: string, extra: Record<string, unknown> = {}): ExternalEffectFacts => ({
      kind, aggregateId, revision: 2, sourceVersion: 4, factsVersion: 4,
      sourceId: `${kind}:${aggregateId}`, sourceUpdatedAt: now.toISOString(), status: kind === "meeting_proposal" ? "offered" : "ready",
      adapterAvailable: true, accountHealthy: true, quotaAvailable: true, evaluatedAt: now.toISOString(),
      ...extra,
    } as ExternalEffectFacts);
    const reader = {
      readPrepare: async (input: { readonly kind: string; readonly aggregateId: string }) => {
        if (input.kind === "conversation_reply") return facts("conversation_reply", input.aggregateId, { suppressed: false, humanReplyAt: null });
        if (input.kind === "content_publication") return facts("content_publication", input.aggregateId, {
          assetId, publicationId, assetVersionId: crypto.randomUUID(), contentVersion: 1, policyVersion: "editorial-v1",
          assetReady: true, assetStatus: "ready", strategyActive: true, strategyDeleted: false, strategyVersion: 1,
        });
        if (input.kind === "meeting_proposal") return facts("meeting_proposal", input.aggregateId, {
          slotPosition: 1, slotStart: "2026-09-01T10:00:00.000Z", slotEnd: "2026-09-01T10:30:00.000Z", timeZone: "UTC", expiresAt: "2026-09-02T00:00:00.000Z",
        });
        return facts("campaign_activation", input.aggregateId, {
          adapterAvailable: false, policyVersion: "campaign-v1", automationStage: "ready", enrollmentFingerprint: "a".repeat(64),
          scheduleWindow: { start: "2026-09-01T09:00:00.000Z", end: "2026-09-01T17:00:00.000Z", timeZone: "UTC" }, accountHealth: { status: "healthy", checkedAt: now.toISOString() },
        });
      },
    };
    const repository = new PostgresMcpGovernedEffectRepository(database.db, () => now);
    const policy = new ExternalEffectPolicy(new PostgresExternalEffectFactsReader(database.db, () => now));
    const capabilities = new PostgresMcpGovernedEffectCapabilities(repository, reader, policy, () => now);

    await capabilities.prepare(context, { kind: "conversation_reply", requestKey: crypto.randomUUID(), inputHash: "a".repeat(64), conversationId, body: "Reply" });
    await capabilities.prepare(context, { kind: "content_publication", requestKey: crypto.randomUUID(), inputHash: "a".repeat(64), assetId });
    await capabilities.prepare(context, { kind: "meeting_proposal", requestKey: crypto.randomUUID(), inputHash: "a".repeat(64), meetingProposalId: meetingId, slotPosition: 1 });
    await expect(capabilities.prepare(context, { kind: "campaign_activation", requestKey: crypto.randomUUID(), inputHash: "a".repeat(64), campaignId })).rejects.toThrow("MCP_EFFECT_ADAPTER_UNAVAILABLE");

    const proposals = await database.db.select({ id: mcpEffectProposals.id }).from(mcpEffectProposals).where(eq(mcpEffectProposals.workspaceId, workspaceId));
    expect(proposals).toHaveLength(3);
    expect(await database.db.select({ id: mcpEffectIntentions.id }).from(mcpEffectIntentions).where(eq(mcpEffectIntentions.workspaceId, workspaceId))).toHaveLength(0);
    expect(await database.db.select({ id: jobs.id }).from(jobs).where(eq(jobs.workspaceId, workspaceId))).toHaveLength(0);
    expect(await database.db.select({ id: outboxEvents.id }).from(outboxEvents).where(eq(outboxEvents.workspaceId, workspaceId))).toHaveLength(0);
  });

  test("lists and resolves only proposals owned by the authenticated workspace", async () => {
    const repository = new PostgresMcpGovernedEffectRepository(database.db, () => now);
    const policy = new ExternalEffectPolicy(new PostgresExternalEffectFactsReader(database.db, () => now));
    const capabilities = new PostgresMcpGovernedEffectCapabilities(repository, { readPrepare: async () => null }, policy, () => now);
    const values = await capabilities.list(context, { limit: 10 });
    expect(values).toHaveLength(3);
    expect(await capabilities.status({ ...context, workspaceId: crypto.randomUUID() }, { proposalId: values[0]!.proposalId })).toBeNull();
  });
});
