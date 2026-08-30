import { afterAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import {
  cleanupMcpProductionSmoke,
  prepareMcpProductionSmoke,
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
});
