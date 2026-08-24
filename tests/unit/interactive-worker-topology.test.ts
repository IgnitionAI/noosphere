import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { developmentProcessSpecs } from "../../scripts/start-development";

const repositoryRoot = new URL("../../", import.meta.url);

describe("interactive Setter worker topology", () => {
  test("production isolates on-demand conversation commands from long AI jobs", () => {
    const compose = readFileSync(new URL("compose.production.yml", repositoryRoot), "utf8");

    expect(compose).toContain("\n  setter-worker:\n");
    expect(compose).toContain("WORKER_ID: setter-command-worker");
    expect(compose).toContain("WORKER_JOB_TYPES: conversation.command.execute");
    expect(compose).toContain("WORKER_EXCLUDED_JOB_TYPES: prospect.decision.execute,conversation.command.execute,prospect.memory.refresh,prospect.memory.backfill");
    expect(compose).toContain("\n  memory-worker:\n");
    expect(compose).toContain("WORKER_ID: prospect-memory-worker");
    expect(compose).toContain("WORKER_JOB_TYPES: prospect.memory.refresh,prospect.memory.backfill");
  });

  test("the local launcher preserves the same isolation", () => {
    const generalWorker = developmentProcessSpecs.find((spec) => spec.name === "worker");
    const setterWorker = developmentProcessSpecs.find((spec) => spec.name === "setter-worker");
    const memoryWorker = developmentProcessSpecs.find((spec) => spec.name === "memory-worker");

    expect(generalWorker?.environment?.WORKER_EXCLUDED_JOB_TYPES).toBe(
      "prospect.decision.execute,conversation.command.execute,prospect.memory.refresh,prospect.memory.backfill",
    );
    expect(setterWorker?.environment).toMatchObject({
      WORKER_ID: "setter-command-worker",
      WORKER_JOB_TYPES: "conversation.command.execute",
      WORKER_DISABLE_MAINTENANCE: "true",
      WORKER_DISABLE_OUTBOX: "true",
      WORKER_DISABLE_OUTREACH_SCHEDULER: "true",
    });
    expect(memoryWorker?.environment).toMatchObject({
      WORKER_ID: "prospect-memory-worker",
      WORKER_JOB_TYPES: "prospect.memory.refresh,prospect.memory.backfill",
      WORKER_DISABLE_MAINTENANCE: "true",
      WORKER_DISABLE_OUTBOX: "true",
      WORKER_DISABLE_OUTREACH_SCHEDULER: "true",
    });
  });

  test("the direct Bun worker scripts preserve the same isolation", () => {
    const manifest = JSON.parse(readFileSync(new URL("package.json", repositoryRoot), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(manifest.scripts?.["worker:general"]).toContain(
      "WORKER_EXCLUDED_JOB_TYPES=prospect.decision.execute,conversation.command.execute,prospect.memory.refresh,prospect.memory.backfill",
    );
    expect(manifest.scripts?.["worker:setter"]).toContain(
      "WORKER_JOB_TYPES=conversation.command.execute",
    );
    expect(manifest.scripts?.["worker:memory"]).toContain(
      "WORKER_JOB_TYPES=prospect.memory.refresh,prospect.memory.backfill",
    );
  });
});
