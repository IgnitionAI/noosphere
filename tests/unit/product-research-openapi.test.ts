import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("the OpenAPI contract declares every F-009 HTTP route", () => {
  const document = JSON.parse(
    readFileSync(
      resolve(import.meta.dir, "../../packages/contracts/openapi/product-research-v1.json"),
      "utf8",
    ),
  ) as { openapi: string; paths: Record<string, Record<string, unknown>> };

  expect(document.openapi).toBe("3.1.0");
  expect(Object.keys(document.paths).sort()).toEqual(
    [
      "/api/v1/product-research-runs",
      "/api/v1/product-research-runs/{runId}",
      "/api/v1/product-research-runs/{runId}/actions/pause",
      "/api/v1/product-research-runs/{runId}/actions/research-more",
      "/api/v1/product-research-runs/{runId}/actions/resume",
      "/api/v1/product-research-runs/{runId}/actions/start",
      "/api/v1/product-research-runs/{runId}/evidence",
    ].sort(),
  );
  expect(document.paths["/api/v1/product-research-runs"]?.post).toBeDefined();
});
