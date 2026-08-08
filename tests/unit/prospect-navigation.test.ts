import { describe, expect, test } from "bun:test";
import {
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
});
