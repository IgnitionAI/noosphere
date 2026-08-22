import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { PostgresOutboxDispatcher } from "@outbound/infrastructure/outbox/postgres-outbox-dispatcher";
import { authUsers, workspaces } from "@outbound/infrastructure/database/schema";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

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
    await database.client`delete from outbox_events where workspace_id = ${workspaceId}`;
    await database.client`delete from auth_users where id = ${userId}`;
    await database.client`delete from workspaces where id = ${workspaceId}`;
    await database.client`create trigger audit_logs_immutable_trg before update or delete on audit_logs for each row execute function reject_audit_log_mutation()`;
    await database.close();
  });

  test("delivers publication once and writes one audit row", async () => {
    const eventId = crypto.randomUUID();
    const subjectId = crypto.randomUUID();
    await database.client`
      insert into outbox_events (id, workspace_id, aggregate_type, aggregate_id, event_type, payload)
      values (${eventId}, ${workspaceId}, 'ICP', ${subjectId}, 'ICPVersionPublished',
        ${JSON.stringify({ actorUserId: userId, version: 1 })}::jsonb)
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
});
