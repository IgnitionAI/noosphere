import postgres from "postgres";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { bootstrapOwner } from "./bootstrap-owner";

const root = new URL("..", import.meta.url).pathname;
const databaseUrl = e2eDatabaseUrl(process.env);
const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3300";
const authSecret = process.env.BETTER_AUTH_SECRET ?? "noosphere-e2e-secret-012345678901234567890123";
const ownerEmail = process.env.BOOTSTRAP_OWNER_EMAIL ?? "owner@ignition.local";
const ownerName = process.env.BOOTSTRAP_OWNER_NAME ?? "Noosphere E2E";
const ownerPassword = process.env.BOOTSTRAP_OWNER_PASSWORD ?? "change-me-in-env";
const workspaceSlug = process.env.BOOTSTRAP_WORKSPACE_SLUG ?? "ignition-ai";
const workspaceName = process.env.BOOTSTRAP_WORKSPACE_NAME ?? "IgnitionAI E2E";
await resetDatabase(databaseUrl);

const environment = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  TEST_DATABASE_URL: databaseUrl,
  E2E_BASE_URL: baseUrl,
  E2E_WEB_PORT: process.env.E2E_WEB_PORT ?? "3300",
  E2E_API_PORT: process.env.E2E_API_PORT ?? "3301",
  BETTER_AUTH_URL: baseUrl,
  BETTER_AUTH_SECRET: authSecret,
  BETTER_AUTH_TRUSTED_ORIGINS: baseUrl,
  OUTBOUND_API_URL: `http://127.0.0.1:${process.env.E2E_API_PORT ?? "3301"}`,
  APP_ENCRYPTION_KEY: "noosphere-e2e-tests-only",
  BOOTSTRAP_OWNER_EMAIL: ownerEmail,
  BOOTSTRAP_OWNER_NAME: ownerName,
  BOOTSTRAP_OWNER_PASSWORD: ownerPassword,
  BOOTSTRAP_WORKSPACE_SLUG: workspaceSlug,
  BOOTSTRAP_WORKSPACE_NAME: workspaceName,
  UNIPILE_ENABLED: "false",
  UNIPILE_DSN: "",
  UNIPILE_API_KEY: "",
  UNIPILE_WEBHOOK_SECRET: "",
  CALENDAR_ENABLED: "false",
  CALCOM_API_KEY: "",
};

const database = createDatabase(databaseUrl);
try {
  await migrate(database.db, {
    migrationsFolder: new URL("../packages/infrastructure/migrations", import.meta.url).pathname,
  });
  await bootstrapOwner(database.db, {
    baseUrl,
    secret: authSecret,
    email: ownerEmail,
    name: ownerName,
    password: ownerPassword,
    workspaceSlug,
    workspaceName,
  });
} finally {
  await database.close();
}

const child = Bun.spawn(["bunx", "playwright", "test", ...process.argv.slice(2)], {
  cwd: root,
  env: environment,
  stdout: "inherit",
  stderr: "inherit",
});
process.exitCode = await child.exited;

function e2eDatabaseUrl(environment: Readonly<Record<string, string | undefined>>): string {
  if (environment.E2E_DATABASE_URL) return assertSafe(environment.E2E_DATABASE_URL);
  const source = environment.DATABASE_URL;
  if (!source) throw new Error("DATABASE_URL or E2E_DATABASE_URL is required for browser tests");
  const url = new URL(source);
  const name = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  url.pathname = `/${name}_e2e`;
  return assertSafe(url.toString());
}

function assertSafe(value: string): string {
  const url = new URL(value);
  const name = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!/^[A-Za-z0-9_-]+_e2e$/.test(name)) throw new Error("E2E database name must end in _e2e");
  return url.toString();
}

async function resetDatabase(databaseUrl: string): Promise<void> {
  const target = new URL(databaseUrl);
  const databaseName = decodeURIComponent(target.pathname.replace(/^\/+/, ""));
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
