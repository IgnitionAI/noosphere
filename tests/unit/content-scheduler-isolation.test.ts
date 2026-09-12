import { expect, test } from "bun:test";
import { DailyContentIdeaScheduler } from "@outbound/infrastructure/content/daily-content-idea-scheduler";
import { editorialStrategySnapshotSchema } from "@outbound/contracts/content";

test("an invalid workspace strategy cannot block later Inbound schedules", async () => {
  const now = new Date("2026-09-12T15:00:00Z");
  const due = ["invalid", "valid"].map(workspaceId => ({ workspaceId, timezone: "UTC", localTime: "06:00", nextRunAt: now }));
  let reads = 0;
  const completed: string[] = [];
  const updates: unknown[] = [];
  const database = {
    select: () => ({ from: () => ({ where: () => ({
      orderBy: async () => [],
      limit: async () => { reads++; return due; },
    }) }) }),
    update: () => ({ set: (value: unknown) => ({ where: async () => { updates.push(value); } }) }),
  };
  const repository = { createDiscovery: async (input: { workspaceId: string }) => {
    if (input.workspaceId === "invalid") editorialStrategySnapshotSchema.parse({});
    completed.push(input.workspaceId);
  } };
  const scheduler = new DailyContentIdeaScheduler(database as never, repository as never, { now: () => now });
  expect(await scheduler.reconcile()).toBe(1);
  expect(reads).toBe(1);
  expect(completed).toEqual(["valid"]);
  expect(updates).toHaveLength(1);
});
