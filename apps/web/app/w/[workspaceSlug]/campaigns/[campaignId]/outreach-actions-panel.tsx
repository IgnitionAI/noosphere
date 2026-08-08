import Link from "next/link";
import { Clock3, Mail, PauseCircle, RefreshCw, Send, ShieldAlert } from "lucide-react";
import type { OutreachAction } from "@/lib/api";
import { MutationForm } from "../../research/[runId]/report/mutation-form";
import { cancelOutreachActionAction, retryOutreachActionAction } from "../actions";
import { ActionsRefresh } from "./actions-refresh";

const STATUS: Record<OutreachAction["status"], { label: string; className: string }> = {
  planned: { label: "Planifiée", className: "badge" },
  awaiting_approval: { label: "En attente d’approbation", className: "badge badge-warning" },
  due: { label: "À envoyer", className: "badge badge-warning" },
  sending: { label: "En cours d’envoi", className: "badge badge-warning" },
  sent: { label: "Exécutée", className: "badge badge-success" },
  failed: { label: "Échec", className: "badge badge-danger" },
  cancelled: { label: "Annulée", className: "badge" },
  suspended: { label: "Suspendue", className: "badge badge-warning" },
};

export function OutreachActionsPanel({
  workspaceSlug,
  campaignId,
  actions,
  canMutate,
}: {
  workspaceSlug: string;
  campaignId: string;
  actions: readonly OutreachAction[];
  canMutate: boolean;
}) {
  const active = actions.some((action) => ["planned", "due", "sending", "awaiting_approval", "suspended"].includes(action.status));
  return (
    <section className="panel mt-5" id="actions">
      <div className="panel-header flex-wrap gap-2"><div><h2 className="flex items-center gap-2 font-semibold"><Send className="text-brand-blue" size={16} /> Actions</h2><p className="mt-1 text-xs text-muted">Timeline des envois issus du snapshot de séquence.</p></div><span className="badge">{actions.length}</span></div>
      <div className="panel-body space-y-4">
        <ActionsRefresh active={active} />
        {actions.length === 0 ? <div className="rounded-lg border border-dashed border-line p-6 text-center"><Clock3 className="mx-auto text-muted" size={20} /><p className="mt-2 text-sm font-semibold text-navy">Aucune action planifiée</p><p className="mt-1 text-xs text-muted">Les actions apparaîtront après l’enrôlement des contacts.</p></div> : <div className="space-y-3">{actions.map((action) => <ActionRow action={action} canMutate={canMutate} campaignId={campaignId} key={action.id} workspaceSlug={workspaceSlug} />)}</div>}
      </div>
    </section>
  );
}

function ActionRow({ action, workspaceSlug, campaignId, canMutate }: { action: OutreachAction; workspaceSlug: string; campaignId: string; canMutate: boolean }) {
  const status = STATUS[action.status];
  const cancelable = canMutate && !["sent", "cancelled"].includes(action.status);
  const retryable = canMutate && ["failed", "suspended"].includes(action.status);
  const cancel = cancelOutreachActionAction.bind(null, workspaceSlug, campaignId, action.id);
  const retry = retryOutreachActionAction.bind(null, workspaceSlug, campaignId, action.id);
  return (
    <article className="relative rounded-lg border border-line p-4">
      <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-start">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-navy"><Mail size={16} /></div>
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className={status.className}>{status.label}</span><span className="badge">Étape {action.stepPosition} · {action.channel}</span><span className="text-xs text-muted">{action.recipient}</span></div><p className="mt-2 truncate text-sm font-semibold text-navy">{action.subject || "Message sans objet"}</p><div className="mt-2 grid gap-1 text-xs text-muted sm:grid-cols-2"><span>Contact <code className="font-mono">{shortId(action.contactId)}</code></span><span>Prévue le {formatDate(action.scheduledAt)}</span><span>Tentatives {action.attemptCount}/{action.maxAttempts}</span>{action.nextAttemptAt ? <span>Prochaine tentative {formatDate(action.nextAttemptAt)}</span> : null}</div>{action.lastErrorCode ? <Reason action={action} /> : null}{action.approvalItemId && action.status === "awaiting_approval" ? <Link className="mt-2 inline-flex text-xs font-semibold text-brand-blue" href={`/w/${workspaceSlug}/approvals/${action.approvalItemId}`}>Voir l’approbation requise →</Link> : null}</div>
        <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">{cancelable ? <MutationForm action={cancel} confirmation="Annuler cette action ? Elle ne sera plus envoyée." successMessage="Action annulée."><button className="button" type="submit"><PauseCircle size={14} /> Annuler</button></MutationForm> : null}{retryable ? <MutationForm action={retry} confirmation="Relancer cette action ? Le scheduler recalculera sa prochaine tentative." successMessage="Action remise en file."><button className="button button-signal" type="submit"><RefreshCw size={14} /> Relancer</button></MutationForm> : null}</div>
      </div>
    </article>
  );
}

function Reason({ action }: { action: OutreachAction }) {
  const accountIssue = action.status === "suspended" && ["ACCOUNT_UNAVAILABLE", "PROVIDER_NOT_CONFIGURED"].includes(action.lastErrorCode ?? "");
  return <p className={`mt-2 flex items-start gap-1 text-xs ${accountIssue ? "text-warning" : "text-muted"}`}><ShieldAlert className="mt-0.5 shrink-0" size={13} />{accountIssue ? "Compte d’envoi indisponible : action suspendue isolément." : `${action.lastErrorCode}: ${action.lastErrorMessage ?? "raison non précisée"}`}</p>;
}

function shortId(value: string): string { return value.slice(0, 8); }
function formatDate(value: string): string { return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
