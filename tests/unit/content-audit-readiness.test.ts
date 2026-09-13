import { expect, test } from "bun:test";
import { contentAuditCoverageStatus, evaluateContentReadiness, editorialQualityCriteria, type ContentDraftSnapshot, type ContentEvidenceAudit, type ContentEditorialCritique } from "@outbound/domain/content/content-asset";

const fingerprint = "a".repeat(64);
const statement = "Le filtre utilise les groupes de l’utilisateur.";
const draft: ContentDraftSnapshot = { hook: "Examiner le filtre", body: statement, callToAction: null, factualClaims: [{ statement, sourceKeys: ["source:1"] }], opinionStatements: [] };
const review = { statement, sourceKeys: ["source:1"], verdict: "supported" as const, reason: "Le document décrit explicitement ce filtrage." };
const audit: ContentEvidenceAudit = {
  reviewedClaims: [review], ungroundedStatements: [], forbiddenTopicMatches: [],
  coverage: { version: 1, evidenceFingerprint: fingerprint, passages: [
    { field: "body", text: statement, classification: "factual", nonFactualReason: null, claims: [{ ...review, kind: "factual" }] },
  ] },
};
const critique: ContentEditorialCritique = {
  qualityAssessment: Object.fromEntries(editorialQualityCriteria.map(key => [key, { verdict: "pass", reason: "Fixture de validation du lien entre audit et contenu courant.", excerpts: [statement] }])) as unknown as NonNullable<ContentEditorialCritique["qualityAssessment"]>,
  genericPhrases: [], repeatedConcepts: [], callToActionAligned: true, distinctFromHistory: true, issues: [], summary: "Texte relu.",
};
function readiness(candidate: ContentDraftSnapshot, assessment: ContentEvidenceAudit, evidenceFingerprint = fingerprint) {
  return evaluateContentReadiness({ draft: candidate, audit: assessment, critique, evidenceFingerprint, availableEvidenceKeys: ["source:1"], recentBodies: [] });
}

test("a complete current audit permits otherwise valid content", () => {
  expect(contentAuditCoverageStatus(draft, audit, fingerprint)).toBe("current");
  expect(readiness(draft, audit)).toEqual({ ready: true, blockers: [] });
});

test("a favorable aggregate verdict outside the reviewed passages cannot approve a promise", () => {
  const promise = "Ce filtre empêche toutes les fuites.";
  const candidate = { ...draft, body: statement + " " + promise, factualClaims: [...draft.factualClaims, { statement: promise, sourceKeys: ["source:1"] }] };
  const forged = { ...audit, reviewedClaims: [...audit.reviewedClaims, { ...review, statement: promise }], coverage: { ...audit.coverage!, passages: audit.coverage!.passages.map(p => p.field === "body" ? { ...p, text: candidate.body } : p) } };
  expect(readiness(candidate, forged)).toMatchObject({ ready: false, blockers: expect.arrayContaining(["audit_coverage_invalid"]) });
});

test.each(["missing", "source_changed", "body_changed", "missing_passage", "duplicate_passage", "foreign_passage", "different_verdict"] as const)("stale or incomplete audit blocks readiness: %s", change => {
  let candidate = draft;
  let assessment = structuredClone(audit);
  let currentFingerprint = fingerprint;
  if (change === "missing") assessment = { ...assessment, coverage: undefined };
  if (change === "source_changed") currentFingerprint = "b".repeat(64);
  if (change === "body_changed") candidate = { ...draft, body: statement + " Une garantie supplémentaire." };
  if (change === "missing_passage") assessment = { ...assessment, coverage: { ...assessment.coverage!, passages: [] } };
  if (change === "duplicate_passage") assessment = { ...assessment, coverage: { ...assessment.coverage!, passages: [...assessment.coverage!.passages, ...assessment.coverage!.passages] } };
  if (change === "foreign_passage") assessment = { ...assessment, coverage: { ...assessment.coverage!, passages: assessment.coverage!.passages.map(p => ({ ...p, field: "mediaPlan.slides[0].body" })) } };
  if (change === "different_verdict") assessment = { ...assessment, reviewedClaims: [{ ...review, verdict: "unsupported" }] };
  expect(readiness(candidate, assessment, currentFingerprint)).toMatchObject({ ready: false, blockers: expect.arrayContaining([change === "missing" ? "audit_coverage_missing" : "audit_coverage_invalid"]) });
});
