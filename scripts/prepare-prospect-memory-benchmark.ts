import { and, eq } from "drizzle-orm";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { RefreshProspectMemory } from "@outbound/application/prospect-memory/refresh-prospect-memory";
import { DeterministicProspectMemoryProjector, StrictProspectMemoryProjectionValidator } from "@outbound/application/prospect-memory/prospect-memory-projector";
import type { ProspectMemorySynthesizer } from "@outbound/application/prospect-memory/prospect-memory";
import { CryptoIdGenerator, SystemClock } from "@outbound/application/shared/ports";
import { createDatabase } from "@outbound/infrastructure/database/client";
import {
  contacts,
  jobs,
  workspaceMembers,
  workspaces,
} from "@outbound/infrastructure/database/schema";
import { captureProspectMemoryMutation } from "@outbound/infrastructure/prospect-memory/capture-prospect-memory-mutation";
import {
  PostgresContextReceiptRecorder,
  PostgresProspectMemoryEventRepository,
  PostgresProspectMemoryPolicyReader,
  PostgresProspectMemorySnapshotRepository,
} from "@outbound/infrastructure/prospect-memory/postgres-prospect-memory-repository";
import {
  PostgresProspectMemoryAuthoritativeStateReader,
  PostgresProspectMemorySemanticBudgetReader,
  PostgresProspectMemorySourceMaterialReader,
} from "@outbound/infrastructure/prospect-memory/postgres-prospect-memory-state-reader";
import { Sha256ContentHasher } from "@outbound/infrastructure/shared/sha256-content-hasher";

const databaseUrl = required("DATABASE_URL");
const ownerEmail = required("BOOTSTRAP_OWNER_EMAIL").toLowerCase();
const workspaceSlug = process.env.BENCHMARK_WORKSPACE_SLUG?.trim() || "prospect-memory-benchmark";
const now = new Date();
const database = createDatabase(databaseUrl);
const ids = new CryptoIdGenerator();
const clock = new SystemClock();
const hasher = new Sha256ContentHasher();
const events = new PostgresProspectMemoryEventRepository(database.client);
const snapshots = new PostgresProspectMemorySnapshotRepository(database.client);
const policies = new PostgresProspectMemoryPolicyReader(database.client);
const authoritativeState = new PostgresProspectMemoryAuthoritativeStateReader(database.db);
const sourceMaterials = new PostgresProspectMemorySourceMaterialReader(database.db, hasher);
const refresh = new RefreshProspectMemory(
  events,
  snapshots,
  authoritativeState,
  sourceMaterials,
  policies,
  new PostgresProspectMemorySemanticBudgetReader(database.db),
  noSemanticModel(),
  new DeterministicProspectMemoryProjector(),
  new StrictProspectMemoryProjectionValidator(),
  clock,
  ids,
  hasher,
);

try {
  const [owner] = await database.client<Array<{ id: string }>>`
    select id from auth_users where lower(email) = ${ownerEmail} limit 1
  `;
  if (!owner) throw new Error("BENCHMARK_OWNER_NOT_FOUND_RUN_BOOTSTRAP_OWNER_FIRST");

  const [workspace] = await database.client<Array<{ id: string }>>`
    insert into workspaces (id, slug, name, status, created_at, updated_at)
    values (${crypto.randomUUID()}, ${workspaceSlug}, 'Prospect Memory Benchmark', 'active', ${now}, ${now})
    on conflict (slug) do update set
      status = 'active',
      deleted_at = null,
      updated_at = excluded.updated_at
    returning id
  `;
  if (!workspace) throw new Error("BENCHMARK_WORKSPACE_CREATE_FAILED");
  await database.db.insert(workspaceMembers).values({
    workspaceId: workspace.id,
    userId: owner.id,
    role: "owner",
    status: "active",
    joinedAt: now,
    lastSelectedAt: now,
  }).onConflictDoUpdate({
    target: [workspaceMembers.workspaceId, workspaceMembers.userId],
    set: { role: "owner", status: "active", lastSelectedAt: now },
  });

  const existing = await database.db.select({ id: contacts.id })
    .from(contacts)
    .where(and(
      eq(contacts.workspaceId, workspace.id),
      eq(contacts.firstName, "Benchmark"),
    ));
  if (existing.length > 0) {
    const existingIds = existing.map((contact) => contact.id);
    await database.client`
      delete from jobs
      where workspace_id = ${workspace.id}
        and type in ('prospect.memory.refresh', 'prospect.memory.backfill')
        and payload->>'contactId' in ${database.client(existingIds)}
    `;
    await database.client`
      delete from contacts
      where workspace_id = ${workspace.id}
        and id in ${database.client(existingIds)}
    `;
  }

  await policies.save({
    workspaceId: workspace.id,
    updatedBy: owner.id,
    updatedAt: now,
    policy: {
      flags: {
        prospectMemoryCapture: true,
        prospectMemoryShadow: true,
        prospectMemorySetter: false,
        enabledCapabilities: ["call_preparation"],
      },
      processingProfiles: [],
      maxDailySemanticRefreshes: 0,
      maxDailyCostUsd: 0,
    },
  });

  const targets: Array<{ delta: 0 | 20 | 200; contactId: string; snapshotWatermark: number }> = [];
  for (const delta of [0, 20, 200] as const) {
    const contactId = crypto.randomUUID();
    await database.db.insert(contacts).values({
      id: contactId,
      workspaceId: workspace.id,
      firstName: "Benchmark",
      lastName: `Memory Delta ${delta}`,
      preferredChannel: "linkedin",
      source: "manual",
      createdAt: now,
      updatedAt: now,
    });
    const baseAt = new Date(now.getTime() - 60_000);
    const base = await database.db.transaction((transaction) => captureProspectMemoryMutation(transaction, {
      workspaceId: workspace.id,
      sourceContactId: contactId,
      sourceKind: "contact",
      sourceId: `benchmark:${contactId}:base`,
      sourceVersion: 1,
      kind: "contact_updated",
      occurredAt: baseAt,
      observedAt: baseAt,
      payload: { benchmark: true, phase: "base" },
      correlationId: `benchmark:${contactId}:base`,
    }));
    if (base.outcome !== "captured" || !base.sequenceId) {
      throw new Error(`BENCHMARK_BASE_CAPTURE_FAILED_${delta}`);
    }
    const projected = await refresh.execute({
      workspaceId: workspace.id,
      contactId,
      targetSequenceId: base.sequenceId,
      privacyEpoch: 0,
      requestKey: `benchmark:${contactId}:snapshot`,
    });
    if (projected.outcome !== "published") {
      throw new Error(`BENCHMARK_BASE_PROJECTION_FAILED_${delta}_${projected.outcome}`);
    }

    for (let index = 1; index <= delta; index += 1) {
      const observedAt = new Date(now.getTime() + index);
      const captured = await database.db.transaction((transaction) => captureProspectMemoryMutation(transaction, {
        workspaceId: workspace.id,
        sourceContactId: contactId,
        sourceKind: "contact",
        sourceId: `benchmark:${contactId}:delta:${index}`,
        sourceVersion: 1,
        kind: "contact_updated",
        occurredAt: observedAt,
        observedAt,
        payload: { benchmark: true, ordinal: index },
        correlationId: `benchmark:${contactId}:delta`,
      }));
      if (captured.outcome !== "captured") {
        throw new Error(`BENCHMARK_DELTA_CAPTURE_FAILED_${delta}_${index}_${captured.outcome}`);
      }
    }
    const latestSequence = await events.latestSequence(workspace.id, contactId);
    if (latestSequence - projected.snapshot.watermark !== delta) {
      throw new Error(`BENCHMARK_DELTA_MISMATCH_${delta}`);
    }
    targets.push({ delta, contactId, snapshotWatermark: projected.snapshot.watermark });
  }

  // Freeze the formal deltas. The isolated fixture deliberately does not run
  // the memory worker while the HTTP assembler benchmark is being measured.
  await database.db.delete(jobs).where(and(
    eq(jobs.workspaceId, workspace.id),
    eq(jobs.type, "prospect.memory.refresh"),
  ));

  const receiptCountBefore = await database.client<Array<{ count: number }>>`
    select count(*)::int as count
    from prospect_memory_context_receipts
    where workspace_id = ${workspace.id}
  `;
  const report = {
    schemaVersion: 1,
    preparedAt: now.toISOString(),
    workspaceSlug,
    shadowOnly: true,
    semanticModelCalls: 0,
    providerEffects: 0,
    receiptCountBefore: receiptCountBefore[0]?.count ?? 0,
    targets,
    environment: {
      BENCHMARK_WORKSPACE_SLUG: workspaceSlug,
      BENCHMARK_MEMORY_CONTACT_0_ID: targets.find((target) => target.delta === 0)!.contactId,
      BENCHMARK_MEMORY_CONTACT_20_ID: targets.find((target) => target.delta === 20)!.contactId,
      BENCHMARK_MEMORY_CONTACT_200_ID: targets.find((target) => target.delta === 200)!.contactId,
    },
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const outputPath = process.env.BENCHMARK_FIXTURE_OUTPUT?.trim();
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await Bun.write(outputPath, serialized);
  }
  process.stdout.write(serialized);
} finally {
  await database.close();
}

function noSemanticModel(): ProspectMemorySynthesizer {
  return {
    async synthesize() {
      throw new Error("BENCHMARK_SEMANTIC_MODEL_CALL_FORBIDDEN");
    },
  };
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
