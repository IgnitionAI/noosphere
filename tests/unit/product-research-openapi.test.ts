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
      "/api/v1/product-research-runs/{runId}/actions/approve-icp",
      "/api/v1/product-research-runs/{runId}/actions/reject-icp",
      "/api/v1/product-research-runs/{runId}/actions/research-more",
      "/api/v1/product-research-runs/{runId}/actions/resume",
      "/api/v1/product-research-runs/{runId}/actions/start",
      "/api/v1/product-research-runs/{runId}/evidence",
      "/api/v1/product-research-runs/{runId}/report",
      "/api/v1/research-documents",
      "/api/v1/research-documents/upload-intents",
      "/api/v1/research-documents/{documentId}",
      "/api/v1/research-documents/{documentId}/complete",
      "/api/v1/workspace-ai-settings",
    ].sort(),
  );
  expect(document.paths["/api/v1/product-research-runs"]?.post).toBeDefined();
});

test("every F-009 operation requires authenticated workspace route context", () => {
  const document = JSON.parse(
    readFileSync(
      resolve(import.meta.dir, "../../packages/contracts/openapi/product-research-v1.json"),
      "utf8",
    ),
  ) as {
    security: Array<Record<string, unknown>>;
    paths: Record<
      string,
      {
        parameters?: Array<{ $ref?: string }>;
        get?: { parameters?: Array<{ $ref?: string }> };
        post?: { parameters?: Array<{ $ref?: string }> };
        put?: { parameters?: Array<{ $ref?: string }> };
        delete?: { parameters?: Array<{ $ref?: string }> };
      }
    >;
  };

  expect(document.security).toEqual([{ sessionCookie: [] }]);
  for (const path of Object.values(document.paths)) {
    const references = [
      ...(path.parameters ?? []),
      ...(path.get?.parameters ?? []),
      ...(path.post?.parameters ?? []),
      ...(path.put?.parameters ?? []),
      ...(path.delete?.parameters ?? []),
    ].map((parameter) => parameter.$ref);
    expect(references).toContain("#/components/parameters/WorkspaceSlug");
  }
});
