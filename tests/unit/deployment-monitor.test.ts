import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { jobStatusEnum } from "../../packages/infrastructure/src/database/schema";

function monitor(count = "0") {
  const root = mkdtempSync(join(tmpdir(), "noosphere-monitor-"));
  for (const dir of ["deploy", "bin", "backups/postgres"]) mkdirSync(join(root, dir), { recursive: true });
  copyFileSync(resolve("deploy/monitor.sh"), join(root, "deploy/monitor.sh"));
  writeFileSync(join(root, "deploy/healthcheck.sh"), "exit 0\n");
  writeFileSync(join(root, "backups/postgres/recent.dump"), "fixture");
  writeFileSync(join(root, ".env"), `PUBLIC_WEBHOOK_BASE_URL=https://canary.example.com\nBACKUP_DIR=${root}/backups\n`, { mode: 0o600 });
  writeFileSync(join(root, "bin/df"), '#!/bin/sh\nprintf "Filesystem Blocks Used Available Capacity Mounted\\nfixture 100 10 90 10%% /\\n"\n', { mode: 0o700 });
  writeFileSync(join(root, "bin/docker"), `#!/usr/bin/env python3
import os, re, sys
if sys.argv[1] == 'stats':
 print('10%')
else:
 query = sys.argv[-1]
 open(os.environ['QUERY_LOG'], 'w').write(query)
 statuses = re.search(r"status\\s+(?:in\\s*\\(([^)]+)\\)|=\\s*('\\w+'))", query)
 if not statuses:
  sys.exit(1)
 values = re.findall(r"'([^']+)'", statuses.group(1) or statuses.group(2))
 if not set(values).issubset(os.environ['VALID_JOB_STATUSES'].split(',')):
  sys.exit(1)
 print(os.environ['JOB_COUNT'])
`, { mode: 0o700 });
  const result = Bun.spawnSync(["bash", join(root, "deploy/monitor.sh")], {
    env: { ...process.env, APP_DIR: root, ENV_FILE: join(root, ".env"), ALERT_WEBHOOK_URL: "", PATH: `${join(root, "bin")}:${process.env.PATH}`, QUERY_LOG: join(root, "query"), VALID_JOB_STATUSES: jobStatusEnum.enumValues.join(","), JOB_COUNT: count },
    stdout: "pipe", stderr: "pipe",
  });
  return { result, query: readFileSync(join(root, "query"), "utf8") };
}

test("healthy monitoring uses real job statuses and counts terminal failures rather than retryable jobs", () => {
  const { result, query } = monitor();
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("monitoring checks passed");
  expect(query).toContain("'dead_lettered'");
  expect(query).not.toContain("'retry'");
  expect(query).not.toContain("::text");
  expect(query).toContain("interval '24 hours'");
});

test("recent terminal jobs trigger an actionable alert", () => {
  const { result } = monitor("2");
  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain("2 dead-lettered jobs in 24h");
});

test("database inspection failure still triggers an alert", () => {
  const { result } = monitor("invalid");
  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain("job backlog could not be inspected");
});
