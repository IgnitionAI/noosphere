import { describe, expect, test } from "bun:test";
import { developmentProcessSpecs } from "../../scripts/start-development";

describe("development launcher", () => {
  test("runs the API, general worker, priority workers and web app together", () => {
    expect(developmentProcessSpecs).toEqual([
      { name: "api", command: ["bun", "apps/api/src/index.ts"] },
      {
        name: "worker",
        command: ["bun", "apps/worker/src/index.ts"],
        environment: {
          WORKER_EXCLUDED_JOB_TYPES: "prospect.decision.execute,conversation.command.execute,prospect.memory.refresh,prospect.memory.backfill",
        },
      },
      {
        name: "decision-worker",
        command: ["bun", "apps/worker/src/index.ts"],
        environment: {
          WORKER_ID: "prospect-decision-worker",
          WORKER_JOB_TYPES: "prospect.decision.execute",
          WORKER_DISABLE_MAINTENANCE: "true",
          WORKER_DISABLE_OUTBOX: "true",
          WORKER_DISABLE_OUTREACH_SCHEDULER: "true",
        },
      },
      {
        name: "setter-worker",
        command: ["bun", "apps/worker/src/index.ts"],
        environment: {
          WORKER_ID: "setter-command-worker",
          WORKER_JOB_TYPES: "conversation.command.execute",
          JOB_BATCH_SIZE: "2",
          JOB_POLL_INTERVAL_MS: "250",
          WORKER_DISABLE_MAINTENANCE: "true",
          WORKER_DISABLE_OUTBOX: "true",
          WORKER_DISABLE_OUTREACH_SCHEDULER: "true",
        },
      },
      {
        name: "memory-worker",
        command: ["bun", "apps/worker/src/index.ts"],
        environment: {
          WORKER_ID: "prospect-memory-worker",
          WORKER_JOB_TYPES: "prospect.memory.refresh,prospect.memory.backfill",
          JOB_BATCH_SIZE: "2",
          JOB_POLL_INTERVAL_MS: "500",
          JOB_LEASE_MS: "120000",
          JOB_HEARTBEAT_MS: "30000",
          WORKER_DISABLE_MAINTENANCE: "true",
          WORKER_DISABLE_OUTBOX: "true",
          WORKER_DISABLE_OUTREACH_SCHEDULER: "true",
        },
      },
      { name: "web", command: ["bun", "run", "web"] },
    ]);
  });
});
