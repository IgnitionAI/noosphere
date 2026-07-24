import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { RequestContextResolver } from "@outbound/interface/http/request-context";
import { ProductResearchApplication } from "@outbound/application/gtm/product-research-application";
import { CryptoIdGenerator, SystemClock } from "@outbound/application/shared/ports";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { PostgresProductResearchRepository } from "@outbound/infrastructure/gtm/postgres-product-research-repository";
import { createProductResearchHttpHandler } from "@outbound/interface/http/product-research-handler";

const databaseUrl = requiredEnvironment("DATABASE_URL");
const contextModulePath = requiredEnvironment("REQUEST_CONTEXT_ADAPTER_MODULE");
const contextModule = (await import(adapterModuleSpecifier(contextModulePath))) as {
  createRequestContextResolver?: () => RequestContextResolver | Promise<RequestContextResolver>;
};
if (typeof contextModule.createRequestContextResolver !== "function") {
  throw new Error("REQUEST_CONTEXT_ADAPTER_MODULE must export createRequestContextResolver()");
}

const database = createDatabase(databaseUrl);
const repository = new PostgresProductResearchRepository(database.db);
const application = new ProductResearchApplication(
  repository,
  repository,
  new CryptoIdGenerator(),
  new SystemClock(),
);
const productResearch = createProductResearchHttpHandler({
  application,
  contextResolver: await contextModule.createRequestContextResolver(),
});
const port = positiveIntegerEnvironment("PORT", 3000);
const server = Bun.serve({
  port,
  maxRequestBodySize: 1_048_576,
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
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

function adapterModuleSpecifier(value: string): string {
  return value.startsWith(".") || value.startsWith("/")
    ? pathToFileURL(resolve(value)).href
    : value;
}

function positiveIntegerEnvironment(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}
