import {
  ArrowLeft,
  Check,
  ExternalLink,
  RotateCcw,
  Search,
  Target,
  TriangleAlert,
  UserRoundPlus,
} from "lucide-react";
import Link from "next/link";
import {
  getDiscoveryRun,
  listDiscoveryRuns,
  listIcpVersions,
} from "@/lib/api";
import {
  importCandidateAction,
  launchDiscoveryAction,
  retryDiscoveryAction,
} from "./actions";

export const metadata = { title: "Découverte de prospects" };
export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  running: { label: "en cours", className: "badge badge-signal" },
  completed: { label: "terminé", className: "badge badge-success" },
  failed: { label: "échec récupérable", className: "badge badge-danger" },
};

export default async function DiscoverPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ versionId?: string; runId?: string }>;
}) {
  const { workspaceSlug } = await params;
  const { versionId, runId } = await searchParams;
  const [versions, runs] = await Promise.all([
    listIcpVersions(workspaceSlug),
    listDiscoveryRuns(workspaceSlug, versionId),
  ]);
  const selectedRun = runId ? await getDiscoveryRun(workspaceSlug, runId) : null;

  return (
    <>
      <header className="mb-6">
        <Link
          className="mb-4 inline-flex items-center gap-2 text-xs font-semibold text-muted"
          href={`/w/${workspaceSlug}/prospects`}
        >
          <ArrowLeft size={14} />
          Retour aux prospects
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <span className="badge badge-signal">ICP publié → candidats LinkedIn</span>
            <h1 className="page-title mt-3">Découverte de prospects</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Seule une version ICP publiée peut lancer une recherche. Les filtres envoyés au
              fournisseur sont enregistrés, et chaque candidat montre ses correspondances et
              écarts avant import.
            </p>
          </div>
          <span className="badge">{versions.data.length} version{versions.data.length > 1 ? "s" : ""} publiée{versions.data.length > 1 ? "s" : ""}</span>
        </div>
      </header>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <section className="panel">
            <div className="panel-header">
              <h2 className="flex items-center gap-2 font-semibold">
                <Target size={15} className="text-brand-blue" />
                Versions ICP publiées
              </h2>
            </div>
            <div className="panel-body space-y-3">
              {versions.data.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">
                  Aucune version publiée. Publiez d’abord un ICP depuis un rapport de recherche.
                </p>
              ) : (
                versions.data.map((version) => {
                  const launch = launchDiscoveryAction.bind(null, workspaceSlug, version.id);
                  return (
                    <article
                      className={`rounded-lg border p-4 ${versionId === version.id ? "border-brand-blue" : "border-line"}`}
                      key={version.id}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm">{version.name}</strong>
                        <span className="badge badge-success">v{version.version}</span>
                        <span className="badge">{Math.round(version.confidence * 100)} %</span>
                      </div>
                      <p className="mt-1 text-[11px] text-muted">
                        Publiée le {version.publishedAt.slice(0, 10)} ·{" "}
                        <Link className="text-brand-blue" href={`/w/${workspaceSlug}/research/${version.runId}/report`}>
                          voir le rapport
                        </Link>
                      </p>
                      <form action={launch} className="mt-3 flex items-center gap-2">
                        <input
                          className="control w-24"
                          name="limit"
                          type="number"
                          min={1}
                          max={100}
                          defaultValue={25}
                          aria-label="Nombre de candidats"
                        />
                        <button className="button button-signal" type="submit">
                          <Search size={14} />
                          Lancer la recherche
                        </button>
                        <Link
                          className="button"
                          href={`/w/${workspaceSlug}/prospects/discover?versionId=${version.id}`}
                        >
                          Ses runs
                        </Link>
                      </form>
                    </article>
                  );
                })
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2 className="font-semibold">Runs de découverte{versionId ? " · version filtrée" : ""}</h2>
              <span className="badge">{runs.data.length}</span>
            </div>
            <div className="panel-body space-y-2">
              {runs.data.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted">Aucun run pour le moment.</p>
              ) : (
                runs.data.map((run) => {
                  const badge = STATUS_BADGE[run.status] ?? STATUS_BADGE.running!;
                  const retry = retryDiscoveryAction.bind(null, workspaceSlug, run.id);
                  return (
                    <div className="rounded-lg border border-line p-3" key={run.id}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={badge.className}>{badge.label}</span>
                        <span className="badge">{run.candidateCount} candidats</span>
                        <span className="text-[11px] text-muted">{run.createdAt.slice(0, 16).replace("T", " ")}</span>
                      </div>
                      <p className="mt-1 font-mono text-[11px] text-muted">
                        filtres: {run.filters?.keywords ?? "—"} ({run.filters?.limit ?? "?"} résultats max)
                      </p>
                      {run.status === "failed" ? (
                        <div className="mt-2 rounded-lg border border-warning/30 bg-amber-50 p-2 text-[11px] text-warning">
                          {run.errorCode} — {run.errorMessage}
                        </div>
                      ) : null}
                      <div className="mt-2 flex gap-2">
                        <Link className="button" href={`/w/${workspaceSlug}/prospects/discover?versionId=${run.icpVersionId}&runId=${run.id}`}>
                          Voir les candidats
                        </Link>
                        {run.status === "failed" ? (
                          <form action={retry}>
                            <button className="button" type="submit">
                              <RotateCcw size={13} />
                              Relancer
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>

        <section className="panel">
          <div className="panel-header">
            <h2 className="font-semibold">Candidats</h2>
            {selectedRun ? <span className="badge">{selectedRun.candidates.length}</span> : null}
          </div>
          <div className="panel-body space-y-3">
            {!selectedRun ? (
              <p className="py-6 text-center text-sm text-muted">
                Sélectionnez un run pour prévisualiser ses candidats.
              </p>
            ) : selectedRun.candidates.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">
                {selectedRun.status === "failed"
                  ? "Le fournisseur était indisponible : aucune liste vide trompeuse — relancez le run."
                  : "Aucun candidat retourné par le fournisseur pour ces filtres."}
              </p>
            ) : (
              selectedRun.candidates.map((candidate) => {
                const importAction = importCandidateAction.bind(null, workspaceSlug, selectedRun.id, candidate.id);
                return (
                  <article className="rounded-lg border border-line p-4" key={candidate.id}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <strong className="text-sm">{candidate.fullName}</strong>
                        {candidate.headline ? (
                          <p className="mt-1 text-xs text-muted">{candidate.headline}</p>
                        ) : null}
                        <p className="mt-1 text-[11px] text-muted">
                          {[candidate.companyName, candidate.location].filter(Boolean).join(" · ") || "—"}
                        </p>
                      </div>
                      {candidate.linkedinUrl ? (
                        <a className="badge hover:border-brand-blue" href={candidate.linkedinUrl} rel="noreferrer" target="_blank">
                          LinkedIn <ExternalLink size={10} />
                        </a>
                      ) : null}
                    </div>
                    <div className="mt-3 space-y-1">
                      {candidate.icpFit.matches.map((match) => (
                        <p className="flex items-center gap-2 text-[11px] text-success" key={match}>
                          <Check size={12} /> {match}
                        </p>
                      ))}
                      {candidate.icpFit.gaps.map((gap) => (
                        <p className="flex items-center gap-2 text-[11px] text-warning" key={gap}>
                          <TriangleAlert size={12} /> {gap}
                        </p>
                      ))}
                    </div>
                    <div className="mt-3 border-t border-line pt-3">
                      {candidate.importedContactId ? (
                        <Link className="button" href={`/w/${workspaceSlug}/prospects/${candidate.importedContactId}`}>
                          <Check size={14} />
                          Importé — voir la fiche
                        </Link>
                      ) : (
                        <form action={importAction}>
                          <button className="button button-signal" type="submit">
                            <UserRoundPlus size={14} />
                            Importer dans le CRM
                          </button>
                        </form>
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>
      </div>
    </>
  );
}
