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
      "/api/v1/sequences",
      "/api/v1/sequences/{sequenceId}",
      "/api/v1/sequences/{sequenceId}/steps",
      "/api/v1/sequences/{sequenceId}/versions",
      "/api/v1/sequences/{sequenceId}/actions/publish",
      "/api/v1/campaigns",
      "/api/v1/campaigns/{campaignId}",
      "/api/v1/campaigns/{campaignId}/actions/preflight",
      "/api/v1/campaigns/{campaignId}/actions/activate",
      "/api/v1/campaigns/{campaignId}/actions/pause",
      "/api/v1/campaigns/{campaignId}/actions/resume",
      "/api/v1/campaigns/{campaignId}/actions/archive",
      "/api/v1/campaigns/{campaignId}/actions",
      "/api/v1/actions/{actionId}",
      "/api/v1/actions/{actionId}/actions/cancel",
      "/api/v1/actions/{actionId}/actions/retry",
      "/api/v1/campaigns/{campaignId}/prospects",
      "/api/v1/campaigns/{campaignId}/prospects/select",
      "/api/v1/campaigns/{campaignId}/prospects/{contactId}/actions/enroll",
      "/api/v1/campaigns/{campaignId}/prospects/{contactId}/actions/exclude",
      "/api/v1/campaigns/{campaignId}/prospects/{contactId}/explanation",
      "/api/v1/campaigns/{campaignId}/workspace-view",
      "/api/v1/approval-items",
      "/api/v1/approval-items/{approvalItemId}",
      "/api/v1/approval-items/{approvalItemId}/actions/approve",
      "/api/v1/approval-items/{approvalItemId}/actions/reject",
      "/api/v1/approval-items/actions/bulk-decide",
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
      "/api/v1/connected-accounts",
      "/api/v1/connected-accounts/{connectedAccountId}",
      "/api/v1/connected-accounts/{connectedAccountId}/actions/check",
      "/api/v1/connected-accounts/{connectedAccountId}/actions/reconnect",
      "/api/v1/connected-accounts/onboarding",
      "/api/v1/connected-accounts/onboarding/{onboardingId}",
      "/api/v1/connected-accounts/onboarding/{onboardingId}/callback",
      "/api/v1/connected-accounts/{connectedAccountId}/quotas",
      "/api/v1/connected-accounts/{connectedAccountId}/impact",
      "/api/v1/account-health-alerts",
      "/api/v1/account-health-alerts/{alertId}/actions/acknowledge",
      "/api/v1/webhooks/unipile",
      "/api/v1/companies",
      "/api/v1/companies/{companyId}",
      "/api/v1/contacts",
      "/api/v1/contacts/{contactId}",
      "/api/v1/contacts/{contactId}/identities",
      "/api/v1/contacts/{contactId}/employments",
      "/api/v1/contacts/{contactId}/actions/enrich",
      "/api/v1/contacts/{contactId}/enrichment",
      "/api/v1/companies/{companyId}/signals",
      "/api/v1/contacts/{contactId}/signals",
      "/api/v1/signals",
      "/api/v1/signals/actions/collect",
      "/api/v1/signal-collection-runs/{runId}",
      "/api/v1/settings/signals",
      "/api/v1/analytics/funnel",
      "/api/v1/analytics/breakdown",
      "/api/v1/analytics/costs",
      "/api/v1/analytics/export",
      "/api/v1/contacts/{contactId}/actions/suppress",
      "/api/v1/suppressions",
      "/api/v1/suppressions/check",
      "/api/v1/suppressions/{suppressionId}/actions/lift",
      "/api/v1/enrichment-coverage",
      "/api/v1/enrichment-jobs/{jobId}",
      "/api/v1/enrichment-jobs/{jobId}/actions/retry",
      "/api/v1/imports",
      "/api/v1/imports/{importId}",
      "/api/v1/imports/{importId}/actions/apply",
      "/api/v1/imports/{importId}/preview",
      "/api/v1/merge-candidates",
      "/api/v1/merge-candidates/{candidateId}/actions/approve",
      "/api/v1/merge-candidates/{candidateId}/actions/reject",
      "/api/v1/contacts/{contactId}/actions/undo-merge",
      "/api/v1/contacts/{contactId}/merges",
      "/api/v1/conversations",
      "/api/v1/opportunities",
      "/api/v1/opportunities/{opportunityId}",
      "/api/v1/opportunities/{opportunityId}/actions/change-stage",
      "/api/v1/opportunities/{opportunityId}/actions/close",
      "/api/v1/opportunities/{opportunityId}/actions/reopen",
      "/api/v1/pipeline/forecast",
      "/api/v1/pipeline/view",
      "/api/v1/workspace/operational-summary",
      "/api/v1/workspace/setup-readiness",
      "/api/v1/workspaces/{workspaceId}/lost-reasons",
      "/api/v1/workspaces",
      "/api/v1/workspaces/{workspaceId}/members",
      "/api/v1/workspaces/{workspaceId}/onboarding",
      "/api/v1/workspaces/{workspaceId}/onboarding/steps/{step}/actions/complete",
      "/api/v1/workspaces/{workspaceId}/onboarding/steps/{step}/actions/skip",
      "/api/v1/workspaces/{workspaceId}/invitations",
      "/api/v1/invitations/{invitationId}/actions/accept",
      "/api/v1/invitations/{invitationId}/actions/revoke",
      "/api/v1/workspaces/{workspaceId}/members/{userId}/actions/change-role",
      "/api/v1/workspaces/{workspaceId}/members/{userId}/actions/set-status",
      "/api/v1/workspaces/{workspaceId}",
      "/api/v1/workspaces/{workspaceId}/sending-preferences",
      "/api/v1/workspaces/{workspaceId}/channel-limits",
      "/api/v1/workspaces/{workspaceId}/retention-policy",
      "/api/v1/workspaces/{workspaceId}/actions/export",
      "/api/v1/exports/{exportId}",
      "/api/v1/contacts/{contactId}/actions/anonymize",
      "/api/v1/audit-logs",
      "/api/v1/calendar-connection",
      "/api/v1/calendar-connection/meeting-types",
      "/api/v1/calendar-bookings",
      "/api/v1/calendar-bookings/{bookingId}/actions/reschedule",
      "/api/v1/calendar-bookings/{bookingId}/actions/cancel",
      "/api/v1/calendar-bookings/{bookingId}/actions/no-show",
      "/api/v1/webhooks/calendar/calcom",
      "/api/v1/console/jobs",
      "/api/v1/console/dead-letters",
      "/api/v1/console/webhooks/rejected",
      "/api/v1/console/correlations/{correlationId}",
      "/api/v1/console/jobs/{jobId}/actions/requeue",
      "/api/v1/knowledge-sources",
      "/api/v1/knowledge-sources/{sourceId}/actions/validate",
      "/api/v1/knowledge-sources/{sourceId}/actions/withdraw",
      "/api/v1/evaluation-datasets",
      "/api/v1/ai-prompt-versions",
      "/api/v1/ai-configurations",
      "/api/v1/ai-configurations/{configurationId}/actions/promote",
      "/api/v1/evaluation-runs",
      "/api/v1/evaluation-runs/compare",
      "/api/v1/evaluation-runs/{runId}",
      "/api/v1/evaluation-runs/{runId}/actions/retry",
      "/api/v1/ai-runs/{aiRunId}/feedback",
      "/api/v1/knowledge-claims",
      "/api/v1/knowledge-claims/{claimId}/actions/validate",
    ].sort(),
  );
  expect(document.paths["/api/v1/product-research-runs"]?.get).toBeDefined();
  expect(document.paths["/api/v1/product-research-runs"]?.post).toBeDefined();
});

test("the OpenAPI contract documents the V3 workflow", () => {
  const document = JSON.parse(
    readFileSync(
      resolve(import.meta.dir, "../../packages/contracts/openapi/product-research-v1.json"),
      "utf8",
    ),
  ) as {
    components: {
      schemas: {
        ProductResearchBrief: { properties: { researchVersion: unknown } };
        ResearchStage: { enum: string[] };
      };
    };
  };
  expect(document.components.schemas.ProductResearchBrief.properties.researchVersion).toEqual({
    type: "integer",
    enum: [1, 2, 3],
    default: 3,
  });
  expect(document.components.schemas.ResearchStage.enum).toEqual(
    expect.arrayContaining(["product_truth", "sourcing_validation", "objective_ranking"]),
  );
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
  for (const [pathname, path] of Object.entries(document.paths)) {
    if (pathname === "/api/v1/webhooks/unipile" || pathname === "/api/v1/webhooks/calendar/calcom" || pathname === "/api/v1/workspaces" || pathname === "/api/v1/invitations/{invitationId}/actions/accept" || pathname === "/api/v1/connected-accounts/onboarding/{onboardingId}/callback") continue;
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
