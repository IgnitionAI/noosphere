import { describe, expect, spyOn, test } from "bun:test";
import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";
import type { ResearchOrchestrator } from "@outbound/application/gtm/research-orchestrator";
import { SystemClock } from "@outbound/application/shared/ports";
import { ResearchWorker } from "../../apps/worker/src/research-worker";

describe("ResearchWorker job leases", () => {
  test("renews the lease while a long AI stage is executing", async () => {
    const now = new Date();
    const job: LeasedJob = {
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      type: "research.stage.execute",
      payload: {},
      idempotencyKey: "run:stage",
      correlationId: "test",
      attempts: 1,
      maxAttempts: 5,
      availableAt: now,
      lockedBy: "worker-test",
      lockedUntil: new Date(now.getTime() + 90),
    };
    let leased = false;
    const renewals: Date[] = [];
    const queue: JobQueue = {
      async enqueue() {
        return { inserted: true };
      },
      async lease() {
        if (leased) return [];
        leased = true;
        return [job];
      },
      async renewLease(_jobId, _workerId, lockedUntil) {
        renewals.push(lockedUntil);
        return true;
      },
      async acknowledge() {},
      async retry() {
        return "scheduled";
      },
    };
    const orchestrator = {
      async process() {
        await Bun.sleep(180);
      },
    } as unknown as ResearchOrchestrator;
    const worker = new ResearchWorker(queue, orchestrator, new SystemClock(), {
      workerId: "worker-test",
      leaseMs: 90,
      batchSize: 1,
      pollIntervalMs: 1,
    });

    await worker.tick();

    expect(renewals.length).toBeGreaterThanOrEqual(2);
    expect(renewals.every((lockedUntil) => lockedUntil.getTime() > now.getTime())).toBe(true);
  });

  test("a lost lease while scheduling a retry does not stop the worker", async () => {
    const now = new Date();
    const job: LeasedJob = {
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      type: "research.stage.execute",
      payload: {},
      idempotencyKey: "run:stage",
      correlationId: "test",
      attempts: 1,
      maxAttempts: 5,
      availableAt: now,
      lockedBy: "worker-test",
      lockedUntil: new Date(now.getTime() + 60_000),
    };
    const queue: JobQueue = {
      async enqueue() {
        return { inserted: true };
      },
      async lease() {
        return [job];
      },
      async renewLease() {
        return true;
      },
      async acknowledge() {},
      async retry() {
        throw new Error("JOB_LEASE_LOST");
      },
    };
    const orchestrator = {
      async process() {
        throw new Error("stage failed");
      },
    } as unknown as ResearchOrchestrator;
    const worker = new ResearchWorker(queue, orchestrator, new SystemClock(), {
      workerId: "worker-test",
      leaseMs: 60_000,
      batchSize: 1,
      pollIntervalMs: 1,
    });
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(worker.tick()).resolves.toBe(1);
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});
