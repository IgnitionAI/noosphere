import { describe, expect, test } from "bun:test";
import { developmentProcessSpecs } from "../../scripts/start-development";

describe("development launcher", () => {
  test("runs the API, general worker, priority decision worker and web app together", () => {
    expect(developmentProcessSpecs).toEqual([
      { name: "api", command: ["bun", "apps/api/src/index.ts"] },
      {
        name: "worker",
        command: ["bun", "apps/worker/src/index.ts"],
        environment: { WORKER_EXCLUDED_JOB_TYPES: "prospect.decision.execute" },
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
      { name: "web", command: ["bun", "run", "web"] },
    ]);
  });
});
