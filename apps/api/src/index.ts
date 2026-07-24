import { ProductResearchApplication } from "@outbound/application/gtm/product-research-application";
import { CryptoIdGenerator, SystemClock } from "@outbound/application/shared/ports";
import { createBetterAuthRuntime } from "@outbound/infrastructure/auth/better-auth-runtime";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { PostgresProductResearchRepository } from "@outbound/infrastructure/gtm/postgres-product-research-repository";
import { createProductResearchHttpHandler } from "@outbound/interface/http/product-research-handler";

const databaseUrl = requiredEnvironment("DATABASE_URL");
const database = createDatabase(databaseUrl);
const auth = createBetterAuthRuntime(database.db, {
  baseUrl: requiredEnvironment("BETTER_AUTH_URL"),
  secret: requiredSecretEnvironment("BETTER_AUTH_SECRET"),
  trustedOrigins: commaSeparatedEnvironment(
    "BETTER_AUTH_TRUSTED_ORIGINS",
    requiredEnvironment("BETTER_AUTH_URL"),
  ),
  allowSignUp: process.env.BETTER_AUTH_ALLOW_SIGN_UP === "true",
});
const repository = new PostgresProductResearchRepository(database.db);
const application = new ProductResearchApplication(
  repository,
  repository,
  new CryptoIdGenerator(),
  new SystemClock(),
);
const productResearch = createProductResearchHttpHandler({
  application,
  contextResolver: auth.contextResolver,
});
const port = positiveIntegerEnvironment("PORT", 3000);
const server = Bun.serve({
  port,
  maxRequestBodySize: 1_048_576,
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith("/api/auth/")) return auth.handle(request);
    if (pathname === "/health/live") return Response.json({ status: "ok" });
    if (pathname === "/health/ready") {
      try {
        await database.client`select 1`;
        return Response.json({ status: "ready" });
      } catch {
        return Response.json({ status: "not_ready" }, { status: 503 });
      }
    }
    return productResearch(request);
  },
  error() {
    return Response.json(
      {
        type: "https://ignition-outbound.local/problems/internal_error",
        title: "INTERNAL_ERROR",
        status: 500,
        detail: "An unexpected error occurred",
        code: "INTERNAL_ERROR",
      },
      {
        status: 500,
        headers: { "content-type": "application/problem+json; charset=utf-8" },
      },
    );
  },
});

console.info(JSON.stringify({ event: "api_started", port: server.port }));
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    console.info(JSON.stringify({ event: "api_stopping", signal }));
    server.stop();
    await database.close();
    console.info(JSON.stringify({ event: "api_stopped" }));
  });
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredSecretEnvironment(name: string): string {
  const value = requiredEnvironment(name);
  if (value.length < 32) throw new Error(`${name} must contain at least 32 characters`);
  return value;
}

function commaSeparatedEnvironment(name: string, fallback: string): string[] {
  return (process.env[name] ?? fallback)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function positiveIntegerEnvironment(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}
