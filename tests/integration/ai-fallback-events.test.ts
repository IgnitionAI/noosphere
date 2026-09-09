import { expect, test } from "bun:test";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { PostgresModelFallbackRecorder } from "@outbound/infrastructure/ai/postgres-model-fallback-recorder";
import { PostgresOperatorConsole } from "@outbound/infrastructure/operations/postgres-operator-console";
const url = process.env.TEST_DATABASE_URL;
(url ? test : test.skip)("fallback event survives reconnect and is idempotent in the job trace", async () => {
  const db = createDatabase(url!);
  const workspaceId = crypto.randomUUID(), jobId = crypto.randomUUID();
  try {
    await migrate(db.db, { migrationsFolder: `${import.meta.dir}/../../packages/infrastructure/migrations` });
    await db.client`insert into workspaces(id, slug, name) values (${workspaceId}, ${workspaceId}, 'Fallback test')`;
    await db.client`insert into jobs(id, workspace_id, type, payload, idempotency_key, correlation_id, max_attempts, available_at) values (${jobId}, ${workspaceId}, 'test.fallback', '{}'::jsonb, ${jobId}, ${jobId}, 5, now())`;
    const input = { workspaceId, requestKey: "internal-request", capability: "content_writer" as const, primary: { provider: "openai-api" as const, model: "primary" }, selected: { provider: "anthropic" as const, model: "secondary" }, reason: "AI_PROVIDER_QUOTA_EXHAUSTED" };
    const recorder = new PostgresModelFallbackRecorder(db.db, () => jobId);
    await Promise.all([recorder.record(input), recorder.record(input)]);
    const restarted = createDatabase(url!);
    try {
      const trace = await new PostgresOperatorConsole(restarted.db, { now: () => new Date() }, { generate: () => crypto.randomUUID() }).traceCorrelation({ workspaceId, correlationId: jobId });
      expect(trace.events.filter((event) => event.eventType === "AiFallbackUsed")).toHaveLength(1);
      expect(trace.events[0]?.payloadPreview).toMatchObject({ jobId, capability: "content_writer", primary: input.primary, selected: input.selected, reason: input.reason });
    } finally { await restarted.close(); }
  } finally {
    await db.client`delete from outbox_events where workspace_id = ${workspaceId}`;
    await db.client`delete from jobs where workspace_id = ${workspaceId}`;
    await db.client`delete from workspaces where id = ${workspaceId}`;
    await db.close();
  }
});
