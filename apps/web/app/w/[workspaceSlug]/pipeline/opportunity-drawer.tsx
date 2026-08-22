import { LockKeyhole, RotateCcw, Save, X } from "lucide-react";
import Link from "next/link";
import type { CalendarBooking, OfferVersion, PipelineOpportunity } from "@/lib/api";
import { MutationForm } from "../research/[runId]/report/mutation-form";
import { closeOpportunityAction, reopenOpportunityAction, updateOpportunityAction } from "./actions";
import { CalendarBookingsPanel } from "@/components/calendar-bookings-panel";

export function OpportunityDrawer({
  opportunity,
  workspaceSlug,
  workspaceRole,
  ownerOptions,
  offerVersions,
  lostReasons,
  closeHref,
  bookings,
}: {
  opportunity: PipelineOpportunity;
  workspaceSlug: string;
  workspaceRole: string;
  ownerOptions: readonly { id: string; label: string }[];
  offerVersions: readonly OfferVersion[];
  lostReasons: readonly { key: string; label: string }[];
  closeHref: string;
  bookings: readonly CalendarBooking[];
}) {
  const canEdit = ["operator", "admin", "owner"].includes(workspaceRole) && opportunity.stage !== "won" && opportunity.stage !== "lost";
  const canReopen = ["admin", "owner"].includes(workspaceRole) && !canEdit;
  const update = updateOpportunityAction.bind(null, workspaceSlug, opportunity.id);
  const close = closeOpportunityAction.bind(null, workspaceSlug, opportunity.id);
  const reopen = reopenOpportunityAction.bind(null, workspaceSlug, opportunity.id);
  return <><Link aria-label="Fermer l’opportunité" className="fixed inset-0 z-40 bg-navy/25 backdrop-blur-[1px]" href={closeHref} scroll={false} /><aside aria-label="Détail de l’opportunité" aria-modal="true" className="fixed inset-y-0 right-0 z-50 w-full max-w-[600px] space-y-4 overflow-y-auto border-l border-line bg-slate-50 p-3 shadow-2xl sm:p-5" role="dialog"><section className="panel overflow-hidden"><div className="panel-header"><div className="min-w-0"><h2 className="truncate font-semibold">{opportunity.firstName} {opportunity.lastName}</h2><p className="mt-1 truncate text-xs text-muted">{opportunity.companyName || "Entreprise à confirmer"} · {stageLabel(opportunity.stage)}</p></div><Link className="button h-8 min-h-8 w-8 p-0" href={closeHref} scroll={false} aria-label="Fermer"><X size={14} /></Link></div><div className="space-y-3 p-4"><div className="flex flex-wrap gap-2"><span className={stageBadge(opportunity.stage)}>{stageLabel(opportunity.stage)}</span><span className="badge">Probabilité : {opportunity.probability}%</span></div><p className="text-xs text-muted">{opportunity.jobTitle || "Fonction à confirmer"}{opportunity.campaignName ? ` · ${opportunity.campaignName}` : ""}</p>{opportunity.stage === "won" || opportunity.stage === "lost" ? <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-amber-50 p-3 text-xs text-warning"><LockKeyhole className="mt-0.5 shrink-0" size={14} /> Opportunité clôturée et verrouillée. {opportunity.stage === "lost" && opportunity.lostReason ? `Motif : ${opportunity.lostReason}.` : ""}</p> : null}</div></section>

      {canEdit ? <section className="panel"><div className="panel-header"><h3 className="font-semibold">Modifier l’opportunité</h3></div><MutationForm action={update} className="panel-body grid gap-3 sm:grid-cols-2" successMessage="Opportunité mise à jour."><label className="text-xs font-semibold text-muted">Montant<input className="control mt-1 w-full" defaultValue={opportunity.amount ?? ""} min="0" name="amount" step="0.01" type="number" /></label><label className="text-xs font-semibold text-muted">Devise<input className="control mt-1 w-full uppercase" defaultValue={opportunity.currency ?? "EUR"} maxLength={3} name="currency" /></label><label className="text-xs font-semibold text-muted">Probabilité (0–100)<input className="control mt-1 w-full" defaultValue={opportunity.probability} max="100" min="0" name="probability" type="number" /></label><label className="text-xs font-semibold text-muted">Responsable<select className="control mt-1 w-full" defaultValue={opportunity.ownerUserId ?? ""} name="ownerUserId"><option value="">Non attribuée</option>{ownerOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><label className="text-xs font-semibold text-muted sm:col-span-2">Prochaine action<textarea className="control mt-1 min-h-20 w-full" defaultValue={opportunity.nextAction ?? ""} name="nextAction" /></label><label className="text-xs font-semibold text-muted">Clôture estimée<input className="control mt-1 w-full" defaultValue={dateValue(opportunity.expectedCloseDate)} name="expectedCloseDate" type="date" /></label><div className="flex items-end sm:col-span-2"><button className="button button-primary" type="submit"><Save size={14} /> Enregistrer</button></div></MutationForm></section> : null}

      <CalendarBookingsPanel bookings={bookings} canMutate={canEdit} compact workspaceSlug={workspaceSlug} />

      {canEdit ? <section className="panel"><div className="panel-header"><h3 className="font-semibold">Clôturer</h3><span className="text-xs text-muted">Action dédiée auditée</span></div><div className="space-y-4 p-4"><MutationForm action={close} className="space-y-3 border-b border-line pb-4" successMessage="Opportunité gagnée."><input name="stage" type="hidden" value="won" /><p className="text-xs font-semibold text-ink">Gagnée</p><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-muted">Montant requis<input className="control mt-1 w-full" min="0.01" name="amount" required step="0.01" type="number" /></label><label className="text-xs font-semibold text-muted">Devise requise<input className="control mt-1 w-full uppercase" defaultValue={opportunity.currency ?? "EUR"} maxLength={3} name="currency" required /></label></div><label className="block text-xs font-semibold text-muted">Offre / version publiée requise<select className="control mt-1 w-full" name="offerVersionId" required><option value="">Sélectionner une version</option>{offerVersions.map((version) => <option key={version.id} value={version.id}>{version.name} · v{version.version}</option>)}</select></label>{offerVersions.length === 0 ? <p className="text-[11px] text-warning">Aucune version d’offre publiée. Publiez-en une depuis <Link className="font-semibold underline" href={`/w/${workspaceSlug}/offers`}>Offres</Link>.</p> : null}<button className="button button-signal" type="submit">Marquer gagnée</button></MutationForm><MutationForm action={close} className="space-y-3" successMessage="Opportunité perdue."><input name="stage" type="hidden" value="lost" /><p className="text-xs font-semibold text-ink">Perdue</p><label className="block text-xs font-semibold text-muted">Motif requis<select className="control mt-1 w-full" name="lostReason" required><option value="">Sélectionner un motif</option>{lostReasons.map((reason) => <option key={reason.key} value={reason.key}>{reason.label}</option>)}</select></label><label className="block text-xs font-semibold text-muted">Commentaire (facultatif)<textarea className="control mt-1 min-h-16 w-full" name="lostComment" /></label><button className="button" type="submit">Marquer perdue</button></MutationForm></div></section> : null}

      {canReopen ? <section className="panel border-warning/40"><div className="panel-body"><MutationForm action={reopen} confirmation="Rouvrir cette opportunité ? Cette action sera auditée." successMessage="Opportunité rouverte."><button className="button button-primary" type="submit"><RotateCcw size={14} /> Rouvrir l’opportunité</button></MutationForm></div></section> : null}
      {!canEdit && !canReopen ? <p className="panel p-4 text-xs text-muted">Votre rôle peut consulter cette opportunité, mais ne peut pas la modifier.</p> : null}
    </aside></>;
}

function dateValue(value: string | null | undefined): string { return value ? value.slice(0, 10) : ""; }
function stageLabel(stage: string): string { return ({ qualified: "Qualifié", meeting_requested: "RDV demandé", meeting_booked: "RDV réservé", meeting_no_show: "À replanifier", meeting_completed: "RDV terminé", won: "Gagné", lost: "Perdu" } as Record<string, string>)[stage] ?? stage; }
function stageBadge(stage: string): string { return stage === "won" || stage === "meeting_booked" ? "badge badge-success" : stage === "lost" || stage === "meeting_no_show" ? "badge badge-warning" : stage === "meeting_requested" ? "badge badge-signal" : "badge"; }
