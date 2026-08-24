const apiPort = process.env.E2E_API_PORT ?? "3301";
const webPort = process.env.E2E_WEB_PORT ?? "3300";
const childEnvironment = {
  ...process.env,
  PORT: apiPort,
  OUTBOUND_API_URL: `http://127.0.0.1:${apiPort}`,
  BETTER_AUTH_URL: `http://127.0.0.1:${webPort}`,
  BETTER_AUTH_TRUSTED_ORIGINS: `http://127.0.0.1:${webPort}`,
};

const processes = [
  { name: "api", process: Bun.spawn(["bun", "apps/api/src/index.ts"], { cwd: import.meta.dir + "/..", env: childEnvironment, stdout: "inherit", stderr: "inherit" }) },
  { name: "web", process: Bun.spawn(["bunx", "next", "dev", "apps/web", "--port", webPort], { cwd: import.meta.dir + "/..", env: childEnvironment, stdout: "inherit", stderr: "inherit" }) },
];

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    for (const child of processes) child.process.kill(signal);
  });
}

const completed = await Promise.race(processes.map(async (child) => ({ name: child.name, exitCode: await child.process.exited })));
for (const child of processes) if (child.name !== completed.name) child.process.kill("SIGTERM");
await Promise.all(processes.map((child) => child.process.exited));
if (completed.exitCode !== 0) {
  console.error(`${completed.name} exited with code ${completed.exitCode}`);
  process.exitCode = completed.exitCode;
}
