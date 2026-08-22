import { describe, expect, test } from "bun:test";
import { InMemoryResearchBackend } from "@outbound/infrastructure/testing/in-memory-research-backend";

describe("JobQueue contract", () => {
  test("deduplicates enqueue, leases once and recovers an expired lease", async () => {
    const queue = new InMemoryResearchBackend();
    const now = new Date("2026-07-24T10:00:00.000Z");
    const job = {
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      type: "research.stage.execute",
      payload: {},
      idempotencyKey: "run:stage",
      correlationId: "correlation",
      maxAttempts: 3,
      availableAt: now,
    };

    expect(await queue.enqueue(job)).toEqual({ inserted: true });
    expect(await queue.enqueue({ ...job, id: crypto.randomUUID() })).toEqual({ inserted: false });

    const first = await queue.lease({
      workerId: "worker-a",
      types: [job.type],
      limit: 1,
      leaseMs: 1_000,
      now,
    });
    expect(first).toHaveLength(1);
    expect(
      await queue.renewLease(
        first[0]!.id,
        first[0]!.lockedBy,
        new Date(now.getTime() + 2_000),
      ),
    ).toBe(true);
    expect(
      await queue.lease({
        workerId: "worker-b",
        types: [job.type],
        limit: 1,
        leaseMs: 1_000,
        now,
      }),
    ).toHaveLength(0);

    const recovered = await queue.lease({
      workerId: "worker-b",
      types: [job.type],
      limit: 1,
      leaseMs: 1_000,
      now: new Date(now.getTime() + 2_001),
    });
    expect(recovered[0]?.attempts).toBe(2);
    expect(recovered[0]?.lockedBy).toBe("worker-b");
  });

  test("moves an exhausted job to the dead letter state", async () => {
    const queue = new InMemoryResearchBackend();
    const now = new Date("2026-07-24T10:00:00.000Z");
    const jobId = crypto.randomUUID();
    await queue.enqueue({
      id: jobId,
      workspaceId: crypto.randomUUID(),
      type: "research.stage.execute",
      payload: {},
      idempotencyKey: "exhausted",
      correlationId: "correlation",
      maxAttempts: 1,
      availableAt: now,
    });
    const leased = await queue.lease({
      workerId: "worker-a",
      types: ["research.stage.execute"],
      limit: 1,
      leaseMs: 1_000,
      now,
    });

    expect(
      await queue.retry({
        jobId,
        workerId: leased[0]!.lockedBy,
        availableAt: now,
        errorCode: "PROVIDER_RATE_LIMITED",
        errorMessage: "rate limited",
      }),
    ).toBe("dead_lettered");
  });

  test("defers scheduled work without consuming an execution attempt", async () => {
    const queue = new InMemoryResearchBackend();
    const now = new Date("2026-07-24T10:00:00.000Z");
    const dueAt = new Date("2026-07-25T09:00:00.000Z");
    const jobId = crypto.randomUUID();
    await queue.enqueue({
      id: jobId,
      workspaceId: crypto.randomUUID(),
      type: "outreach.dispatch",
      payload: {},
      idempotencyKey: "scheduled-window",
      correlationId: "correlation",
      maxAttempts: 1,
      availableAt: now,
    });
    const [leased] = await queue.lease({
      workerId: "worker-a",
      types: ["outreach.dispatch"],
      limit: 1,
      leaseMs: 1_000,
      now,
    });

    await queue.defer({
      jobId,
      workerId: leased!.lockedBy,
      availableAt: dueAt,
      errorCode: "OUTSIDE_SENDING_WINDOW",
      errorMessage: "Wait for the recipient business window",
    });

    expect(queue.inspectJobs()[0]).toMatchObject({
      status: "pending",
      attempts: 0,
      availableAt: dueAt,
      lastErrorCode: "OUTSIDE_SENDING_WINDOW",
    });
    const [reLeased] = await queue.lease({
      workerId: "worker-b",
      types: ["outreach.dispatch"],
      limit: 1,
      leaseMs: 1_000,
      now: dueAt,
    });
    expect(reLeased?.attempts).toBe(1);
  });
});
