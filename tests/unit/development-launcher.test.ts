import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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


test("shutdown lets a busy worker drain after another child exits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "noosphere-launcher-"));
  const result = join(directory, "drained");
  const launcher = join(directory, "launcher.ts");
  const modulePath = new URL("../../scripts/start-development.ts", import.meta.url).pathname;
  const worker = `process.once("SIGTERM", async () => { await Bun.sleep(300); await Bun.write(${JSON.stringify(result)}, "drained"); process.exit(0); }); console.log("worker-ready"); setInterval(() => {}, 1000);`;
  await writeFile(launcher, `import { startDevelopment } from ${JSON.stringify(modulePath)}; await startDevelopment(${JSON.stringify([
    { name: "worker", command: [process.execPath, "-e", worker] },
    { name: "api", command: [process.execPath, "-e", 'process.once("SIGTERM", () => process.exit(0)); console.log("api-ready"); setInterval(() => {}, 1000);'] },
  ])});`);
  const child = Bun.spawn([process.execPath, launcher], { stdout: "pipe", stderr: "pipe" });
  const reader = child.stdout.getReader();
  let output = "";
  try {
    while (!output.includes("worker-ready") || !output.includes("api-ready")) {
      const {value, done} = await reader.read();
      if (done) throw new Error("Launcher exited before children were ready");
      output += new TextDecoder().decode(value);
    }
    child.kill("SIGTERM");
    await child.exited;
    expect(await readFile(result, "utf8").catch(() => "missing")).toBe("drained");
  } finally { reader.releaseLock(); child.kill(); }
});
