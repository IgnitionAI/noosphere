import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("MCP governed external effects schema", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);

  beforeAll(async () => {
    await migrate(database.db, {
      migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations"),
    });
  });

  afterAll(async () => {
    await database.close();
  });

  test("creates the additive governed effect tables and bounded constraints", async () => {
    const tables = await database.client`
      select table_name from information_schema.tables
      where table_schema = 'public'
        and table_name in ('mcp_effect_proposals', 'mcp_effect_intentions', 'mcp_effect_traces', 'mcp_effect_reconciliations')
      order by table_name
    `;
    expect(tables.map((row) => row.table_name)).toEqual([
      "mcp_effect_intentions",
      "mcp_effect_proposals",
      "mcp_effect_reconciliations",
      "mcp_effect_traces",
    ]);

    const checks = await database.client`
      select constraint_name from information_schema.table_constraints
      where table_schema = 'public'
        and table_name in ('mcp_effect_proposals', 'mcp_effect_intentions', 'mcp_effect_traces', 'mcp_effect_reconciliations')
        and constraint_type = 'CHECK'
    `;
    expect(checks.length).toBeGreaterThanOrEqual(10);
  });

  test("keeps migration forward-only and adds proposal/revision columns", async () => {
    const journal = JSON.parse(await readFile(resolve(import.meta.dir, "../../packages/infrastructure/migrations/meta/_journal.json"), "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(journal.entries.at(-1)).toMatchObject({
      idx: 106,
      tag: "0106_mcp_reconciliation_matched_invariant",
    });

    const columns = await database.client`
      select table_name, column_name from information_schema.columns
      where (table_name = 'approval_items' and column_name = 'proposal_id')
         or (table_name = 'meeting_proposals' and column_name in ('revision', 'source_version'))
         or (table_name = 'mcp_effect_reconciliations' and column_name = 'result_snapshot')
      order by table_name, column_name
    `;
    expect([...columns]).toEqual([
      { table_name: "approval_items", column_name: "proposal_id" },
      { table_name: "mcp_effect_reconciliations", column_name: "result_snapshot" },
      { table_name: "meeting_proposals", column_name: "revision" },
      { table_name: "meeting_proposals", column_name: "source_version" },
    ]);
  });

  test("requires a non-empty bounded result snapshot for matched reconciliation", async () => {
    const matchedConstraint = await database.client`
      select pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conrelid = 'mcp_effect_reconciliations'::regclass
        and conname = 'mcp_effect_reconciliations_matched_result_ck'
    `;
    expect(matchedConstraint[0]?.definition).toContain("candidate_count = 1");
    expect(matchedConstraint[0]?.definition).toContain("result_snapshot IS NOT NULL");
    expect(matchedConstraint[0]?.definition).toContain("result_snapshot <> '{}'::jsonb");
  });

  test("rejects invalid kinds/states and oversized redacted payloads", async () => {
    const workspaceId = crypto.randomUUID();
    await database.client`insert into workspaces (id, slug, name) values (${workspaceId}, ${`mcp-schema-${workspaceId}`}, 'MCP schema fixture')`;
    try {
      await expect(Promise.resolve(database.client`
        insert into mcp_effect_proposals
          (workspace_id, client_id, kind, request_key, input_hash, aggregate_id, intent_snapshot, source_snapshot, correlation_id)
        values (${workspaceId}, 'fixture', 'provider_send', ${crypto.randomUUID()}, ${"a".repeat(64)}, ${crypto.randomUUID()}, '{}'::jsonb, '{}'::jsonb, ${crypto.randomUUID()})
      `)).rejects.toThrow();

      const proposalId = crypto.randomUUID();
      await database.client`
        insert into mcp_effect_proposals
          (id, workspace_id, client_id, kind, request_key, input_hash, aggregate_id, intent_snapshot, source_snapshot, correlation_id)
        values (${proposalId}, ${workspaceId}, 'fixture', 'conversation_reply', ${crypto.randomUUID()}, ${"a".repeat(64)}, ${crypto.randomUUID()}, '{}'::jsonb, '{}'::jsonb, ${crypto.randomUUID()})
      `;
      await expect(Promise.resolve(database.client`
        insert into mcp_effect_reconciliations
          (workspace_id, proposal_id, status, candidate_count, result_snapshot, next_attempt_at)
        values (${workspaceId}, ${proposalId}, 'matched', 1, '{}'::jsonb, now())
      `)).rejects.toThrow();
      const reconciliationId = crypto.randomUUID();
      await database.client`
        insert into mcp_effect_reconciliations
          (id, workspace_id, proposal_id, status, candidate_count, next_attempt_at)
        values (${reconciliationId}, ${workspaceId}, ${proposalId}, 'pending', 0, now())
      `;
      await expect(Promise.resolve(database.client`
        update mcp_effect_reconciliations
        set status = 'matched', candidate_count = 1, result_snapshot = '[]'::jsonb
        where id = ${reconciliationId}
      `)).rejects.toThrow();
      await expect(Promise.resolve(database.client`
        insert into mcp_effect_traces
          (workspace_id, proposal_id, stage, sequence, source_event_id, idempotency_key, event_type, redacted_payload, correlation_id)
        values (${workspaceId}, ${proposalId}, 'proposal', 1, ${crypto.randomUUID()}, 'fixture', 'fixture', ${JSON.stringify({ value: "x".repeat(33000) })}::jsonb, ${crypto.randomUUID()})
      `)).rejects.toThrow();

      await expect(Promise.resolve(database.client`
        update mcp_effect_proposals set policy_preview = '[]'::jsonb where workspace_id = ${workspaceId} and id = ${proposalId}
      `)).rejects.toThrow();
      await expect(Promise.resolve(database.client`
        update mcp_effect_proposals set policy_final = '[]'::jsonb where workspace_id = ${workspaceId} and id = ${proposalId}
      `)).rejects.toThrow();
      await expect(Promise.resolve(database.client`
        update mcp_effect_proposals set policy_preview = ${JSON.stringify({ value: "x".repeat(33000) })}::jsonb where workspace_id = ${workspaceId} and id = ${proposalId}
      `)).rejects.toThrow();
      await expect(Promise.resolve(database.client`
        update mcp_effect_proposals set policy_final = ${JSON.stringify({ value: "x".repeat(33000) })}::jsonb where workspace_id = ${workspaceId} and id = ${proposalId}
      `)).rejects.toThrow();

      for (const column of ["approval_item_id", "operation_id", "job_id", "reconciliation_id"]) {
        await expect(Promise.resolve(database.client.unsafe(
          `update mcp_effect_proposals set ${column} = $1 where workspace_id = $2 and id = $3`,
          [crypto.randomUUID(), workspaceId, proposalId],
        ))).rejects.toThrow();
      }
      } finally {
      await database.client.begin(async (transaction) => {
        await transaction`update mcp_effect_proposals set reconciliation_id = null where workspace_id = ${workspaceId}`;
        await transaction`delete from mcp_effect_traces where workspace_id = ${workspaceId}`;
        await transaction`delete from mcp_effect_reconciliations where workspace_id = ${workspaceId}`;
        await transaction`delete from mcp_effect_intentions where workspace_id = ${workspaceId}`;
        await transaction`delete from mcp_effect_proposals where workspace_id = ${workspaceId}`;
        await transaction`delete from workspaces where id = ${workspaceId}`;
      });
    }
  });

  test("enforces workspace-safe intention FKs and lease CAS predicates", async () => {
    // Simulate a database that recorded the first 0103, whose lease check had
    // the same name but did not require a lease for started intentions.
    await database.client`alter table mcp_effect_intentions drop constraint if exists mcp_effect_intentions_lease_ck`;
    await database.client`alter table mcp_effect_intentions add constraint mcp_effect_intentions_lease_ck check ((state = 'started') or (state <> 'started' and lease_token is null and lease_expires_at is null))`;
    await database.client.unsafe(await readFile(resolve(import.meta.dir, "../../packages/infrastructure/migrations/0104_mcp_governed_external_effects_repair.sql"), "utf8"));
    const leaseConstraint = await database.client`
      select pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conrelid = 'mcp_effect_intentions'::regclass
        and conname = 'mcp_effect_intentions_lease_ck'
    `;
    expect(leaseConstraint[0]?.definition).toContain("lease_token IS NOT NULL");
    expect(leaseConstraint[0]?.definition).toContain("lease_expires_at IS NOT NULL");

    const workspaceId = crypto.randomUUID();
    const foreignWorkspaceId = crypto.randomUUID();
    const proposalId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const foreignJobId = crypto.randomUUID();
    const intentionId = crypto.randomUUID();
    const leaseToken = crypto.randomUUID();
    await database.client`
      insert into workspaces (id, slug, name) values
        (${workspaceId}, ${`mcp-schema-${workspaceId}`}, 'MCP schema fixture'),
        (${foreignWorkspaceId}, ${`mcp-schema-${foreignWorkspaceId}`}, 'MCP foreign fixture')
    `;
    try {
      await database.client`
        insert into jobs (id, workspace_id, type, payload, idempotency_key, correlation_id, max_attempts, available_at)
        values (${jobId}, ${workspaceId}, 'mcp.external-effect.execute', '{}'::jsonb, ${`fixture-${jobId}`}, ${crypto.randomUUID()}, 1, now()),
               (${foreignJobId}, ${foreignWorkspaceId}, 'mcp.external-effect.execute', '{}'::jsonb, ${`fixture-${foreignJobId}`}, ${crypto.randomUUID()}, 1, now())
      `;
      await database.client`
        insert into mcp_effect_proposals
          (id, workspace_id, client_id, kind, request_key, input_hash, aggregate_id, intent_snapshot, source_snapshot, correlation_id)
        values (${proposalId}, ${workspaceId}, 'fixture', 'conversation_reply', ${crypto.randomUUID()}, ${"a".repeat(64)}, ${crypto.randomUUID()}, '{}'::jsonb, '{}'::jsonb, ${crypto.randomUUID()})
      `;
      await expect(Promise.resolve(database.client`
        insert into mcp_effect_intentions
          (id, workspace_id, proposal_id, kind, aggregate_id, idempotency_key, job_id, correlation_id)
        values (${crypto.randomUUID()}, ${foreignWorkspaceId}, ${proposalId}, 'conversation_reply', ${crypto.randomUUID()}, 'fixture', ${foreignJobId}, ${crypto.randomUUID()})
      `)).rejects.toThrow();

      const expiresAt = new Date(Date.now() - 1_000);
      await database.client`
        insert into mcp_effect_intentions
          (id, workspace_id, proposal_id, kind, aggregate_id, state, idempotency_key, job_id, lease_token, lease_expires_at, correlation_id)
        values (${intentionId}, ${workspaceId}, ${proposalId}, 'conversation_reply', ${crypto.randomUUID()}, 'started', 'fixture', ${jobId}, ${leaseToken}, ${expiresAt}, ${crypto.randomUUID()})
      `;
      await expect(Promise.resolve(database.client`
        update mcp_effect_intentions set state = 'started', lease_token = null where id = ${intentionId}
      `)).rejects.toThrow();
      await expect(Promise.resolve(database.client`
        update mcp_effect_intentions set state = 'started', lease_expires_at = null where id = ${intentionId}
      `)).rejects.toThrow();
      await expect(Promise.resolve(database.client`
        update mcp_effect_intentions set state = 'queued', lease_token = ${leaseToken}, lease_expires_at = ${expiresAt} where id = ${intentionId}
      `)).rejects.toThrow();
      const reclaimed = await database.client`
        update mcp_effect_intentions
        set state = 'unknown', lease_token = null, lease_expires_at = null, updated_at = now()
        where workspace_id = ${workspaceId} and id = ${intentionId} and state = 'started'
          and lease_token = ${leaseToken} and lease_expires_at <= now()
        returning id
      `;
      expect([...reclaimed]).toHaveLength(1);
      await expect(Promise.resolve(database.client`
        update mcp_effect_intentions set lease_token = ${leaseToken} where id = ${intentionId}
      `)).rejects.toThrow();
      await expect(Promise.resolve(database.client`
        update mcp_effect_intentions set state = 'completed', lease_token = ${leaseToken} where id = ${intentionId}
      `)).rejects.toThrow();
      const stale = await database.client`
        update mcp_effect_intentions
        set state = 'unknown'
        where workspace_id = ${workspaceId} and id = ${intentionId} and state = 'started'
          and lease_token = ${crypto.randomUUID()} and lease_expires_at <= now()
        returning id
      `;
      expect([...stale]).toHaveLength(0);
    } finally {
      await database.client.begin(async (transaction) => {
        await transaction`update mcp_effect_proposals set reconciliation_id = null where workspace_id in (${workspaceId}, ${foreignWorkspaceId})`;
        await transaction`delete from mcp_effect_traces where workspace_id in (${workspaceId}, ${foreignWorkspaceId})`;
        await transaction`delete from mcp_effect_reconciliations where workspace_id in (${workspaceId}, ${foreignWorkspaceId})`;
        await transaction`delete from mcp_effect_intentions where workspace_id in (${workspaceId}, ${foreignWorkspaceId})`;
        await transaction`delete from mcp_effect_proposals where workspace_id in (${workspaceId}, ${foreignWorkspaceId})`;
        await transaction`delete from jobs where id in (${jobId}, ${foreignJobId})`;
        await transaction`delete from workspaces where id in (${workspaceId}, ${foreignWorkspaceId})`;
      });
    }
  });
});
