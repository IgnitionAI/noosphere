import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const roots: string[] = [];
const updater = resolve("deploy/update.sh");
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function git(cwd: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "noosphere-update-"));
  roots.push(root);
  const origin = join(root, "origin");
  const checkout = join(root, "checkout");
  mkdirSync(origin);
  git(origin, "init", "-b", "main");
  git(origin, "config", "user.name", "Release test");
  git(origin, "config", "user.email", "release@example.com");
  mkdirSync(join(origin, "deploy"));
  writeFileSync(join(origin, ".gitignore"), ".env\n.deploy/\n");
  writeFileSync(join(origin, "deploy/release.sh"), 'set -eu\nprintf "%s" "$1" > .deploy/requested-version\nexit "${RELEASE_TEST_EXIT:-0}"\n');
  git(origin, "add", ".");
  git(origin, "commit", "-m", "baseline");
  const previous = git(origin, "rev-parse", "HEAD");
  git(root, "clone", origin, checkout);
  writeFileSync(join(checkout, ".env"), "APP_VERSION=v1.0.0\n", { mode: 0o600 });
  writeFileSync(join(origin, "feature.txt"), "new release\n");
  git(origin, "add", ".");
  git(origin, "commit", "-m", "release");
  git(origin, "tag", "v1.1.0");
  return { origin, checkout, previous };
}
function update(checkout: string, version: string, env: Record<string, string> = {}) {
  return Bun.spawnSync(["bash", updater, version], {
    env: { ...process.env, APP_DIR: checkout, ...env }, stdout: "pipe", stderr: "pipe",
  });
}

test("updates the dedicated checkout to a release from main and passes the exact version", () => {
  const { origin, checkout } = fixture();
  const result = update(checkout, "v1.1.0");
  expect(result.exitCode).toBe(0);
  expect(git(checkout, "rev-parse", "HEAD")).toBe(git(origin, "rev-parse", "v1.1.0"));
  expect(readFileSync(join(checkout, ".deploy/requested-version"), "utf8")).toBe("v1.1.0");
});

test("refuses a tag outside main without changing the running checkout", () => {
  const { origin, checkout, previous } = fixture();
  git(origin, "checkout", "-b", "unreleased");
  writeFileSync(join(origin, "feature.txt"), "not reviewed\n");
  git(origin, "add", ".");
  git(origin, "commit", "-m", "unreleased");
  git(origin, "tag", "v9.0.0");
  const result = update(checkout, "v9.0.0");
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("not part of origin/main");
  expect(git(checkout, "rev-parse", "HEAD")).toBe(previous);
});

test("refuses to overwrite operator changes", () => {
  const { checkout, previous } = fixture();
  writeFileSync(join(checkout, "deploy/release.sh"), "operator changes\n");
  const result = update(checkout, "v1.1.0");
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("local changes");
  expect(git(checkout, "rev-parse", "HEAD")).toBe(previous);
  expect(readFileSync(join(checkout, "deploy/release.sh"), "utf8")).toBe("operator changes\n");
});

test("restores the prior code on release failure and permits a later retry", () => {
  const { checkout, previous } = fixture();
  const result = update(checkout, "v1.1.0", { RELEASE_TEST_EXIT: "42" });
  expect(result.exitCode).toBe(42);
  expect(git(checkout, "rev-parse", "HEAD")).toBe(previous);
  expect(readFileSync(join(checkout, ".env"), "utf8")).toBe("APP_VERSION=v1.0.0\n");
  expect(update(checkout, "v1.1.0").exitCode).toBe(0);
});

test("rejects concurrent updates without touching the checkout", () => {
  const { checkout, previous } = fixture();
  mkdirSync(join(checkout, ".deploy/update.lock"), { recursive: true });
  const result = update(checkout, "v1.1.0");
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("update lock already exists");
  expect(git(checkout, "rev-parse", "HEAD")).toBe(previous);
});

test("refuses pinned image overrides instead of reporting a false version upgrade", () => {
  const { checkout, previous } = fixture();
  writeFileSync(join(checkout, ".env"), "APP_VERSION=v1.0.0\nBACKEND_IMAGE=ghcr.io/example/backend:v1.0.0\n");
  const result = update(checkout, "v1.1.0");
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("require empty BACKEND_IMAGE");
  expect(git(checkout, "rev-parse", "HEAD")).toBe(previous);
});

test("a late metadata failure restores the environment and previous release record", () => {
  const root = mkdtempSync(join(tmpdir(), "noosphere-release-publish-"));
  roots.push(root);
  const env = join(root, ".env");
  const legacy = join(root, "version");
  const manifest = join(root, "manifest.json");
  const candidate = join(root, "candidate.json");
  writeFileSync(env, "APP_VERSION=v1.0.0\nOTHER=preserved\n", { mode: 0o600 });
  writeFileSync(legacy, "v1.0.0\n");
  writeFileSync(manifest, '{"appVersion":"v1.0.0"}');
  writeFileSync(candidate, '{"appVersion":"v1.1.0"}');
  const result = Bun.spawnSync(["python3", "-c", `
import os, runpy, sys
from pathlib import Path
module = runpy.run_path(sys.argv[1])
real_replace = os.replace
failed = False
def fail_final_publish(source, target):
    global failed
    if str(target) == sys.argv[4] and not failed:
        failed = True
        raise OSError("simulated late metadata write failure")
    return real_replace(source, target)
os.replace = fail_final_publish
module["publish"](Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]), Path(sys.argv[5]))
`, resolve("deploy/publish-release.py"), env, candidate, manifest, legacy], { stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("simulated late metadata write failure");
  expect(readFileSync(env, "utf8")).toBe("APP_VERSION=v1.0.0\nOTHER=preserved\n");
  expect(readFileSync(legacy, "utf8")).toBe("v1.0.0\n");
  expect(readFileSync(manifest, "utf8")).toBe('{"appVersion":"v1.0.0"}');
});
