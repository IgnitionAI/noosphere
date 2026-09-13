import { contentPublicText, type ContentDraftSnapshot, type ContentEvidenceAudit } from "./content-asset";

/** Silence or a conflicting favorable vote does not resolve an earlier factual objection. */
export function retainUnresolvedAuditClaims(draft: ContentDraftSnapshot, current: ContentEvidenceAudit, previous: ContentEvidenceAudit | null): ContentEvidenceAudit {
  const text = contentPublicText(draft);
  const findings = [...(previous?.unresolvedClaims ?? []), ...(previous?.reviewedClaims ?? []).flatMap(claim => claim.verdict === "unsupported" ? [{ ...claim, verdict: "unsupported" as const }] : [])];
  const unresolvedClaims = [...new Map(findings.filter(claim => text.includes(claim.statement)).map(claim => [JSON.stringify([claim.statement, claim.reason, [...claim.sourceKeys].sort()]), claim])).values()];
  if (unresolvedClaims.length > 30) throw new Error("CONTENT_AUDIT_FINDINGS_CAPACITY_EXCEEDED");
  const { unresolvedClaims: _untrustedFindings, ...review } = current;
  return unresolvedClaims.length ? { ...review, unresolvedClaims } : review;
}
