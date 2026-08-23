import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { JobQueue, LeasedJob, NewJob } from "@outbound/application/jobs/job-queue";
import {
  type ProspectMemoryPolicy,
  type ProspectMemorySemanticCategory,
  type ProspectMemorySourceMaterial,
  type ProspectMemorySynthesis,
} from "@outbound/application/prospect-memory/prospect-memory";
import type { ProspectMemoryEvent } from "@outbound/domain/prospect-memory/prospect-memory";
import { DefaultProspectContextAssembler } from "@outbound/application/prospect-memory/prospect-context-assembler";
import {
  DeterministicProspectMemoryProjector,
  StrictProspectMemoryProjectionValidator,
} from "@outbound/application/prospect-memory/prospect-memory-projector";
import { DeterministicProspectMemoryShadowComparator } from "@outbound/application/prospect-memory/prospect-memory-shadow-comparator";
import { CryptoIdGenerator, SystemClock } from "@outbound/application/shared/ports";
import { PostgresAiRunRecorder } from "@outbound/infrastructure/ai/postgres-ai-run-recorder";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { ProspectMemoryBackfillJobProcessor } from "@outbound/infrastructure/prospect-memory/prospect-memory-backfill";
import {
  PostgresContextReceiptRecorder,
  PostgresProspectMemoryEventRepository,
  PostgresProspectMemoryPolicyReader,
  PostgresProspectMemorySnapshotRepository,
} from "@outbound/infrastructure/prospect-memory/postgres-prospect-memory-repository";
import {
  PostgresProspectMemoryAuthoritativeStateReader,
  PostgresProspectMemorySourceMaterialReader,
} from "@outbound/infrastructure/prospect-memory/postgres-prospect-memory-state-reader";
import { Sha256ContentHasher } from "@outbound/infrastructure/shared/sha256-content-hasher";

const databaseUrl = required("DATABASE_URL");
const workspaceSlug = required("SHADOW_WORKSPACE_SLUG");
const minimumContexts = positiveInteger("SHADOW_MIN_CONTEXTS", 1_000);
const maximumContacts = positiveInteger("SHADOW_MAX_CONTACTS", 200);
const outputPath = process.env.SHADOW_CORPUS_OUTPUT?.trim() || null;
const runId = crypto.randomUUID();
const startedAt = new Date();
const criticalPattern = "(je (vais|peux|m.engage)|nous (allons|pouvons)|i (will|can|promise)|we (will|can)|rendez-vous|meeting|appel|call|envoyer|send|revenir vers|follow up|pas intéressé|not interested|trop cher|too expensive|déjà|already|non merci|no thanks|problème|problem)";
const database = createDatabase(databaseUrl);
const clock = new SystemClock();
const ids = new CryptoIdGenerator();
const hasher = new Sha256ContentHasher();
const policies = new PostgresProspectMemoryPolicyReader(database.client);
const events = new PostgresProspectMemoryEventRepository(database.client);
const snapshots = new PostgresProspectMemorySnapshotRepository(database.client);
const authoritativeState = new PostgresProspectMemoryAuthoritativeStateReader(database.db);
const sourceMaterials = new PostgresProspectMemorySourceMaterialReader(database.db, hasher);
const receipts = new PostgresContextReceiptRecorder(database.client);
const assembler = new DefaultProspectContextAssembler(
  events,
  snapshots,
  authoritativeState,
  sourceMaterials,
  policies,
  receipts,
  ids,
  hasher,
);
const comparator = new DeterministicProspectMemoryShadowComparator(
  new PostgresAiRunRecorder(database.db, clock, ids),
  hasher,
);
const projector = new DeterministicProspectMemoryProjector();
const validator = new StrictProspectMemoryProjectionValidator();
let originalPolicy: ProspectMemoryPolicy | null = null;
let workspaceId: string | null = null;
let ownerId: string | null = null;
let cleanedRefreshJobs = 0;

try {
  const [workspace] = await database.client<Array<{ id: string; owner_id: string }>>`
    select workspace.id,
           member.user_id as owner_id
    from workspaces workspace
    join lateral (
      select user_id
      from workspace_members
      where workspace_id = workspace.id
        and status = 'active'
        and role in ('owner', 'admin')
      order by case role when 'owner' then 0 else 1 end, joined_at, user_id
      limit 1
    ) member on true
    where workspace.slug = ${workspaceSlug}
      and workspace.status = 'active'
      and workspace.deleted_at is null
    limit 1
  `;
  if (!workspace) throw new Error("SHADOW_WORKSPACE_OR_OWNER_NOT_FOUND");
  workspaceId = workspace.id;
  ownerId = workspace.owner_id;
  originalPolicy = await policies.find(workspace.id);
  await policies.save({
    workspaceId: workspace.id,
    updatedBy: workspace.owner_id,
    updatedAt: startedAt,
    policy: {
      flags: {
        prospectMemoryCapture: true,
        prospectMemoryShadow: true,
        prospectMemorySetter: false,
        enabledCapabilities: [],
      },
      processingProfiles: [],
      maxDailySemanticRefreshes: 0,
      maxDailyCostUsd: 0,
    },
  });

  const inlineQueue = createInlineBackfillQueue();
  const backfill = new ProspectMemoryBackfillJobProcessor(
    database.db,
    database.client,
    inlineQueue,
    ids,
    clock,
  );
  inlineQueue.seed({
    id: ids.generate(),
    workspaceId: workspace.id,
    type: "prospect.memory.backfill",
    payload: {
      workspaceId: workspace.id,
      stage: "contacts",
      cursor: null,
      captured: 0,
      excluded: 0,
      duplicates: 0,
    },
    idempotencyKey: `prospect-memory:shadow-corpus:${runId}:contacts:start`,
    correlationId: `prospect-memory-shadow-corpus:${runId}`,
    maxAttempts: 3,
    priority: -100,
    availableAt: startedAt,
  });
  let backfillPages = 0;
  while (inlineQueue.hasPending()) {
    const job = inlineQueue.take();
    if (!job) break;
    await backfill.process(job);
    backfillPages += 1;
  }
  // Backfill observations are timestamped while the pages are processed. The
  // projection and all context reads must therefore use an as-of instant after
  // the final page, never the run start captured before those events existed.
  const corpusAsOf = new Date();

  const candidates = await database.client<Array<{
    contact_id: string;
    old_critical_message_ids: string[];
  }>>`
    with ranked as (
      select conversation.contact_id,
             message.id,
             message.body,
             row_number() over (
               partition by conversation.contact_id
               order by message.created_at desc, message.id desc
             ) as recent_rank,
             count(*) over (partition by conversation.contact_id) as message_count
      from conversations conversation
      join messages message
        on message.workspace_id = conversation.workspace_id
       and message.conversation_id = conversation.id
      where conversation.workspace_id = ${workspace.id}
    ), eligible as (
      select contact_id,
             array_agg(id order by id) filter (
               where recent_rank > 30
                 and body ~* ${criticalPattern}
             ) as old_critical_message_ids,
             max(message_count) as message_count
      from ranked
      group by contact_id
    )
    select contact_id, old_critical_message_ids
    from eligible
    where message_count >= 31
      and coalesce(cardinality(old_critical_message_ids), 0) > 0
    order by contact_id
    limit ${maximumContacts}
  `;
  if (candidates.length === 0) throw new Error("SHADOW_REAL_CORPUS_EMPTY");

  const selected: string[] = [];
  let projectedSnapshots = 0;
  let classifiedCriticalSources = 0;
  for (const candidate of candidates) {
    const oldCriticalMessageIds = new Set(candidate.old_critical_message_ids);
    const state = await authoritativeState.read(workspace.id, candidate.contact_id);
    if (!state || state.anonymizedAt || state.currentState.anonymized) continue;
    const previousSnapshot = await snapshots.findCurrent(workspace.id, candidate.contact_id);
    const latestSequence = await events.latestSequence(workspace.id, candidate.contact_id);
    if (latestSequence < 1) continue;
    if (!previousSnapshot || previousSnapshot.watermark < latestSequence) {
      const memoryEvents = await readAllEvents(workspace.id, candidate.contact_id, latestSequence);
      const delta = previousSnapshot
        ? memoryEvents.filter((event) => event.sequenceId > previousSnapshot.watermark)
        : memoryEvents;
      if (delta.length === 0) continue;
      const materials = await sourceMaterials.read({
        workspaceId: workspace.id,
        contactId: candidate.contact_id,
        events: delta,
      });
      const synthesis = deterministicProbeSynthesis(materials, oldCriticalMessageIds);
      if (synthesis.classifications.length === 0) continue;
      classifiedCriticalSources += synthesis.classifications.length;
      const snapshotId = ids.generate();
      const draft = projector.project({
        previousSnapshot,
        resetHistoricalProjection: false,
        currentState: state.currentState,
        events: delta,
        materials,
        synthesis,
        generatedAt: corpusAsOf,
        privacyEpoch: state.privacyEpoch,
        snapshotId,
        contentHash: "pending",
      });
      const snapshot = validator.validate({
        previousSnapshot,
        resetHistoricalProjection: false,
        snapshot: {
          ...draft,
          contentHash: await hasher.hash({ ...draft, contentHash: null }),
        },
        events: delta,
        materials,
      });
      const published = await snapshots.publishIfCurrent({
        snapshot,
        expectedVersion: previousSnapshot?.version ?? 0,
        expectedPrivacyEpoch: state.privacyEpoch,
      });
      if (!published) continue;
      projectedSnapshots += 1;
    }
    selected.push(candidate.contact_id);
  }
  if (selected.length === 0) throw new Error("SHADOW_REAL_CORPUS_NO_PROJECTED_CONTACTS");

  const contextsPerContact = Math.max(1, Math.ceil(minimumContexts / selected.length));
  let contextCount = 0;
  for (const contactId of selected) {
    const recentHistory = await database.client<Array<{
      id: string;
      direction: "inbound" | "outbound";
      body: string;
    }>>`
      select message.id, message.direction, message.body
      from messages message
      join conversations conversation
        on conversation.workspace_id = message.workspace_id
       and conversation.id = message.conversation_id
      where message.workspace_id = ${workspace.id}
        and conversation.contact_id = ${contactId}
      order by message.created_at desc, message.id desc
      limit 30
    `;
    const history = [...recentHistory].reverse();
    if (history.length !== 30) continue;
    for (let ordinal = 0; ordinal < contextsPerContact && contextCount < minimumContexts; ordinal += 1) {
      const requestKey = `shadow-corpus:${runId}:${contactId}:${ordinal}`;
      const bundle = await assembler.assemble({
        workspaceId: workspace.id,
        contactId,
        capability: "setter_campaign",
        principalRole: "worker",
        requestKey,
        now: corpusAsOf,
      });
      await comparator.compare({
        workspaceId: workspace.id,
        contactId,
        requestKey,
        legacyHistory: history.map((message) => ({
          direction: message.direction,
          body: message.body,
          sourceId: message.id,
        })),
        memory: bundle,
        comparedAt: corpusAsOf,
      });
      contextCount += 1;
    }
    if (contextCount >= minimumContexts) break;
  }
  if (contextCount < minimumContexts) {
    throw new Error(`SHADOW_CONTEXT_TARGET_NOT_REACHED_${contextCount}_${minimumContexts}`);
  }

  cleanedRefreshJobs = await cleanupBackfillRefreshJobs(workspace.id, startedAt);
  const [counts] = await database.client<Array<{
    event_count: number;
    snapshot_count: number;
    receipt_count: number;
    comparison_count: number;
  }>>`
    select
      (select count(*)::int from prospect_memory_events where workspace_id = ${workspace.id}) as event_count,
      (select count(*)::int from prospect_memory_snapshots where workspace_id = ${workspace.id} and superseded_at is null and invalidated_at is null) as snapshot_count,
      (select count(*)::int from prospect_memory_context_receipts where workspace_id = ${workspace.id} and created_at >= ${startedAt}) as receipt_count,
      (select count(*)::int from ai_runs where workspace_id = ${workspace.id} and purpose = 'prospect_memory_shadow_comparison' and created_at >= ${startedAt}) as comparison_count
  `;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    workspaceSlug,
    runId,
    realWorkspaceData: true,
    shadowOnly: true,
    semanticProbe: "deterministic-lexical-v1",
    semanticQualityMeasured: false,
    semanticModelCalls: 0,
    providerEffects: 0,
    backfillPages,
    selectedContactCount: selected.length,
    projectedSnapshots,
    classifiedCriticalSources,
    requestedContextCount: minimumContexts,
    contextCount,
    cleanedRefreshJobs,
    durableCounts: counts ?? null,
    privacy: "Output contains aggregate counters only; no contact IDs, messages or source excerpts.",
  };
  await writeReport(report);
} finally {
  if (workspaceId) cleanedRefreshJobs += await cleanupBackfillRefreshJobs(workspaceId, startedAt);
  if (workspaceId && ownerId && originalPolicy) {
    await policies.save({
      workspaceId,
      updatedBy: ownerId,
      updatedAt: new Date(),
      policy: originalPolicy,
    });
  }
  await database.close();
}

async function readAllEvents(
  workspace: string,
  contactId: string,
  targetSequenceId: number,
): Promise<ProspectMemoryEvent[]> {
  const collected: ProspectMemoryEvent[] = [];
  let cursor = 0;
  while (cursor < targetSequenceId) {
    const page = await events.listAfter({
      workspaceId: workspace,
      contactId,
      sequenceId: cursor,
      targetSequenceId,
      limit: 1_000,
    });
    if (page.length === 0) break;
    collected.push(...page);
    cursor = page.at(-1)!.sequenceId;
  }
  return collected;
}

function deterministicProbeSynthesis(
  materials: readonly ProspectMemorySourceMaterial[],
  oldCriticalMessageIds: ReadonlySet<string>,
): ProspectMemorySynthesis {
  const classifications = materials.flatMap((material) => {
    if (material.event.sourceKind !== "message" || !oldCriticalMessageIds.has(material.event.sourceId)) return [];
    const categories = classifyCriticalMessage(material.content ?? "");
    return categories.length ? [{ eventId: material.event.id, categories }] : [];
  });
  return {
    classifications,
    assertions: [],
    relationshipSummary: "Shadow probe déterministe : la qualité sémantique reste à évaluer sur un corpus humainement labellisé.",
    recommendedTone: null,
    contradictions: [],
    missingInformation: [],
    provider: null,
    model: null,
  };
}

function classifyCriticalMessage(body: string): readonly ProspectMemorySemanticCategory[] {
  const categories = new Set<ProspectMemorySemanticCategory>();
  if (/(pas intéressé|not interested|trop cher|too expensive|déjà|already|non merci|no thanks|problème|problem)/iu.test(body)) {
    categories.add("objection");
  }
  if (/(pas intéressé|not interested|non merci|no thanks)/iu.test(body)) {
    categories.add("do_not_repeat");
  }
  if (/(je (vais|peux|m'engage)|nous (allons|pouvons)|i (will|can|promise)|we (will|can)|rendez-vous|meeting|appel|call|envoyer|send|revenir vers|follow up)/iu.test(body)) {
    categories.add("commitment");
  }
  return [...categories];
}

async function cleanupBackfillRefreshJobs(workspace: string, createdSince: Date): Promise<number> {
  const rows = await database.client<Array<{ id: string }>>`
    delete from jobs
    where workspace_id = ${workspace}
      and type = 'prospect.memory.refresh'
      and correlation_id like 'prospect-memory-backfill:%'
      and created_at >= ${createdSince}
      and status in ('pending', 'retry')
    returning id
  `;
  return rows.length;
}

async function writeReport(report: unknown): Promise<void> {
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await Bun.write(outputPath, serialized);
  }
  process.stdout.write(serialized);
}

function createInlineBackfillQueue(): JobQueue & {
  seed(job: NewJob): void;
  hasPending(): boolean;
  take(): LeasedJob | undefined;
} {
  const pending: LeasedJob[] = [];
  const leased = (job: NewJob): LeasedJob => ({
    ...job,
    attempts: 1,
    lockedBy: `shadow-corpus:${runId}`,
    lockedUntil: new Date(Date.now() + 60 * 60 * 1_000),
  });
  return {
    seed(job) { pending.push(leased(job)); },
    hasPending() { return pending.length > 0; },
    take() { return pending.shift(); },
    async enqueue(job) {
      pending.push(leased(job));
      return { inserted: true };
    },
    async lease() { throw new Error("INLINE_BACKFILL_QUEUE_LEASE_UNSUPPORTED"); },
    async renewLease() { return true; },
    async acknowledge() {},
    async defer() { throw new Error("INLINE_BACKFILL_QUEUE_DEFER_UNSUPPORTED"); },
    async retry() { throw new Error("INLINE_BACKFILL_QUEUE_RETRY_UNSUPPORTED"); },
  };
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}
