"use client";

import { ExternalLink, LoaderCircle, RefreshCw, Radio, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { IntentSignal, SignalCollectionRun, SignalEntityType } from "@/lib/api";
import { MutationForm } from "@/app/w/[workspaceSlug]/research/[runId]/report/mutation-form";

type MutationAction = (formData: FormData) => Promise<unknown>;

const SIGNAL_LABEL: Record<IntentSignal["signalType"], string> = {
  hiring: "Recrute",
  funding: "Levée de fonds",
  job_change: "Changement de poste",
  leadership_change: "Changement de direction",
  geographic_expansion: "Expansion géographique",
  public_activity: "Activité publique",
  technology: "Technologie",
  competitor: "Concurrent",
};

export function SignalsPanel({
  entityType,
  entityId,
  signals,
  run,
  canCollect,
  requestKey,
  collectAction,
}: {
  entityType: SignalEntityType;
  entityId: string;
  signals: readonly IntentSignal[];
  run: SignalCollectionRun | null;
  canCollect: boolean;
  requestKey: string;
  collectAction: MutationAction;
}) {
  const router = useRouter();
  const [retryKey] = useState(() => `${requestKey}:retry:${Date.now()}`);
  const inFlight = run ? run.status === "queued" || run.status === "running" : false;
  const expired = (signal: IntentSignal) => new Date(signal.expiresAt).getTime() <= Date.now();
  useEffect(() => {
    if (!inFlight) return;
    const timer = window.setInterval(() => router.refresh(), 4_000);
    return () => window.clearInterval(timer);
  }, [inFlight, router]);

  function showRun(result: unknown) {
    if (!result || typeof result !== "object" || !("id" in result) || typeof result.id !== "string") return;
    const url = new URL(window.location.href);
    url.searchParams.set("signalRunId", result.id);
    router.replace(url.pathname + url.search);
  }

  return (
    <section className="panel mt-5" id="signals">
      <div className="panel-header flex-wrap gap-2"><div><h2 className="flex items-center gap-2 font-semibold"><Radio className="text-brand-blue" size={16} /> Signaux</h2><p className="mt-1 text-xs text-muted">Faits observés, sourcés et datés pour expliquer la priorité.</p></div><span className="badge">{signals.length}</span></div>
      <div className="panel-body space-y-3">
        {run && (run.status === "queued" || run.status === "running") ? <p className="flex items-center gap-2 rounded-lg border border-brand-blue/30 bg-blue-50 p-3 text-xs text-brand-blue" role="status"><LoaderCircle className="animate-spin" size={14} /> Collecte des signaux en cours… Actualisation automatique.</p> : null}
        {run && (run.status === "failed" || run.status === "partial") ? <div className={`rounded-lg border p-3 text-xs ${run.status === "partial" ? "border-warning/40 bg-amber-50 text-warning" : "border-danger/30 bg-red-50 text-danger"}`}><p className="font-semibold">{run.status === "partial" ? "Collecte partielle" : providerDown(run) ? "Source de signaux indisponible" : "La collecte a échoué"}</p><p className="mt-1">{run.errorMessage || run.errorCode || "Vous pouvez relancer une collecte."}</p>{canCollect && !inFlight ? <MutationForm action={collectAction} onSuccess={showRun} successMessage="Nouvelle collecte mise en file."><input name="requestKey" type="hidden" value={retryKey} readOnly /><input name="entityType" type="hidden" value={entityType} readOnly /><input name="entityId" type="hidden" value={entityId} readOnly /><button className="button mt-2" type="submit"><RefreshCw size={14} /> Relancer</button></MutationForm> : null}</div> : null}
        {signals.length === 0 ? <p className="rounded-lg border border-dashed border-line p-5 text-center text-sm text-muted">Aucun signal observé pour le moment. L’absence de signal est neutre : aucune donnée n’est simulée.</p> : <div className="space-y-2">{signals.map((signal) => <SignalCard expired={expired(signal)} key={signal.id} signal={signal} />)}</div>}
        {canCollect && !inFlight ? <MutationForm action={collectAction} onSuccess={showRun} successMessage="Collecte demandée."><input name="requestKey" type="hidden" value={run ? retryKey : requestKey} readOnly /><input name="entityType" type="hidden" value={entityType} readOnly /><input name="entityId" type="hidden" value={entityId} readOnly /><button className="button button-signal" type="submit"><RefreshCw size={14} /> {run ? "Collecter à nouveau" : "Collecter les signaux"}</button><p className="mt-2 text-[11px] text-muted">Réservé aux owners et admins. Chaque demande est idempotente par clé.</p></MutationForm> : null}
        {!canCollect ? <p className="text-[11px] text-muted">La collecte est réservée aux owners et admins ; les autres rôles peuvent lire les signaux.</p> : null}
      </div>
    </section>
  );
}

function SignalCard({ signal, expired }: { signal: IntentSignal; expired: boolean }) {
  return <article className={`rounded-lg border p-3 ${expired ? "border-line bg-slate-50/70 opacity-80" : "border-line"}`}><div className="flex flex-wrap items-start gap-2"><span className={`badge ${expired ? "" : "badge-success"}`}>{expired ? "Historique · expiré" : "Actuel"}</span><span className="badge">{SIGNAL_LABEL[signal.signalType]}</span><span className="badge">Confiance {signal.confidence}</span></div><p className="mt-2 text-sm font-semibold text-ink">{SIGNAL_LABEL[signal.signalType]} — observé le {formatDate(signal.observedAt)}</p><p className="mt-1 text-xs text-muted">Source {signal.source}{signal.sources.length > 1 ? ` · ${signal.sources.length} sources` : ""} · expiration {formatDate(signal.expiresAt)}</p>{signal.evidenceSnippet ? <p className="mt-2 text-xs italic text-muted">« {signal.evidenceSnippet} »</p> : null}{signal.evidenceUrl ? <a className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-blue" href={signal.evidenceUrl} rel="noreferrer" target="_blank">Voir la preuve <ExternalLink size={11} /></a> : null}</article>;
}

function providerDown(run: SignalCollectionRun): boolean { return /source|provider|unavailable|down/i.test(`${run.errorCode ?? ""} ${run.errorMessage ?? ""}`); }
function formatDate(value: string): string { return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(value)); }
