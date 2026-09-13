import { contentAuditDeclarations } from "./content-audit-declarations";
import { contentAuditEvidenceFingerprint } from "@outbound/application/content/content-audit-context";
import { z } from "zod";
import { contentDraftSnapshotSchema, contentEvidenceAuditSchema } from "@outbound/contracts/content";
import { contentPublicFields } from "@outbound/domain/content/content-asset";

/** Only malformed quote locations without substantive objections permit reassessment. */
export class ContentAuditQuoteLocationError extends Error {
  constructor(readonly fields: readonly string[]) { super("CONTENT_AUDIT_COVERAGE_INVALID"); }
}

/** Provider IDs are resolved against the current input, never persisted as evidence of coverage. */
export function contentAuditModelSpec(context: unknown, system: string) {
  const input = z.object({ draft: contentDraftSnapshotSchema, evidence: z.array(z.object({ key: z.string() }).passthrough()), strategy: z.object({forbiddenTopics: z.array(z.string().min(1).max(300)).max(30)}).optional() }).parse(context);
  const publicPassages = contentPublicFields(input.draft).map(p => ({ id: p.field, ...p }));
  const topicObligations = [...new Set(input.strategy?.forbiddenTopics ?? [])].map((topic, i) => ({id: `topic_${i}`, topic}));
  const declaredOccurrences = contentAuditDeclarations(input.draft);
  const keys = [...new Set(input.evidence.map(e => e.key))];
  const claim = z.object({
    statement: z.string().min(3).max(1_000), kind: z.enum(["factual", "attribution"]),
    sourceKeys: z.array(keys.length ? z.enum(keys as [string, ...string[]]) : z.string()).max(keys.length ? 12 : 0),
    verdict: z.enum(["supported", "unsupported"]), reason: z.string().min(3).max(1_000),
  }).strict();
  const declarationReview = claim.omit({statement: true});
  const declarationShape: Record<string, typeof declarationReview> = Object.fromEntries(declaredOccurrences.map(item => [item.id, declarationReview]));
  const schema = z.object({
    topicReviews: z.object(Object.fromEntries(topicObligations.map(({id}) => [id, z.object({violated: z.boolean(), reason: z.string().min(20).max(1_000)}).strict()]))).strict(),
    declarationReviews: z.object(declarationShape).strict(),
    passageReviews: z.array(z.union([
      z.object({
        passageId: z.enum(publicPassages.map(p => p.id) as [string, ...string[]]),
        classification: z.literal("factual"), nonFactualReason: z.null(),
        claims: z.array(claim).min(1).max(30),
      }).strict(),
      z.object({
        passageId: z.enum(publicPassages.map(p => p.id) as [string, ...string[]]),
        classification: z.literal("non_factual"), nonFactualReason: z.string().min(20).max(1_000),
        claims: z.array(claim).max(0),
      }).strict(),
      z.object({
        passageId: z.enum(publicPassages.map(p => p.id) as [string, ...string[]]),
        classification: z.literal("mixed"), nonFactualReason: z.string().min(20).max(1_000),
        claims: z.array(claim).min(1).max(30),
      }).strict(),
    ])).length(publicPassages.length),
    reviewedScenarios: z.array(z.object({ statement: z.string().min(20).max(600), verdict: z.enum(["hypothetical", "misleading"]), reason: z.string().min(20).max(1_000) }).strict()).max(2),
    forbiddenTopicMatches: z.array(z.string().min(1).max(300)).max(20),
    topicFindings: z.array(z.object({topic: z.string().min(1).max(300), field: z.enum(publicPassages.map(p => p.id) as [string, ...string[]]), statement: z.string().min(3).max(1_000), reason: z.string().min(20).max(1_000)}).strict()).max(20),
  }).strict();
  return {
    name: "submit_evidence_audit", description: "Review every current public field and its factual spans against evidence.",
    schema, context: { ...(context as Record<string, unknown>), publicPassages, declaredOccurrences, topicObligations },
    system: `${system}\nReturn every required declarationReviews key listed in declaredOccurrences. Evaluate each entire declared statement in its own field context against evidence; declaration does not imply support. Never substitute a supported fragment for a broader assertion. Independently review the entire current field in passageReviews, including undeclared facts and contradictions. Keep the field classification and non-factual reasoning independent of the declaration slot. Return exactly one passageReviews entry per publicPassages ID. Review every factual span, including missing-ledger statements and short media instructions describing mechanisms. Use exact contiguous substrings of that field. Also cover the full wording of every writer-declared claim; do not approve only its supported fragment. Use classification factual with claims and null nonFactualReason; non_factual with no claims and a reason; mixed with claims and a reason identifying its non-factual material. Opinions, proposals, questions, structural markers and explicitly fictional inputs are not automatically factual assertions, but factual premises in mixed passages still require review. Never classify an unsupported factual assertion as an opinion to avoid a negative verdict. Supported factual spans require nonempty supplied source keys. Retain unsupported verdicts even when the writer omitted the claim. Bibliographic attribution must be verified in context; quotation identity alone does not establish endorsement or scope. Mark bibliographic credits as kind attribution and substantive assertions as kind factual, separating adjacent claims. An attribution is not a missing substantive ledger entry. Review declared scenarios separately. Independently assess every topicObligations entry in topicReviews, even when its violation is already rejected as an unsupported claim. Give a reason for both absent and present violations. A violated topic must appear verbatim in forbiddenTopicMatches with located topicFindings; an absent one must not. For each forbiddenTopicMatches entry, provide topicFindings with the same topic, a current field ID, an exact contiguous quotation from that field, and a reason explaining the violation. Do not list a topic without locating its offending wording. Both lists must be empty when no forbidden topic is present. Across all fields, at most30 distinct reviewed claims and20 missing substantive ledger statements fit the audit contract; do not drop findings to fit. Do not rewrite public copy.`,
    decode(output: unknown) {
      const result = schema.parse(output);
      if (topicObligations.some(({id, topic}) => result.topicReviews[id]!.violated !== result.forbiddenTopicMatches.includes(topic))) throw new Error("CONTENT_AUDIT_TOPIC_COVERAGE_INVALID");
      if (result.forbiddenTopicMatches.some(topic => !result.topicFindings.some(finding => finding.topic === topic))
        || result.topicFindings.some(finding => !result.forbiddenTopicMatches.includes(finding.topic) || !publicPassages.find(p => p.field === finding.field)!.text.includes(finding.statement))) throw new Error("CONTENT_AUDIT_TOPIC_COVERAGE_INVALID");
      if (new Set(result.passageReviews.map(r => r.passageId)).size !== publicPassages.length) throw new Error("CONTENT_AUDIT_COVERAGE_INVALID");
      const misplacedFields = publicPassages.filter(p => result.passageReviews.find(r => r.passageId === p.id)!.claims.some(c => !p.text.includes(c.statement))).map(p => p.field);
      if (misplacedFields.length) {
        const claims = [...result.passageReviews.flatMap(r => r.claims), ...Object.values(result.declarationReviews)];
        const hasObjection = claims.some(c => c.verdict === "unsupported" || !c.sourceKeys.length)
          || result.reviewedScenarios.some(s => s.verdict === "misleading") || result.forbiddenTopicMatches.length > 0;
        if (hasObjection) throw new Error("CONTENT_AUDIT_COVERAGE_INVALID");
        throw new ContentAuditQuoteLocationError(misplacedFields);
      }
      const passages = publicPassages.map(p => {
        const review = result.passageReviews.find(r => r.passageId === p.id)!;
        if ((review.classification === "non_factual") !== (review.claims.length === 0)
          || (review.classification === "factual") !== (review.nonFactualReason === null)
          || review.claims.some(c => !p.text.includes(c.statement) || (c.verdict === "supported" && c.sourceKeys.length === 0))) throw new Error("CONTENT_AUDIT_COVERAGE_INVALID");
        return { field: p.field, text: p.text, classification: review.classification, nonFactualReason: review.nonFactualReason, claims: review.claims };
      });
      const declarations = declaredOccurrences.map(({id, field, start, statement}) => {
        const review = result.declarationReviews[id]!;
        if (review.verdict === "supported" && !review.sourceKeys.length) throw new Error("CONTENT_AUDIT_COVERAGE_INVALID");
        return {field, start, statement, ...review};
      });
      // Keep opposing verdicts, even if they refer to the same repeated statement.
      const reviewedClaims = [...new Map([...result.passageReviews.flatMap(r => r.claims), ...declarations].map(c => [JSON.stringify([c.statement, c.verdict, [...c.sourceKeys].sort()]), c])).values()];
      const ungroundedStatements = [...new Set(result.passageReviews.flatMap(r => r.claims).filter(c => c.kind === "factual" && !input.draft.factualClaims.some(d => d.statement.includes(c.statement))).map(c => c.statement))];
      if (reviewedClaims.length > 30 || ungroundedStatements.length > 20) throw new Error("CONTENT_AUDIT_CAPACITY_EXCEEDED");
      return contentEvidenceAuditSchema.parse({
        topicReviews: topicObligations.map(({id, topic}) => ({topic, ...result.topicReviews[id]!})),
        reviewedClaims: reviewedClaims.map(({statement, sourceKeys, verdict, reason}) => ({statement, sourceKeys, verdict, reason})), ungroundedStatements, reviewedScenarios: result.reviewedScenarios, forbiddenTopicMatches: result.forbiddenTopicMatches, topicFindings: result.topicFindings,
        coverage: { version: 1, evidenceFingerprint: contentAuditEvidenceFingerprint(input.evidence), passages, declarations },
      });
    },
  };
}
