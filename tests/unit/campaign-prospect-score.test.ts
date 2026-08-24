import { describe, expect, test } from "bun:test";
import { scoreCampaignProspect } from "@outbound/application/campaigns/autonomous-prospecting";

describe("autonomous campaign prospect score", () => {
  test("admits a LinkedIn prospect with an eligible identity and ICP evidence", () => {
    expect(scoreCampaignProspect({
      channel: "linkedin",
      icpFit: { matches: ["Secteur", "Rôle"], gaps: [] },
      channelIdentity: { status: "verified" },
    })).toMatchObject({ score: 80, eligible: true, exclusionReason: null });
  });

  test("rejects WhatsApp until the professional number is verified", () => {
    expect(scoreCampaignProspect({
      channel: "whatsapp",
      icpFit: { matches: ["Secteur"], gaps: [] },
      channelIdentity: { status: "found", evidenceUrl: "https://example.com/contact" },
    })).toMatchObject({ eligible: false, exclusionReason: "NO_ELIGIBLE_WHATSAPP_IDENTITY" });
  });
});
