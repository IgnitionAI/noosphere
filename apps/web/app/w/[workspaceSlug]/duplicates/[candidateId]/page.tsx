import Link from "next/link";
import { notFound } from "next/navigation";
import { CrmPermissionState } from "@/components/crm-states";
import { MutationForm } from "../../research/[runId]/report/mutation-form";
import { getContact, getMergeCandidate, listWorkspaces, OutboundApiError, type ContactDetail } from "@/lib/api";
import { approveMergeCandidateAction, rejectMergeCandidateAction } from "../actions";

export const metadata = { title: "Comparer les doublons" };
export const dynamic = "force-dynamic";

export default async function DuplicateComparePage({ params }: { params: Promise<{ workspaceSlug: string; candidateId: string }> }) {
  const { workspaceSlug, candidateId } = await params;
  let candidate;
  try {
    candidate = await getMergeCandidate(workspaceSlug, candidateId);
  } catch (error) {
    if (error instanceof OutboundApiError && error.status === 404) notFound();
    if (error instanceof OutboundApiError && (error.status === 401 || error.status === 403)) return <CrmPermissionState resource="ce candidat de fusion" />;
    throw error;
  }
  let contacts: ContactDetail[];
  try {
    contacts = await Promise.all([getContact(workspaceSlug, candidate.primaryContactId), getContact(workspaceSlug, candidate.secondaryContactId)]);
  } catch (error) {
    if (error instanceof OutboundApiError && error.status === 404) notFound();
    if (error instanceof OutboundApiError && (error.status === 401 || error.status === 403)) return <CrmPermissionState resource="les fiches à comparer" />;
    throw error;
  }
  const workspace = (await listWorkspaces()).find((item) => item.slug === workspaceSlug);
  const canDecide = workspace ? ["operator", "admin", "owner"].includes(workspace.role) : false;
  const approve = approveMergeCandidateAction.bind(null, workspaceSlug, candidateId);
  const reject = rejectMergeCandidateAction.bind(null, workspaceSlug, candidateId);
  const pending = candidate.status === "pending";

  return (
    <>
      <header className="mb-6">
        <Link className="mb-4 inline-flex text-xs font-semibold text-muted" href={`/w/${workspaceSlug}/duplicates`}>← Retour aux doublons</Link>
        <div className="flex flex-wrap items-center gap-3"><h1 className="page-title">Comparer les contacts</h1><span className={`badge ${candidate.matchType === "certain" ? "badge-danger" : ""}`}>{candidate.matchType === "certain" ? "MATCH CERTAIN" : "MATCH PROBABLE"}</span><span className="badge">{candidate.status}</span></div>
        <p className="mt-2 text-sm text-muted">{signalLabel(candidate)} · la fiche de gauche sera conservée comme contact principal en cas d’approbation.</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2"><ContactComparison contact={contacts[0]!} /><ContactComparison contact={contacts[1]!} /></div>
      {pending && canDecide ? (
        <section className="panel mt-5">
          <div className="panel-header"><h2 className="font-semibold">Décision humaine</h2></div>
          <div className="panel-body grid gap-4 md:grid-cols-2">
            <MutationForm action={approve} confirmation="Confirmer la fusion conservatrice ? La fiche de gauche sera conservée ; l’annulation reste disponible depuis l’historique." successMessage="Fusion approuvée. Vous pouvez consulter l’historique depuis la fiche contact.">
              <button className="button button-signal w-full" type="submit">Approuver et fusionner</button>
            </MutationForm>
            <MutationForm action={reject} confirmation="Rejeter ce candidat ? Cette paire ne sera plus proposée." successMessage="Candidat rejeté et mémorisé.">
              <textarea className="control min-h-20 w-full" name="reason" placeholder="Motif facultatif du rejet" />
              <button className="button mt-2 w-full" type="submit">Rejeter le candidat</button>
            </MutationForm>
          </div>
        </section>
      ) : null}
      {!canDecide && pending ? <p className="mt-5 rounded-lg border border-warning/30 bg-amber-50 p-3 text-xs text-warning">Reviewer/viewer : lecture seule, décision réservée aux operator/admin/owner.</p> : null}
    </>
  );
}

function ContactComparison({ contact }: { contact: ContactDetail }) {
  return (
    <section className="panel min-w-0">
      <div className="panel-header"><div><h2 className="font-semibold">{contact.firstName} {contact.lastName}</h2><p className="text-xs text-muted">Source : {contact.source ?? "—"}</p></div><span className="badge">{contact.status}</span></div>
      <div className="panel-body space-y-4 text-sm">
        <div><h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Identités</h3>{contact.identities.length ? <ul className="mt-2 space-y-1">{contact.identities.map((identity) => <li className="rounded border border-line p-2" key={identity.id}><span className="font-semibold">{identity.type}</span> · {identity.value}<span className="ml-1 text-xs text-muted">({identity.source})</span></li>)}</ul> : <p className="mt-2 text-xs text-muted">Aucune identité</p>}</div>
        <div><h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Emplois</h3>{contact.employments.length ? <ul className="mt-2 space-y-1">{contact.employments.map((employment) => <li className="rounded border border-line p-2" key={employment.id}><span className="font-semibold">{employment.title}</span> · {employment.companyName}<span className="block text-xs text-muted">{employment.startedOn ?? "?"} → {employment.isCurrent ? "aujourd’hui" : employment.endedOn ?? "?"}</span></li>)}</ul> : <p className="mt-2 text-xs text-muted">Aucun emploi</p>}</div>
      </div>
    </section>
  );
}

function signalLabel(candidate: { signals: Readonly<Record<string, unknown>> }): string {
  const identity = candidate.signals.identity;
  return typeof identity === "string" ? `Identité partagée (${identity.split(":")[0]})` : "Nom + entreprise identiques";
}
