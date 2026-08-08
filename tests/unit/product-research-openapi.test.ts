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
      "/api/v1/product-research-runs/{runId}/actions/publish-icp",
      "/api/v1/product-research-runs/{runId}/actions/research-more",
      "/api/v1/product-research-runs/{runId}/actions/resume",
      "/api/v1/product-research-runs/{runId}/actions/start",
      "/api/v1/product-research-runs/{runId}/evidence",
      "/api/v1/product-research-runs/{runId}/findings/{findingId}",
      "/api/v1/product-research-runs/{runId}/icp-proposals/{proposalId}",
      "/api/v1/product-research-runs/{runId}/report",
      "/api/v1/research-documents",
      "/api/v1/research-documents/upload-intents",
      "/api/v1/research-documents/{documentId}",
      "/api/v1/research-documents/{documentId}/complete",
      "/api/v1/workspace-ai-settings",
      "/api/v1/icps",
      "/api/v1/icps/{icpId}",
      "/api/v1/icps/{icpId}/actions/publish",
      "/api/v1/icp-versions/{versionId}",
      "/api/v1/icp-versions/{versionId}/discovery-runs",
      "/api/v1/discovery-runs",
      "/api/v1/discovery-runs/{runId}",
      "/api/v1/discovery-runs/{runId}/actions/retry",
      "/api/v1/discovery-runs/{runId}/candidates/{candidateId}/actions/import",
      "/api/v1/offers",
      "/api/v1/offers/{offerId}",
      "/api/v1/offers/{offerId}/actions/publish",
      "/api/v1/offers/{offerId}/versions",
      "/api/v1/messaging-strategies",
      "/api/v1/messaging-strategies/{strategyId}",
      "/api/v1/messaging-strategies/{strategyId}/actions/publish",
      "/api/v1/ai-policies",
      "/api/v1/ai-policies/{policyId}",
      "/api/v1/ai-policies/{policyId}/actions/publish",
      "/api/v1/companies",
      "/api/v1/companies/{companyId}",
      "/api/v1/contacts",
      "/api/v1/contacts/{contactId}",
      "/api/v1/contacts/{contactId}/identities",
      "/api/v1/contacts/{contactId}/employments",
      "/api/v1/contacts/{contactId}/actions/suppress",
      "/api/v1/suppressions",
      "/api/v1/suppressions/check",
      "/api/v1/suppressions/{suppressionId}/actions/lift",
      "/api/v1/imports",
      "/api/v1/imports/{importId}",
      "/api/v1/imports/{importId}/actions/apply",
      "/api/v1/imports/{importId}/preview",
      "/api/v1/merge-candidates",
      "/api/v1/merge-candidates/{candidateId}/actions/approve",
      "/api/v1/merge-candidates/{candidateId}/actions/reject",
      "/api/v1/contacts/{contactId}/actions/undo-merge",
      "/api/v1/contacts/{contactId}/merges",
    ].sort(),
  );
  expect(document.paths["/api/v1/product-research-runs"]?.get).toBeDefined();
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

test("OfferClaim ids are optional draft fields while claim data is required", () => {
  const document = JSON.parse(
    readFileSync(resolve(import.meta.dir, "../../packages/contracts/openapi/product-research-v1.json"), "utf8"),
  ) as { components: { schemas: { OfferClaim: { required?: string[] } } } };
  expect(document.components.schemas.OfferClaim.required).toEqual(["claim", "validationStatus"]);
  expect(document.components.schemas.OfferClaim.required).not.toContain("id");
});
