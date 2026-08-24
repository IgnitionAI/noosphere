import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createDatabase, type SqlClient } from "@outbound/infrastructure/database/client";
import { PostgresJobQueue } from "@outbound/infrastructure/jobs/postgres-job-queue";
import { WorkspaceRetentionPurgeProcessor } from "@outbound/infrastructure/workspaces/workspace-data-export";

const databaseUrl = required("DATABASE_URL");
const expectedDatabase = required("PROSPECT_MEMORY_PURGE_EXPECTED_DATABASE");
const workspaceSlug = process.env.PROSPECT_MEMORY_PURGE_WORKSPACE_SLUG ?? "prospect-memory-benchmark";
const outputPath = process.env.PROSPECT_MEMORY_PURGE_OUTPUT;
const parsedDatabase = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));

if (parsedDatabase !== expectedDatabase) {
  throw new Error(`PURGE_DATABASE_GUARD:${parsedDatabase || "unknown"}:${expectedDatabase}`);
}

const database = createDatabase(databaseUrl);

try {
  const [databaseIdentity] = await database.client<Array<{ database_name: string }>>`
    select current_database() as database_name
  `;
  if (databaseIdentity?.database_name !== expectedDatabase) {
    throw new Error(`PURGE_DATABASE_IDENTITY_MISMATCH:${databaseIdentity?.database_name ?? "unknown"}`);
  }
  const [workspace] = await database.client<Array<{ id: string }>>`
    select id from workspaces where slug = ${workspaceSlug}
  `;
  if (!workspace) throw new Error(`PURGE_WORKSPACE_NOT_FOUND:${workspaceSlug}`);

  const before = await snapshot(database.client, workspace.id);
  if (before.inFlightMemoryJobs < 1) throw new Error("PURGE_IN_FLIGHT_MEMORY_JOB_REQUIRED");
  const memoryEpochsBefore = await memoryContactEpochs(database.client, workspace.id);
  if (memoryEpochsBefore.length < 1) throw new Error("PURGE_MEMORY_CONTACT_REQUIRED");

  const queue = new PostgresJobQueue(database.client);
  const jobId = crypto.randomUUID();
  const now = new Date(Date.now() + 24 * 60 * 60 * 1_000);
  const retention = {
    invitationsDays: 0,
    jobsDays: 0,
    auditDays: 0,
    memoryEventsDays: 0,
    memorySnapshotsDays: 0,
    memoryReceiptsDays: 0,
  };
  const enqueued = await queue.enqueue({
    id: jobId,
    workspaceId: workspace.id,
    type: "workspace.retention.purge",
    payload: { retention },
    idempotencyKey: `restored-purge-verification:${jobId}`,
    correlationId: `restored-purge-verification:${jobId}`,
    maxAttempts: 1,
    availableAt: now,
    priority: 1_000,
  });
  if (!enqueued.inserted) throw new Error("PURGE_VERIFICATION_JOB_NOT_INSERTED");
  const [leased] = await queue.lease({
    workerId: "restored-purge-verification",
    types: ["workspace.retention.purge"],
    limit: 1,
    leaseMs: 120_000,
    now,
  });
  if (!leased || leased.id !== jobId) throw new Error("PURGE_VERIFICATION_JOB_NOT_LEASED");

  await new WorkspaceRetentionPurgeProcessor(database.db, queue, { now: () => now }).process(leased);
  const after = await snapshot(database.client, workspace.id);
  const memoryEpochsAfter = await contactEpochs(
    database.client,
    workspace.id,
    memoryEpochsBefore.map((entry) => entry.contactId),
  );
  const [purgeJob] = await database.client<Array<{ status: string }>>`
    select status::text as status from jobs where id = ${jobId}
  `;

  const report = {
    schemaVersion: 1,
    verifiedAt: new Date().toISOString(),
    database: expectedDatabase,
    workspaceSlug,
    workspaceId: workspace.id,
    before,
    after,
    memoryEpochsBefore,
    memoryEpochsAfter,
    purgeJobStatus: purgeJob?.status ?? null,
    inFlightJobPreserved: after.inFlightMemoryJobs === before.inFlightMemoryJobs,
    inFlightResultInvalidated: memoryEpochsBefore.every((entry) =>
      memoryEpochsAfter.some((afterEntry) =>
        afterEntry.contactId === entry.contactId && afterEntry.privacyEpoch === entry.privacyEpoch + 1)),
    providerEffectsUnchanged:
      after.messages === before.messages
      && after.outreachAttempts === before.outreachAttempts
      && after.publicationAttempts === before.publicationAttempts,
    passed:
      before.events > 0
      && before.snapshots > 0
      && before.receipts > 0
      && after.events === 0
      && after.snapshots === 0
      && after.receipts === 0
      && after.inFlightMemoryJobs === before.inFlightMemoryJobs
      && memoryEpochsBefore.every((entry) =>
        memoryEpochsAfter.some((afterEntry) =>
          afterEntry.contactId === entry.contactId && afterEntry.privacyEpoch === entry.privacyEpoch + 1))
      && after.messages === before.messages
      && after.outreachAttempts === before.outreachAttempts
      && after.publicationAttempts === before.publicationAttempts
      && purgeJob?.status === "completed",
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await Bun.write(outputPath, serialized);
  }
  process.stdout.write(serialized);
  if (!report.passed) process.exitCode = 1;
} finally {
  await database.close();
}

async function memoryContactEpochs(sql: SqlClient, workspaceId: string) {
  return sql<Array<{ contactId: string; privacyEpoch: number }>>`
    select distinct contact.id as "contactId", contact.privacy_epoch as "privacyEpoch"
    from contacts contact
    join prospect_memory_events event
      on event.workspace_id = contact.workspace_id
     and event.canonical_contact_id = contact.id
    where contact.workspace_id = ${workspaceId}
    order by contact.id
  `;
}

async function contactEpochs(sql: SqlClient, workspaceId: string, contactIds: readonly string[]) {
  return sql<Array<{ contactId: string; privacyEpoch: number }>>`
    select id as "contactId", privacy_epoch as "privacyEpoch"
    from contacts
    where workspace_id = ${workspaceId}
      and id = any(${`{${contactIds.join(",")}}`}::uuid[])
    order by id
  `;
}

async function snapshot(sql: SqlClient, workspaceId: string) {
  const [counts] = await sql<Array<{
    events: number;
    snapshots: number;
    receipts: number;
    in_flight_memory_jobs: number;
    messages: number;
    outreach_attempts: number;
    publication_attempts: number;
  }>>`
    select
      (select count(*)::int from prospect_memory_events where workspace_id = ${workspaceId}) as events,
      (select count(*)::int from prospect_memory_snapshots where workspace_id = ${workspaceId}) as snapshots,
      (select count(*)::int from prospect_memory_context_receipts where workspace_id = ${workspaceId}) as receipts,
      (
        select count(*)::int from jobs
        where workspace_id = ${workspaceId}
          and type in ('prospect.memory.refresh', 'prospect.memory.backfill')
          and status = 'running'
      ) as in_flight_memory_jobs,
      (select count(*)::int from messages where workspace_id = ${workspaceId}) as messages,
      (select count(*)::int from outreach_attempts where workspace_id = ${workspaceId}) as outreach_attempts,
      (select count(*)::int from content_publication_attempts where workspace_id = ${workspaceId}) as publication_attempts
  `;
  if (!counts) throw new Error("PURGE_COUNTS_MISSING");
  return {
    events: counts.events,
    snapshots: counts.snapshots,
    receipts: counts.receipts,
    inFlightMemoryJobs: counts.in_flight_memory_jobs,
    messages: counts.messages,
    outreachAttempts: counts.outreach_attempts,
    publicationAttempts: counts.publication_attempts,
  };
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
