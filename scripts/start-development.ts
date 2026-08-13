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
