import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import {
  PROSPECT_MEMORY_EVENT_SCHEMA_VERSION,
  PROSPECT_MEMORY_RENDERER_VERSION,
  PROSPECT_MEMORY_SNAPSHOT_SCHEMA_VERSION,
  type ProspectMemorySnapshot,
} from "@outbound/domain/prospect-memory/prospect-memory";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { authUsers, contacts, jobs, prospectMemoryEvents, workspaceProspectMemorySettings, workspaces } from "@outbound/infrastructure/database/schema";
import {
  PostgresContextReceiptRecorder,
  PostgresProspectMemoryEventRepository,
  PostgresProspectMemoryPolicyReader,
  PostgresProspectMemorySnapshotRepository,
} from "@outbound/infrastructure/prospect-memory/postgres-prospect-memory-repository";
import { captureProspectMemoryMutation } from "@outbound/infrastructure/prospect-memory/capture-prospect-memory-mutation";
import {
  ProspectMemoryBackfillJobProcessor,
  ProspectMemoryBackfillScheduler,
} from "@outbound/infrastructure/prospect-memory/prospect-memory-backfill";
import { PostgresJobQueue } from "@outbound/infrastructure/jobs/postgres-job-queue";
import { and, eq } from "drizzle-orm";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("MEM-002 prospect memory persistence", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const events = new PostgresProspectMemoryEventRepository(database.client);
  const snapshots = new PostgresProspectMemorySnapshotRepository(database.client);
  const receipts = new PostgresContextReceiptRecorder(database.client);
  const policies = new PostgresProspectMemoryPolicyReader(database.client);
  const workspaceA = crypto.randomUUID();
  const workspaceB = crypto.randomUUID();
  const contactA = crypto.randomUUID();
  const contactB = crypto.randomUUID();
  const operatorId = crypto.randomUUID();
  const observedAt = new Date("2026-08-23T09:00:00.000Z");

  beforeAll(async () => {
    await migrate(database.db, {
      migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations"),
    });
    await database.db.insert(workspaces).values([
      { id: workspaceA, slug: `memory-a-${workspaceA}`, name: "Memory A" },
      { id: workspaceB, slug: `memory-b-${workspaceB}`, name: "Memory B" },
    ]);
    await database.db.insert(authUsers).values({
      id: operatorId,
      name: "Memory Operator",
      email: `memory-${operatorId}@example.test`,
    });
    await database.db.insert(contacts).values([
      { id: contactA, workspaceId: workspaceA, firstName: "Ada", lastName: "Martin" },
      { id: contactB, workspaceId: workspaceB, firstName: "Grace", lastName: "Durand" },
    ]);
  });

  afterAll(async () => {
    await database.client`delete from prospect_memory_context_receipts where workspace_id in (${workspaceA}, ${workspaceB})`;
    await database.client`delete from prospect_memory_snapshots where workspace_id in (${workspaceA}, ${workspaceB})`;
    await database.client`delete from prospect_memory_events where workspace_id in (${workspaceA}, ${workspaceB})`;
    await database.client`delete from jobs where workspace_id in (${workspaceA}, ${workspaceB})`;
    await database.client`delete from workspace_prospect_memory_settings where workspace_id in (${workspaceA}, ${workspaceB})`;
    await database.client`delete from contacts where workspace_id in (${workspaceA}, ${workspaceB})`;
    await database.client`delete from workspaces where id in (${workspaceA}, ${workspaceB})`;
    await database.client`delete from auth_users where id = ${operatorId}`;
    await database.close();
  });

  test("deduplicates source versions and orders late provider events by the database sequence", async () => {
    const first = await events.append(eventInput({
      workspaceId: workspaceA,
      contactId: contactA,
      sourceId: "message-1",
      occurredAt: new Date("2026-08-23T08:00:00.000Z"),
    }));
    const replay = await events.append(eventInput({
      workspaceId: workspaceA,
      contactId: contactA,
      sourceId: "message-1",
      occurredAt: new Date("2026-08-23T08:00:00.000Z"),
    }));
    const late = await events.append(eventInput({
      workspaceId: workspaceA,
      contactId: contactA,
      sourceId: "message-old-provider-time",
      occurredAt: new Date("2026-08-20T08:00:00.000Z"),
    }));

    expect(first.inserted).toBe(true);
    expect(replay.inserted).toBe(false);
    expect(replay.event.id).toBe(first.event.id);
    expect(late.event.sequenceId).toBeGreaterThan(first.event.sequenceId);

    const delta = await events.listAfter({
      workspaceId: workspaceA,
      contactId: contactA,
      sequenceId: 0,
      limit: 10,
    });
    expect(delta.map((event) => event.sourceId)).toEqual(["message-1", "message-old-provider-time"]);
    expect(await events.aggregateValidEventKinds({
      workspaceId: workspaceA,
      contactId: contactA,
      asOf: observedAt,
    })).toMatchObject({ message_received: 2 });
    expect(await events.latestSequence(workspaceB, contactB)).toBe(0);
  });

  test("commits atomically and coalesces nearby mutations into one durable refresh job", async () => {
    await database.db.insert(workspaceProspectMemorySettings).values({
      workspaceId: workspaceB,
      captureEnabled: true,
      shadowEnabled: true,
    }).onConflictDoUpdate({
      target: workspaceProspectMemorySettings.workspaceId,
      set: { captureEnabled: true, shadowEnabled: true },
    });
    const rolledBackSource = `rollback-${crypto.randomUUID()}`;
    await expect(database.db.transaction(async (tx) => {
      await captureProspectMemoryMutation(tx, {
        workspaceId: workspaceB,
        sourceContactId: contactB,
        sourceKind: "message",
        sourceId: rolledBackSource,
        sourceVersion: 1,
        kind: "message_received",
        occurredAt: observedAt,
        observedAt,
        payload: { direction: "inbound" },
        correlationId: rolledBackSource,
      });
      throw new Error("ROLLBACK_FOR_TEST");
    })).rejects.toThrow("ROLLBACK_FOR_TEST");
    expect(await database.db.select({ id: prospectMemoryEvents.id }).from(prospectMemoryEvents).where(and(
      eq(prospectMemoryEvents.workspaceId, workspaceB),
      eq(prospectMemoryEvents.sourceId, rolledBackSource),
    ))).toHaveLength(0);
    expect(await database.db.select({ id: jobs.id }).from(jobs).where(and(
      eq(jobs.workspaceId, workspaceB),
      eq(jobs.correlationId, rolledBackSource),
    ))).toHaveLength(0);

    const committedSource = `commit-${crypto.randomUUID()}`;
    await database.db.transaction(async (tx) => {
      await captureProspectMemoryMutation(tx, {
        workspaceId: workspaceB,
        sourceContactId: contactB,
        sourceKind: "message",
        sourceId: committedSource,
        sourceVersion: 1,
        kind: "message_received",
        occurredAt: observedAt,
        observedAt,
        payload: { direction: "inbound" },
        correlationId: committedSource,
      });
      await captureProspectMemoryMutation(tx, {
        workspaceId: workspaceB,
        sourceContactId: contactB,
        sourceKind: "message",
        sourceId: `${committedSource}-second`,
        sourceVersion: 1,
        kind: "message_sent",
        occurredAt: new Date(observedAt.getTime() + 1_000),
        observedAt: new Date(observedAt.getTime() + 1_000),
        payload: { direction: "outbound" },
        correlationId: `${committedSource}-second`,
      });
    });
    expect(await database.db.select({ id: prospectMemoryEvents.id }).from(prospectMemoryEvents).where(and(
      eq(prospectMemoryEvents.workspaceId, workspaceB),
      eq(prospectMemoryEvents.sourceId, committedSource),
    ))).toHaveLength(1);
    const coalesced = await database.client<{ count: number; target_sequence_id: string }[]>`
      select count(*)::int as count, max((payload->>'targetSequenceId')::bigint)::text as target_sequence_id
      from jobs
      where workspace_id = ${workspaceB}
        and type = 'prospect.memory.refresh'
        and idempotency_key like ${`prospect-memory:auto:${contactB}:%`}
    `;
    expect(coalesced[0]?.count).toBe(1);
    const eventSequence = await database.client<{ sequence_id: string }[]>`
      select sequence_id::text from prospect_memory_events
      where workspace_id = ${workspaceB} and source_id = ${`${committedSource}-second`}
    `;
    expect(coalesced[0]?.target_sequence_id).toBe(eventSequence[0]?.sequence_id);
    await database.db.delete(workspaceProspectMemorySettings).where(eq(workspaceProspectMemorySettings.workspaceId, workspaceB));
  });

  test("backfills at low priority and replays a crashed page without duplicate events or successor jobs", async () => {
    const queue = new PostgresJobQueue(database.client);
    const ids = { generate: () => crypto.randomUUID() };
    const clock = { now: () => observedAt };
    await database.db.insert(workspaceProspectMemorySettings).values({
      workspaceId: workspaceB,
      captureEnabled: true,
      shadowEnabled: true,
    }).onConflictDoUpdate({
      target: workspaceProspectMemorySettings.workspaceId,
      set: { captureEnabled: true, shadowEnabled: true },
    });
    const scheduler = new ProspectMemoryBackfillScheduler(database.db, queue, ids, clock);
    expect(await scheduler.reconcile()).toBe(1);
    expect(await scheduler.reconcile()).toBe(0);

    const [root] = await queue.lease({
      workerId: "memory-backfill-test",
      types: ["prospect.memory.backfill"],
      limit: 1,
      leaseMs: 120_000,
      now: observedAt,
    });
    expect(root?.priority).toBe(-100);
    const processor = new ProspectMemoryBackfillJobProcessor(database.db, database.client, queue, ids, clock);
    await processor.process(root!);

    const contactEventsBeforeReplay = await database.client<{ count: number }[]>`
      select count(*)::int as count
      from prospect_memory_events
      where workspace_id = ${workspaceB}
        and source_kind = 'contact'
        and source_id = ${contactB}
    `;
    expect(contactEventsBeforeReplay[0]?.count).toBe(1);

    await queue.enqueue({
      id: crypto.randomUUID(),
      workspaceId: workspaceB,
      type: "prospect.memory.backfill",
      payload: root!.payload,
      idempotencyKey: `test-crash-replay:${crypto.randomUUID()}`,
      correlationId: root!.correlationId,
      maxAttempts: 3,
      priority: 0,
      availableAt: observedAt,
    });
    const [replay] = await queue.lease({
      workerId: "memory-backfill-replay-test",
      types: ["prospect.memory.backfill"],
      limit: 1,
      leaseMs: 120_000,
      now: observedAt,
    });
    await processor.process(replay!);

    const [afterReplay] = await database.client<{ events: number; successor_jobs: number }[]>`
      select
        (select count(*)::int from prospect_memory_events
          where workspace_id = ${workspaceB} and source_kind = 'contact' and source_id = ${contactB}) as events,
        (select count(*)::int from jobs
          where workspace_id = ${workspaceB}
            and type = 'prospect.memory.backfill'
            and idempotency_key = 'prospect-memory:backfill:v1:identities:start') as successor_jobs
    `;
    expect(afterReplay).toEqual({ events: 1, successor_jobs: 1 });
    await database.db.delete(workspaceProspectMemorySettings).where(eq(workspaceProspectMemorySettings.workspaceId, workspaceB));
  });

  test("publishes snapshots with compare-and-swap and rejects an old privacy epoch", async () => {
    const watermark = await events.latestSequence(workspaceA, contactA);
    const first = snapshot({ version: 1, watermark, privacyEpoch: 0 });
    expect(await snapshots.publishIfCurrent({
      snapshot: first,
      expectedVersion: 0,
      expectedPrivacyEpoch: 0,
    })).toBe(true);
    expect((await snapshots.findCurrent(workspaceA, contactA))?.id).toBe(first.id);

    expect(await snapshots.publishIfCurrent({
      snapshot: snapshot({ version: 2, watermark, privacyEpoch: 0 }),
      expectedVersion: 0,
      expectedPrivacyEpoch: 0,
    })).toBe(false);

    await database.client`
      update contacts
      set privacy_epoch = privacy_epoch + 1,
          anonymized_at = ${observedAt}
      where workspace_id = ${workspaceA} and id = ${contactA}
    `;
    expect(await snapshots.findCurrent(workspaceA, contactA)).toBeNull();
    expect(await snapshots.publishIfCurrent({
      snapshot: snapshot({ version: 2, watermark, privacyEpoch: 0 }),
      expectedVersion: 1,
      expectedPrivacyEpoch: 0,
    })).toBe(false);
  });

  test("stores receipts without raw context and keeps memory disabled without workspace settings", async () => {
    const policy = await policies.find(workspaceB);
    expect(policy.flags).toEqual({
      prospectMemoryCapture: false,
      prospectMemoryShadow: false,
      prospectMemorySetter: false,
      enabledCapabilities: [],
    });

    const receiptId = crypto.randomUUID();
    const receipt = {
      id: receiptId,
      requestKey: `context:${receiptId}`,
      workspaceId: workspaceB,
      contactId: contactB,
      capability: "call_preparation",
      snapshotId: null,
      snapshotVersion: null,
      watermark: 0,
      privacyEpoch: 0,
      rendererVersion: PROSPECT_MEMORY_RENDERER_VERSION,
      sourceEventIds: [],
      sourceHashes: [],
      excludedSourceEventIds: [],
      normalizedRetrievalQueries: ["objections ouvertes"],
      estimatedInputTokens: 12,
      contextHash: "a".repeat(64),
      createdAt: observedAt,
    } as const;
    expect(await receipts.record(receipt)).toBe(receiptId);
    expect(await receipts.record({ ...receipt, id: crypto.randomUUID() })).toBe(receiptId);
    await expect(receipts.record({
      ...receipt,
      id: crypto.randomUUID(),
      contextHash: "b".repeat(64),
    })).rejects.toThrow("PROSPECT_MEMORY_RECEIPT_REQUEST_KEY_REUSED");
    const rows = await database.client<{ payload_column_count: number }[]>`
      select count(*)::int as payload_column_count
      from information_schema.columns
      where table_name = 'prospect_memory_context_receipts'
        and column_name in ('context', 'payload', 'content', 'messages')
    `;
    expect(rows[0]?.payload_column_count).toBe(0);
  });

  test("activates shadow atomically and rolls back to disabled without losing reviewed provider policy", async () => {
    const activated = await policies.save({
      workspaceId: workspaceB,
      updatedBy: operatorId,
      updatedAt: observedAt,
      policy: {
        flags: {
          prospectMemoryCapture: true,
          prospectMemoryShadow: true,
          prospectMemorySetter: false,
          enabledCapabilities: ["setter_campaign", "outbound_drafting"],
        },
        processingProfiles: [{
          provider: "codex-cli",
          encryptedInTransit: true,
          trainingUse: "none",
          providerRetentionDays: 0,
          regionOrJurisdiction: "EU",
          operatorAccessPolicy: "Restricted support access with audit logs",
          subprocessorsReviewed: true,
          deletionProcedure: "Provider deletion request followed by contract expiry",
          personalDataAllowed: true,
          allowedCapabilities: ["setter_campaign", "outbound_drafting"],
          reviewedAt: observedAt,
        }],
        maxDailySemanticRefreshes: 500,
        maxDailyCostUsd: 7.5,
      },
    });
    expect(activated.flags).toMatchObject({
      prospectMemoryCapture: true,
      prospectMemoryShadow: true,
      prospectMemorySetter: false,
    });
    expect(activated.processingProfiles[0]).toMatchObject({
      provider: "codex-cli",
      regionOrJurisdiction: "EU",
      subprocessorsReviewed: true,
      allowedCapabilities: ["setter_campaign", "outbound_drafting"],
    });

    const rolledBack = await policies.save({
      workspaceId: workspaceB,
      updatedBy: operatorId,
      updatedAt: new Date(observedAt.getTime() + 1_000),
      policy: {
        ...activated,
        flags: {
          prospectMemoryCapture: false,
          prospectMemoryShadow: false,
          prospectMemorySetter: false,
          enabledCapabilities: [],
        },
      },
    });
    expect(rolledBack.flags).toEqual({
      prospectMemoryCapture: false,
      prospectMemoryShadow: false,
      prospectMemorySetter: false,
      enabledCapabilities: [],
    });
    expect(rolledBack.processingProfiles[0]?.provider).toBe("codex-cli");
  });

  function snapshot(input: {
    readonly version: number;
    readonly watermark: number;
    readonly privacyEpoch: number;
  }): ProspectMemorySnapshot {
    return {
      id: crypto.randomUUID(),
      workspaceId: workspaceA,
      contactId: contactA,
      version: input.version,
      watermark: input.watermark,
      firstSequenceId: input.watermark,
      privacyEpoch: input.privacyEpoch,
      status: "fresh",
      currentState: {
        displayName: "Ada Martin",
        companyName: null,
        jobTitle: null,
        locale: "fr",
        availableChannels: ["linkedin"],
        suppressed: false,
        anonymized: false,
        activeCampaignIds: [],
        activeDecisionId: null,
      },
      commercialState: {
        confirmedNeeds: [],
        objections: [],
        commitments: [],
        topicsCovered: [],
        doNotRepeat: [],
        openQuestions: [],
      },
      assertions: [],
      relationshipSummary: "Premier échange LinkedIn.",
      recommendedTone: "direct",
      contradictions: [],
      missingInformation: [],
      modelProvider: null,
      model: null,
      promptVersion: "memory-v1",
      policyVersion: "policy-v1",
      schemaVersion: PROSPECT_MEMORY_SNAPSHOT_SCHEMA_VERSION,
      rendererVersion: PROSPECT_MEMORY_RENDERER_VERSION,
      contentHash: input.version.toString().padStart(64, "0"),
      generatedAt: observedAt,
    };
  }
});

function eventInput(input: {
  readonly workspaceId: string;
  readonly contactId: string;
  readonly sourceId: string;
  readonly occurredAt: Date;
}) {
  return {
    workspaceId: input.workspaceId,
    sourceContactId: input.contactId,
    canonicalContactId: input.contactId,
    sourceKind: "message",
    sourceId: input.sourceId,
    sourceVersion: 1,
    kind: "message_received" as const,
    occurredAt: input.occurredAt,
    observedAt: new Date("2026-08-23T09:00:00.000Z"),
    validFrom: input.occurredAt,
    validTo: null,
    supersedesEventId: null,
    payload: { direction: "inbound" },
    schemaVersion: PROSPECT_MEMORY_EVENT_SCHEMA_VERSION,
  };
}
