import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("F-012 messaging strategy and AI policy persistence", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const strategyId = crypto.randomUUID();
  const strategyVersionId = crypto.randomUUID();
  const policyId = crypto.randomUUID();
  const policyVersionId = crypto.randomUUID();

  beforeAll(async () => {
    await migrate(database.db, {
      migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations"),
    });
  });

  afterAll(async () => {
    await database.close();
  });

  test("enforces unique version numbers per strategy and policy", async () => {
    try {
      await database.client.begin(async (sql) => {
      await sql`insert into workspaces (id, slug, name) values (${workspaceId}, ${`strategy-${workspaceId}`}, 'F-012')`;
      await sql`insert into messaging_strategies (id, workspace_id, name) values (${strategyId}, ${workspaceId}, 'Outbound')`;
      await sql`insert into messaging_strategy_versions (id, workspace_id, strategy_id, version, rules, published_at)
        values (${strategyVersionId}, ${workspaceId}, ${strategyId}, 1, '{}'::jsonb, now())`;
      await sql`savepoint duplicate_strategy_version`;
      let strategyError: unknown;
      try {
        await sql`insert into messaging_strategy_versions (id, workspace_id, strategy_id, version, rules, published_at)
          values (${crypto.randomUUID()}, ${workspaceId}, ${strategyId}, 1, '{}'::jsonb, now())`;
      } catch (error) {
        strategyError = error;
      }
      expect(String(strategyError)).toContain("messaging_strategy_versions_strategy_version_uq");
      await sql`rollback to savepoint duplicate_strategy_version`;

      await sql`insert into ai_policies (id, workspace_id, name) values (${policyId}, ${workspaceId}, 'Supervision')`;
      await sql`insert into ai_policy_versions (id, workspace_id, policy_id, version, rules, published_at)
        values (${policyVersionId}, ${workspaceId}, ${policyId}, 1, '{}'::jsonb, now())`;
      await sql`savepoint duplicate_policy_version`;
      let policyError: unknown;
      try {
        await sql`insert into ai_policy_versions (id, workspace_id, policy_id, version, rules, published_at)
          values (${crypto.randomUUID()}, ${workspaceId}, ${policyId}, 1, '{}'::jsonb, now())`;
      } catch (error) {
        policyError = error;
      }
      expect(String(policyError)).toContain("ai_policy_versions_policy_version_uq");
        await sql`rollback to savepoint duplicate_policy_version`;
        throw new Error("ROLLBACK_F012_TEST");
      });
    } catch (error) {
      expect(String(error)).toContain("ROLLBACK_F012_TEST");
    }
  });

  test("rejects update and delete of published strategy and policy versions", async () => {
    try {
      await database.client.begin(async (sql) => {
      await sql`insert into workspaces (id, slug, name) values (${workspaceId}, ${`strategy-${workspaceId}`}, 'F-012')`;
      await sql`insert into messaging_strategies (id, workspace_id, name) values (${strategyId}, ${workspaceId}, 'Outbound')`;
      await sql`insert into messaging_strategy_versions (id, workspace_id, strategy_id, version, rules, published_at)
        values (${strategyVersionId}, ${workspaceId}, ${strategyId}, 1, '{}'::jsonb, now())`;
      await sql`insert into ai_policies (id, workspace_id, name) values (${policyId}, ${workspaceId}, 'Supervision')`;
      await sql`insert into ai_policy_versions (id, workspace_id, policy_id, version, rules, published_at)
        values (${policyVersionId}, ${workspaceId}, ${policyId}, 1, '{}'::jsonb, now())`;

      await assertImmutable(sql, "messaging_strategy_versions", strategyVersionId, "MESSAGING_STRATEGY_VERSION_IMMUTABLE");
        await assertImmutable(sql, "ai_policy_versions", policyVersionId, "AI_POLICY_VERSION_IMMUTABLE");
        throw new Error("ROLLBACK_F012_TEST");
      });
    } catch (error) {
      expect(String(error)).toContain("ROLLBACK_F012_TEST");
    }
  });
});

async function assertImmutable(
  sql: {
    (strings: TemplateStringsArray, ...values: unknown[]): unknown;
    unsafe(query: string): unknown;
  },
  table: "messaging_strategy_versions" | "ai_policy_versions",
  id: string,
  expectedMessage: string,
) {
  await sql`savepoint immutable_update`;
  let updateError: unknown;
  try {
    await sql.unsafe(`update ${table} set rules = '{"changed":true}'::jsonb where id = '${id}'`);
  } catch (error) {
    updateError = error;
  }
  expect(String(updateError)).toContain(expectedMessage);
  await sql`rollback to savepoint immutable_update`;

  await sql`savepoint immutable_delete`;
  let deleteError: unknown;
  try {
    await sql.unsafe(`delete from ${table} where id = '${id}'`);
  } catch (error) {
    deleteError = error;
  }
  expect(String(deleteError)).toContain(expectedMessage);
  await sql`rollback to savepoint immutable_delete`;
}
