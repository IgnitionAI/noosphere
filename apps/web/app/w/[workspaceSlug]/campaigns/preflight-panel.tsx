"use client";

import { useState } from "react";
import { TriangleAlert, CheckCircle2 } from "lucide-react";
import { MutationForm } from "../research/[runId]/report/mutation-form";
import type { CampaignPreflight } from "@/lib/api";
import { preflightCampaignAction } from "./actions";

export function PreflightPanel({ workspaceSlug, campaignId }: { workspaceSlug: string; campaignId: string }) {
  const [result, setResult] = useState<CampaignPreflight | null>(null);
  const action = preflightCampaignAction.bind(null, workspaceSlug, campaignId);
  return <section className="panel"><div className="panel-header"><h2 className="font-semibold">Préflight avant activation</h2>{result ? <span className={`badge ${result.ok ? "badge-success" : "badge-danger"}`}>{result.ok ? "prêt" : "bloqué"}</span> : null}</div><div className="panel-body"><p className="mb-3 text-xs text-muted">Le contrôle est rejouable. Les blocages indiquent la référence exacte à corriger.</p><MutationForm action={action} onSuccess={(value: unknown) => setResult(value as CampaignPreflight)} successMessage="Préflight terminé."><button className="button" type="submit">Rejouer le préflight</button></MutationForm>{result ? <div className="mt-4 space-y-2">{result.blockers.length ? <div className="rounded-lg border border-danger/30 bg-red-50 p-3 text-xs text-danger"><p className="mb-2 flex items-center gap-2 font-semibold"><TriangleAlert size={14} /> Blocages d’activation</p>{result.blockers.map((blocker) => <p className="border-t border-danger/10 py-2" key={`${blocker.reference}-${blocker.code}`}><strong>{label(blocker.reference)}</strong> · {blocker.message}<br /><span className="font-mono text-[10px]">{blocker.code} · {blocker.versionId}</span></p>)}</div> : <p className="flex items-center gap-2 rounded-lg border border-success/30 bg-emerald-50 p-3 text-xs text-success"><CheckCircle2 size={14} /> Toutes les références sont publiées.</p>}{result.warnings.map((warning) => <p className="rounded-lg border border-warning/30 bg-amber-50 p-3 text-xs text-warning" key={warning.code}><strong>Avertissement · {warning.code}</strong><br />{warning.message}<br /><span>Ce point n’empêche pas l’activation, mais l’envoi restera indisponible.</span></p>)}</div> : null}</div></section>;
}
function label(reference: string): string { return ({ offerVersionId: "Offre", icpVersionId: "ICP", messagingStrategyVersionId: "Stratégie de message", aiPolicyVersionId: "Politique IA", sequenceVersionId: "Séquence" } as Record<string, string>)[reference] ?? reference; }
