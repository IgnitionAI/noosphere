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

test("a retained scenario objection blocks a favorable current audit", () => {
  const assessment = { ...audit, unresolvedScenarios: [{ statement, verdict: "misleading" as const, reason: "Une objection antérieure reste présente dans le texte courant." }] };
  expect(readiness(draft, assessment)).toMatchObject({ ready: false, blockers: expect.arrayContaining(["unresolved_audit_scenario"]) });
});

test.each(["missing", "orphan", "foreign_quote", "wrong_field"])("readiness refuses inconsistent topic evidence: %s", kind => {
  const finding = {topic:"Sujet interdit", field: kind === "wrong_field" ? "mediaPlan.title" : "body", statement: kind === "foreign_quote" ? "Citation absente de ce contenu." : statement, reason:"Cette citation démontre la violation du sujet interdit."};
  expect(readiness(draft,{...audit,forbiddenTopicMatches:kind === "orphan" ? [] : [finding.topic],topicFindings:kind === "missing" ? [] : [finding]})).toMatchObject({ready:false,blockers:expect.arrayContaining(["topic_audit_invalid"])});
});
test("retained topic objections block readiness independently of current topic votes", () => {
  expect(readiness(draft,{...audit,unresolvedTopics:[{topic:"Sujet interdit",field:"body",statement,reason:"L’objection antérieure demeure dans le texte courant."}]})).toMatchObject({ready:false,blockers:expect.arrayContaining(["unresolved_audit_topic"])});
});

test.each(["missing","partial","complete"])("compares stored topic reviews with configured obligations: %s",kind=>{
 const topics=['Premier sujet','Deuxième sujet'];
 const topicReviews=topics.slice(0,kind==='complete'?2:kind==='partial'?1:0).map(topic=>({topic,violated:false,reason:'Ce contenu ne mentionne pas ce sujet interdit dans ses passages.'}));
 const result=evaluateContentReadiness({draft,audit:{...audit,topicReviews},critique,evidenceFingerprint:fingerprint,availableEvidenceKeys:['source:1'],recentBodies:[],forbiddenTopics:topics});
 expect(result.ready).toBe(kind==='complete');
});
