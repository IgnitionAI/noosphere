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

export function configuredDevelopmentProcessSpecs(environment: Readonly<Record<string, string | undefined>>): readonly DevelopmentProcessSpec[] {
  if (!environment.WEB_PORT && !environment.WEB_HOST) return developmentProcessSpecs;
  const port = environment.WEB_PORT ?? "3000";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error("WEB_PORT must be a valid TCP port");
  return developmentProcessSpecs.map(spec => spec.name === "web" ? {
    ...spec, command: ["bunx", "next", "dev", "apps/web", "--hostname", environment.WEB_HOST ?? "127.0.0.1", "--port", port],
  } : spec);
}

export async function startDevelopment(
  specs: readonly DevelopmentProcessSpec[] = configuredDevelopmentProcessSpecs(process.env),
): Promise<void> {
  const processes = specs.map(({ name, command, ...spec }) => ({
    name,
    process: Bun.spawn([...command], {
      cwd: import.meta.dir + "/..",
      env: { ...process.env, ...(spec.environment ?? {}) },
      stdout: "inherit",
      stderr: "inherit",
    }),
  }));

  let stopping = false;
  const stop = (signal: "SIGINT" | "SIGTERM") => {
    if (stopping) return;
    stopping = true;
    for (const child of processes) {
      if (child.process.exitCode === null) child.process.kill(signal);
    }
  };
  const onInterrupt = () => stop("SIGINT");
  const onTerminate = () => stop("SIGTERM");
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);

  const completed = await Promise.race(
    processes.map(async (child) => ({
      name: child.name,
      exitCode: await child.process.exited,
    })),
  );
  stop("SIGTERM");
  await Promise.all(processes.map((child) => child.process.exited));
  process.off("SIGINT", onInterrupt);
  process.off("SIGTERM", onTerminate);
  if (completed.exitCode !== 0) {
    console.error(`${completed.name} exited with code ${completed.exitCode}`);
    process.exitCode = completed.exitCode;
  }
}

if (import.meta.main) await startDevelopment();
