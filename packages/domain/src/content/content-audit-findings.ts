import { contentPublicText, type ContentDraftSnapshot, type ContentEvidenceAudit } from "./content-asset";

/** Silence or a conflicting favorable vote does not resolve an earlier objection. */
export function retainUnresolvedAuditFindings(draft: ContentDraftSnapshot, current: ContentEvidenceAudit, previous: ContentEvidenceAudit | null): ContentEvidenceAudit {
  const text = contentPublicText(draft);
  const findings = [...(previous?.unresolvedClaims ?? []), ...(previous?.reviewedClaims ?? []).flatMap(claim => claim.verdict === "unsupported" ? [{ ...claim, verdict: "unsupported" as const }] : [])];
  const unresolvedClaims = [...new Map(findings.filter(claim => text.includes(claim.statement)).map(claim => [JSON.stringify([claim.statement, claim.reason, [...claim.sourceKeys].sort()]), claim])).values()];
  if (unresolvedClaims.length > 30) throw new Error("CONTENT_AUDIT_FINDINGS_CAPACITY_EXCEEDED");
  const scenarios = [...(previous?.unresolvedScenarios ?? []), ...(previous?.reviewedScenarios ?? []).flatMap(scenario => scenario.verdict === "misleading" ? [{ ...scenario, verdict: "misleading" as const }] : [])];
  const unresolvedScenarios = [...new Map(scenarios.filter(scenario => text.includes(scenario.statement)).map(scenario => [JSON.stringify([scenario.statement, scenario.reason]), scenario])).values()];
  if (unresolvedScenarios.length > 6) throw new Error("CONTENT_AUDIT_FINDINGS_CAPACITY_EXCEEDED");
  const topics = [...(previous?.unresolvedTopics ?? []), ...(previous?.topicFindings ?? []), ...(previous?.forbiddenTopicMatches ?? []).filter(topic => !previous?.topicFindings?.some(finding => finding.topic === topic)).map(topic => ({ topic, field: null, statement: null, reason: "L’audit historique ne localise pas cette objection. Cette objection exige une résolution distincte avant publication." }))];
  const unresolvedTopics = [...new Map(topics.filter(finding => finding.statement === null || text.includes(finding.statement)).map(finding => [JSON.stringify([finding.topic, finding.statement, finding.reason]), finding])).values()];
  if (unresolvedTopics.length > 20) throw new Error("CONTENT_AUDIT_FINDINGS_CAPACITY_EXCEEDED");
  const { unresolvedClaims: _untrustedClaims, unresolvedScenarios: _untrustedScenarios, unresolvedTopics: _untrustedTopics, ...review } = current;
  return { ...review, ...(unresolvedClaims.length ? { unresolvedClaims } : {}), ...(unresolvedScenarios.length ? { unresolvedScenarios } : {}), ...(unresolvedTopics.length ? { unresolvedTopics } : {}) };
}
