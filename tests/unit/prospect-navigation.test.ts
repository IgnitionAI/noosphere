import { describe, expect, test } from "bun:test";
import {
  prospectCampaignIdFromReturnTo,
  prospectDetailHref,
  resolveProspectReturn,
} from "../../apps/web/lib/prospect-navigation";

describe("prospect campaign navigation", () => {
  test("returns from a prospect to the campaign that opened it", () => {
    const campaignPath = "/w/ignition-ai/campaigns/plans/plan-123";
    const href = prospectDetailHref("ignition-ai", "contact-456", campaignPath);

    expect(href).toBe(
      "/w/ignition-ai/prospects/contact-456?returnTo=%2Fw%2Fignition-ai%2Fcampaigns%2Fplans%2Fplan-123",
    );
    expect(resolveProspectReturn("ignition-ai", campaignPath)).toEqual({
      href: campaignPath,
      label: "Retour à la campagne",
    });
  });

  test("rejects another workspace or an external return URL", () => {
    const fallback = {
      href: "/w/ignition-ai/prospects",
      label: "Retour aux prospects",
    };

    expect(resolveProspectReturn("ignition-ai", "/w/other/campaigns/plans/plan-123")).toEqual(fallback);
    expect(resolveProspectReturn("ignition-ai", "https://evil.example/capture")).toEqual(fallback);
    expect(resolveProspectReturn("ignition-ai", "//evil.example/capture")).toEqual(fallback);
  });

  // Regression: ISSUE-001 — a dry-run opened from a campaign lost its campaign context.
  // Found by /qa on 2026-08-13.
  test("extracts only a direct campaign UUID from the authenticated workspace return", () => {
    const campaignId = "e007186b-9232-47b8-91a2-5e713e67ae0f";
    expect(prospectCampaignIdFromReturnTo("ignition-ai", `/w/ignition-ai/campaigns/${campaignId}`)).toBe(campaignId);
    expect(prospectCampaignIdFromReturnTo("ignition-ai", `/w/other/campaigns/${campaignId}`)).toBeNull();
    expect(prospectCampaignIdFromReturnTo("ignition-ai", `/w/ignition-ai/campaigns/${campaignId}/settings`)).toBeNull();
    expect(prospectCampaignIdFromReturnTo("ignition-ai", `https://evil.example/w/ignition-ai/campaigns/${campaignId}`)).toBeNull();
  });
});
