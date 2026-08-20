const processes = [
  { name: "api", process: Bun.spawn(["bun", "apps/api/src/index.ts"], { cwd: import.meta.dir + "/..", env: process.env, stdout: "inherit", stderr: "inherit" }) },
  { name: "web", process: Bun.spawn(["bun", "run", "web"], { cwd: import.meta.dir + "/..", env: process.env, stdout: "inherit", stderr: "inherit" }) },
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
