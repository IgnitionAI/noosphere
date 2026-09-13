import type { ContentAssetVersion } from "@/lib/api";

export function AuditObjections({ audit }: { audit: ContentAssetVersion["audit"] }) {
  const describedTopics = new Set([...(audit.unresolvedTopics ?? []), ...(audit.topicFindings ?? [])].map(finding => finding.topic));
  const findings = [
    ...audit.forbiddenTopicMatches.filter(topic => !describedTopics.has(topic)).map(topic => ({
      title: `Sujet à corriger : ${topic}`,
      statement: null,
      reason: "Cet audit signale le sujet sans enregistrer de citation ni de motif détaillé.",
    })),
    ...(audit.unresolvedClaims ?? []).map(finding => ({ ...finding, title: "Fait toujours contesté" })),
    ...(audit.unresolvedScenarios ?? []).map(finding => ({ ...finding, title: "Scénario toujours contesté" })),
    ...(audit.unresolvedTopics ?? []).map(finding => ({ ...finding, title: `Sujet à corriger : ${finding.topic}` })),
    ...(audit.topicFindings ?? []).map(finding => ({ ...finding, title: `Sujet à corriger : ${finding.topic}` })),
  ];
  const unique = [...new Map(findings.map(finding => [JSON.stringify([finding.title, finding.statement, finding.reason]), finding])).values()];
  if (!unique.length) return null;

  return <section className="panel overflow-hidden" aria-labelledby="audit-objections-title">
    <div className="panel-header"><div className="min-w-0">
      <h2 id="audit-objections-title" className="font-semibold">Corrections nécessaires</h2>
      <p className="mt-1 text-sm leading-6 text-muted">Ces objections restent bloquantes. Une nouvelle version doit les résoudre avant toute publication.</p>
    </div></div>
    <ul className="panel-body space-y-4">
      {unique.map((finding, index) => <li key={index} className="rounded-xl border border-line bg-surface-subtle p-4">
        <h3 className="text-sm font-semibold text-ink">{finding.title}</h3>
        {finding.statement ? <blockquote className="mt-3 whitespace-pre-wrap break-words border-l-2 border-amber-500 pl-3 text-sm leading-6 text-ink">{finding.statement}</blockquote>
          : <p className="mt-3 text-sm leading-6 text-ink">L’audit précédent ne précise pas le passage concerné. Une réécriture seule ne suffit pas à lever cette objection.</p>}
        <p className="mt-3 break-words text-sm leading-6 text-muted">{finding.reason}</p>
      </li>)}
    </ul>
  </section>;
}
