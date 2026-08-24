import { BrainCircuit } from "lucide-react";
import type { ProspectMemoryStatus, ProspectMemoryView } from "@/lib/api";
import { ProspectMemoryRefreshWatcher } from "@/components/prospect-memory-refresh-watcher";

/**
 * Read-only view of the durable Prospect 360 projection. This component never
 * owns the refresh job: it only observes PostgreSQL-backed state, so unmounting
 * a drawer cannot cancel the work.
 */
export function ProspectMemoryPanel({
  status,
  view,
}: {
  status: ProspectMemoryStatus;
  view: ProspectMemoryView | null;
}) {
  const refreshing = status.status === "refreshing";
  const facts = view ? [
    { label: "Besoins confirmés", values: view.facts.confirmedNeeds },
    { label: "Objections", values: view.facts.objections },
    { label: "Engagements pris", values: view.facts.commitments },
    { label: "À ne pas répéter", values: view.facts.doNotRepeat },
    { label: "Questions ouvertes", values: view.facts.openQuestions },
  ].filter((section) => section.values.length > 0) : [];
  return (
    <div className="rounded-xl border border-lime-200 bg-lime-50/60 p-4">
      <ProspectMemoryRefreshWatcher active={refreshing} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="flex items-center gap-2 text-xs"><BrainCircuit size={14} />Mémoire Prospect 360</strong>
        <span className={`badge ${memoryBadgeClass(status.status)}`}>{memoryStatusLabel(status.status)}</span>
      </div>
      {view?.relationshipSummary ? (
        <p className="mt-3 text-xs leading-5">{view.relationshipSummary}</p>
      ) : (
        <p className="mt-3 text-xs leading-5 text-muted">
          {status.enabled ? "La mémoire se construit à partir des faits durables du prospect." : "La mémoire durable est désactivée pour ce workspace."}
        </p>
      )}
      {view?.recommendedTone ? <p className="mt-2 text-[11px] text-muted"><strong>Ton conseillé :</strong> {view.recommendedTone}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted">
        {status.generatedAt ? <span>Actualisée {formatRelativeDate(status.generatedAt)}</span> : <span>Pas encore synthétisée</span>}
        <span>· {status.pendingEventCount} fait{status.pendingEventCount > 1 ? "s" : ""} en attente</span>
        {view ? <span>· {view.sourceCount} source{view.sourceCount > 1 ? "s" : ""}</span> : null}
      </div>
      {facts.length || view?.hypotheses.length || view?.recommendations.length ? (
        <details className="mt-3 rounded-lg border border-lime-200 bg-white/75 p-3">
          <summary className="cursor-pointer text-xs font-semibold">Pourquoi ? Voir les faits et recommandations</summary>
          <div className="mt-3 space-y-3">
            {facts.map((section) => (
              <div key={section.label}>
                <p className="text-[11px] font-semibold">{section.label}</p>
                <ul className="mt-1 space-y-1 text-[11px] leading-4 text-muted">
                  {section.values.slice(0, 5).map((source) => (
                    <li key={source.eventId}>• {source.excerpt ?? `Preuve ${source.sourceKind}`}</li>
                  ))}
                </ul>
              </div>
            ))}
            {view?.hypotheses.length ? <MemoryAssertions label="Hypothèses IA" values={view.hypotheses} /> : null}
            {view?.recommendations.length ? <MemoryAssertions label="Recommandations IA" values={view.recommendations} /> : null}
          </div>
        </details>
      ) : null}
      <p className="mt-3 text-[10px] leading-4 text-muted">
        {refreshing
          ? "Mise à jour durable en cours. Vous pouvez fermer cette fiche : le job continue et sera retrouvé à votre retour."
          : "La mémoire prépare le contexte uniquement. Elle n’envoie jamais de message."}
      </p>
    </div>
  );
}

function MemoryAssertions({
  label,
  values,
}: {
  label: string;
  values: ProspectMemoryView["hypotheses"];
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold">{label}</p>
      <ul className="mt-1 space-y-1 text-[11px] leading-4 text-muted">
        {values.slice(0, 5).map((assertion) => (
          <li key={assertion.id}>• {assertion.statement} <span className="opacity-70">({Math.round(assertion.confidence * 100)} %)</span></li>
        ))}
      </ul>
    </div>
  );
}

function memoryStatusLabel(status: ProspectMemoryStatus["status"]): string {
  return ({
    fresh: "À jour",
    refreshing: "Mise à jour…",
    stale: "À actualiser",
    budget_blocked: "Budget en attente",
    failed: "À vérifier",
    anonymized: "Anonymisée",
  } as const)[status];
}

function memoryBadgeClass(status: ProspectMemoryStatus["status"]): string {
  if (status === "fresh") return "badge-success";
  if (status === "refreshing") return "badge-signal";
  if (status === "stale" || status === "budget_blocked") return "badge-warning";
  return "";
}

function formatRelativeDate(value: string): string {
  const ageMinutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (ageMinutes < 1) return "à l’instant";
  if (ageMinutes < 60) return `il y a ${ageMinutes} min`;
  const hours = Math.round(ageMinutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.round(hours / 24)} j`;
}
