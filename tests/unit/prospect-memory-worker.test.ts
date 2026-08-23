import { describe, expect, test } from "bun:test";
import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";
import { PROSPECT_MEMORY_REFRESH_JOB_TYPE } from "@outbound/application/prospect-memory/prospect-memory";
import type { RefreshProspectMemory } from "@outbound/application/prospect-memory/refresh-prospect-memory";
import { ProspectMemoryRefreshJobProcessor } from "@outbound/infrastructure/prospect-memory/prospect-memory-refresh-job-processor";

const now = new Date("2026-08-23T08:00:00.000Z");

describe("ProspectMemoryRefreshJobProcessor", () => {
  test("acknowledges a durable refresh only after the snapshot is published", async () => {
    const calls: string[] = [];
    const processor = new ProspectMemoryRefreshJobProcessor(
      { execute: async () => ({ outcome: "published", snapshot: {}, hasMore: false }) } as unknown as RefreshProspectMemory,
      queue({ acknowledge: async () => { calls.push("acknowledge"); } }),
      { now: () => now },
    );

    await processor.process(job());

    expect(calls).toEqual(["acknowledge"]);
  });

  test("continues a published event page without consuming an attempt", async () => {
    const calls: Array<{ kind: string; errorCode?: string; availableAt?: Date }> = [];
    const processor = new ProspectMemoryRefreshJobProcessor(
      { execute: async () => ({ outcome: "published", snapshot: {}, hasMore: true }) } as unknown as RefreshProspectMemory,
      queue({
        acknowledge: async () => { calls.push({ kind: "acknowledge" }); },
        defer: async (request) => { calls.push({ kind: "defer", errorCode: request.errorCode, availableAt: request.availableAt }); },
      }),
      { now: () => now },
    );

    await processor.process(job());

    expect(calls).toEqual([{
      kind: "defer",
      errorCode: "PROSPECT_MEMORY_PAGE_CONTINUE",
      availableAt: new Date(now.getTime() + 10),
    }]);
  });

  test("defers a budget-blocked refresh without acknowledging or consuming browser state", async () => {
    const calls: Array<{ kind: string; errorCode?: string; availableAt?: Date }> = [];
    const retryAt = new Date("2026-08-24T00:00:00.000Z");
    const processor = new ProspectMemoryRefreshJobProcessor(
      { execute: async () => ({ outcome: "budget_blocked", retryAt }) } as unknown as RefreshProspectMemory,
      queue({
        acknowledge: async () => { calls.push({ kind: "acknowledge" }); },
        defer: async (request) => { calls.push({ kind: "defer", errorCode: request.errorCode, availableAt: request.availableAt }); },
      }),
      { now: () => now },
    );

    await processor.process(job());

    expect(calls).toEqual([{ kind: "defer", errorCode: "PROSPECT_MEMORY_BUDGET_BLOCKED", availableAt: retryAt }]);
  });

  test("rebuilds after a compare-and-swap race instead of publishing stale context", async () => {
    const calls: Array<{ kind: string; errorCode?: string; availableAt?: Date }> = [];
    const processor = new ProspectMemoryRefreshJobProcessor(
      { execute: async () => ({ outcome: "concurrent_update" }) } as unknown as RefreshProspectMemory,
      queue({
        acknowledge: async () => { calls.push({ kind: "acknowledge" }); },
        defer: async (request) => { calls.push({ kind: "defer", errorCode: request.errorCode, availableAt: request.availableAt }); },
      }),
      { now: () => now },
    );

    await processor.process(job());

    expect(calls).toEqual([{
      kind: "defer",
      errorCode: "PROSPECT_MEMORY_CAS_RETRY",
      availableAt: new Date(now.getTime() + 1_000),
    }]);
  });

  test("rejects a payload whose workspace does not match the lease", async () => {
    const processor = new ProspectMemoryRefreshJobProcessor(
      { execute: async () => ({ outcome: "concurrent_update" }) } as unknown as RefreshProspectMemory,
      queue(),
      { now: () => now },
    );

    await expect(processor.process(job({ workspaceId: "workspace-other" }))).rejects.toThrow(
      "PROSPECT_MEMORY_JOB_WORKSPACE_MISMATCH",
    );
  });
});

function job(payload: Record<string, unknown> = {}): LeasedJob {
  return {
    id: "job-memory-1",
    workspaceId: "workspace-1",
    type: PROSPECT_MEMORY_REFRESH_JOB_TYPE,
    payload: {
      workspaceId: "workspace-1",
      contactId: "contact-1",
      targetSequenceId: 42,
      privacyEpoch: 0,
      ...payload,
    },
    idempotencyKey: "memory:contact-1:42:0",
    correlationId: "memory-canary",
    maxAttempts: 3,
    attempts: 1,
    availableAt: now,
    lockedBy: "memory-worker-1",
    lockedUntil: new Date(now.getTime() + 120_000),
    priority: 0,
  };
}

function queue(overrides: Partial<JobQueue> = {}): JobQueue {
  return {
    enqueue: async () => ({ inserted: true }),
    lease: async () => [],
    renewLease: async () => true,
    acknowledge: async () => {},
    defer: async () => {},
    retry: async () => "scheduled",
    ...overrides,
  };
}
