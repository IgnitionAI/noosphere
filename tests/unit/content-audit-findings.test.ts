import { expect, test } from "bun:test";
import { retainUnresolvedAuditFindings } from "@outbound/domain/content/content-audit-findings";
import type { ContentDraftSnapshot, ContentEvidenceAudit } from "@outbound/domain/content/content-asset";
const statement = "Le service élimine toutes les fuites.";
const draft: ContentDraftSnapshot = { hook: statement, body: statement, callToAction: null, factualClaims: [{ statement, sourceKeys: ["proof"] }], opinionStatements: [] };
const fresh: ContentEvidenceAudit = { reviewedClaims: [], ungroundedStatements: [], forbiddenTopicMatches: [] };
const prior = { ...fresh, reviewedClaims: [{ statement, sourceKeys: ["proof"], verdict: "unsupported", reason: "La source ne garantit pas l’absence de fuite." }] } satisfies ContentEvidenceAudit;
test("a later silent audit cannot erase an unsupported statement still published", () => {
  expect(retainUnresolvedAuditFindings(draft, fresh, prior).unresolvedClaims).toEqual(prior.reviewedClaims);
});

test("a favorable second vote on unchanged copy does not resolve the objection", () => {
  const favorable = { ...fresh, reviewedClaims: [{ ...prior.reviewedClaims[0]!, verdict: "supported" as const }] };
  expect(retainUnresolvedAuditFindings(draft, favorable, prior).unresolvedClaims).toHaveLength(1);
});
test("an objection survives several silent reviews and a move to a slide", () => {
  const carried = retainUnresolvedAuditFindings(draft, fresh, prior);
  const moved = { ...draft, body: "Une procédure à examiner.", factualClaims: [], mediaPlan: { format: "linkedin_document" as const, visualTone: "editorial" as const, title: null, subtitle: null, altText: null, scenes: [], slides: [{ title: "Garantie", body: statement }] } };
  expect(retainUnresolvedAuditFindings(moved, fresh, carried).unresolvedClaims).toEqual(prior.reviewedClaims);
});
test("removing the disputed assertion permits independent reassessment of the replacement", () => {
  const corrected = { ...draft, body: "Examinons la configuration du filtre.", factualClaims: [] };
  expect(retainUnresolvedAuditFindings(corrected, fresh, prior).unresolvedClaims ?? []).toEqual([]);
});

const scenario = "Exemple fictif : un agent ouvre tous les dossiers après validation.";
const scenarioDraft = { ...draft, body: scenario, factualClaims: [], illustrativeScenarios: [scenario] };
const misleading = { statement: scenario, verdict: "misleading" as const, reason: "La validation fictive présente un élargissement des droits comme justifié." };
const scenarioPrior = { ...fresh, reviewedScenarios: [misleading] };
test.each(["silent", "favorable", "undeclared"] as const)("an unchanged misleading scenario survives a %s later audit", kind => {
  const current = kind === "favorable" ? { ...fresh, reviewedScenarios: [{ ...misleading, verdict: "hypothetical" as const }] } : fresh;
  const candidate = kind === "undeclared" ? { ...scenarioDraft, illustrativeScenarios: [] } : scenarioDraft;
  expect(retainUnresolvedAuditFindings(candidate, current, scenarioPrior)).toMatchObject({ unresolvedScenarios: [misleading] });
});
test("scenario objections survive a serialized checkpoint and moving the copy into media", () => {
  const carried = JSON.parse(JSON.stringify(retainUnresolvedAuditFindings(scenarioDraft, fresh, scenarioPrior))) as ContentEvidenceAudit;
  const moved = { ...scenarioDraft, body: "Une nouvelle explication.", illustrativeScenarios: [], mediaPlan: { format: "linkedin_image" as const, visualTone: "editorial" as const, title: scenario, subtitle: null, altText: null, slides: [], scenes: [] } };
  expect(retainUnresolvedAuditFindings(moved, fresh, carried)).toMatchObject({ unresolvedScenarios: [misleading] });
});
test("removing the disputed scenario releases its objection", () => {
  const removed = { ...scenarioDraft, body: "Une nouvelle explication.", illustrativeScenarios: [] };
  expect(retainUnresolvedAuditFindings(removed, fresh, scenarioPrior)).not.toHaveProperty("unresolvedScenarios");
});

test("scenario history survives the persisted audit schema without becoming a model verdict", async () => {
  const { contentEvidenceAuditSchema } = await import("@outbound/contracts/content");
  const retained = retainUnresolvedAuditFindings(scenarioDraft, fresh, scenarioPrior);
  expect(contentEvidenceAuditSchema.parse(retained)).toMatchObject({ unresolvedScenarios: [misleading] });
  expect(retainUnresolvedAuditFindings(scenarioDraft, retained, null)).not.toHaveProperty("unresolvedScenarios");
});
test("scenario capacity overflow fails instead of dropping historical objections", () => {
  const prior = { ...scenarioPrior, unresolvedScenarios: Array.from({length: 6}, (_, i) => ({ ...misleading, reason: `Motif historique différent numéro ${i} de ce scénario trompeur.` })) };
  expect(() => retainUnresolvedAuditFindings(scenarioDraft, fresh, prior)).toThrow("CONTENT_AUDIT_FINDINGS_CAPACITY_EXCEEDED");
});
