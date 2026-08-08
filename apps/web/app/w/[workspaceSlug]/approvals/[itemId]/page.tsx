import Link from "next/link";
import { notFound } from "next/navigation";
import { CrmPermissionState } from "@/components/crm-states";
import { getApprovalItem, listWorkspaces, OutboundApiError } from "@/lib/api";
import { MutationForm } from "../../research/[runId]/report/mutation-form";
import { approveApprovalItemAction, editApprovalItemAction, rejectApprovalItemAction } from "../actions";
import { contentText, StatusBadge } from "../approval-queue";

export const metadata = { title: "Détail approbation" };
export const dynamic = "force-dynamic";

export default async function ApprovalItemPage({ params }: { params: Promise<{ workspaceSlug: string; itemId: string }> }) {
  const { workspaceSlug, itemId } = await params;
  const workspace = (await listWorkspaces()).find((item) => item.slug === workspaceSlug);
  if (!workspace || workspace.role === "viewer") return <CrmPermissionState resource="cet item d’approbation" />;
  let item;
  try {
    item = await getApprovalItem(workspaceSlug, itemId);
  } catch (error) {
    if (error instanceof OutboundApiError && error.status === 404) notFound();
    if (error instanceof OutboundApiError && (error.status === 401 || error.status === 403)) return <CrmPermissionState resource="cet item d’approbation" />;
    throw error;
  }
  const canDecide = ["reviewer", "admin", "owner"].includes(workspace.role);
  const pending = item.status === "pending";
  const editable = pending && canDecide;
  const approve = approveApprovalItemAction.bind(null, workspaceSlug, itemId);
  const reject = rejectApprovalItemAction.bind(null, workspaceSlug, itemId);
  const edit = editApprovalItemAction.bind(null, workspaceSlug, itemId);

  return (
    <>
      <header className="mb-6">
        <Link className="mb-4 inline-flex text-xs font-semibold text-muted" href={`/w/${workspaceSlug}/approvals`}>← Retour à la file</Link>
        <div className="flex flex-wrap items-center gap-3"><h1 className="page-title">Détail de l’approbation</h1><StatusBadge status={item.status} /><span className="badge">{item.itemType} · {item.channel}</span></div>
        <p className="mt-2 text-sm text-muted">{contextLabel(item)}</p>
      </header>

      {item.status === "invalidated" ? <div className="mb-5 rounded-lg border border-warning/40 bg-amber-50 p-4 text-sm text-warning"><strong>Item invalidé — aucune action possible.</strong><p className="mt-1">{invalidationLabel(item.invalidationReason)}</p></div> : null}
      {!canDecide && pending ? <p className="mb-5 rounded-lg border border-warning/30 bg-amber-50 p-3 text-xs text-warning">Lecture seule pour votre rôle. Les décisions sont réservées aux reviewers, admins et owners.</p> : null}

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <ContentPanel label="Contenu original" value={item.contentOriginal} />
        <ContentPanel label="Contenu édité" value={item.contentEdited ?? item.contentOriginal} edited={editable} action={edit} />
      </div>

      {editable ? <section className="panel mt-5"><div className="panel-header"><h2 className="font-semibold">Décision humaine</h2></div><div className="panel-body grid gap-4 md:grid-cols-2">
        <MutationForm action={approve} confirmation="Confirmer l’approbation ? Le contenu édité sera retenu pour la suite." successMessage="Item approuvé."><button className="button button-signal w-full" type="submit">Approuver</button></MutationForm>
        <MutationForm action={reject} confirmation="Confirmer le rejet ? La justification sera conservée dans l’audit." successMessage="Item rejeté."><label className="text-xs font-semibold text-navy">Justification obligatoire<textarea className="control mt-1 min-h-24 w-full" name="justification" placeholder="Expliquez ce rejet…" required /></label><button className="button mt-2 w-full" type="submit">Rejeter</button></MutationForm>
      </div></section> : null}
      {item.rejectionJustification ? <section className="panel mt-5"><div className="panel-header"><h2 className="font-semibold">Justification du rejet</h2></div><div className="panel-body text-sm">{item.rejectionJustification}</div></section> : null}
    </>
  );
}

function ContentPanel({ label, value, edited = false, action }: { label: string; value: unknown; edited?: boolean; action?: (formData: FormData) => Promise<unknown> }) {
  const text = contentText(value);
  return <section className="panel min-w-0"><div className="panel-header"><h2 className="font-semibold">{label}</h2></div><div className="panel-body">{edited && action ? <MutationForm action={action} successMessage="Contenu édité enregistré."><textarea className="control min-h-72 w-full font-mono text-xs" defaultValue={text} name="contentEdited" aria-label={label} /><button className="button mt-3" type="submit">Enregistrer la modification</button><p className="mt-2 text-[11px] text-muted">JSON valide accepté pour conserver la structure ; sinon le texte est envoyé tel quel.</p></MutationForm> : <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-4 text-xs leading-5 text-navy">{text}</pre>}</div></section>;
}

function contextLabel(item: { context: Readonly<Record<string, unknown>>; campaignId: string | null; contactId: string | null }): string {
  const campaign = typeof item.context.campaignName === "string" ? item.context.campaignName : item.campaignId ? `Campagne ${item.campaignId.slice(0, 8)}` : "Sans campagne";
  const contact = typeof item.context.contactName === "string" ? item.context.contactName : item.contactId ? `Contact ${item.contactId.slice(0, 8)}` : "Sans contact";
  return `${campaign} · ${contact}`;
}

function invalidationLabel(reason: string | null): string {
  return ({ contact_deleted: "Le contact a été supprimé.", contact_data_changed: "Les données du contact ont changé depuis la génération.", contact_suppressed: "Une suppression globale est active pour ce contact." } as Record<string, string>)[reason ?? ""] ?? reason ?? "La source de l’item n’est plus valide.";
}
