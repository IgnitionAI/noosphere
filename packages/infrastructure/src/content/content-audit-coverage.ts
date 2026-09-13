import { z } from "zod";
import { contentDraftSnapshotSchema, contentEvidenceAuditSchema } from "@outbound/contracts/content";
import { contentPublicFields } from "@outbound/domain/content/content-asset";

/** Provider IDs are resolved against the current input, never persisted as evidence of coverage. */
export function contentAuditModelSpec(context: unknown, system: string) {
  const input = z.object({ draft: contentDraftSnapshotSchema, evidence: z.array(z.object({ key: z.string() }).passthrough()) }).parse(context);
  const publicPassages = contentPublicFields(input.draft).map(p => ({ id: p.field, ...p }));
  const keys = [...new Set(input.evidence.map(e => e.key))];
  const claim = z.object({
    statement: z.string().min(3).max(1_000), kind: z.enum(["factual", "attribution"]),
    sourceKeys: z.array(keys.length ? z.enum(keys as [string, ...string[]]) : z.string()).max(keys.length ? 12 : 0),
    verdict: z.enum(["supported", "unsupported"]), reason: z.string().min(3).max(1_000),
  }).strict();
  const schema = z.object({
    passageReviews: z.array(z.object({
      passageId: z.enum(publicPassages.map(p => p.id) as [string, ...string[]]),
      classification: z.enum(["factual", "non_factual", "mixed"]),
      nonFactualReason: z.string().min(20).max(1_000).nullable(),
      claims: z.array(claim).max(30),
    }).strict()).length(publicPassages.length),
    reviewedScenarios: z.array(z.object({ statement: z.string().min(20).max(600), verdict: z.enum(["hypothetical", "misleading"]), reason: z.string().min(20).max(1_000) }).strict()).max(2),
    forbiddenTopicMatches: z.array(z.string().min(2).max(500)).max(20),
  }).strict();
  return {
    name: "submit_evidence_audit", description: "Review every current public field and its factual spans against evidence.",
    schema, context: { ...(context as Record<string, unknown>), publicPassages },
    system: `${system}\nReturn exactly one passageReviews entry per publicPassages ID. Review every factual span, including missing-ledger statements and short media instructions describing mechanisms. Use exact contiguous substrings of that field. Also cover the full wording of every writer-declared claim; do not approve only its supported fragment. Use classification factual with claims and null nonFactualReason; non_factual with no claims and a reason; mixed with claims and a reason identifying its non-factual material. Opinions, proposals, questions, structural markers and explicitly fictional inputs are not automatically factual assertions, but factual premises in mixed passages still require review. Never classify an unsupported factual assertion as an opinion to avoid a negative verdict. Supported factual spans require nonempty supplied source keys. Retain unsupported verdicts even when the writer omitted the claim. Bibliographic attribution must be verified in context; quotation identity alone does not establish endorsement or scope. Mark bibliographic credits as kind attribution and substantive assertions as kind factual, separating adjacent claims. An attribution is not a missing substantive ledger entry. Review declared scenarios separately. Across all fields, at most30 distinct reviewed claims and20 missing substantive ledger statements fit the audit contract; do not drop findings to fit. Do not rewrite public copy.`,
    decode(output: unknown) {
      const result = schema.parse(output);
      if (new Set(result.passageReviews.map(r => r.passageId)).size !== publicPassages.length) throw new Error("CONTENT_AUDIT_COVERAGE_INVALID");
      const passages = publicPassages.map(p => {
        const review = result.passageReviews.find(r => r.passageId === p.id)!;
        if ((review.classification === "non_factual") !== (review.claims.length === 0)
          || (review.classification === "factual") !== (review.nonFactualReason === null)
          || review.claims.some(c => !p.text.includes(c.statement) || (c.verdict === "supported" && c.sourceKeys.length === 0))) throw new Error("CONTENT_AUDIT_COVERAGE_INVALID");
        return { field: p.field, text: p.text, classification: review.classification, nonFactualReason: review.nonFactualReason, claims: review.claims };
      });
      // Keep opposing verdicts, even if they refer to the same repeated statement.
      const reviewedClaims = [...new Map(result.passageReviews.flatMap(r => r.claims).map(c => [JSON.stringify([c.statement, c.verdict, [...c.sourceKeys].sort()]), c])).values()];
      const ungroundedStatements = [...new Set(result.passageReviews.flatMap(r => r.claims).filter(c => c.kind === "factual" && !input.draft.factualClaims.some(d => d.statement.includes(c.statement))).map(c => c.statement))];
      if (reviewedClaims.length > 30 || ungroundedStatements.length > 20) throw new Error("CONTENT_AUDIT_CAPACITY_EXCEEDED");
      return contentEvidenceAuditSchema.parse({
        reviewedClaims: reviewedClaims.map(({kind: _kind, ...c}) => c), ungroundedStatements, reviewedScenarios: result.reviewedScenarios, forbiddenTopicMatches: result.forbiddenTopicMatches,
        coverage: { version: 1, evidenceFingerprint: new Bun.CryptoHasher("sha256").update(JSON.stringify(input.evidence)).digest("hex"), passages },
      });
    },
  };
}
