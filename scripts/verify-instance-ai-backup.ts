import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { PostgresInstanceAiConnectionsRepository } from "@outbound/infrastructure/ai/postgres-instance-ai-connections-repository";
import { encryptSecret, decryptSecret } from "@outbound/infrastructure/security/secret-crypto";

// This drill creates its own databases and files. It never reads application data
// or existing credential volumes, and makes no provider calls.
const endpoint = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "");
const image = "paradedb/paradedb:v0.23.5";
const suffix = crypto.randomUUID().replaceAll("-", "");
const names = [`noosphere_backup_test_${suffix}`, `noosphere_restore_test_${suffix}`];
const adminUrl = new URL(endpoint); adminUrl.pathname = "/postgres";
const admin = createDatabase(adminUrl.href);
const databases: ReturnType<typeof createDatabase>[] = [];
const created: string[] = [];
const directory = await mkdtemp(join(tmpdir(), "noosphere-ai-restore-"));
const source = join(directory, "source"), backups = join(directory, "backups"), restored = join(directory, "restored");
const fixtureKey = crypto.randomUUID(), fixtureSecret = `fixture-${crypto.randomUUID()}`, connectionId = crypto.randomUUID();
const pgEnvironment = {
  ...process.env,
  PGHOST: ["localhost", "127.0.0.1", "::1"].includes(endpoint.hostname) ? "host.docker.internal" : endpoint.hostname,
  PGPORT: endpoint.port || "5432", PGUSER: decodeURIComponent(endpoint.username), PGPASSWORD: decodeURIComponent(endpoint.password),
};
async function run(args: string[], environment = process.env) {
  const child = Bun.spawn(args, { env: environment, stdout: "pipe", stderr: "pipe" });
  const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()]);
  if (code !== 0) throw new Error(`Backup drill command failed (${args[0]}): ${error}`);
}
try {
  for (const folder of [source, backups, restored, join(source, "codex-service-home"), join(source, "instance-codex-home", connectionId)]) await mkdir(folder, { recursive: true, mode: 0o700 });
  const auth = JSON.stringify({ tokens: { access_token: "controlled-auth-token" } });
  await writeFile(join(source, "environment.env"), `APP_ENCRYPTION_KEY=${fixtureKey}\n`, { mode: 0o600 });
  await writeFile(join(source, "codex-service-home", "auth.json"), auth, { mode: 0o600 });
  await writeFile(join(source, "instance-codex-home", connectionId, "auth.json"), auth, { mode: 0o600 });
  for (const name of names) {
    await admin.client.unsafe(`create database "${name}"`);
    created.push(name);
    const url = new URL(endpoint); url.pathname = `/${name}`;
    databases.push(createDatabase(url.href));
  }
  const original = databases[0]!, recovered = databases[1]!;
  await migrate(original.db, { migrationsFolder: join(import.meta.dir, "../packages/infrastructure/migrations") });
  const repository = new PostgresInstanceAiConnectionsRepository(original.db, { encrypt: (value) => encryptSecret(value, fixtureKey), decrypt: (value) => decryptSecret(value, fixtureKey) });
  const saved = await repository.save({ name: "Backup fixture", provider: "openai-api", apiKey: fixtureSecret, models: [{ model: "controlled-model", reasoningEffort: "low" }] });
  const selection = { connectionId: saved.id, model: "controlled-model" };
  await repository.finishTest({ ...await repository.beginTest(selection), errorCode: null });
  const compose = await readFile(join(import.meta.dir, "../compose.production.yml"), "utf8");
  const service = compose.split("  backup-ai-credentials:\n")[1]?.split("\n  codex-auth:")[0];
  const command = service?.match(/      - \|\n([\s\S]*?)    volumes:/)?.[1]?.split("\n").map((line) => line.replace(/^        /, "")).join("\n").replaceAll("$$", "$");
  assert(command, "Backup service command is missing");
  await run(["docker", "run", "--rm", "--network", "none", "--read-only", "--entrypoint", "/bin/sh", "-v", `${source}:/source:ro`, "-v", `${backups}:/backups`, image, "-ec", command]);
  const archives = await readdir(join(backups, "credentials"));
  assert.equal(archives.length, 1);
  const archive = join(backups, "credentials", archives[0]!);
  assert.equal((await stat(archive)).mode & 0o777, 0o600);
  const clientOptions = ["docker", "run", "--rm", "-e", "PGHOST", "-e", "PGPORT", "-e", "PGUSER", "-e", "PGPASSWORD", "-e", "PGDATABASE", "-v", `${backups}:/backups`];
  await run([...clientOptions, "--entrypoint", "pg_dump", image, "--format=custom", "--no-owner", "--no-acl", "--file=/backups/database.dump"], { ...pgEnvironment, PGDATABASE: names[0]! });
  await chmod(join(backups, "database.dump"), 0o600);
  await run([...clientOptions, "--entrypoint", "pg_restore", image, "--exit-on-error", "--clean", "--if-exists", "--no-owner", "--no-acl", "--dbname", names[1]!, "/backups/database.dump"], { ...pgEnvironment, PGDATABASE: names[1]! });
  await run(["docker", "run", "--rm", "--network", "none", "--entrypoint", "tar", "-v", `${archive}:/archive.tar.gz:ro`, "-v", `${restored}:/restored`, image, "-xzf", "/archive.tar.gz", "-C", "/restored"]);
  const recoveredKey = (await readFile(join(restored, "environment.env"), "utf8")).trim().split("=")[1]!;
  const restoredRepository = new PostgresInstanceAiConnectionsRepository(recovered.db, { encrypt: (value) => encryptSecret(value, recoveredKey), decrypt: (value) => decryptSecret(value, recoveredKey) });
  const ready = await restoredRepository.getReadyRoute(selection);
  assert(ready?.connectionVersion);
  const credential = await restoredRepository.getCredential(saved.id, ready.connectionVersion);
  assert.equal(credential?.apiKey, fixtureSecret);
  for (const path of [join(restored, "codex-service-home", "auth.json"), join(restored, "instance-codex-home", connectionId, "auth.json")]) {
    assert.equal(await readFile(path, "utf8"), auth);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  }
  const wrongKey = new PostgresInstanceAiConnectionsRepository(recovered.db, { encrypt: (value) => encryptSecret(value, "wrong"), decrypt: (value) => decryptSecret(value, "wrong") });
  await assert.rejects(() => wrongKey.getCredential(saved.id, ready.connectionVersion!));
  console.info(JSON.stringify({ event: "instance_ai_restore_verified", archiveMode: "0600", databaseRestored: true, credentialDecrypted: true, wrongKeyRejected: true, codexAuthFilesRestored: 2, providerCalls: 0, fixtureDirectory: directory }));
} finally {
  await Promise.all(databases.map((database) => database.close()));
  for (const name of created.reverse()) await admin.client.unsafe(`drop database "${name}"`);
  await admin.close();
}
