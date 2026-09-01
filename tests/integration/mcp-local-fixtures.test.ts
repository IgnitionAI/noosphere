import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { chmod, readFile, unlink, writeFile } from "node:fs/promises";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { PostgresMcpOAuthStore } from "@outbound/infrastructure/auth/postgres-mcp-oauth-store";
import { createMcpOAuthService } from "@outbound/interface/mcp/mcp-oauth";
import { ExternalEffectPolicy } from "@outbound/application/mcp/external-effect-policy";
import type { McpExecutionContext } from "@outbound/application/mcp/mcp-read-capabilities";
import { PostgresExternalEffectFactsReader } from "@outbound/infrastructure/mcp/postgres-external-effect-facts-reader";
import { PostgresMcpGovernedEffectCapabilities } from "@outbound/infrastructure/mcp/postgres-mcp-governed-effect-capabilities";
import { PostgresMcpGovernedEffectRepository } from "@outbound/infrastructure/mcp/postgres-mcp-governed-effect-repository";
import { stableMcpSmokeUuid } from "../../scripts/prepare-mcp-production-smoke";
import { cleanupMcpLocal, createMcpLocalFixtureDatabaseClient, loadMcpLocalPrivateCredential, prepareMcpLocal, readMcpLocalFixtureFingerprint } from "../../scripts/prepare-mcp-local";

const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = process.env.MCP_LOCAL_FIXTURES_INTEGRATION === "1" && Boolean(databaseUrl);
const fixtureKey = `local-it-${randomBytes(6).toString("hex")}`;
const envFilePath = `/tmp/mcp-local-fixtures-${fixtureKey}.env`;

describe.skipIf(!enabled)("MCP local fixture integration", () => {
  test("creates then reuses one two-workspace fixture without changing its fingerprint", async () => {
    if (!databaseUrl) throw new Error("MCP_LOCAL_FIXTURES_INTEGRATION=1 and TEST_DATABASE_URL are required");
    const client = createMcpLocalFixtureDatabaseClient(databaseUrl);
    const privateFiles = new Map<string, string>();
    const readPrivateFile = async (path: string) => privateFiles.get(path) ?? await readFile(path, "utf8").catch(() => null);
    const writePrivateFile = async (path: string, content: string) => {
      privateFiles.set(path, content);
      await writeFile(path, content, { encoding: "utf8", mode: 0o600 });
      await chmod(path, 0o600);
    };
    try {
      const first = await prepareMcpLocal({ databaseUrl, fixtureKey, envFilePath, readPrivateFile, writePrivateFile });
      const before = await readMcpLocalFixtureFingerprint(databaseUrl, fixtureKey);
      const second = await prepareMcpLocal({ databaseUrl, fixtureKey, envFilePath, readPrivateFile, writePrivateFile });
      const after = await readMcpLocalFixtureFingerprint(databaseUrl, fixtureKey);
      expect(second.fixtureIds).toEqual(first.fixtureIds);
      expect(second.credentials).toEqual(first.credentials);
      expect(after).toEqual(before);
      expect((await readFile(envFilePath, "utf8"))).toContain("MCP_LOCAL_FIXTURE_KEY");
    } finally {
      try {
        await cleanupMcpLocal({ databaseUrl, fixtureKey, envFilePath, client });
      } finally {
        await client.close();
        await unlink(envFilePath).catch(() => undefined);
      }
    }
  });

  test("seeds content and campaign aggregates used by the post-setup verifier", async () => {
    if (!databaseUrl) throw new Error("MCP_LOCAL_FIXTURES_INTEGRATION=1 and TEST_DATABASE_URL are required");
    const client = createMcpLocalFixtureDatabaseClient(databaseUrl);
    const database = createDatabase(databaseUrl);
    const localFixtureKey = `local-source-${randomBytes(6).toString("hex")}`;
    const localEnvFilePath = `/tmp/mcp-local-source-${localFixtureKey}.env`;
    try {
      const fixture = await prepareMcpLocal({ databaseUrl, fixtureKey: localFixtureKey, envFilePath: localEnvFilePath, ...privateFileIo(localEnvFilePath) });
      const source = fixture.fixtureIds.content.foreign;
      const rows = await database.client`
        select
          (select count(*)::int from content_assets where workspace_id = ${fixture.workspaceIds[0]} and id = ${source.assetId} and status = 'ready') as assets,
          (select count(*)::int from content_publications where workspace_id = ${fixture.workspaceIds[0]} and id = ${source.publicationId} and asset_id = ${source.assetId} and status = 'scheduled') as publications,
          (select count(*)::int from campaigns where workspace_id = ${fixture.workspaceIds[0]} and id = ${source.campaignId} and status = 'active') as campaigns
      ` as Array<{ assets: number; publications: number; campaigns: number }>;
      expect(rows).toEqual([{ assets: 1, publications: 1, campaigns: 1 }]);
      expect(source.providerAccountId).toBe(`local-fake-account-${localFixtureKey}-0`);
    } finally {
      try {
        await cleanupMcpLocal({ databaseUrl, fixtureKey: localFixtureKey, envFilePath: localEnvFilePath, client });
      } finally {
        await client.close();
        await database.close();
        await unlink(localEnvFilePath).catch(() => undefined);
      }
    }
  });

  test("seeds conversation aggregates readable by the real facts reader and capabilities", async () => {
    if (!databaseUrl) throw new Error("MCP_LOCAL_FIXTURES_INTEGRATION=1 and TEST_DATABASE_URL are required");
    const localFixtureKey = `local-conversation-${randomBytes(6).toString("hex")}`;
    const localEnvFilePath = `/tmp/mcp-local-conversation-${localFixtureKey}.env`;
    const client = createMcpLocalFixtureDatabaseClient(databaseUrl);
    const database = createDatabase(databaseUrl);
    try {
      const fixture = await prepareMcpLocal({ databaseUrl, fixtureKey: localFixtureKey, envFilePath: localEnvFilePath, ...privateFileIo(localEnvFilePath) });
      const aggregateId = fixture.fixtureIds.aggregate.foreign;
      const reviewerContext: McpExecutionContext = {
        userId: stableMcpSmokeUuid(`${localFixtureKey}:user:reviewer`),
        workspaceId: fixture.workspaceIds[0],
        clientId: fixture.identities[0]!.clientId,
        role: "reviewer",
        scopes: ["mcp:read", "mcp:write", "mcp:approve"],
        audience: fixture.resource,
      };
      const operatorContext: McpExecutionContext = {
        ...reviewerContext,
        userId: stableMcpSmokeUuid(`${localFixtureKey}:user:operator`),
        clientId: fixture.identities[1]!.clientId,
        role: "operator",
        scopes: ["mcp:read", "mcp:write"],
      };
      const reader = new PostgresExternalEffectFactsReader(database.db, () => new Date("2026-08-31T12:00:00.000Z"));
      const facts = await reader.readPrepare({
        context: reviewerContext,
        kind: "conversation_reply",
        aggregateId,
        intentSnapshot: { kind: "conversation_reply", aggregateId, body: "Fixture probe" },
      });
      expect(facts).toMatchObject({ kind: "conversation_reply", aggregateId, contactPresent: true, hasHumanReply: false, adapterAvailable: true, accountHealthy: true, quotaAvailable: true });

      const repository = new PostgresMcpGovernedEffectRepository(database.db, () => new Date("2026-08-31T12:00:00.000Z"));
      const capabilities = new PostgresMcpGovernedEffectCapabilities(repository, reader, new ExternalEffectPolicy(reader), () => new Date("2026-08-31T12:00:00.000Z"));
      const reviewerRequestKey = stableMcpSmokeUuid(`${localFixtureKey}:conversation:reviewer:request`);
      const reviewerProposal = await capabilities.prepare(reviewerContext, { kind: "conversation_reply", conversationId: aggregateId, body: "Fixture reviewer reply", requestKey: reviewerRequestKey, inputHash: "" });
      const reviewerReplay = await capabilities.prepare(reviewerContext, { kind: "conversation_reply", conversationId: aggregateId, body: "Fixture reviewer reply", requestKey: reviewerRequestKey, inputHash: "" });
      const operatorProposal = await capabilities.prepare(operatorContext, { kind: "conversation_reply", conversationId: aggregateId, body: "Fixture operator reply", requestKey: stableMcpSmokeUuid(`${localFixtureKey}:conversation:operator:request`), inputHash: "" });
      expect(reviewerProposal.proposalId).toBe(reviewerReplay.proposalId);
      expect(reviewerProposal.approvalItemId).toBeString();
      expect(operatorProposal.approvalItemId).toBeString();
      expect(await capabilities.status({ ...reviewerContext, workspaceId: fixture.workspaceIds[1], userId: stableMcpSmokeUuid(`${localFixtureKey}:user:viewer`) }, { proposalId: reviewerProposal.proposalId })).toBeNull();
    } finally {
      try {
        await cleanupMcpLocal({ databaseUrl, fixtureKey: localFixtureKey, envFilePath: localEnvFilePath, client });
      } finally {
        await client.close();
        await database.close();
        await unlink(localEnvFilePath).catch(() => undefined);
      }
    }
  });

  test("accepts a fresh OAuth access token and immediately observes demotion and revocation", async () => {
    if (!databaseUrl) throw new Error("MCP_LOCAL_FIXTURES_INTEGRATION=1 and TEST_DATABASE_URL are required");
    const localFixtureKey = `local-oauth-${randomBytes(6).toString("hex")}`;
    const localEnvFilePath = `/tmp/mcp-local-oauth-${localFixtureKey}.env`;
    const client = createMcpLocalFixtureDatabaseClient(databaseUrl);
    const database = createDatabase(databaseUrl);
    try {
      const io = privateFileIo(localEnvFilePath);
      const fixture = await prepareMcpLocal({ databaseUrl, fixtureKey: localFixtureKey, envFilePath: localEnvFilePath, ...io });
      const reviewer = loadMcpLocalPrivateCredential(fixture.credentials, fixture.identities, fixture.fixtureIds, "reviewer");
      const service = createMcpOAuthService(new PostgresMcpOAuthStore(database.db), { issuer: "https://mcp.localhost:18443", resource: fixture.resource });
      const fresh = await service.authenticateMcpRequest({ accessToken: reviewer.token, resource: fixture.resource, requiredScopes: ["mcp:read"] });
      expect(fresh.workspaceId).toBe(fixture.workspaceIds[0]);
      await database.client`update workspace_members set role = 'viewer' where workspace_id = ${fixture.workspaceIds[0]} and user_id = ${fresh.userId}`;
      await expect(service.authenticateMcpRequest({ accessToken: reviewer.token, resource: fixture.resource, requiredScopes: ["mcp:approve"] })).rejects.toMatchObject({ status: 403 });
      const demoted = await service.authenticateMcpRequest({ accessToken: reviewer.token, resource: fixture.resource, requiredScopes: ["mcp:read"] });
      expect(demoted.role).toBe("viewer");
      await database.client`update workspace_members set role = 'reviewer' where workspace_id = ${fixture.workspaceIds[0]} and user_id = ${fresh.userId}`;
      await service.revokeToken({ token: reviewer.token });
      await expect(service.authenticateMcpRequest({ accessToken: reviewer.token, resource: fixture.resource, requiredScopes: ["mcp:read"] })).rejects.toMatchObject({ status: 401 });
    } finally {
      try {
        await cleanupMcpLocal({ databaseUrl, fixtureKey: localFixtureKey, envFilePath: localEnvFilePath, client });
      } finally {
        await client.close();
        await database.close();
        await unlink(localEnvFilePath).catch(() => undefined);
      }
    }
  });

  test("keeps an older fixture isolated when a newer fixture is cleaned", async () => {
    if (!databaseUrl) throw new Error("MCP_LOCAL_FIXTURES_INTEGRATION=1 and TEST_DATABASE_URL are required");
    const olderKey = `local-old-${randomBytes(6).toString("hex")}`;
    const newerKey = `local-new-${randomBytes(6).toString("hex")}`;
    const olderPath = `/tmp/mcp-local-old-${olderKey}.env`;
    const newerPath = `/tmp/mcp-local-new-${newerKey}.env`;
    const client = createMcpLocalFixtureDatabaseClient(databaseUrl);
    try {
      const oldFixture = await prepareMcpLocal({ databaseUrl, fixtureKey: olderKey, envFilePath: olderPath, ...privateFileIo(olderPath) });
      const oldFingerprint = await readMcpLocalFixtureFingerprint(databaseUrl, olderKey);
      await prepareMcpLocal({ databaseUrl, fixtureKey: newerKey, envFilePath: newerPath, ...privateFileIo(newerPath) });
      await cleanupMcpLocal({ databaseUrl, fixtureKey: newerKey, envFilePath: newerPath, client });
      expect(await readMcpLocalFixtureFingerprint(databaseUrl, olderKey)).toEqual(oldFingerprint);
      expect(oldFixture.fixtureKey).toBe(olderKey);
    } finally {
      try {
        await cleanupMcpLocal({ databaseUrl, fixtureKey: olderKey, envFilePath: olderPath, client });
      } finally {
        await client.close();
        await unlink(olderPath).catch(() => undefined);
        await unlink(newerPath).catch(() => undefined);
      }
    }
  });

  test("serializes concurrent same-key creates and rejects a hash mismatch", async () => {
    if (!databaseUrl) throw new Error("MCP_LOCAL_FIXTURES_INTEGRATION=1 and TEST_DATABASE_URL are required");
    const localFixtureKey = `local-concurrent-${randomBytes(6).toString("hex")}`;
    const firstPath = `/tmp/mcp-local-concurrent-a-${localFixtureKey}.env`;
    const secondPath = `/tmp/mcp-local-concurrent-b-${localFixtureKey}.env`;
    const client = createMcpLocalFixtureDatabaseClient(databaseUrl);
    try {
      const results = await Promise.allSettled([
        prepareMcpLocal({ databaseUrl, fixtureKey: localFixtureKey, envFilePath: firstPath, ...privateFileIo(firstPath) }),
        prepareMcpLocal({ databaseUrl, fixtureKey: localFixtureKey, envFilePath: secondPath, ...privateFileIo(secondPath) }),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      const winningPath = results.find((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof prepareMcpLocal>>> => result.status === "fulfilled")!.value.envFilePath;
      const winningContent = await readFile(winningPath, "utf8");
      const mismatchedContent = winningContent.replace(/MCP_LOCAL_REVIEWER_TOKEN='[^']*'/, "MCP_LOCAL_REVIEWER_TOKEN='mismatch-reviewer-token'");
      await writeFile(winningPath, mismatchedContent, { encoding: "utf8", mode: 0o600 });
      await expect(prepareMcpLocal({ databaseUrl, fixtureKey: localFixtureKey, envFilePath: winningPath, ...privateFileIo(winningPath) })).rejects.toMatchObject({ code: "MCP_LOCAL_FIXTURE_MISMATCH" });
    } finally {
      try {
        await cleanupMcpLocal({ databaseUrl, fixtureKey: localFixtureKey, envFilePath: firstPath, client });
      } finally {
        await client.close();
        await unlink(firstPath).catch(() => undefined);
        await unlink(secondPath).catch(() => undefined);
      }
    }
  });
});

function privateFileIo(path: string): {
  readonly readPrivateFile: (path: string) => Promise<string | null>;
  readonly writePrivateFile: (path: string, content: string) => Promise<void>;
} {
  return {
    readPrivateFile: async (candidate) => readFile(candidate, "utf8").catch(() => null),
    writePrivateFile: async (candidate, content) => {
      await writeFile(candidate, content, { encoding: "utf8", mode: 0o600 });
      await chmod(candidate, 0o600);
    },
  };
}
