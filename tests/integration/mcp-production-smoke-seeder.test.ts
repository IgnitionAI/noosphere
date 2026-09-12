import { afterAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import {
  cleanupMcpProductionSmoke,
  prepareMcpProductionSmoke,
  revokeMcpProductionSmoke,
} from "../../scripts/prepare-mcp-production-smoke";

const databaseUrl = process.env.SMOKE_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("MCP production smoke fixture seeder", () => {
  if (!databaseUrl) return;
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10, idle_timeout: 20 });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  test("persists proposal snapshots as JSON objects accepted by the schema check", async () => {
    const fixtureKey = `a4-jsonb-${crypto.randomUUID().slice(0, 8)}`;
    const outputPath = `/tmp/mcp-smoke-${fixtureKey}.env`;
    let prepared: Awaited<ReturnType<typeof prepareMcpProductionSmoke>> | undefined;
    try {
      prepared = await prepareMcpProductionSmoke(databaseUrl, outputPath, {
        fixtureKey,
        host: "mcp-smoke.localhost",
        httpsPort: 18443,
        tokens: {
          reviewer: "reviewer-token-value",
          operator: "operator-token-value",
          viewer: "viewer-token-value",
          revoked: "revoked-token-value",
        },
      });
      const rows = await sql<{
        readonly intentType: string;
        readonly sourceType: string;
      }[]>`
        select jsonb_typeof(intent_snapshot) as "intentType", jsonb_typeof(source_snapshot) as "sourceType"
        from mcp_effect_proposals
        where workspace_id in (${prepared.workspaceIds[0]}, ${prepared.workspaceIds[1]})
        order by id
      `;
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.intentType === "object" && row.sourceType === "object")).toBe(true);
    } finally {
      if (prepared) await cleanupMcpProductionSmoke(databaseUrl, fixtureKey, outputPath);
    }
  }, 30_000);
  test("revocation disables only the fixture memberships and revokes its credentials idempotently", async () => {
    const fixtureKey = `a4-revoke-${crypto.randomUUID().slice(0, 8)}`;
    const otherKey = `a4-other-${crypto.randomUUID().slice(0, 8)}`;
    const paths = [fixtureKey, otherKey].map((key) => `/tmp/mcp-smoke-${key}.env`);
    const prepared: Array<Awaited<ReturnType<typeof prepareMcpProductionSmoke>>> = [];
    async function snapshot(workspaceIds: readonly string[]) {
      return {
        workspaces: [...await sql`select id, slug, status from workspaces where id in ${sql(workspaceIds)} order by id`],
        members: [...await sql`select workspace_id, user_id, status from workspace_members where workspace_id in ${sql(workspaceIds)} order by workspace_id, user_id`],
        clients: [...await sql`select id, revoked_at from mcp_oauth_clients where workspace_id in ${sql(workspaceIds)} order by id`],
        tokens: [...await sql`select id, revoked_at from mcp_oauth_access_tokens where workspace_id in ${sql(workspaceIds)} order by id`],
      };
    }
    try {
      for (const [index, key] of [fixtureKey, otherKey].entries()) {
        prepared.push(await prepareMcpProductionSmoke(databaseUrl, paths[index]!, { fixtureKey: key, host: "mcp-smoke.localhost", httpsPort: 18443 }));
      }
      const otherBefore = await snapshot(prepared[1]!.workspaceIds);
      const before = await snapshot(prepared[0]!.workspaceIds);
      expect(before.members.length).toBeGreaterThan(0);
      expect(before.members.every((row) => row.status === "active")).toBe(true);
      await revokeMcpProductionSmoke(databaseUrl, fixtureKey);
      const after = await snapshot(prepared[0]!.workspaceIds);
      expect(after.workspaces).toEqual(before.workspaces);
      expect(after.members).toHaveLength(before.members.length);
      expect(after.members.every((row) => row.status === "disabled")).toBe(true);
      expect(after.clients).toHaveLength(before.clients.length);
      expect(after.clients.length).toBeGreaterThan(0);
      expect(after.clients.every((row) => row.revoked_at !== null)).toBe(true);
      expect(after.tokens).toHaveLength(before.tokens.length);
      expect(after.tokens.length).toBeGreaterThan(0);
      expect(after.tokens.every((row) => row.revoked_at !== null)).toBe(true);
      expect(await snapshot(prepared[1]!.workspaceIds)).toEqual(otherBefore);
      await revokeMcpProductionSmoke(databaseUrl, fixtureKey);
      expect(await snapshot(prepared[0]!.workspaceIds)).toEqual(after);
      expect(await snapshot(prepared[1]!.workspaceIds)).toEqual(otherBefore);
    } finally {
      for (const [index, plan] of prepared.entries()) await cleanupMcpProductionSmoke(databaseUrl, plan.fixtureKey, paths[index]);
    }
  }, 30_000);
});
