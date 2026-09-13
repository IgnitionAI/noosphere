import { expect, test } from "bun:test";
import { retainUnresolvedAuditClaims } from "@outbound/domain/content/content-audit-findings";
import type { ContentDraftSnapshot, ContentEvidenceAudit } from "@outbound/domain/content/content-asset";
const statement = "Le service élimine toutes les fuites.";
const draft: ContentDraftSnapshot = { hook: statement, body: statement, callToAction: null, factualClaims: [{ statement, sourceKeys: ["proof"] }], opinionStatements: [] };
const fresh: ContentEvidenceAudit = { reviewedClaims: [], ungroundedStatements: [], forbiddenTopicMatches: [] };
const prior = { ...fresh, reviewedClaims: [{ statement, sourceKeys: ["proof"], verdict: "unsupported", reason: "La source ne garantit pas l’absence de fuite." }] } satisfies ContentEvidenceAudit;
test("a later silent audit cannot erase an unsupported statement still published", () => {
  expect(retainUnresolvedAuditClaims(draft, fresh, prior).unresolvedClaims).toEqual(prior.reviewedClaims);
});

test("a favorable second vote on unchanged copy does not resolve the objection", () => {
  const favorable = { ...fresh, reviewedClaims: [{ ...prior.reviewedClaims[0]!, verdict: "supported" as const }] };
  expect(retainUnresolvedAuditClaims(draft, favorable, prior).unresolvedClaims).toHaveLength(1);
});
test("an objection survives several silent reviews and a move to a slide", () => {
  const carried = retainUnresolvedAuditClaims(draft, fresh, prior);
  const moved = { ...draft, body: "Une procédure à examiner.", factualClaims: [], mediaPlan: { format: "linkedin_document" as const, visualTone: "editorial" as const, title: null, subtitle: null, altText: null, scenes: [], slides: [{ title: "Garantie", body: statement }] } };
  expect(retainUnresolvedAuditClaims(moved, fresh, carried).unresolvedClaims).toEqual(prior.reviewedClaims);
});
test("removing the disputed assertion permits independent reassessment of the replacement", () => {
  const corrected = { ...draft, body: "Examinons la configuration du filtre.", factualClaims: [] };
  expect(retainUnresolvedAuditClaims(corrected, fresh, prior).unresolvedClaims ?? []).toEqual([]);
});
