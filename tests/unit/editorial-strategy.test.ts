import { describe, expect, test } from "bun:test";
import { EditorialStrategyApplication, type EditorialStrategyGrounding, type EditorialStrategyRepository } from "@outbound/application/content/editorial-strategy";
import type { EditorialStrategySnapshot } from "@outbound/domain/content/editorial-strategy";

const workspaceId = "10000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000002";
const claimId = "10000000-0000-4000-8000-000000000003";

describe("Noosphere editorial strategy", () => {
  test("derives a complete strategy from published offer and ICP snapshots", async () => {
    const calls: string[] = [];
    const repository = fakeRepository(calls);
    const application = new EditorialStrategyApplication(repository, {
      async generate(input) {
        calls.push(`generate:${input.workspaceId}:${input.grounding.offer.versionId}:${input.grounding.icp.versionId}`);
        return { snapshot: sampleSnapshot(), metadata: { provider: "kimi-code", model: "k3", promptVersion: "v1", aiRunId: null } };
      },
    });
    const strategy = await application.derive({ workspaceId, userId, requestKey: "derive:one" });
    expect(strategy.draft.pillars).toHaveLength(3);
    expect(calls).toEqual([
      `grounding:${workspaceId}`,
      `generate:${workspaceId}:10000000-0000-4000-8000-000000000011:10000000-0000-4000-8000-000000000021`,
      "save:derive:one",
    ]);
  });

  test("rejects a model claim that is not sourced or validated", async () => {
    const application = new EditorialStrategyApplication(fakeRepository([]), {
      async generate() { return { snapshot: { ...sampleSnapshot(), allowedClaimIds: [crypto.randomUUID()] }, metadata: { provider: "kimi-code", model: "k3", promptVersion: "v1", aiRunId: null } }; },
    });
    expect(application.derive({ workspaceId, userId, requestKey: "derive:bad" })).rejects.toThrow("EDITORIAL_STRATEGY_UNAUTHORIZED_CLAIM");
  });
});

function fakeRepository(calls: string[]): EditorialStrategyRepository {
  return {
    async grounding(id) { calls.push(`grounding:${id}`); return grounding(); },
    async find() { return null; },
    async findRequest() { return null; },
    async saveDerived(input) {
      calls.push(`save:${input.requestKey}`);
      return { id: crypto.randomUUID(), workspaceId, name: "Strategy", offerId: input.grounding.offer.id, offerVersionId: input.grounding.offer.versionId, icpId: input.grounding.icp.id, icpVersionId: input.grounding.icp.versionId, currentVersion: 0, draft: input.snapshot, derivation: input.derivation, createdAt: new Date(), updatedAt: new Date() };
    },
    async updateDraft() { throw new Error("unused"); },
    async publish() { throw new Error("unused"); },
  };
}

function grounding(): EditorialStrategyGrounding {
  return {
    offer: { id: "10000000-0000-4000-8000-000000000010", versionId: "10000000-0000-4000-8000-000000000011", name: "Noosphere", category: "saas", valueProposition: "Créer et capter la demande", targetAudience: "Fondateurs B2B", pricing: {}, commercialRules: {}, constraints: {}, objections: [], claims: [{ id: claimId, claim: "Automatisation multicanale", validationStatus: "validated", evidenceUri: "https://example.test/proof" }] },
    icp: { id: "10000000-0000-4000-8000-000000000020", versionId: "10000000-0000-4000-8000-000000000021", name: "SaaS B2B", criteria: {}, buyingCommittee: {}, problems: [], signals: [], exclusions: [] },
  };
}

function sampleSnapshot(): EditorialStrategySnapshot {
  return {
    audience: { name: "Fondateurs SaaS B2B", summary: "Équipes qui veulent relier contenu, prospection et appels.", awareness: "solution_aware" },
    pillars: [
      { name: "Système", promise: "Montrer le pipeline complet.", proofTypes: ["capture produit"] },
      { name: "Preuves", promise: "Expliquer les décisions avec leurs sources.", proofTypes: ["journal d’audit"] },
      { name: "Terrain", promise: "Partager les apprentissages des conversations.", proofTypes: ["conversation anonymisée"] },
    ],
    voice: { traits: ["direct", "technique"], avoid: ["hooks interchangeables"] },
    formats: ["linkedin_text"],
    cadence: { postsPerWeek: 3, preferredDays: [2, 3, 5], timezone: "Europe/Paris" },
    callsToAction: ["Demander un retour terrain"],
    allowedClaimIds: [claimId],
    forbiddenTopics: ["chiffres non sourcés"],
  };
}
