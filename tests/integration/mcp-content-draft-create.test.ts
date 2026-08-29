import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { createMcpWriteCapabilities } from "@outbound/bootstrap/create-noosphere-api-runtime";
import {
  authUsers,
  contentIdeaDiscoveryRuns,
  contentIdeaSources,
  contentIdeas,
  editorialStrategies,
  editorialStrategyVersions,
  icpVersions,
  icps,
  jobs,
  mcpOauthClients,
  offerVersions,
  offers,
  workspaceMembers,
  workspaces,
} from "@outbound/infrastructure/database/schema";
import { CONTENT_GENERATION_JOB_TYPE } from "@outbound/application/content/content-generation";
import type { McpExecutionContext, McpWriteCommand } from "@outbound/application/mcp/mcp-write-capabilities";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("MCP content_draft_create PostgreSQL composition", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const clientId = `mcp-content-draft-${workspaceId}`;
  const workspaceSlug = `mcp-content-draft-${workspaceId}`;
  const offerId = crypto.randomUUID();
  const offerVersionId = crypto.randomUUID();
  const icpId = crypto.randomUUID();
  const icpVersionId = crypto.randomUUID();
  const strategyId = crypto.randomUUID();
  const strategyVersionId = crypto.randomUUID();
  const discoveryRunId = crypto.randomUUID();
  const ideaId = crypto.randomUUID();
  const now = new Date("2026-08-29T12:00:00.000Z");
  const requestKey = crypto.randomUUID();
  const context: McpExecutionContext = {
    workspaceId,
    userId,
    clientId,
    role: "owner",
    scopes: ["mcp:write"],
    audience: "/mcp",
  };
  const command: McpWriteCommand<"content_draft_create"> = {
    operation: "content_draft_create",
    requestKey,
    inputHash: "a".repeat(64),
    arguments: { requestKey, ideaId, body: "Draft instruction", format: "linkedin_text" },
  };

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values({ id: workspaceId, slug: workspaceSlug, name: "MCP content draft" });
    await database.db.insert(authUsers).values({ id: userId, name: "MCP Content Draft User", email: `${clientId}@example.test` });
    await database.db.insert(workspaceMembers).values({ workspaceId, userId, role: "owner", status: "active" });
    await database.db.insert(mcpOauthClients).values({
      id: crypto.randomUUID(), clientId, clientName: "MCP Content Draft Test Client", redirectUris: [], userId,
      workspaceId, workspaceSlug, allowedScopes: ["mcp:read", "mcp:write"],
    });
    await database.db.insert(offers).values({ id: offerId, workspaceId, name: `Offer ${workspaceId}`, status: "draft", currentVersion: 1, createdBy: userId });
    await database.db.insert(offerVersions).values({ id: offerVersionId, workspaceId, offerId, version: 1, name: "Offer", category: "saas", valueProposition: "Value", targetAudience: "Operators", publishedBy: userId, publishedAt: now });
    await database.db.insert(icps).values({ id: icpId, workspaceId, name: "Operators", currentVersion: 1 });
    await database.db.insert(icpVersions).values({ id: icpVersionId, workspaceId, icpId, version: 1, name: "Operators", confidence: "0.9000", criteria: {}, buyingCommittee: {}, problems: [], signals: [], exclusions: [], unknowns: [], unresolvedContradictions: [], blockedFindings: [], publishedBy: userId, publishedAt: now });
    await database.db.insert(editorialStrategies).values({ id: strategyId, workspaceId, name: "Strategy", offerId, offerVersionId, icpId, icpVersionId, status: "active", currentVersion: 1, draft: {}, provider: "test", model: "test", promptVersion: "test", createdBy: userId });
    await database.db.insert(editorialStrategyVersions).values({ id: strategyVersionId, workspaceId, strategyId, version: 1, offerVersionId, icpVersionId, snapshot: {}, provider: "test", model: "test", promptVersion: "test", publishedBy: userId, publishedAt: now });
    await database.db.insert(contentIdeaDiscoveryRuns).values({ id: discoveryRunId, workspaceId, strategyVersionId, trigger: "manual", status: "completed", queryPlan: [], queryLimit: 1, sourceLimit: 1, deadlineAt: now, createdBy: userId, completedAt: now, createdAt: now, updatedAt: now });
    await database.db.insert(contentIdeas).values({ id: ideaId, workspaceId, strategyVersionId, status: "discovered", angle: "A tested angle", rationale: "A tested rationale", audience: "Operators", pillar: "Proof", priority: 80, fingerprint: ideaId.replaceAll("-", ""), freshnessUntil: new Date(now.getTime() + 60_000), firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now });
    await database.db.insert(contentIdeaSources).values({ id: crypto.randomUUID(), workspaceId, ideaId, runId: discoveryRunId, type: "public_web", sourceRef: "fixture", title: "Fixture", excerpt: "Fixture evidence", contentHash: "fixture-hash", collectedAt: now });
  }, 30_000);

  afterAll(async () => {
    await database.client`drop trigger if exists audit_logs_immutable_trg on audit_logs`;
    await database.client`delete from jobs where workspace_id = ${workspaceId}`;
    await database.client`delete from audit_logs where workspace_id = ${workspaceId}`;
    await database.client`delete from outbox_events where workspace_id = ${workspaceId}`;
    await database.client`delete from mcp_oauth_audit_events where workspace_id = ${workspaceId}`;
    await database.client`delete from mcp_oauth_clients where client_id = ${clientId}`;
    await database.client`delete from workspace_members where workspace_id = ${workspaceId}`;
    await database.client`delete from content_generation_runs where workspace_id = ${workspaceId}`;
    await database.client`delete from content_assets where workspace_id = ${workspaceId}`;
    await database.client`delete from content_operation_requests where workspace_id = ${workspaceId}`;
    await database.client`delete from content_idea_sources where workspace_id = ${workspaceId}`;
    await database.client`delete from content_ideas where workspace_id = ${workspaceId}`;
    await database.client`delete from content_idea_discovery_runs where workspace_id = ${workspaceId}`;
    await database.client`alter table editorial_strategy_versions disable trigger editorial_strategy_versions_immutable_trg`;
    await database.client`delete from editorial_strategy_versions where workspace_id = ${workspaceId}`;
    await database.client`alter table editorial_strategy_versions enable trigger editorial_strategy_versions_immutable_trg`;
    await database.client`delete from editorial_strategies where workspace_id = ${workspaceId}`;
    await database.client`alter table icp_versions disable trigger icp_versions_immutable_trg`;
    await database.client`delete from icp_versions where workspace_id = ${workspaceId}`;
    await database.client`alter table icp_versions enable trigger icp_versions_immutable_trg`;
    await database.client`delete from icps where workspace_id = ${workspaceId}`;
    await database.client`alter table offer_versions disable trigger offer_versions_immutable_trg`;
    await database.client`delete from offer_versions where workspace_id = ${workspaceId}`;
    await database.client`alter table offer_versions enable trigger offer_versions_immutable_trg`;
    await database.client`delete from offers where workspace_id = ${workspaceId}`;
    await database.client`delete from auth_users where id = ${userId}`;
    await database.client`delete from workspaces where id = ${workspaceId}`;
    await database.client`create trigger audit_logs_immutable_trg before update or delete on audit_logs for each row execute function reject_audit_log_mutation()`;
    await database.close();
  }, 30_000);

  test("creates one queued domain run/job/operation with one correlation and stable replay", async () => {
    const capabilities = createMcpWriteCapabilities(database.db, { now: () => now });

    const first = await capabilities.execute(context, command);
    const replay = await capabilities.execute(context, command);
    const [runCount] = await database.client`select count(*)::int as count from content_generation_runs where workspace_id = ${workspaceId}`;
    const [jobCount] = await database.client`select count(*)::int as count from jobs where workspace_id = ${workspaceId} and type = ${CONTENT_GENERATION_JOB_TYPE}`;
    const [operation] = await database.client`select job_id, correlation_id, result_refs from mcp_operations where workspace_id = ${workspaceId} and operation_id = ${first.operationId!}`;
    const [job] = await database.client`select id, correlation_id from jobs where id = ${first.jobId!} and workspace_id = ${workspaceId}`;
    const [audit] = await database.client`select correlation_id from mcp_oauth_audit_events where id = ${first.auditId!} and workspace_id = ${workspaceId}`;
    const [output] = await database.client`select result from mcp_write_operations where workspace_id = ${workspaceId} and request_key = ${requestKey}`;

    expect(first.state).toBe("queued");
    expect(first.status).toBe("queued");
    expect(first.operationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.jobId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(runCount?.count).toBe(1);
    expect(jobCount?.count).toBe(1);
    expect(operation?.job_id).toBe(first.jobId);
    expect(operation?.correlation_id).toBe(first.correlationId);
    expect(job?.correlation_id).toBe(first.correlationId);
    expect(audit?.correlation_id).toBe(first.correlationId);
    expect(output?.result?.correlationId).toBe(first.correlationId);
    expect(replay).toEqual(first);

    await expect(capabilities.execute(context, { ...command, inputHash: "b".repeat(64) })).rejects.toThrow("MCP_WRITE_IDEMPOTENCY_CONFLICT");
    const [afterConflict] = await database.client`select count(*)::int as count from jobs where workspace_id = ${workspaceId} and type = ${CONTENT_GENERATION_JOB_TYPE}`;
    expect(afterConflict?.count).toBe(1);
  });
});
