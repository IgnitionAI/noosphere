import { MAX_CONTENT_FACTUAL_CLAIMS, contentAuditCoverageStatus, type ContentDraftSnapshot, type ContentEvidenceAudit } from "./content-asset";

/** Complete references from independently audited spans; never change public copy or suppress objections. */
export function synchronizeAuditedClaimLedger(draft: ContentDraftSnapshot, audit: ContentEvidenceAudit, availableEvidenceKeys: readonly string[], evidenceFingerprint: string): { draft: ContentDraftSnapshot; audit: ContentEvidenceAudit } {
  const unchanged = { draft, audit };
  if (contentAuditCoverageStatus(draft, audit, evidenceFingerprint) !== "current") return unchanged;
  const available = new Set(availableEvidenceKeys);
  if (audit.reviewedClaims.some(claim => claim.sourceKeys.some(key => !available.has(key)))) return unchanged;
  const disputed = new Set([...audit.reviewedClaims.filter(claim => claim.verdict === "unsupported"), ...(audit.unresolvedClaims ?? [])].map(claim => claim.statement));
  const additions = new Map<string, readonly string[]>();
  for (const claim of audit.coverage!.passages.flatMap(passage => passage.claims)) {
    if (claim.kind !== "factual" || claim.verdict !== "supported" || disputed.has(claim.statement)
      || draft.factualClaims.some(existing => existing.statement.includes(claim.statement))) continue;
    // Keep one complete audited support set; merging separate sets could invent a review that never happened.
    if (!additions.has(claim.statement)) additions.set(claim.statement, claim.sourceKeys);
  }
  // Leave the complete original audit available to the bounded substantive repair path.
  if (!additions.size || draft.factualClaims.length + additions.size > MAX_CONTENT_FACTUAL_CLAIMS) return unchanged;
  return {
    draft: { ...draft, factualClaims: [...draft.factualClaims, ...[...additions].map(([statement, keys]) => ({ statement, sourceKeys: [...keys] }))] },
    audit: { ...audit, ungroundedStatements: audit.ungroundedStatements.filter(statement => !additions.has(statement)) },
  };
}
