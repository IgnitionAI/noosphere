import { expect, test } from "bun:test";
import { contentAuditDeclarations } from "@outbound/infrastructure/content/content-audit-declarations";
import { contentClaimOccurrences, type ContentDraftSnapshot } from "@outbound/domain/content/content-asset";

const statement = "Authentifié ≠ autorisé";
const draft: ContentDraftSnapshot = {
  hook: statement, body: `${statement}. ${statement}. Une distinction à examiner dans son contexte documentaire.`, callToAction: "Comparez les droits.",
  factualClaims: [{ statement, sourceKeys: ["source:1"] }], opinionStatements: [],
  mediaPlan: {format: "linkedin_image", visualTone: "editorial", title: statement, subtitle: null, altText: "Distinction", slides: [], scenes: []},
};
test("identifies every current occurrence without rewriting or collapsing its context", () => {
  expect(contentAuditDeclarations(draft)).toEqual([
    {id: "c0_f0_o0", field: "body", start: 0, statement, claimedSourceKeys: ["source:1"]},
    {id: `c0_f0_o${statement.length + 2}`, field: "body", start: statement.length + 2, statement, claimedSourceKeys: ["source:1"]},
    {id: "c0_f1_o0", field: "mediaPlan.title", start: 0, statement, claimedSourceKeys: ["source:1"]},
  ]);
});
test("does not manufacture an occurrence from an old or paraphrased declaration", () => {
  expect(() => contentAuditDeclarations({...draft, factualClaims: [{statement: "Une ancienne phrase",sourceKeys:["source:1"]}]})).toThrow("CONTENT_AUDIT_DECLARATION_NOT_LOCATED");
});
test("rejects excessive occurrences instead of dropping review obligations", () => {
  expect(() => contentAuditDeclarations({...draft, body: (statement + ". ").repeat(201)})).toThrow("CONTENT_AUDIT_CAPACITY_EXCEEDED");
});

import { contentAuditModelSpec } from "@outbound/infrastructure/content/content-audit-coverage";
import { contentAuditCoverageStatus } from "@outbound/domain/content/content-asset";
import { contentAuditEvidenceFingerprint } from "@outbound/application/content/content-audit-context";

test("requires every declaration verdict even when field review treats the title as editorial", () => {
  const evidence = [{key: "source:1"}];
  const spec = contentAuditModelSpec({draft,evidence}, "Audit independently");
  const verdict = {kind: "factual", sourceKeys: ["source:1"], verdict: "supported", reason: "The supplied source explicitly distinguishes identity from document permissions."};
  const output = {
    passageReviews: [{passageId:"body",classification:"non_factual",nonFactualReason:"The wording is presented as an editorial distinction.",claims:[]},
      {passageId:"mediaPlan.title",classification:"non_factual",nonFactualReason:"The title is presented as an editorial distinction.",claims:[]}],
    declarationReviews: Object.fromEntries(contentAuditDeclarations(draft).map(d => [d.id, verdict])),
    reviewedScenarios: [], forbiddenTopicMatches: [],
  };
  const result = spec.decode(output);
  expect(result.reviewedClaims).toContainEqual({statement,sourceKeys:verdict.sourceKeys,verdict:"supported",reason:verdict.reason});
  expect(result.coverage?.passages[1]?.classification).toBe("non_factual");
  expect(contentAuditCoverageStatus(draft,result,contentAuditEvidenceFingerprint(evidence))).toBe("current");
  const missingReceipt = {...result, coverage: {...result.coverage!, declarations: result.coverage!.declarations!.slice(0, 2)}};
  expect(contentAuditCoverageStatus(draft,missingReceipt,contentAuditEvidenceFingerprint(evidence))).toBe("invalid");
  const missing = structuredClone(output);
  delete missing.declarationReviews.c0_f1_o0;
  expect(() => spec.decode(missing)).toThrow();
  for (const invalid of [
    {...output, declarationReviews: {...output.declarationReviews, foreign: verdict}},
    {...output, declarationReviews: {...output.declarationReviews, c0_f1_o0: {...verdict, sourceKeys: []}}},
    {...output, declarationReviews: {...output.declarationReviews, c0_f1_o0: {...verdict, sourceKeys: ["invented"]}}},
    {...output, declarationReviews: {...output.declarationReviews, c0_f1_o0: {...verdict, statement: "Supported fragment"}}},
  ]) expect(() => spec.decode(invalid)).toThrow();
  const conflicting = {...output, passageReviews: [output.passageReviews[0], {
    passageId: "mediaPlan.title", classification: "factual", nonFactualReason: null,
    claims: [{statement, ...verdict, verdict:"unsupported", reason:"This standalone wording loses a necessary qualification."}],
  }]};
  const reviewed = spec.decode(conflicting);
  expect(reviewed.reviewedClaims.map(c => c.verdict).sort()).toEqual(["supported","unsupported"]);
  expect(contentAuditCoverageStatus(draft,reviewed,contentAuditEvidenceFingerprint(evidence))).toBe("current");
});


test("binds accent/case-equivalent historical declarations to exact public text without mutation", () => {
  const publicText = "Le filtre protège les données.";
  const legacy = {...draft, body: publicText, mediaPlan: {...draft.mediaPlan!,title:null,format:"linkedin_text" as const}, factualClaims: [{statement: "LE FILTRE PROTEGE LES DONNEES.", sourceKeys:["source:1"]}]};
  expect(contentAuditDeclarations(legacy)).toEqual([{id:"c0_f0_o0",field:"body",start:0,statement:publicText,claimedSourceKeys:["source:1"]}]);
  expect(legacy.factualClaims[0]!.statement).toBe("LE FILTRE PROTEGE LES DONNEES.");
});

test("legacy receipts cannot use a body review to cover an omitted title", () => {
  const evidence = [{key: "source:1"}];
  const verdict = {statement,kind:"factual" as const,sourceKeys:["source:1"],verdict:"supported" as const,reason:"The source distinguishes identity and document permissions."};
  const audit = contentAuditModelSpec({draft,evidence},"Audit independently").decode({
    passageReviews: [
      {passageId:"body",classification:"factual",nonFactualReason:null,claims:[verdict]},
      {passageId:"mediaPlan.title",classification:"non_factual",nonFactualReason:"An editorial heading without a field review.",claims:[]},
    ],
    declarationReviews:Object.fromEntries(contentAuditDeclarations(draft).map(d => [d.id, {kind:verdict.kind,sourceKeys:verdict.sourceKeys,verdict:verdict.verdict,reason:verdict.reason}])),
    reviewedScenarios:[],forbiddenTopicMatches:[],
  });
  const {declarations: _declarations, ...legacyCoverage} = audit.coverage!;
  const legacyAudit = {...audit,coverage:legacyCoverage};
  expect(contentAuditCoverageStatus(draft,legacyAudit,contentAuditEvidenceFingerprint(evidence))).toBe("invalid");
  const reviewedTitle = {...legacyCoverage,passages:legacyCoverage.passages.map(p => p.field === "mediaPlan.title" ? {...p,classification:"factual" as const,nonFactualReason:null,claims:[verdict]} : p)};
  expect(contentAuditCoverageStatus(draft,{...audit,coverage:reviewedTitle},contentAuditEvidenceFingerprint(evidence))).toBe("current");
});

test("maps decomposed accents and UTF-16 offsets without accepting partial ligatures", () => {
  expect(contentClaimOccurrences("🔐 prote\u0301ge\u0301", "PROTEGE")).toEqual([{start:3,statement:"prote\u0301ge\u0301"}]);
  expect(contentClaimOccurrences("ﬁltre", "filtre")).toEqual([{start:0,statement:"ﬁltre"}]);
  expect(contentClaimOccurrences("ﬁltre", "i")).toEqual([]);
});

test("merges only declared source references for duplicate current occurrences", () => {
  const repeated = {...draft,factualClaims:[...draft.factualClaims,{statement:"AUTHENTIFIE ≠ AUTORISE",sourceKeys:["source:2"]}]};
  const occurrences=contentAuditDeclarations(repeated);
  expect(occurrences).toHaveLength(3);
  expect(occurrences.every(item => item.claimedSourceKeys.join(",") === "source:1,source:2")).toBe(true);
  expect(repeated.factualClaims[0]!.sourceKeys).toEqual(["source:1"]);
});
