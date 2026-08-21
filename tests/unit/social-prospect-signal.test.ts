import { describe, expect, test } from "bun:test";
import {
  assessSocialProspectSignals,
  type SocialProspectSignalFact,
} from "@outbound/domain/crm/social-prospect-signal";

const now = new Date("2026-08-21T10:00:00.000Z");

describe("CRM-102 social prospect signals", () => {
  test("boosts only recent explicit interactions with an exact proved identity", () => {
    const result = assessSocialProspectSignals({
      now,
      baseScore: 72,
      openLinkedinConversation: false,
      signals: [
        signal("comment", new Date("2026-08-20T10:00:00.000Z")),
        signal("reply", new Date("2026-08-19T10:00:00.000Z")),
      ],
    });
    expect(result).toMatchObject({ baseScore: 72, socialBoost: 20, effectiveScore: 92, decisionImpact: "boosted" });
    expect(result.eligibleSignals.map((item) => item.type)).toEqual(["comment", "reply"]);
    expect(result.ignoredSignals).toEqual([]);
  });

  test("keeps a like, an expired signal and an ambiguous identity inert", () => {
    const ambiguous = { ...signal("comment", new Date("2026-08-20T10:00:00.000Z")), id: "ambiguous", identityRule: "ambiguous_exact_linkedin_identity_v1", identityCertainty: "unknown", identityConfidence: 0 };
    const result = assessSocialProspectSignals({
      now,
      baseScore: 80,
      openLinkedinConversation: false,
      signals: [
        signal("reaction", new Date("2026-08-20T10:00:00.000Z")),
        { ...signal("mention", new Date("2026-06-01T10:00:00.000Z")), id: "expired" },
        ambiguous,
      ],
    });
    expect(result).toMatchObject({ socialBoost: 0, effectiveScore: 80, decisionImpact: "none" });
    expect(result.ignoredSignals.map((item) => item.reason)).toEqual(["reaction_inert", "identity_not_exact", "expired"]);
  });

  test("makes an open LinkedIn conversation the dominant decision impact", () => {
    const result = assessSocialProspectSignals({
      now,
      baseScore: 60,
      openLinkedinConversation: true,
      signals: [signal("comment", new Date("2026-08-20T10:00:00.000Z"))],
    });
    expect(result).toMatchObject({ socialBoost: 8, effectiveScore: 68, decisionImpact: "conversation_open", openLinkedinConversation: true });
  });
});

function signal(type: SocialProspectSignalFact["type"], occurredAt: Date): SocialProspectSignalFact {
  return {
    id: type,
    type,
    direction: "incoming",
    status: "observed",
    body: type === "reaction" ? null : "Je souhaite en savoir plus.",
    reaction: type === "reaction" ? "like" : null,
    occurredAt,
    identityCertainty: "evidence",
    identityRule: "linkedin_profile_url_exact_v1",
    identityConfidence: 0.95,
    identityProofType: "contact_identity",
    proofHref: `/attribution?interactionId=${type}`,
  };
}
