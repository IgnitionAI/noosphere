import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createDatabase, type SqlClient } from "@outbound/infrastructure/database/client";

type Snapshot = {
  readonly workspaceId: string;
  readonly events: number;
  readonly snapshots: number;
  readonly receipts: number;
  readonly settings: number;
  readonly inFlightMemoryJobs: number;
  readonly eventDigest: string;
  readonly snapshotDigest: string;
  readonly receiptDigest: string;
  readonly settingsDigest: string;
  readonly inFlightJobDigest: string;
  readonly messages: number;
  readonly outreachAttempts: number;
  readonly publicationAttempts: number;
};

const sourceUrl = required("SOURCE_DATABASE_URL");
const restoredUrl = required("RESTORED_DATABASE_URL");
const workspaceSlug = process.env.BACKUP_RESTORE_WORKSPACE_SLUG ?? "prospect-memory-benchmark";
const outputPath = process.env.BACKUP_RESTORE_OUTPUT;
const source = createDatabase(sourceUrl);
const restored = createDatabase(restoredUrl);

try {
  const [sourceSnapshot, restoredSnapshot] = await Promise.all([
    snapshot(source.client, workspaceSlug),
    snapshot(restored.client, workspaceSlug),
  ]);
  const matches = JSON.stringify(sourceSnapshot) === JSON.stringify(restoredSnapshot);
  const report = {
    schemaVersion: 1,
    verifiedAt: new Date().toISOString(),
    workspaceSlug,
    source: sourceSnapshot,
    restored: restoredSnapshot,
    matches,
    inFlightJobPreserved: restoredSnapshot.inFlightMemoryJobs > 0,
    providerEffectsDuringVerification: 0,
    passed: matches && restoredSnapshot.inFlightMemoryJobs > 0,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await Bun.write(outputPath, serialized);
  }
  process.stdout.write(serialized);
  if (!report.passed) process.exitCode = 1;
} finally {
  await Promise.all([source.close(), restored.close()]);
}

async function snapshot(sql: SqlClient, slug: string): Promise<Snapshot> {
  const [workspace] = await sql<Array<{ id: string }>>`
    select id from workspaces where slug = ${slug}
  `;
  if (!workspace) throw new Error(`BACKUP_RESTORE_WORKSPACE_NOT_FOUND:${slug}`);
  const workspaceId = workspace.id;
  const [counts] = await sql<Array<{
    events: number;
    snapshots: number;
    receipts: number;
    settings: number;
    in_flight_memory_jobs: number;
    messages: number;
    outreach_attempts: number;
    publication_attempts: number;
  }>>`
    select
      (select count(*)::int from prospect_memory_events where workspace_id = ${workspaceId}) as events,
      (select count(*)::int from prospect_memory_snapshots where workspace_id = ${workspaceId}) as snapshots,
      (select count(*)::int from prospect_memory_context_receipts where workspace_id = ${workspaceId}) as receipts,
      (select count(*)::int from workspace_prospect_memory_settings where workspace_id = ${workspaceId}) as settings,
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
  if (!counts) throw new Error("BACKUP_RESTORE_COUNTS_MISSING");
  const [digests] = await sql<Array<{
    event_digest: string;
    snapshot_digest: string;
    receipt_digest: string;
    settings_digest: string;
    in_flight_job_digest: string;
  }>>`
    select
      coalesce((
        select md5(string_agg(
          id::text || ':' || sequence_id::text || ':' || source_kind || ':' || source_id || ':' ||
          source_version::text || ':' || kind || ':' || payload::text,
          '|' order by sequence_id
        )) from prospect_memory_events where workspace_id = ${workspaceId}
      ), md5('')) as event_digest,
      coalesce((
        select md5(string_agg(
          id::text || ':' || contact_id::text || ':' || version::text || ':' || watermark::text || ':' ||
          privacy_epoch::text || ':' || status || ':' || content_hash,
          '|' order by contact_id, version
        )) from prospect_memory_snapshots where workspace_id = ${workspaceId}
      ), md5('')) as snapshot_digest,
      coalesce((
        select md5(string_agg(
          id::text || ':' || request_key || ':' || capability || ':' || context_hash || ':' ||
          source_event_ids::text || ':' || source_hashes::text,
          '|' order by id
        )) from prospect_memory_context_receipts where workspace_id = ${workspaceId}
      ), md5('')) as receipt_digest,
      coalesce((
        select md5(string_agg(
          workspace_id::text || ':' || capture_enabled::text || ':' || shadow_enabled::text || ':' ||
          setter_enabled::text || ':' || enabled_capabilities::text || ':' || processing_profiles::text,
          '|' order by workspace_id
        )) from workspace_prospect_memory_settings where workspace_id = ${workspaceId}
      ), md5('')) as settings_digest,
      coalesce((
        select md5(string_agg(
          id::text || ':' || type || ':' || status::text || ':' || attempts::text || ':' ||
          payload::text || ':' || coalesce(locked_by, '') || ':' || coalesce(locked_until::text, ''),
          '|' order by id
        )) from jobs
        where workspace_id = ${workspaceId}
          and type in ('prospect.memory.refresh', 'prospect.memory.backfill')
          and status = 'running'
      ), md5('')) as in_flight_job_digest
  `;
  if (!digests) throw new Error("BACKUP_RESTORE_DIGESTS_MISSING");
  return {
    workspaceId,
    events: counts.events,
    snapshots: counts.snapshots,
    receipts: counts.receipts,
    settings: counts.settings,
    inFlightMemoryJobs: counts.in_flight_memory_jobs,
    eventDigest: digests.event_digest,
    snapshotDigest: digests.snapshot_digest,
    receiptDigest: digests.receipt_digest,
    settingsDigest: digests.settings_digest,
    inFlightJobDigest: digests.in_flight_job_digest,
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
