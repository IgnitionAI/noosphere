import { GitMerge, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { CrmEmptyState, CrmPermissionState } from "@/components/crm-states";
import { listMergeCandidates, listWorkspaces, OutboundApiError, type MergeCandidate } from "@/lib/api";

export const metadata = { title: "Doublons" };
export const dynamic = "force-dynamic";

export default async function DuplicatesPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  let candidates: MergeCandidate[];
  try {
    candidates = await listMergeCandidates(workspaceSlug);
  } catch (error) {
    if (error instanceof OutboundApiError && (error.status === 401 || error.status === 403)) return <CrmPermissionState resource="les candidats de fusion" />;
    throw error;
  }
  const workspace = (await listWorkspaces()).find((item) => item.slug === workspaceSlug);
  const canDecide = workspace ? ["operator", "admin", "owner"].includes(workspace.role) : false;
  const certain = candidates.filter((candidate) => candidate.matchType === "certain").length;
  const probable = candidates.length - certain;

  return (
    <>
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="page-title">Doublons à examiner</h1>
          <p className="mt-2 text-sm text-muted">Chaque fusion reste une décision humaine : comparez les fiches avant d’approuver ou rejeter.</p>
        </div>
        <div className="flex flex-wrap gap-2"><span className="badge">{certain} certains</span><span className="badge">{probable} probables</span></div>
      </header>

      {!canDecide ? <p className="mb-5 rounded-lg border border-warning/30 bg-amber-50 p-3 text-xs text-warning">Votre rôle permet la lecture de la file, mais pas la décision d’une fusion.</p> : null}
      <section className="panel">
        <div className="panel-header"><h2 className="flex items-center gap-2 font-semibold"><GitMerge className="text-brand-blue" size={16} /> File de revue</h2></div>
        <div className="panel-body">
          {candidates.length === 0 ? <CrmEmptyState title="Aucun doublon détecté" description="La file de revue est vide pour le moment." /> : (
            <div className="space-y-3">{candidates.map((candidate) => <CandidateCard candidate={candidate} key={candidate.id} workspaceSlug={workspaceSlug} />)}</div>
          )}
        </div>
      </section>
      <p className="mt-4 flex items-start gap-2 text-xs text-muted"><ShieldAlert className="mt-0.5 shrink-0" size={14} /> Les matchs certains partagent une empreinte email/LinkedIn ; les matchs probables combinent nom et entreprise. Le nom seul ne suffit jamais.</p>
    </>
  );
}

function CandidateCard({ candidate, workspaceSlug }: { candidate: MergeCandidate; workspaceSlug: string }) {
  const names = candidate.contacts.map((contact) => `${contact.firstName} ${contact.lastName}`);
  return (
    <Link className="block rounded-lg border border-line p-4 transition hover:border-brand-blue hover:shadow-sm" href={`/w/${workspaceSlug}/duplicates/${candidate.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2"><span className={`badge ${candidate.matchType === "certain" ? "badge-danger" : "badge"}`}>{candidate.matchType === "certain" ? "MATCH CERTAIN" : "MATCH PROBABLE"}</span><span className="text-xs text-muted">{candidate.status === "pending" ? "À décider" : candidate.status}</span></div>
        <span className="text-xs font-semibold text-brand-blue">Comparer →</span>
      </div>
      <h3 className="mt-3 text-base font-semibold text-ink">{names.join(" · ") || "Contacts introuvables"}</h3>
      <p className="mt-1 text-xs text-muted">Signal : {signalLabel(candidate)}</p>
    </Link>
  );
}

function signalLabel(candidate: MergeCandidate): string {
  const identity = candidate.signals.identity;
  if (typeof identity === "string") return `identité partagée (${identity.split(":")[0]})`;
  return "nom + entreprise identiques";
}
