import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createMcpSmokeSeedPlan,
  formatMcpSmokeEnvironmentFile,
  mcpSmokeProposalInputHash,
  resolveMcpSmokeFixtureIds,
  resolveMcpSmokeConversationFixtureIds,
  isMcpSmokeScheduledForValid,
  validateMcpSmokeWorkspaceIdentity,
} from "../../scripts/prepare-mcp-production-smoke";

describe("MCP production smoke fixture seeder", () => {
  test("resolves a deterministic conversation source chain for each aggregate", () => {
    const fixtureKey = "unit-conversation-chain";
    const ids = resolveMcpSmokeFixtureIds(fixtureKey);
    const foreign = resolveMcpSmokeConversationFixtureIds(fixtureKey, 0);
    const viewer = resolveMcpSmokeConversationFixtureIds(fixtureKey, 1);
    expect(foreign.conversationId).toBe(ids.aggregate.foreign);
    expect(viewer.conversationId).toBe(ids.aggregate.viewer);
    expect(new Set([foreign.contactId, viewer.contactId, foreign.identityId, viewer.identityId, foreign.accountId, viewer.accountId, foreign.messageId, viewer.messageId]).size).toBe(8);
    expect(foreign.providerAccountId).toBe("local-fake-messaging-unit-conversation-chain-0");
    expect(foreign).toEqual(resolveMcpSmokeConversationFixtureIds(fixtureKey, 0));
  });
  test("binds proposal snapshots as JSON objects instead of JSONB strings", () => {
    const source = readFileSync(resolve(import.meta.dir, "../../scripts/prepare-mcp-production-smoke.ts"), "utf8");
    expect(source).not.toMatch(/JSON\.stringify\([^\n]+\)::jsonb/);
    expect(source).not.toContain("::jsonb");
    expect(source).not.toContain("jsonb_build_object");
    expect(source).toContain("tx.json(");
  });

  test("seeds deterministic content and campaign source aggregates for local verification", () => {
    const source = readFileSync(resolve(import.meta.dir, "../../scripts/prepare-mcp-production-smoke.ts"), "utf8");
    expect(source).toContain("insertContentSourceFixture");
    expect(source).toContain("content_publications");
    expect(source).toContain("campaigns");
    expect(source).toContain("local-fixture-no-provider");
    const ids = resolveMcpSmokeFixtureIds("unit-source");
    expect(ids.content.foreign.assetId).not.toBe(ids.aggregate.foreign);
    expect(ids.content.foreign.campaignId).not.toBe(ids.aggregate.foreign);
    expect(ids.content.foreign.publicationId).not.toBe(ids.content.viewer.publicationId);
    expect(ids.content.foreign.providerAccountId).toBe("local-fake-account-unit-source-0");
  });

  test("validates the complete FactsReader source chain and protects immutable cleanup", () => {
    const source = readFileSync(resolve(import.meta.dir, "../../scripts/prepare-mcp-production-smoke.ts"), "utf8");
    expect(source).toContain("readContentSourceState");
    expect(source).toContain("content_asset_versions");
    expect(source).toContain("content_publication_reconciliations");
    expect(source).toContain("workspace_channel_accounts");
    expect(source).not.toContain("disable trigger");
    expect(source).not.toContain("alter table content_briefs");
    expect(source).not.toContain("alter table content_asset_versions");
    expect(source).toContain("immutable content source rows are retained");
    expect(source).toContain("assertDisposableLocalDatabase(databaseUrl)");
    expect(source).toContain("expectedWorkspaceIds");
    expect(source).toContain("MCP_SMOKE_FIXTURE_IMMUTABLE_RETAINED");
    expect(source).toContain("scheduledFor");
    expect(source).toContain("scheduled_for");
    expect(source).toContain("schedule_start");
    expect(source).toContain("schedule_end");
    expect(source).toContain('channel === "linkedin"');
  });

  test("keeps generated OAuth environment private inside the non-root container", () => {
    const source = readFileSync(resolve(import.meta.dir, "../../scripts/prepare-mcp-production-smoke.ts"), "utf8");
    expect(source).toContain('MCP_SMOKE_PRIVATE_ENV_DIRECTORY = "/tmp/mcp-smoke-private"');
    expect(source).toContain("mode: 0o700");
    expect(source).toContain("mode: 0o600");
    expect(source).toContain("chmod(outputPath, 0o600)");
    expect(source).not.toContain("console.log(JSON.stringify");
  });

  test("builds an idempotent two-workspace identity matrix with scoped probes", () => {
    const plan = createMcpSmokeSeedPlan({
      fixtureKey: "unit-seeder",
      host: "mcp-smoke.localhost",
      httpsPort: 18443,
      tokens: {
        reviewer: "reviewer-token-value",
        operator: "operator-token-value",
        viewer: "viewer-token-value",
        revoked: "revoked-token-value",
      },
    });
    expect(new Set(plan.identities.map((identity) => identity.workspaceId)).size).toBe(2);
    expect(plan.identities.map((identity) => identity.role)).toEqual(["reviewer", "operator", "viewer"]);
    expect(plan.foreignProposalId).not.toBe(plan.viewerProposalId);
    expect(plan.workspaceSlugs).toEqual([
      "mcp-smoke-unit-seeder-a",
      "mcp-smoke-unit-seeder-b",
    ]);
  });

  test("requires a new fixture key after immutable cleanup retention", () => {
    const oldPlan = createMcpSmokeSeedPlan({ fixtureKey: "unit-cleanup-old", host: "mcp-smoke.localhost", httpsPort: 18443, tokens: {
      reviewer: "reviewer-token-value", operator: "operator-token-value", viewer: "viewer-token-value", revoked: "revoked-token-value",
    } });
    const newPlan = createMcpSmokeSeedPlan({ fixtureKey: "unit-cleanup-new", host: "mcp-smoke.localhost", httpsPort: 18443, tokens: {
      reviewer: "reviewer-token-value", operator: "operator-token-value", viewer: "viewer-token-value", revoked: "revoked-token-value",
    } });
    expect(newPlan.workspaceIds).not.toEqual(oldPlan.workspaceIds);
    expect(newPlan.foreignProposalId).not.toBe(oldPlan.foreignProposalId);
  });

  test("rejects a publication schedule at or before the reuse clock", () => {
    const now = new Date("2026-08-31T12:00:00.000Z");
    expect(isMcpSmokeScheduledForValid(new Date(now.getTime() - 1), now)).toBe(false);
    expect(isMcpSmokeScheduledForValid(new Date(now), now)).toBe(false);
    expect(isMcpSmokeScheduledForValid(new Date(now.getTime() + 1), now)).toBe(true);
    expect(isMcpSmokeScheduledForValid(new Date("invalid"), now)).toBe(false);
    expect(isMcpSmokeScheduledForValid("2026-08-31T12:01:00.000Z", now)).toBe(false);
  });

  test("rejects workspace slug or ID collisions before cleanup mutation", () => {
    const expectedId = "00000000-0000-4000-8000-000000000001";
    const otherId = "00000000-0000-4000-8000-000000000002";
    expect(() => validateMcpSmokeWorkspaceIdentity({
      expectedId,
      expectedSlug: "mcp-smoke-unit-a",
      slugRows: [{ id: otherId, slug: "mcp-smoke-unit-a" }],
      idRows: [{ id: expectedId, slug: "mcp-smoke-other" }],
    })).toThrow("MCP_SMOKE_FIXTURE_CLEANUP_IDENTITY_MISMATCH");
    expect(() => validateMcpSmokeWorkspaceIdentity({
      expectedId,
      expectedSlug: "mcp-smoke-unit-a",
      slugRows: [{ id: expectedId, slug: "mcp-smoke-unit-a" }],
      idRows: [],
    })).toThrow("MCP_SMOKE_FIXTURE_CLEANUP_IDENTITY_MISMATCH");
  });

  test("writes shell-sourceable env without database credentials or secret output", () => {
    const plan = createMcpSmokeSeedPlan({
      fixtureKey: "unit-seeder-env",
      host: "mcp-smoke.localhost",
      httpsPort: 18443,
      tokens: {
        reviewer: "reviewer-token-value",
        operator: "operator-token-value",
        viewer: "viewer-token-value",
        revoked: "revoked-token-value",
      },
    });
    const envFile = formatMcpSmokeEnvironmentFile(plan);
    expect(envFile).toContain("MCP_SMOKE_IDENTITIES_JSON='");
    expect(envFile).toContain("MCP_SMOKE_URL='https://mcp-smoke.localhost:18443/mcp'");
    expect(envFile).not.toContain("DATABASE_URL");
    expect(envFile).not.toContain("TEST_DATABASE_URL");
    expect(envFile).not.toContain("MCP_SMOKE_ENV_FILE");
    expect(envFile).toContain("MCP_SMOKE_FOREIGN_CONTENT_ASSET_ID=");
    expect(envFile).toContain("MCP_SMOKE_FOREIGN_CONTENT_PUBLICATION_ID=");
    expect(envFile).toContain("MCP_SMOKE_FOREIGN_CAMPAIGN_ID=");
  });

  test("uses a PostgreSQL-compatible 64-character proposal input hash", () => {
    expect(mcpSmokeProposalInputHash("fixture-input")).toMatch(/^[0-9a-f]{64}$/);
  });
});
