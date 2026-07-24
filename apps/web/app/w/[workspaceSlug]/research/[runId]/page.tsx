import {
  AlertTriangle,
  Check,
  Circle,
  Clock3,
  LoaderCircle,
  Pause,
  Play,
  RotateCw,
  SearchCheck,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getResearchRun, OutboundApiError } from "@/lib/api";
import { pauseResearch, resumeResearch, startResearch } from "./actions";
import { ProgressRefresh } from "./progress-refresh";

const stageLabels: Record<string, string> = {
  product_analysis: "Comprendre le produit",
  competitor_discovery: "Découvrir les concurrents",
  competitor_analysis: "Analyser le positionnement",
  segment_synthesis: "Identifier les segments",
  icp_synthesis: "Synthétiser les ICP",
  evidence_review: "Auditer les preuves",
};

const statusLabels: Record<string, string> = {
  pending: "À venir",
  queued: "En attente",
  running: "En cours",
  paused: "En pause",
  completed: "Terminé",
};

export const metadata = { title: "Progression de l’étude ICP" };
export const dynamic = "force-dynamic";

export default async function ResearchProgressPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; runId: string }>;
}) {
  const { workspaceSlug, runId } = await params;
  let run;
  try {
    run = await getResearchRun(workspaceSlug, runId);
  } catch (error) {
    if (error instanceof OutboundApiError && error.status === 404) notFound();
    throw error;
  }
  const completed = run.stages.filter((stage) => stage.status === "completed").length;
  const progress = Math.round(
    ((completed + (run.stages.some((stage) => stage.status === "running") ? 0.5 : 0)) /
      run.stages.length) *
      100,
  );
  const isActive = run.status === "queued" || run.status === "running";
  const pause = pauseResearch.bind(null, workspaceSlug, runId);
  const resume = resumeResearch.bind(null, workspaceSlug, runId);
  const start = startResearch.bind(null, workspaceSlug, runId);

  return (
    <>
      <ProgressRefresh active={isActive} />
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="badge badge-signal capitalize">{run.status.replaceAll("_", " ")}</span>
            <span className="font-mono text-[10px] text-muted">{run.id.slice(0, 13)}</span>
          </div>
          <h1 className="page-title">Étude ICP en cours</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Les résultats validés restent disponibles si une source ou une étape échoue.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {run.status === "draft" ? (
            <form action={start}>
              <button className="button button-primary" type="submit">
                <Play size={16} />
                Démarrer
              </button>
            </form>
          ) : run.status === "paused" ? (
            <form action={resume}>
              <button className="button button-primary" type="submit">
                <Play size={16} />
                Reprendre
              </button>
            </form>
          ) : isActive ? (
            <form action={pause}>
              <button className="button" type="submit">
                <Pause size={16} />
                Mettre en pause
              </button>
            </form>
          ) : null}
          <Link className="button" href={`/w/${workspaceSlug}/research/${runId}`}>
            <RotateCw size={16} />
            Actualiser
          </Link>
        </div>
      </header>

      <section className="panel mb-5">
        <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="badge">{run.brief.depth}</span>
              <span className="badge badge-signal">
                {completed} / {run.stages.length} étapes
              </span>
            </div>
            <h2 className="mt-4 text-xl font-semibold">
              {run.brief.productName} · {run.brief.geography}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              {run.brief.description || "Analyse du produit et de son marché cible."}
            </p>
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-200">
              <span
                className="block h-full rounded-full bg-signal transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Étapes terminées" value={String(completed)} />
            <Metric
              label="Tentatives"
              value={String(run.stages.reduce((total, stage) => total + stage.attempts, 0))}
            />
          </div>
        </div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="panel overflow-hidden" aria-live="polite">
          <div className="panel-header">
            <h2 className="font-semibold">Progression</h2>
            {isActive ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                <LoaderCircle className="animate-spin" size={13} />
                Actualisation auto
              </span>
            ) : null}
          </div>
          <div className="p-4">
            {run.stages.map((stage, index) => (
              <div className="relative flex gap-3 pb-5 last:pb-0" key={stage.stage}>
                {index < run.stages.length - 1 ? (
                  <span className="absolute left-[15px] top-8 h-[calc(100%-22px)] w-px bg-line" />
                ) : null}
                <StageIcon status={stage.status} />
                <div className="min-w-0 pt-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm">{stageLabels[stage.stage] ?? stage.stage}</strong>
                    <span className="text-[10px] font-semibold uppercase text-muted">
                      {statusLabels[stage.status]}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {stage.attempts
                      ? `${stage.attempts} tentative${stage.attempts > 1 ? "s" : ""}`
                      : "En attente de lancement"}
                    {stage.lastErrorCode ? ` · ${stage.lastErrorCode}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <div className="space-y-4">
          {run.status === "failed" ? (
            <section className="rounded-xl border border-red-200 bg-red-50 p-5 text-danger">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 flex-none" size={19} />
                <div>
                  <h2 className="font-semibold">La recherche est interrompue</h2>
                  <p className="mt-1 text-xs leading-5">
                    Les checkpoints terminés sont conservés. Consultez le dernier code d’erreur
                    avant de reprendre.
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          <section className="panel">
            <div className="panel-header">
              <h2 className="font-semibold">Résultats partiels</h2>
              <span className="badge">{completed ? "Disponibles" : "En préparation"}</span>
            </div>
            <div className="panel-body">
              {completed ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {run.stages
                    .filter((stage) => stage.status === "completed")
                    .map((stage) => (
                      <article className="rounded-lg border border-line p-4" key={stage.stage}>
                        <SearchCheck className="text-success" size={18} />
                        <strong className="mt-3 block text-sm">
                          {stageLabels[stage.stage] ?? stage.stage}
                        </strong>
                        <p className="mt-1 text-xs leading-5 text-muted">
                          Checkpoint durable validé. Le détail métier sera exposé dans le rapport ICP.
                        </p>
                      </article>
                    ))}
                </div>
              ) : (
                <div className="py-10 text-center">
                  <Clock3 className="mx-auto text-muted" size={24} />
                  <h3 className="mt-3 font-semibold">Le premier checkpoint se prépare</h3>
                  <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-muted">
                    Cette page affichera chaque résultat dès sa validation, sans attendre la fin de
                    toute la mission.
                  </p>
                </div>
              )}
            </div>
          </section>

          <div className="flex flex-col gap-3 rounded-xl border border-signal bg-[#f6ffdf] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <strong>Le livrable ICP apparaîtra ici</strong>
              <p className="mt-1 text-xs text-signal-ink/80">
                Publication et prospection resteront soumises à une validation humaine.
              </p>
            </div>
            <button className="button button-signal cursor-not-allowed" disabled type="button">
              Ouvrir le rapport
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-[10px] border border-line bg-white p-4">
      <div className="mb-2 text-xs text-muted">{label}</div>
      <div className="metric-value">{value}</div>
    </article>
  );
}

function StageIcon({ status }: { status: string }) {
  const className =
    "relative z-10 grid h-8 w-8 flex-none place-items-center rounded-full border border-line bg-white";
  if (status === "completed") {
    return (
      <span className={`${className} text-success`}>
        <Check size={16} />
      </span>
    );
  }
  if (status === "running" || status === "queued") {
    return (
      <span className={`${className} text-brand-blue`}>
        <LoaderCircle className={status === "running" ? "animate-spin" : ""} size={16} />
      </span>
    );
  }
  if (status === "paused") {
    return (
      <span className={`${className} text-warning`}>
        <Pause size={15} />
      </span>
    );
  }
  return (
    <span className={`${className} text-muted`}>
      <Circle size={14} />
    </span>
  );
}
