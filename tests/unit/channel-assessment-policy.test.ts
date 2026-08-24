import { describe, expect, test } from "bun:test";
import { decideChannelRecommendation } from "@outbound/domain/campaigns/prospecting-plan";
import { normalizeStrategyPayload } from "@outbound/infrastructure/campaigns/channel-strategy-planner";

describe("channel assessment policy", () => {
  test("recommends LinkedIn from observed eligible profiles without requiring email or phone", () => {
    expect(
      decideChannelRecommendation("linkedin", {
        sampleSize: 10,
        accountsFound: 6,
        peopleFound: 7,
        eligibleIdentities: 5,
        verifiedIdentities: 4,
      }),
    ).toMatchObject({ recommendation: "recommended" });
  });

  test("keeps email optional when companies exist but nominative coverage is weak", () => {
    expect(
      decideChannelRecommendation("email", {
        sampleSize: 10,
        accountsFound: 6,
        peopleFound: 0,
        eligibleIdentities: 1,
        verifiedIdentities: 1,
      }),
    ).toMatchObject({ recommendation: "optional" });
  });

  test("never recommends WhatsApp from unverified phone numbers", () => {
    expect(
      decideChannelRecommendation("whatsapp", {
        sampleSize: 10,
        accountsFound: 5,
        peopleFound: 0,
        eligibleIdentities: 4,
        verifiedIdentities: 0,
      }),
    ).toMatchObject({ recommendation: "optional" });
  });

  test("bounds a Kimi prompt-JSON strategy before contract validation", () => {
    expect(
      normalizeStrategyPayload({
        query: `cabinet avocat ${"x".repeat(600)}`,
        sourceKinds: ["web", "web", "maps", "unknown", "jobs", "news", "official_registry"],
        rationale: "r".repeat(1_200),
        sampleSize: 99.4,
      }),
    ).toEqual({
      query: `cabinet avocat ${"x".repeat(485)}`,
      sourceKinds: ["web", "maps", "jobs", "news"],
      rationale: "r".repeat(1_000),
      sampleSize: 20,
    });
  });
});
