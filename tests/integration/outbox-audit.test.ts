import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import type postgres from "postgres";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { PostgresOutboxDispatcher } from "@outbound/infrastructure/outbox/postgres-outbox-dispatcher";
import {
  MCP_EXTERNAL_EFFECT_EXECUTION_REQUESTED,
  McpExternalEffectOutboxHandler,
} from "@outbound/infrastructure/outbox/mcp-external-effect-outbox-handler";
import { authUsers, workspaces } from "@outbound/infrastructure/database/schema";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
// postgres.js serializes these object parameters as JSON; the cast only
// bridges its tagged-template parameter type, preserving the runtime object.
type JsonbFixture = postgres.SerializableParameter;

databaseDescribe("F-003 outbox dispatcher and audit log", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();

  beforeAll(async () => {
    await migrate(database.db, {
      migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations"),
    });
    await database.db.insert(workspaces).values({ id: workspaceId, slug: `outbox-${workspaceId}`, name: "Outbox" });
    await database.db.insert(authUsers).values({ id: userId, name: "Outbox Tester", email: `outbox-${userId}@example.com` });
  });

  afterAll(async () => {
    await database.client`drop trigger if exists audit_logs_immutable_trg on audit_logs`;
    try {
      await database.client`delete from audit_logs where workspace_id = ${workspaceId}`;
      await database.client`delete from outbox_events where workspace_id = ${workspaceId}`;
      await database.client`update mcp_effect_proposals
        set approval_item_id = null, operation_id = null, job_id = null, reconciliation_id = null
        where workspace_id = ${workspaceId}`;
      await database.client`delete from approval_items where workspace_id = ${workspaceId}`;
      await database.client`delete from mcp_effect_intentions where workspace_id = ${workspaceId}`;
      await database.client`delete from mcp_effect_traces where workspace_id = ${workspaceId}`;
      await database.client`delete from mcp_effect_proposals where workspace_id = ${workspaceId}`;
      await database.client`delete from mcp_effect_reconciliations where workspace_id = ${workspaceId}`;
      await database.client`delete from jobs where workspace_id = ${workspaceId}`;
      await database.client`delete from auth_users where id = ${userId}`;
      await database.client`delete from workspaces where id = ${workspaceId}`;
    } finally {
      await database.client`create trigger audit_logs_immutable_trg before update or delete on audit_logs for each row execute function reject_audit_log_mutation()`;
      await database.close();
    }
  });

  test("delivers publication once and writes one audit row", async () => {
    const eventId = crypto.randomUUID();
    const subjectId = crypto.randomUUID();
    const auditPayload = { actorUserId: userId, version: 1 } as unknown as JsonbFixture;
    await database.client`
      insert into outbox_events (id, workspace_id, aggregate_type, aggregate_id, event_type, payload)
      values (${eventId}, ${workspaceId}, 'ICP', ${subjectId}, 'ICPVersionPublished',
        ${auditPayload}::jsonb)
    `;
    const dispatcher = new PostgresOutboxDispatcher(database.client, { batchSize: 500 });
    expect(await dispatcher.dispatchBatch()).toBeGreaterThan(0);
    expect(await dispatcher.dispatchBatch()).toBe(0);
    const rows = await database.client<{ published_at: Date | null; attempts: number }[]>`
      select published_at, attempts from outbox_events where id = ${eventId}
    `;
    expect(rows[0]?.published_at).toBeTruthy();
    expect(rows[0]?.attempts).toBe(1);
    const audit = await database.client<{ count: number }[]>`
      select count(*)::int as count from audit_logs where source_event_id = ${eventId}
    `;
    expect(audit[0]?.count).toBe(1);
  });

  test("retries a failed delivery without duplicating the event", async () => {
    const eventId = crypto.randomUUID();
    const subjectId = crypto.randomUUID();
    await database.client`
      insert into outbox_events (id, workspace_id, aggregate_type, aggregate_id, event_type, payload)
      values (${eventId}, ${workspaceId}, 'Contact', ${subjectId}, 'SuppressionRegistered', '{}'::jsonb)
    `;
    let calls = 0;
    const dispatcher = new PostgresOutboxDispatcher(database.client, {
      handler: async () => {
        calls += 1;
        if (calls === 1) throw new Error("temporary handler failure");
      },
    });
    expect(await dispatcher.dispatchBatch()).toBe(0);
    await database.client`update outbox_events set available_at = now() where id = ${eventId}`;
    expect(await dispatcher.dispatchBatch()).toBe(1);
    expect(calls).toBe(2);
    const rows = await database.client<{ published_at: Date | null; attempts: number }[]>`
      select published_at, attempts from outbox_events where id = ${eventId}
    `;
    expect(rows[0]?.published_at).toBeTruthy();
    expect(rows[0]?.attempts).toBe(2);
  });

  test("audits a governed execution envelope once without creating another job", async () => {
    const eventId = crypto.randomUUID();
    const proposalId = crypto.randomUUID();
    const intentionId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const aggregateId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const payload = {
      workspaceId,
      proposalId,
      intentionId,
      jobId,
      correlationId,
      sourceEventId: eventId,
      idempotencyKey: `mcp-effect:${proposalId}:execute:v1`,
      kind: "conversation_reply",
      aggregateId,
    };
    const jobPayload = { workspaceId, proposalId, intentionId, kind: payload.kind, aggregateId, correlationId } as unknown as JsonbFixture;
    const envelopePayload = payload as unknown as JsonbFixture;
    await database.client`
      insert into mcp_effect_proposals (
        id, workspace_id, client_id, kind, request_key, input_hash, aggregate_id,
        intent_snapshot, source_snapshot, revision, source_version, status,
        version, correlation_id, created_at, updated_at
      ) values (
        ${proposalId}, ${workspaceId}, 'outbox-fixture', 'conversation_reply', ${crypto.randomUUID()}, ${"a".repeat(64)}, ${aggregateId},
        '{"body":"bounded"}'::jsonb, '{"status":"open"}'::jsonb, 1, 1, 'queued',
        1, ${correlationId}, now(), now()
      )
    `;
    await database.client`
      insert into jobs (
        id, workspace_id, type, payload, idempotency_key, correlation_id,
        max_attempts, available_at, created_at, updated_at
      ) values (
        ${jobId}, ${workspaceId}, 'mcp.external-effect.execute', ${jobPayload}::jsonb,
        ${payload.idempotencyKey}, ${correlationId}, 5, now(), now(), now()
      )
    `;
    await database.client`update mcp_effect_proposals set job_id = ${jobId} where id = ${proposalId} and workspace_id = ${workspaceId}`;
    await database.client`
      insert into mcp_effect_intentions (
        id, workspace_id, proposal_id, kind, aggregate_id, state,
        idempotency_key, job_id, correlation_id, created_at, updated_at
      ) values (
        ${intentionId}, ${workspaceId}, ${proposalId}, ${payload.kind}, ${aggregateId}, 'queued',
        ${payload.idempotencyKey}, ${jobId}, ${correlationId}, now(), now()
      )
    `;
    await database.client`
      insert into outbox_events (id, workspace_id, aggregate_type, aggregate_id, event_type, payload)
      values (${eventId}, ${workspaceId}, 'mcp_effect_proposal', ${proposalId}, ${MCP_EXTERNAL_EFFECT_EXECUTION_REQUESTED}, ${envelopePayload}::jsonb)
    `;
    const handler = new McpExternalEffectOutboxHandler(database.client);
    const dispatcher = new PostgresOutboxDispatcher(database.client, {
      batchSize: 500,
      handler: (event) => handler.handle(event),
    });
    expect(await dispatcher.dispatchBatch()).toBe(1);
    await database.client`update outbox_events set published_at = null, available_at = now() where id = ${eventId}`;
    expect(await dispatcher.dispatchBatch()).toBe(1);
    expect(await dispatcher.dispatchBatch()).toBe(0);
    const audit = await database.client<{ count: number }[]>`
      select count(*)::int as count from audit_logs where source_event_id = ${eventId}
    `;
    expect(audit[0]?.count).toBe(1);
    const payloadType = await database.client<{ type: string }[]>`
      select jsonb_typeof(payload) as type from outbox_events where id = ${eventId}
    `;
    expect(payloadType[0]?.type).toBe("object");
    const event = await database.client<{ attempts: number }[]>`
      select attempts from outbox_events where id = ${eventId}
    `;
    expect(event[0]?.attempts).toBe(2);
    const jobs = await database.client<{ count: number }[]>`
      select count(*)::int as count from jobs where id = ${jobId}
    `;
    expect(jobs[0]?.count).toBe(1);
    await database.client`delete from mcp_effect_intentions where id = ${intentionId} and workspace_id = ${workspaceId}`;
    await database.client`update mcp_effect_proposals set job_id = null where id = ${proposalId} and workspace_id = ${workspaceId}`;
    await database.client`delete from mcp_effect_proposals where id = ${proposalId} and workspace_id = ${workspaceId}`;
    await database.client`delete from jobs where id = ${jobId} and workspace_id = ${workspaceId}`;
  });

  test("does not acknowledge malformed governed envelopes", async () => {
    const eventId = crypto.randomUUID();
    const proposalId = crypto.randomUUID();
    const malformedPayload = { sourceEventId: eventId } as unknown as JsonbFixture;
    await database.client`
      insert into outbox_events (id, workspace_id, aggregate_type, aggregate_id, event_type, payload)
      values (${eventId}, ${workspaceId}, 'mcp_effect_proposal', ${proposalId}, ${MCP_EXTERNAL_EFFECT_EXECUTION_REQUESTED}, ${malformedPayload}::jsonb)
    `;
    const dispatcher = new PostgresOutboxDispatcher(database.client, {
      batchSize: 500,
      handler: (event) => new McpExternalEffectOutboxHandler(database.client).handle(event),
    });
    expect(await dispatcher.dispatchBatch()).toBe(0);
    const row = await database.client<{ published_at: Date | null; attempts: number }[]>`
      select published_at, attempts from outbox_events where id = ${eventId}
    `;
    expect(row[0]?.published_at).toBeNull();
    expect(row[0]?.attempts).toBe(1);
    const audit = await database.client<{ count: number }[]>`
      select count(*)::int as count from audit_logs where source_event_id = ${eventId}
    `;
    expect(audit[0]?.count).toBe(0);
  });
});
