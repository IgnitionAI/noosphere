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
    return explicitTestUrl;
  }
  const url = new URL(developmentUrl!);
  const databaseName = databaseNameFrom(url);
  url.pathname = `/${databaseName}_test`;
  return url.toString();
}

async function ensureDatabase(databaseUrl: string): Promise<void> {
  const target = new URL(databaseUrl);
  const databaseName = databaseNameFrom(target);
  if (!/^[A-Za-z0-9_-]+$/.test(databaseName)) {
    throw new Error("Integration test database name contains unsupported characters");
  }
  const admin = new URL(target);
  admin.pathname = "/postgres";
  const sql = postgres(admin.toString(), { max: 1, connect_timeout: 10 });
  try {
    const existing = await sql<{ exists: boolean }[]>`
      select exists(select 1 from pg_database where datname = ${databaseName}) as exists
    `;
    if (!existing[0]?.exists) {
      try {
        await sql.unsafe(`create database "${databaseName}"`);
      } catch (error) {
        if (postgresErrorCode(error) !== "42P04") throw error;
      }
    }
  } finally {
    await sql.end();
  }
}

async function main(): Promise<void> {
  const testDatabaseUrl = integrationTestDatabaseUrl(process.env);
  await ensureDatabase(testDatabaseUrl);
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
    env: { ...process.env, TEST_DATABASE_URL: testDatabaseUrl },
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

function normalizedDatabaseUrl(value: string): string {
  const url = new URL(value);
  url.searchParams.sort();
  return url.toString();
}

function postgresErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

if (import.meta.main) await main();
