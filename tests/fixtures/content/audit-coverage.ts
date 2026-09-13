import { contentPublicFields, type ContentDraftSnapshot, type ContentEvidenceAudit } from "@outbound/domain/content/content-asset";
import { contentAuditEvidenceFingerprint } from "@outbound/application/content/content-audit-context";

/** Synthetic model receipt for orchestration fixtures, never evidence of semantic quality. */
export function fixtureAuditCoverage(draft: ContentDraftSnapshot, audit: ContentEvidenceAudit, evidence: readonly { readonly key: string }[] = []): ContentEvidenceAudit {
  return { ...audit, coverage: { version: 1, evidenceFingerprint: contentAuditEvidenceFingerprint(evidence),
    passages: contentPublicFields(draft).map(({ field, text }) => {
      const claims = audit.reviewedClaims.filter(claim => text.includes(claim.statement)).map(claim => ({ ...claim, kind: "factual" as const }));
      return { field, text, classification: claims.length ? "mixed" as const : "non_factual" as const,
        nonFactualReason: "Synthetic nonfactual context for an orchestration fixture.", claims };
    }),
  } };
}

export function fixtureReadinessInput<T extends { draft: ContentDraftSnapshot; audit: ContentEvidenceAudit }>(input: T) {
  return { ...input, audit: fixtureAuditCoverage(input.draft, input.audit), evidenceFingerprint: contentAuditEvidenceFingerprint([]) };
}
