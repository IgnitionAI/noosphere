import {
  ArrowLeft,
  Check,
  ExternalLink,
  Link2,
  LoaderCircle,
  RotateCcw,
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
import { DiscoveryRunAutoRefresh } from "./run-auto-refresh";
import { DiscoveryLaunchForm } from "./discovery-launch-form";

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
  const [versions, allRuns] = await Promise.all([
    listIcpVersions(workspaceSlug),
    listDiscoveryRuns(workspaceSlug),
  ]);
  const runs = {
    data: versionId
      ? allRuns.data.filter((run) => run.icpVersionId === versionId)
      : allRuns.data,
  };
  const selectedRun = runId ? await getDiscoveryRun(workspaceSlug, runId) : null;
  const activeRunByVersion = new Map(
    allRuns.data
      .filter((run) => run.status === "running")
      .map((run) => [run.icpVersionId, run]),
  );

  return (
    <>
      <DiscoveryRunAutoRefresh active={allRuns.data.some((run) => run.status === "running")} />
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
            <span className="badge badge-signal">ICP publié → profils LinkedIn</span>
            <h1 className="page-title mt-3">Découverte de prospects</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Seule une version ICP publiée peut lancer cette recherche LinkedIn. Les filtres
              envoyés à Unipile sont enregistrés. Email et WhatsApp utilisent leurs propres
              recherches entreprises depuis les campagnes correspondantes.
            </p>
          </div>
          <span className="badge">{versions.data.length} version{versions.data.length > 1 ? "s" : ""} publiée{versions.data.length > 1 ? "s" : ""}</span>
        </div>
      </header>

      {selectedRun?.status === "running" ? (
        <div
          aria-live="polite"
          className="mb-5 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950"
          data-testid="discovery-progress"
          role="status"
        >
          <LoaderCircle className="mt-0.5 shrink-0 animate-spin text-brand-blue" size={18} />
          <div>
            <strong className="block">Recherche LinkedIn lancée</strong>
            <span className="mt-1 block text-xs leading-5 text-blue-800">
              Unipile recherche jusqu’à {Number(selectedRun.filters?.limit ?? 25)} profils. La page se met à jour automatiquement et vous pouvez la quitter sans perdre le job.
            </span>
          </div>
        </div>
      ) : null}

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
                  const activeRun = activeRunByVersion.get(version.id);
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
                      <DiscoveryLaunchForm
                        action={launch}
                        activeRunHref={activeRun
                          ? `/w/${workspaceSlug}/prospects/discover?versionId=${version.id}&runId=${activeRun.id}`
                          : null}
                        runsHref={`/w/${workspaceSlug}/prospects/discover?versionId=${version.id}`}
                      />
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
                {selectedRun.status === "running"
                  ? "Recherche LinkedIn en cours. Vous pouvez quitter cette page : le job continue en arrière-plan."
                  : selectedRun.status === "failed"
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
                        {candidate.companyWebsite ? (
                          <a
                            className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-blue"
                            href={candidate.companyWebsite}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {candidate.companyDomain ?? "Site de l’entreprise"}
                            <ExternalLink size={10} />
                          </a>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2">
                      <ChannelCard
                        href={candidate.linkedinUrl}
                        icon={<Link2 size={13} />}
                        label="LinkedIn"
                        channel={candidate.channels.linkedin}
                        external
                      />
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

type CandidateChannel = {
  readonly value: string | null;
  readonly status: "verified" | "found" | "unverified" | "unavailable";
  readonly evidenceUrl?: string | null;
  readonly observedAt?: string | null;
};

const CHANNEL_STATUS: Record<CandidateChannel["status"], { label: string; className: string }> = {
  verified: { label: "vérifié", className: "text-success" },
  found: { label: "trouvé", className: "text-brand-blue" },
  unverified: { label: "à vérifier", className: "text-warning" },
  unavailable: { label: "indisponible", className: "text-muted" },
};

function ChannelCard({
  channel,
  href,
  icon,
  label,
  external = false,
}: {
  channel: CandidateChannel;
  href: string | null;
  icon: React.ReactNode;
  label: string;
  external?: boolean;
}) {
  const status = CHANNEL_STATUS[channel.status];
  const className = "min-w-0 rounded-lg border border-line bg-surface-soft p-2.5";
  return (
    <div className={className}>
      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-ink">
        {icon} {label}
      </span>
      {href ? (
        <a
          className="mt-1 block truncate text-[11px] text-ink hover:text-brand-blue"
          href={href}
          rel={external ? "noreferrer" : undefined}
          target={external ? "_blank" : undefined}
        >
          {channel.value}
        </a>
      ) : (
        <span className={`mt-1 block truncate text-[11px] ${channel.value ? "text-ink" : "text-muted"}`}>
          {channel.value ?? "Non trouvé"}
        </span>
      )}
      <span className={`mt-1 block text-[10px] font-semibold ${status.className}`}>
        {status.label}
      </span>
      {channel.evidenceUrl ? (
        <a
          className="mt-1 inline-flex items-center gap-1 text-[10px] text-brand-blue"
          href={channel.evidenceUrl}
          rel="noreferrer"
          target="_blank"
        >
          Voir la preuve <ExternalLink size={9} />
        </a>
      ) : null}
    </div>
  );
}
