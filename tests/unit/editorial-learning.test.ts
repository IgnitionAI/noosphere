import { describe, expect, test } from "bun:test";
import { deriveBoundedEditorialLearning, EditorialLearningReconciler } from "@outbound/application/content/editorial-learning";

const now = new Date("2026-08-21T08:00:00.000Z");
const strategy = {
  audience: { name: "Équipes juridiques", summary: "Juristes B2B", awareness: "problem_aware" as const },
  pillars: [
    { name: "Preuve", promise: "Décider avec des sources", proofTypes: ["source"] },
    { name: "Sécurité", promise: "Contrôler les données", proofTypes: ["audit"] },
    { name: "Adoption", promise: "Déployer", proofTypes: ["chronologie"] },
  ],
  voice: { traits: ["direct", "précis"], avoid: ["générique"] },
  formats: ["linkedin_text" as const],
  cadence: { postsPerWeek: 3, preferredDays: [1, 3, 5], timezone: "Europe/Paris" },
  callsToAction: ["Comment faites-vous ?"],
  allowedClaimIds: [crypto.randomUUID()],
  forbiddenTopics: [],
};

describe("AUT-102 bounded editorial learning", () => {
  test("separates facts from inferences and freezes every policy boundary", () => {
    const icpVersionId = crypto.randomUUID();
    const result = deriveBoundedEditorialLearning({
      workspaceId: crypto.randomUUID(), strategyId: crypto.randomUUID(), strategyVersionId: crypto.randomUUID(), icpVersionId, strategy,
      evidence: [
        { kind: "response", certainty: "fact", pillar: "Preuve", angle: "Montrer une décision sourcée", sourceRef: "social-interaction:1", sourceHref: "/attribution?interaction=1", occurredAt: now },
        { kind: "booking", certainty: "inference", pillar: "Preuve", angle: "Montrer une décision sourcée", sourceRef: "booking:1", sourceHref: "/appointments?booking=1", occurredAt: now },
        { kind: "response", certainty: "fact", pillar: "PILIER_INVENTÉ", angle: "Hors policy", sourceRef: "social-interaction:2", sourceHref: "/attribution?interaction=2", occurredAt: now },
      ],
      windowStartedAt: new Date(now.getTime() - 86_400_000), windowEndedAt: now,
    });
    expect(result.facts).toHaveLength(1);
    expect(result.inferences).toHaveLength(1);
    expect(result.recommendations).toEqual([expect.objectContaining({ action: "prioritize", audience: "Équipes juridiques", pillar: "Preuve", angle: "Montrer une décision sourcée", score: 40 })]);
    expect(result.bounds).toEqual({ icpVersionId, allowedPillars: ["Preuve", "Sécurité", "Adoption"], allowedClaimIds: strategy.allowedClaimIds, formats: ["linkedin_text"], postsPerWeek: 3 });
  });

  test("does not version the same evidence twice", async () => {
    const saved: string[] = [];
    const context = { workspaceId: "workspace", strategyId: "strategy", strategyVersionId: "strategy-version", icpVersionId: "icp-version", strategy, evidence: [{ kind: "response" as const, certainty: "fact" as const, pillar: "Preuve", angle: "Angle", sourceRef: "interaction:1", sourceHref: "/attribution", occurredAt: now }], windowStartedAt: new Date(now.getTime() - 1), windowEndedAt: now };
    let latest: any = null;
    const repository = {
      async listEnabledWorkspaces() { return ["workspace"]; },
      async loadContext() { return context; },
      async latest() { return latest; },
      async save(input: { inputHash: string }) {
        if (!latest) { latest = { id: "version-1" }; saved.push(input.inputHash); }
        return latest;
      },
    } as never;
    const reconciler = new EditorialLearningReconciler(repository, () => now);
    expect(await reconciler.reconcile()).toBe(1);
    expect(await reconciler.reconcile()).toBe(0);
    expect(saved).toHaveLength(1);
  });
});
