import { expect, test } from "bun:test";
import { synchronizeAuditedClaimLedger } from "@outbound/domain/content/content-audit-ledger";
import { fixtureAuditCoverage } from "../fixtures/content/audit-coverage";
import { contentAuditEvidenceFingerprint } from "@outbound/application/content/content-audit-context";
import { contentAuditCoverageStatus, type ContentDraftSnapshot, type ContentEvidenceAudit } from "@outbound/domain/content/content-asset";
const statement = "Le filtre utilise les groupes de l’utilisateur.";
const evidence = [{ key: "source:1", excerpt: statement }];
const draft: ContentDraftSnapshot = { hook: "Examiner le filtre", body: "Une vérification à préparer.", callToAction: null, factualClaims: [], opinionStatements: [], illustrativeScenarios: [], mediaPlan: { format: "linkedin_document", visualTone: "technical", title: "Contrôler les accès", subtitle: null, altText: "Un contrôle à préparer", scenes: [], slides: [{ title: "Filtrage", body: statement }] } };
const assessment: ContentEvidenceAudit = { reviewedClaims: [{ statement, sourceKeys: ["source:1"], verdict: "supported", reason: "La source décrit explicitement ce mécanisme." }], ungroundedStatements: [statement], forbiddenTopicMatches: [] };
const audit = fixtureAuditCoverage(draft, assessment, evidence);
function sync(candidate = draft, reviewed = audit, keys = ["source:1"], fingerprint = contentAuditEvidenceFingerprint(evidence)) {
  return synchronizeAuditedClaimLedger(candidate, reviewed, keys, fingerprint);
}
test("a fully audited source-backed slide gets its missing reference without rewriting public copy", () => {
  const result = sync();
  expect(result.draft).toEqual({ ...draft, factualClaims: [{ statement, sourceKeys: ["source:1"] }] });
  expect(result.audit.ungroundedStatements).toEqual([]);
  expect(result.audit.coverage).toEqual(audit.coverage);
  expect(draft.factualClaims).toEqual([]);
});

test.each(["missing_receipt", "stale_sources", "unknown_key", "unsupported", "unresolved", "attribution"] as const)("does not authorize a missing claim from %s", kind => {
  let reviewed = audit;
  let fingerprint = contentAuditEvidenceFingerprint(evidence);
  let keys = ["source:1"];
  if (kind === "missing_receipt") reviewed = { ...audit, coverage: undefined };
  if (kind === "stale_sources") fingerprint = "b".repeat(64);
  if (kind === "unknown_key") keys = [];
  if (kind === "unsupported") reviewed = fixtureAuditCoverage(draft, {...assessment, reviewedClaims: assessment.reviewedClaims.map(c => ({...c, verdict: "unsupported" as const}))}, evidence);
  if (kind === "unresolved") reviewed = {...audit, unresolvedClaims: [{...assessment.reviewedClaims[0]!, verdict: "unsupported"}]};
  if (kind === "attribution") reviewed = {...audit, coverage: {...audit.coverage!, passages: audit.coverage!.passages.map(p => ({...p, claims: p.claims.map(c => ({...c, kind: "attribution" as const}))}))}};
  expect(sync(draft, reviewed, keys, fingerprint)).toEqual({draft, audit: reviewed});
});
test("preserves unrelated objections when adding an independently supported reference", () => {
  const reviewed = {...audit, ungroundedStatements: [statement, "Une autre affirmation à vérifier."], forbiddenTopicMatches: ["Une promesse interdite."]};
  const result = sync(draft, reviewed);
  expect(result.draft.factualClaims).toHaveLength(1);
  expect(result.audit.ungroundedStatements).toEqual(["Une autre affirmation à vérifier."]);
  expect(result.audit.forbiddenTopicMatches).toEqual(reviewed.forbiddenTopicMatches);
});
test("keeps the complete audit for substantive repair when the ledger cannot fit", () => {
  const candidate = {...draft, factualClaims: Array.from({length:20}, () => ({statement:draft.body, sourceKeys:["source:1"]}))};
  const reviewed = fixtureAuditCoverage(candidate, assessment, evidence);
  expect(sync(candidate, reviewed)).toEqual({draft:candidate, audit:reviewed});
});
test("synchronizing again is idempotent", () => {
  const first = sync();
  expect(sync(first.draft, first.audit)).toEqual(first);
});
test("repeated support preserves a complete audited set instead of inventing their union", () => {
  const sources = [...evidence, {key:"source:2", excerpt:statement}];
  const assessed = fixtureAuditCoverage(draft, {...assessment, reviewedClaims: [...assessment.reviewedClaims, {...assessment.reviewedClaims[0]!, sourceKeys:["source:2"]}]}, sources);
  const result = sync(draft, assessed, ["source:1", "source:2"], contentAuditEvidenceFingerprint(sources));
  expect(result.draft.factualClaims).toEqual([{statement, sourceKeys:["source:1"]}]);
});


test("does not invalidate field coverage by promoting a claim repeated in an unreviewed field", () => {
  const candidate = {...draft, body: statement};
  const reviewed = fixtureAuditCoverage(candidate, assessment, evidence);
  const partial = {...reviewed, coverage: {...reviewed.coverage!, passages: reviewed.coverage!.passages.map(p => p.field === "body" ? {...p, classification: "non_factual" as const, nonFactualReason: "The auditor classified this field as proposed guidance.", claims: []} : p)}};
  expect(contentAuditCoverageStatus(candidate, partial, contentAuditEvidenceFingerprint(evidence))).toBe("current");
  const result = sync(candidate, partial);
  expect(contentAuditCoverageStatus(result.draft, result.audit, contentAuditEvidenceFingerprint(evidence))).toBe("current");
  expect(result.draft.factualClaims).toEqual([]);
  expect(result.audit.ungroundedStatements).toContain(statement);
  expect(result.audit.coverage).toEqual(partial.coverage);
});

test("retains the uncovered finding while synchronizing an independent fully reviewed span", () => {
  const independent = "La recherche utilise les droits du lecteur.";
  const candidate = {...draft, body: statement, mediaPlan: {...draft.mediaPlan, title: independent}};
  const reviewed = fixtureAuditCoverage(candidate, {...assessment,
    reviewedClaims: [...assessment.reviewedClaims, {...assessment.reviewedClaims[0]!, statement: independent}],
    ungroundedStatements: [statement, independent],
  }, evidence);
  const partial = {...reviewed, coverage: {...reviewed.coverage!, passages: reviewed.coverage!.passages.map(p => p.field === "body" ? {...p, classification: "non_factual" as const, nonFactualReason: "The auditor classified this field as proposed guidance.", claims: []} : p)}};
  const result = sync(candidate, partial);
  expect(result.draft.factualClaims).toEqual([{statement: independent, sourceKeys: ["source:1"]}]);
  expect(result.audit.ungroundedStatements).toEqual([statement]);
  expect(contentAuditCoverageStatus(result.draft, result.audit, contentAuditEvidenceFingerprint(evidence))).toBe("current");
});
