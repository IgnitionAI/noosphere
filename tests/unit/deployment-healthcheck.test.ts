import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("standalone healthcheck loads its private environment and preserves HTTPS verification during startup retries", () => {
  const root = mkdtempSync(join(tmpdir(), "noosphere-healthcheck-"));
  mkdirSync(join(root, "deploy"));
  mkdirSync(join(root, "bin"));
  copyFileSync(resolve("deploy/healthcheck.sh"), join(root, "deploy/healthcheck.sh"));
  writeFileSync(join(root, ".env"), "PUBLIC_WEBHOOK_BASE_URL=https://canary.example.com\n", { mode: 0o600 });
  writeFileSync(join(root, "bin/docker"), `#!/bin/sh
case "$*" in
  *"--services"*) printf '%s\n' database tei-embedding tei-reranker minio searxng crawler api web worker decision-worker setter-worker memory-worker proxy ;;
  inspect*) echo healthy ;;
  *) echo test-container ;;
esac
`, { mode: 0o700 });
  writeFileSync(join(root, "bin/curl"), `#!/bin/sh
printf '%s\n' "$*" >> "$HEALTHCHECK_LOG"
echo '{"status":"ready"}'
`, { mode: 0o700 });
  const result = Bun.spawnSync(["bash", join(root, "deploy/healthcheck.sh")], {
    env: { ...process.env, ENV_FILE: join(root, ".env"), PUBLIC_WEBHOOK_BASE_URL: "", PATH: `${join(root, "bin")}:${process.env.PATH}`, HEALTHCHECK_LOG: join(root, "requests") },
    stdout: "pipe", stderr: "pipe",
  });
  expect(result.exitCode).toBe(0);
  const requests = readFileSync(join(root, "requests"), "utf8");
  expect(requests).toContain("https://canary.example.com/health/ready");
  expect(requests).toContain("https://canary.example.com/login");
  expect(requests).toContain("--retry-all-errors");
  expect(requests).toContain("--max-time 15");
  expect(requests).not.toContain("--insecure");
});
