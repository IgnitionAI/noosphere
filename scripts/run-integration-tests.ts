import postgres from "postgres";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";

export function integrationTestDatabaseUrl(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const developmentUrl = environment.DATABASE_URL?.trim();
  const explicitTestUrl = environment.TEST_DATABASE_URL?.trim();
  if (!developmentUrl && !explicitTestUrl) {
    throw new Error("DATABASE_URL or TEST_DATABASE_URL is required for integration tests");
  }
  if (explicitTestUrl) {
    if (developmentUrl && normalizedDatabaseUrl(explicitTestUrl) === normalizedDatabaseUrl(developmentUrl)) {
      throw new Error("TEST_DATABASE_URL must not target the development database");
    }
    assertSafeTestDatabaseName(databaseNameFrom(new URL(explicitTestUrl)));
    return explicitTestUrl;
  }
  const url = new URL(developmentUrl!);
  const databaseName = databaseNameFrom(url);
  url.pathname = `/${databaseName}_test`;
  assertSafeTestDatabaseName(databaseNameFrom(url));
  return url.toString();
}

export function integrationTestEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  testDatabaseUrl: string,
): Record<string, string | undefined> {
  return {
    ...environment,
    TEST_DATABASE_URL: testDatabaseUrl,
    APP_ENCRYPTION_KEY: "ignition-outbound-integration-tests-only",
  };
}

async function resetDatabase(databaseUrl: string): Promise<void> {
  const target = new URL(databaseUrl);
  const databaseName = databaseNameFrom(target);
  if (!/^[A-Za-z0-9_-]+$/.test(databaseName)) {
    throw new Error("Integration test database name contains unsupported characters");
  }
  assertSafeTestDatabaseName(databaseName);
  const admin = new URL(target);
  admin.pathname = "/postgres";
  const sql = postgres(admin.toString(), { max: 1, connect_timeout: 10 });
  try {
    await sql`select pg_terminate_backend(pid) from pg_stat_activity where datname = ${databaseName} and pid <> pg_backend_pid()`;
    await sql.unsafe(`drop database if exists "${databaseName}"`);
    await sql.unsafe(`create database "${databaseName}"`);
  } finally {
    await sql.end();
  }
}

async function main(): Promise<void> {
  const testDatabaseUrl = integrationTestDatabaseUrl(process.env);
  await resetDatabase(testDatabaseUrl);
  const database = createDatabase(testDatabaseUrl);
  try {
    await migrate(database.db, {
      migrationsFolder: new URL("../packages/infrastructure/migrations", import.meta.url).pathname,
    });
  } finally {
    await database.close();
  }
  console.info("Integration test database ready (isolated from development).");
  const child = Bun.spawn(["bun", "test", "tests/integration"], {
    cwd: import.meta.dir + "/..",
    env: integrationTestEnvironment(process.env, testDatabaseUrl),
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) process.exitCode = exitCode;
}

function databaseNameFrom(url: URL): string {
  const name = decodeURIComponent(url.pathname.replace(/^\/+/, "")).trim();
  if (!name) throw new Error("Database URL must include a database name");
  return name;
}

function assertSafeTestDatabaseName(databaseName: string): void {
  if (["postgres", "template0", "template1"].includes(databaseName.toLocaleLowerCase("en-US"))) {
    throw new Error("Integration test database name is reserved");
  }
}

function normalizedDatabaseUrl(value: string): string {
  const url = new URL(value);
  url.searchParams.sort();
  return url.toString();
}

if (import.meta.main) await main();
