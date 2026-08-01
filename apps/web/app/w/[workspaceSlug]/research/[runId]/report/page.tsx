import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ExternalLink,
  FileText,
  Lock,
  PencilLine,
  Search,
  ShieldCheck,
  TriangleAlert,
  UsersRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getResearchReport, listWorkspaces, OutboundApiError } from "@/lib/api";
import {
  approveProposal,
  confirmFinding,
  correctFinding,
  correctProposal,
  publishProposal,
  rejectFinding,
  rejectProposal,
  requestMoreResearch,
} from "./actions";

export const metadata = { title: "Rapport ICP" };
export const dynamic = "force-dynamic";

const REVIEW_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: "À revoir", className: "badge" },
  unreviewed: { label: "À revoir", className: "badge" },
  accepted: { label: "Accepté", className: "badge badge-success" },
  confirmed: { label: "Confirmé", className: "badge badge-success" },
  approved: { label: "Approuvé", className: "badge badge-success" },
  corrected: { label: "Corrigé", className: "badge badge-signal" },
  reworded: { label: "Reformulé", className: "badge badge-signal" },
  hypothesis: { label: "Hypothèse", className: "badge badge-warning" },
  rejected: { label: "Rejeté", className: "badge badge-danger" },
};

export default async function ResearchReportPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; runId: string }>;
}) {
  const { workspaceSlug, runId } = await params;
  let report;
  let role: string = "viewer";
  try {
    [report] = await Promise.all([getResearchReport(workspaceSlug, runId)]);
    const workspaces = await listWorkspaces();
    role = workspaces.find((workspace) => workspace.slug === workspaceSlug)?.role ?? "viewer";
  } catch (error) {
    if (error instanceof OutboundApiError && error.status === 404) notFound();
    throw error;
  }

  const review = object(report.stageOutputs.evidence_review);
  const buyerLandscape = object(report.stageOutputs.buyer_landscape_discovery);
  const buyerSegments = array(buyerLandscape.buyerSegments).map(object);
  const commercialReadiness = object(review.commercialReadiness);
  const proposals = report.proposals.map(object);
  const versions = (report.versions ?? []).map(object);
  const publishedProposalIds = new Set(versions.map((version) => text(version.proposalId)));
  const contradictions = stringArray(review.unresolvedContradictions);
  const allUnknowns = [
    ...new Set([
      ...stringArray(object(report.stageOutputs.product_analysis).unknowns),
      ...proposals.flatMap((proposal) => stringArray(proposal.unknowns)),
    ]),
  ];
  const evidenceById = new Map(report.evidence.map((item) => [item.id, item]));
  const canPublish = ["admin", "owner"].includes(role);
  const canReview = ["operator", "reviewer", "admin", "owner"].includes(role);
  const readyForReview = report.run.status === "ready_for_review";
  const moreResearch = requestMoreResearch.bind(null, workspaceSlug, runId);

  return (
    <>
      <header className="mb-6">
        <Link
          className="mb-4 inline-flex items-center gap-2 text-xs font-semibold text-muted"
          href={`/w/${workspaceSlug}/research/${runId}`}
        >
          <ArrowLeft size={14} />
          Retour à la progression
        </Link>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <span className="badge badge-signal">
              {readyForReview ? "Revue humaine requise" : "Rapport"}
            </span>
            <h1 className="page-title mt-3">Rapport ICP · {report.run.brief.productName}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Proposition produite par le deep agent. Rien n’est publié ni envoyé sans une
              action humaine explicite.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge">{report.evidence.length} preuves</span>
            <span className="badge">{report.competitors.length} concurrents</span>
            <span className="badge">{versions.length} version{versions.length > 1 ? "s" : ""} publiée{versions.length > 1 ? "s" : ""}</span>
          </div>
        </div>
        {readyForReview && canReview ? (
          <details className="panel mt-4">
            <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-semibold">
              <Search size={15} className="text-brand-blue" />
              Demander une recherche complémentaire
            </summary>
            <form action={moreResearch} className="flex flex-col gap-3 border-t border-line p-4 sm:flex-row">
              <select className="control sm:w-64" name="fromStage" defaultValue="competitor_discovery" required>
                <option value="product_analysis">Depuis l’analyse produit</option>
                <option value="competitor_discovery">Depuis la découverte concurrents</option>
                <option value="competitor_analysis">Depuis l’analyse concurrents</option>
                <option value="buyer_landscape_discovery">Depuis les acheteurs</option>
                <option value="segment_synthesis">Depuis les segments</option>
                <option value="icp_synthesis">Depuis les ICP</option>
                <option value="evidence_review">Depuis l’audit des preuves</option>
              </select>
              <input
                className="control min-w-0 flex-1"
                name="reason"
                minLength={10}
                placeholder="Ex. creuser les cabinets d’avocats de 10 à 50 personnes en région parisienne"
                required
              />
              <button className="button" type="submit">Relancer</button>
            </form>
          </details>
        ) : null}
      </header>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <main className="min-w-0 space-y-4">
          <section className="panel" id="synthese">
            <div className="panel-header">
              <h2 className="flex items-center gap-2 font-semibold">
                <FileText size={16} className="text-brand-blue" />
                Synthèse exécutive
              </h2>
            </div>
            <div className="panel-body">
              {text(commercialReadiness.decision) ? (
                <div
                  className={`mb-4 rounded-lg border p-3 text-xs leading-5 ${
                    text(commercialReadiness.decision) === "ready"
                      ? "border-success/40 bg-emerald-50 text-success"
                      : "border-warning/40 bg-amber-50 text-warning"
                  }`}
                >
                  <strong>
                    {text(commercialReadiness.decision) === "ready"
                      ? "ICP prospectables"
                      : "Recherche marché insuffisante"}
                  </strong>
                  <p className="mt-1">{text(commercialReadiness.rationale)}</p>
                </div>
              ) : null}
              <p className="max-w-prose text-sm leading-7">
                {text(review.executiveSummary) ||
                  "La synthèse finale sera disponible après l’audit des preuves."}
              </p>
            </div>
          </section>

          <section className="panel" id="concurrents">
            <div className="panel-header">
              <h2 className="font-semibold">Carte concurrentielle</h2>
              <span className="badge">{report.competitors.length}</span>
            </div>
            <div className="panel-body overflow-x-auto">
              <table className="data-table min-w-[640px]">
                <thead>
                  <tr>
                    <th>Acteur</th>
                    <th>Relation</th>
                    <th>Rationale</th>
                    <th>Confiance</th>
                  </tr>
                </thead>
                <tbody>
                  {report.competitors.map((competitor, index) => (
                    <tr key={text(competitor.id) || index}>
                      <td className="font-semibold">
                        {competitor.url ? (
                          <a
                            className="inline-flex items-center gap-1 text-brand-blue"
                            href={text(competitor.url)}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {text(competitor.name)} <ExternalLink size={11} />
                          </a>
                        ) : (
                          text(competitor.name)
                        )}
                      </td>
                      <td className="capitalize">{text(competitor.relation)}</td>
                      <td className="text-xs leading-5 text-muted">{text(competitor.rationale)}</td>
                      <td>{Math.round(number(competitor.confidence) * 100)} %</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {buyerSegments.length ? (
            <section className="panel" id="acheteurs">
              <div className="panel-header">
                <div>
                  <h2 className="flex items-center gap-2 font-semibold">
                    <UsersRound size={16} className="text-brand-blue" />
                    Paysage des acheteurs
                  </h2>
                  <p className="mt-1 text-xs text-muted">
                    Utilisateurs finaux, partenaires et équipes capables de construire sont séparés.
                  </p>
                </div>
                <span className="badge badge-signal">{buyerSegments.length} segments</span>
              </div>
              <div className="panel-body grid gap-3 lg:grid-cols-2">
                {buyerSegments.map((segment, index) => {
                  const buildVsBuy = object(segment.buildVsBuy);
                  return (
                    <article className="rounded-xl border border-line p-4" key={text(segment.name) || index}>
                      <div className="flex flex-wrap items-center gap-2">
                        <strong>{text(segment.name)}</strong>
                        <span className="badge">{buyerTypeLabel(text(segment.buyerType))}</span>
                        <span className="badge">{Math.round(number(segment.confidence) * 100)} %</span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-muted">{text(segment.description)}</p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <ListCard title="Secteurs" value={segment.industries} />
                        <ListCard title="Workflows récurrents" value={segment.recurringWorkflows} />
                        <ListCard title="Comité d’achat" value={segment.buyingCommittee} />
                        <div className="rounded-lg border border-line p-3 text-xs">
                          <div className="font-semibold">Build vs buy</div>
                          <div className="mt-2 text-muted">
                            Capacité à construire : {Math.round(number(buildVsBuy.buildAbility))}/100
                          </div>
                          <div className="mt-1 text-muted">
                            Volonté d’acheter : {Math.round(number(buildVsBuy.willingnessToBuy))}/100
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section className="panel" id="icp">
            <div className="panel-header">
              <div>
                <h2 className="font-semibold">ICP proposés</h2>
                <p className="mt-1 text-xs text-muted">
                  Classés par cohérence produit et qualité des preuves. Comparez, corrigez,
                  approuvez, puis publiez.
                </p>
              </div>
              <span className="badge badge-signal">{proposals.length} propositions</span>
            </div>
            <div className="panel-body space-y-4">
              {proposals.map((proposal) => {
                const id = text(proposal.id);
                const status = text(proposal.reviewStatus) || "pending";
                const isPublished = publishedProposalIds.has(id);
                const publishedVersion = versions.find(
                  (version) => text(version.proposalId) === id,
                );
                const approve = approveProposal.bind(null, workspaceSlug, runId, id);
                const reject = rejectProposal.bind(null, workspaceSlug, runId, id);
                const correct = correctProposal.bind(null, workspaceSlug, runId, id);
                const publish = publishProposal.bind(null, workspaceSlug, runId, id);
                const proposalCriteria = object(proposal.criteria);
                const scorecard = object(proposalCriteria.scorecard);
                return (
                  <article className="rounded-xl border border-line" key={id}>
                    <div className="flex flex-wrap items-center gap-2 border-b border-line p-5">
                      <span className="badge badge-signal">#{text(proposal.rank)}</span>
                      <h3 className="text-lg font-semibold">{text(proposal.name)}</h3>
                      <span className="badge">{Math.round(number(proposal.confidence) * 100)} %</span>
                      <span className="badge">{buyerTypeLabel(text(proposalCriteria.buyerType))}</span>
                      <span className="badge badge-signal">
                        Score {Math.round(number(scorecard.total))}/100
                      </span>
                      <ReviewBadge status={status} />
                      {proposal.humanEdited ? (
                        <span className="badge badge-signal">
                          <PencilLine size={11} className="mr-1 inline" />
                          Corrigé humainement
                        </span>
                      ) : null}
                      {isPublished ? (
                        <span className="badge badge-success">
                          <Lock size={11} className="mr-1 inline" />
                          Publié · v{text(publishedVersion?.version)}
                        </span>
                      ) : null}
                    </div>
                    <div className="grid gap-4 p-5 lg:grid-cols-2">
                      <CriteriaCard title="Critères entreprise" value={proposal.criteria} />
                      <CriteriaCard title="Plan de sourcing" value={proposalCriteria.prospecting} />
                      <CriteriaCard title="Score de prospectabilité" value={proposalCriteria.scorecard} />
                      <ListCard title="Comité d’achat" value={proposal.buyingCommittee} />
                      <ListCard title="Problèmes prioritaires" value={proposal.problems} />
                      <ListCard title="Signaux d’achat" value={proposal.signals} />
                      <ListCard title="Exclusions" value={proposal.exclusions} />
                      <ListCard title="Inconnues" value={proposal.unknowns} tone="warning" />
                    </div>
                    {canReview && !isPublished ? (
                      <div className="space-y-3 border-t border-line p-5">
                        <details>
                          <summary className="cursor-pointer text-sm font-semibold text-brand-blue">
                            Corriger cette proposition
                          </summary>
                          <form action={correct} className="mt-3 space-y-3">
                            <label className="block text-xs font-semibold text-muted">
                              Nom
                              <input className="control mt-1 w-full" name="name" defaultValue={text(proposal.name)} />
                            </label>
                            <div className="grid gap-3 md:grid-cols-2">
                              <TextareaField label="Comité d’achat (un par ligne)" name="buyingCommittee" value={stringArray(proposal.buyingCommittee)} />
                              <TextareaField label="Problèmes (un par ligne)" name="problems" value={stringArray(proposal.problems)} />
                              <TextareaField label="Signaux (un par ligne)" name="signals" value={stringArray(proposal.signals)} />
                              <TextareaField label="Exclusions (une par ligne)" name="exclusions" value={stringArray(proposal.exclusions)} />
                              <TextareaField label="Inconnues (une par ligne)" name="unknowns" value={stringArray(proposal.unknowns)} />
                              <label className="block text-xs font-semibold text-muted">
                                Critères (JSON)
                                <textarea
                                  className="control mt-1 h-24 w-full font-mono text-xs"
                                  name="criteria"
                                  defaultValue={JSON.stringify(proposal.criteria ?? {}, null, 2)}
                                />
                              </label>
                            </div>
                            <button className="button" type="submit">Enregistrer les corrections</button>
                          </form>
                        </details>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          {status === "pending" ? (
                            <>
                              <form action={approve}>
                                <button className="button button-signal" type="submit">
                                  <Check size={15} />
                                  Approuver
                                </button>
                              </form>
                              <form action={reject} className="flex flex-1 gap-2">
                                <input className="control min-w-0 flex-1" name="reason" placeholder="Motif du rejet" required />
                                <button className="button" type="submit">
                                  <X size={15} />
                                  Rejeter
                                </button>
                              </form>
                            </>
                          ) : null}
                          {status === "approved" && canPublish ? (
                            <form action={publish}>
                              <button className="button button-signal" type="submit">
                                <CheckCircle2 size={15} />
                                Publier en version immuable
                              </button>
                            </form>
                          ) : null}
                          {status === "approved" && !canPublish ? (
                            <p className="text-xs text-muted">
                              Approuvé. La publication est réservée aux admins et owners du workspace.
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>

          <section className="panel" id="findings">
            <div className="panel-header">
              <div>
                <h2 className="font-semibold">Findings et niveau de confiance</h2>
                <p className="mt-1 text-xs text-muted">
                  Chaque affirmation cite une preuve ou porte le badge hypothèse. Une
                  contradiction non résolue bloque le finding à la publication.
                </p>
              </div>
              <span className="badge">{report.findings.length}</span>
            </div>
            <div className="panel-body space-y-3">
              {report.findings.map((finding) => {
                const id = text(finding.id);
                const status = text(finding.reviewStatus) || "unreviewed";
                const confirm = confirmFinding.bind(null, workspaceSlug, runId, id);
                const correctFindingAction = correctFinding.bind(null, workspaceSlug, runId, id);
                const rejectFindingAction = rejectFinding.bind(null, workspaceSlug, runId, id);
                const findingEvidence = stringArray(finding.evidenceIds)
                  .map((evidenceId) => evidenceById.get(evidenceId))
                  .filter((item) => item !== undefined);
                return (
                  <article className="rounded-lg border border-line p-4" key={id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <ReviewBadge status={status} />
                      {finding.hypothesis ? (
                        <span className="badge badge-warning">
                          <TriangleAlert size={11} className="mr-1 inline" />
                          Hypothèse
                        </span>
                      ) : null}
                      {finding.humanEdited ? (
                        <span className="badge badge-signal">
                          <PencilLine size={11} className="mr-1 inline" />
                          Corrigé humainement
                        </span>
                      ) : null}
                      <span className="badge">{Math.round(number(finding.confidence) * 100)} %</span>
                      <span className="badge">{text(finding.stage).replaceAll("_", " ")}</span>
                    </div>
                    <p className="mt-2 text-sm leading-6">{text(finding.statement)}</p>
                    {findingEvidence.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {findingEvidence.map((item) => (
                          <a
                            className="badge hover:border-brand-blue"
                            href={item.url ?? undefined}
                            key={item.id}
                            rel="noreferrer"
                            target="_blank"
                            title={item.title}
                          >
                            {item.sourceType === "public_web" ? "Web" : "Interne"} · {item.title.slice(0, 40)}
                          </a>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-warning">Aucune preuve résoluble — traiter comme hypothèse.</p>
                    )}
                    {canReview && status !== "rejected" ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                        <form action={confirm}>
                          <button className="button" type="submit">
                            <Check size={14} />
                            Confirmer
                          </button>
                        </form>
                        <details className="relative">
                          <summary className="button cursor-pointer list-none">Corriger</summary>
                          <form action={correctFindingAction} className="absolute z-10 mt-2 w-72 space-y-2 rounded-lg border border-line bg-white p-3 shadow-lg">
                            <textarea className="control h-20 w-full text-xs" name="statement" defaultValue={text(finding.statement)} required />
                            <button className="button button-signal w-full" type="submit">Enregistrer</button>
                          </form>
                        </details>
                        <details className="relative">
                          <summary className="button cursor-pointer list-none">Rejeter</summary>
                          <form action={rejectFindingAction} className="absolute z-10 mt-2 w-72 space-y-2 rounded-lg border border-line bg-white p-3 shadow-lg">
                            <input className="control w-full text-xs" name="reason" placeholder="Motif (contradiction, source faible…)" />
                            <button className="button w-full" type="submit">Rejeter le finding</button>
                          </form>
                        </details>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        </main>

        <aside className="min-w-0 space-y-4 xl:sticky xl:top-20">
          {versions.length ? (
            <section className="panel border-success">
              <div className="panel-header">
                <h2 className="flex items-center gap-2 font-semibold">
                  <Lock size={15} className="text-success" />
                  Versions publiées
                </h2>
              </div>
              <div className="panel-body space-y-3">
                {versions.map((version) => (
                  <article className="rounded-lg border border-line p-3" key={text(version.id)}>
                    <div className="flex items-center justify-between gap-2">
                      <strong className="text-sm">{text(version.name)}</strong>
                      <span className="badge badge-success">v{text(version.version)}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      Immuable · publiée le {text(version.publishedAt).slice(0, 10)}
                    </p>
                    {stringArray(version.unknowns).length ? (
                      <p className="mt-2 text-xs text-warning">
                        Inconnues maintenues : {stringArray(version.unknowns).join(" · ")}
                      </p>
                    ) : null}
                    {Array.isArray(version.blockedFindings) && version.blockedFindings.length ? (
                      <p className="mt-1 text-xs text-muted">
                        {version.blockedFindings.length} finding{version.blockedFindings.length > 1 ? "s" : ""} bloqué{version.blockedFindings.length > 1 ? "s" : ""} (contradiction non résolue)
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <section className="panel">
            <div className="panel-header">
              <h2 className="flex items-center gap-2 font-semibold">
                <ShieldCheck size={16} className="text-success" />
                Preuves
              </h2>
              <span className="badge">{report.evidence.length}</span>
            </div>
            <div className="panel-body max-h-[480px] space-y-2 overflow-y-auto">
              {report.evidence.map((item) => (
                <article className="rounded-lg border border-line p-3" key={item.id}>
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-xs">{item.title}</strong>
                    <span className="badge">{item.sourceType === "public_web" ? "Web public" : "Document fourni"}</span>
                  </div>
                  <p className="mt-2 text-[11px] leading-5 text-muted">{item.excerpt}</p>
                  {item.url ? (
                    <a className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-blue" href={item.url} rel="noreferrer" target="_blank">
                      Ouvrir la source <ExternalLink size={11} />
                    </a>
                  ) : null}
                </article>
              ))}
            </div>
          </section>

          {contradictions.length ? (
            <section className="panel border-warning">
              <div className="panel-header">
                <h2 className="flex items-center gap-2 font-semibold">
                  <TriangleAlert size={15} className="text-warning" />
                  Contradictions non résolues
                </h2>
              </div>
              <div className="panel-body">
                <ul className="space-y-2 text-xs leading-5">
                  {contradictions.map((item) => (
                    <li key={item}>• {item}</li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}

          <section className="panel">
            <div className="panel-header">
              <h2 className="font-semibold">Inconnues à valider</h2>
              <span className="badge badge-warning">{allUnknowns.length}</span>
            </div>
            <div className="panel-body">
              <ul className="space-y-2 text-xs leading-5">
                {allUnknowns.map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
              <p className="mt-3 rounded-lg border border-warning/30 bg-amber-50 p-3 text-[11px] leading-5 text-warning">
                Ces inconnues se valident par des conversations marché, pas en les complétant
                automatiquement. Elles restent visibles après publication.
              </p>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

function ReviewBadge({ status }: { status: string }) {
  const badge = REVIEW_BADGE[status] ?? { label: status, className: "badge" };
  return <span className={badge.className}>{badge.label}</span>;
}

function CriteriaCard({ title, value }: { title: string; value: unknown }) {
  const entries = objectEntries(value);
  if (!entries.length) return null;
  return (
    <div className="rounded-lg border border-line p-4">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h4>
      <dl className="mt-2 space-y-1">
        {entries.map(([key, entryValue]) => (
          <div className="flex items-baseline justify-between gap-3 text-xs" key={key}>
            <dt className="text-muted">{key}</dt>
            <dd className="font-semibold">{formatValue(entryValue)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ListCard({
  title,
  value,
  tone,
}: {
  title: string;
  value: unknown;
  tone?: "warning";
}) {
  const items = stringArray(value);
  if (!items.length) return null;
  return (
    <div className={`rounded-lg border p-4 ${tone === "warning" ? "border-warning/40" : "border-line"}`}>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h4>
      <ul className="mt-2 space-y-1 text-xs leading-5">
        {items.map((item) => (
          <li key={item}>• {item}</li>
        ))}
      </ul>
    </div>
  );
}

function TextareaField({
  label,
  name,
  value,
}: {
  label: string;
  name: string;
  value: readonly string[];
}) {
  return (
    <label className="block text-xs font-semibold text-muted">
      {label}
      <textarea
        className="control mt-1 h-24 w-full text-xs"
        name={name}
        defaultValue={value.join("\n")}
      />
    </label>
  );
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function buyerTypeLabel(value: string): string {
  if (value === "end_customer") return "Client final";
  if (value === "channel_partner") return "Partenaire";
  if (value === "internal_builder") return "Équipe interne";
  return "Acheteur à qualifier";
}

function objectEntries(value: unknown): [string, unknown][] {
  return Object.entries(object(value));
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(formatValue).join(", ");
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => `${key}: ${formatValue(entry)}`)
      .join(" – ");
  }
  return String(value ?? "");
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}
