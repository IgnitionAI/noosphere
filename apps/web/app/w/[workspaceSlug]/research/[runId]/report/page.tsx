import { ArrowLeft, Check, ExternalLink, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getResearchReport, OutboundApiError } from "@/lib/api";
import { approveProposal, rejectProposal } from "./actions";

export const metadata = { title: "Rapport ICP" };
export const dynamic = "force-dynamic";

export default async function ResearchReportPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; runId: string }>;
}) {
  const { workspaceSlug, runId } = await params;
  let report;
  try {
    report = await getResearchReport(workspaceSlug, runId);
  } catch (error) {
    if (error instanceof OutboundApiError && error.status === 404) notFound();
    throw error;
  }
  const review = object(report.stageOutputs.evidence_review);
  const proposals = report.proposals.map(object);

  return (
    <>
      <header className="mb-6">
        <Link className="mb-4 inline-flex items-center gap-2 text-xs font-semibold text-muted" href={`/w/${workspaceSlug}/research/${runId}`}>
          <ArrowLeft size={14} />
          Retour à la progression
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <span className="badge badge-signal">Revue humaine requise</span>
            <h1 className="page-title mt-3">Rapport ICP · {report.run.brief.productName}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              {text(review.executiveSummary) || "La synthèse finale sera disponible après l’audit des preuves."}
            </p>
          </div>
          <span className="badge">{report.evidence.length} preuves</span>
        </div>
      </header>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <main className="space-y-4">
          <section className="panel">
            <div className="panel-header">
              <h2 className="font-semibold">ICP proposés</h2>
              <span className="badge">{proposals.length}</span>
            </div>
            <div className="panel-body space-y-4">
              {proposals.map((proposal) => {
                const id = text(proposal.id);
                const approve = approveProposal.bind(null, workspaceSlug, runId, id);
                const reject = rejectProposal.bind(null, workspaceSlug, runId, id);
                return (
                  <article className="rounded-xl border border-line p-5" key={id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="badge badge-signal">#{text(proposal.rank)}</span>
                      <h3 className="text-lg font-semibold">{text(proposal.name)}</h3>
                      <span className="badge">{Math.round(number(proposal.confidence) * 100)} %</span>
                      <span className="badge capitalize">{text(proposal.reviewStatus) || "pending"}</span>
                    </div>
                    <Field title="Critères entreprise" value={proposal.criteria} />
                    <List title="Comité d’achat" value={proposal.buyingCommittee} />
                    <List title="Problèmes prioritaires" value={proposal.problems} />
                    <List title="Signaux d’achat" value={proposal.signals} />
                    <List title="Exclusions" value={proposal.exclusions} />
                    <List title="Inconnues" value={proposal.unknowns} />
                    {text(proposal.reviewStatus) === "pending" ? (
                      <div className="mt-5 flex flex-col gap-2 border-t border-line pt-4 sm:flex-row">
                        <form action={approve}>
                          <button className="button button-signal" type="submit">
                            <Check size={15} />
                            Valider cet ICP
                          </button>
                        </form>
                        <form action={reject} className="flex flex-1 gap-2">
                          <input className="control min-w-0 flex-1" name="reason" placeholder="Motif du rejet" required />
                          <button className="button" type="submit">
                            <X size={15} />
                            Rejeter
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2 className="font-semibold">Sources et preuves</h2>
            </div>
            <div className="panel-body grid gap-3 md:grid-cols-2">
              {report.evidence.map((evidence) => (
                <article className="rounded-lg border border-line p-4" key={evidence.id}>
                  <div className="flex items-start justify-between gap-3">
                    <strong className="text-sm">{evidence.title}</strong>
                    <span className="badge">{evidence.sourceType === "public_web" ? "Web" : "Interne"}</span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted">{evidence.excerpt}</p>
                  {evidence.url ? (
                    <a className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-blue" href={evidence.url} rel="noreferrer" target="_blank">
                      Ouvrir la source <ExternalLink size={12} />
                    </a>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        </main>

        <aside className="panel xl:sticky xl:top-20">
          <div className="panel-header">
            <h2 className="font-semibold">Audit des preuves</h2>
            <ShieldCheck className="text-success" size={18} />
          </div>
          <div className="panel-body">
            <List title="Contradictions non résolues" value={review.unresolvedContradictions} />
            <p className="mt-5 text-xs leading-5 text-muted">
              Une validation sélectionne l’ICP de travail. Elle ne lance aucune prospection et ne publie aucune donnée.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}

function Field({ title, value }: { title: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="mt-4">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h4>
      <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-lg bg-canvas p-3 text-xs">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

function List({ title, value }: { title: string; value: unknown }) {
  const items = Array.isArray(value) ? value.map(text).filter(Boolean) : [];
  if (!items.length) return null;
  return (
    <div className="mt-4">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h4>
      <ul className="mt-2 space-y-1 text-sm">
        {items.map((item, index) => <li key={`${item}-${index}`}>• {item}</li>)}
      </ul>
    </div>
  );
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
