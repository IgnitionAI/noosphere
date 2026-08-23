export interface DevelopmentProcessSpec {
  readonly name: string;
  readonly command: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
}

export const developmentProcessSpecs: readonly DevelopmentProcessSpec[] = [
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
] as const;

export async function startDevelopment(): Promise<void> {
  const processes = developmentProcessSpecs.map(({ name, command, ...spec }) => ({
    name,
    process: Bun.spawn([...command], {
      cwd: import.meta.dir + "/..",
      env: { ...process.env, ...(spec.environment ?? {}) },
      stdout: "inherit",
      stderr: "inherit",
    }),
  }));

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      for (const child of processes) child.process.kill(signal);
    });
  }

  const completed = await Promise.race(
    processes.map(async (child) => ({
      name: child.name,
      exitCode: await child.process.exited,
    })),
  );
  for (const child of processes) {
    if (child.name !== completed.name) child.process.kill("SIGTERM");
  }
  await Promise.all(processes.map((child) => child.process.exited));
  if (completed.exitCode !== 0) {
    console.error(`${completed.name} exited with code ${completed.exitCode}`);
    process.exitCode = completed.exitCode;
  }
}

if (import.meta.main) await startDevelopment();
