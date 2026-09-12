import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "dotenv";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { bootstrapInstanceAdministrator } from "./bootstrap-owner";

const endpoint = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "");
const suffix = crypto.randomUUID().replaceAll("-", "");
const name = `noosphere_compose_test_${suffix}`;
const project = `noosphere-ai-test-${suffix.slice(0, 12)}`;
const directory = await mkdtemp(join(tmpdir(), "noosphere-compose-ai-"));
const port = Number(process.env.INSTANCE_AI_CANARY_PORT ?? "3390");
const base = `http://127.0.0.1:${port}`;
const target = new URL(endpoint); target.pathname = `/${name}`;
const dockerTarget = new URL(target);
if (["127.0.0.1", "localhost", "::1"].includes(dockerTarget.hostname)) dockerTarget.hostname = "host.docker.internal";
const adminUrl = new URL(endpoint); adminUrl.pathname = "/postgres";
const admin = createDatabase(adminUrl.href), database = createDatabase(target.href);
const env = { ...parse(await readFile(join(import.meta.dir, "../.env.example"))), DATABASE_URL: dockerTarget.href, AI_PROVIDER: "", OPENAI_API_KEY: "", KIMI_CODE_API_KEY: "", CODEX_SERVICE_HOME: "/var/lib/noosphere-codex", INSTANCE_CODEX_HOME: "/var/lib/noosphere-instance-codex", CRAWLER_API_KEY: "fixture", S3_ACCESS_KEY_ID: "fixture", S3_SECRET_ACCESS_KEY: "fixture", APP_ENCRYPTION_KEY: crypto.randomUUID(), BETTER_AUTH_SECRET: crypto.randomUUID(), BETTER_AUTH_URL: base, BETTER_AUTH_TRUSTED_ORIGINS: base, OUTBOUND_API_URL: "http://api:3001", TEI_PROTO_PATH: "/app/packages/infrastructure/src/embeddings/tei.proto", WORKER_DISABLE_MAINTENANCE: "true", WORKER_DISABLE_OUTBOX: "true", WORKER_DISABLE_OUTREACH_SCHEDULER: "true", JOB_POLL_INTERVAL_MS: "5000" };
const backend = "noosphere-ai-validation-backend:93", web = "noosphere-ai-validation-web:93";
const volumes = ["codex:/var/lib/noosphere-codex", "instance-codex:/var/lib/noosphere-instance-codex"];
const platform = "linux/amd64";
const compose = { services: {
  migrate: { image: backend, platform, command: ["bun", "dist/migrate/migrate.js"], environment: env },
  api: { image: backend, platform, command: ["bun", "dist/backend/api/src/index.js"], environment: { ...env, PORT: "3001" }, volumes, depends_on: { migrate: { condition: "service_completed_successfully" } }, healthcheck: { test: ["CMD", "bun", "-e", "fetch('http://127.0.0.1:3001/health/ready').then(r=>{if(!r.ok)process.exit(1)})"], interval: "2s", timeout: "5s", retries: 30 } },
  worker: { image: backend, platform, command: ["bun", "dist/backend/worker/src/index.js"], environment: env, volumes, depends_on: { api: { condition: "service_healthy" } } },
  web: { image: web, platform, environment: { ...env, PORT: "3000", HOSTNAME: "0.0.0.0" }, depends_on: { api: { condition: "service_healthy" } }, healthcheck: { test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/login').then(r=>{if(!r.ok)process.exit(1)})"], interval: "2s", timeout: "5s", retries: 30 } },
  proxy: { image: "caddy:2.11.1-alpine@sha256:3b2a0196e0687279c14c27adff9fc6b44acfa318dbb97eaebe385bdf99e5364c", platform, ports: [`127.0.0.1:${port}:80`], volumes: [`${directory}/Caddyfile:/etc/caddy/Caddyfile:ro`], depends_on: { web: { condition: "service_healthy" } } },
}, volumes: { codex: {}, "instance-codex": {} } };
const file = join(directory, "compose.json");
await writeFile(file, JSON.stringify(compose), { mode: 0o600 });
await writeFile(join(directory, "Caddyfile"), ":80 {\n handle /api/* {\n reverse_proxy api:3001\n }\n handle {\n reverse_proxy web:3000\n }\n}\n", { mode: 0o644 });
async function command(args: string[]) {
  const child = Bun.spawn(["docker", "compose", "-p", project, "-f", file, ...args], { stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (code) throw new Error(`Compose canary failed: ${stderr}`);
  return stdout;
}
let created = false;
try {
  await admin.client.unsafe(`create database "${name}"`); created = true;
  await command(["up", "--detach", "--wait", "--wait-timeout", "120"]);
  const owner = { baseUrl: base, secret: env.BETTER_AUTH_SECRET, email: "canary@example.com", name: "Canary", password: "canary-fixture-password", workspaceSlug: "unused", workspaceName: "Unused" };
  await bootstrapInstanceAdministrator(database.db, owner);
  assert.equal((await fetch(`${base}/login`)).status, 200);
  const signedIn = await fetch(`${base}/api/auth/sign-in/email`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ email: owner.email, password: owner.password }) });
  assert.equal(signedIn.status, 200);
  const cookie = signedIn.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const headers = { origin: base, "content-type": "application/json", cookie };
  const setup = await fetch(`${base}/api/v1/instance/setup`, { headers });
  assert.equal(setup.status, 200);
  assert.equal((await setup.json() as { isAdministrator: boolean }).isAdministrator, true);
  const workspaceResponse = await fetch(`${base}/api/v1/workspaces`, { method: "POST", headers, body: JSON.stringify({ name: "Compose exploration" }) });
  assert.equal(workspaceResponse.status, 201);
  const workspace = await workspaceResponse.json() as { slug: string };
  assert.equal((await fetch(`${base}/w/${workspace.slug}`, { headers })).status, 200);
  const generation = await fetch(`${base}/api/v1/content/strategy/derive`, { method: "POST", headers: { ...headers, "x-workspace-slug": workspace.slug }, body: JSON.stringify({ requestKey: "compose-no-ai" }) });
  assert.equal(generation.status, 409);
  assert.equal((await generation.json() as { code: string }).code, "AI_SETUP_REQUIRED");
  console.info(JSON.stringify({ event: "instance_ai_compose_verified", architecture: platform, login: true, instanceAdministrator: true, workspaceCreatedWithoutAi: true, generationBlockedWithoutAi: true, ingress: base, project, evidenceDirectory: directory }));
} finally {
  await command(["logs", "--no-color"]).then((logs) => writeFile(join(directory, "runtime.log"), logs, { mode: 0o600 })).catch(() => {});
  await command(["down"]).catch(() => {});
  await database.close();
  if (created) await admin.client.unsafe(`drop database "${name}"`);
  await admin.close();
}
