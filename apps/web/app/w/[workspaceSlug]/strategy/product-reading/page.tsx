import { ArrowRight, CircleAlert, Clock3, FileSearch, PauseCircle } from "lucide-react";
import Link from "next/link";
import { listResearchDocuments, listResearchRuns, type ResearchRunSummary } from "@/lib/api";
import { BriefForm } from "./brief-form";
import { loadProductReadingPageState } from "./product-reading-state";

export const metadata = { title: "Trouver mon ICP" };

export default async function ProductReadingPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const [{ runs, historyUnavailable }, documents] = await Promise.all([
    loadProductReadingPageState(() => listResearchRuns(workspaceSlug)),
    listResearchDocuments(workspaceSlug).catch(() => []),
  ]);
  const latestRun = runs[0] ?? null;
  const recoverableRun = runs.find((run) =>
    ["draft", "queued", "running", "paused", "ready_for_review", "completed", "partial", "interrupted"].includes(run.status),
  );
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-2 text-xs font-semibold text-muted">
        <span className="inline-flex items-center gap-2 text-ink">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-navy text-[10px] text-white">
            1
          </span>
          ICP
        </span>
        <span className="h-px w-7 bg-line" />
        <span className="inline-flex items-center gap-2">
          <span className="grid h-5 w-5 place-items-center rounded-full border border-line bg-white text-[10px]">
            2
          </span>
          Campagnes
        </span>
        <span className="h-px w-7 bg-line" />
        <span className="inline-flex items-center gap-2">
          <span className="grid h-5 w-5 place-items-center rounded-full border border-line bg-white text-[10px]">
            3
          </span>
          Rendez-vous
        </span>
      </div>
      <header className="mb-6">
        <h1 className="page-title">Lancer mon ICP</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Décrivez votre produit. L’IA trouve les marchés crédibles, crée les campagnes puis
          prospecte automatiquement jusqu’aux rendez-vous.
        </p>
      </header>
      {historyUnavailable ? (
        <section className="mb-6 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950" role="status">
          <CircleAlert className="mt-0.5 shrink-0" size={18} />
          <div>
            <h2 className="text-sm font-semibold">L’historique ICP est temporairement indisponible</h2>
            <p className="mt-1 text-xs leading-5 text-amber-900">
              Le formulaire reste utilisable. Rechargez plus tard pour retrouver les analyses précédentes.
            </p>
          </div>
        </section>
      ) : null}
      {recoverableRun ? (
        <RecoverableRun workspaceSlug={workspaceSlug} run={recoverableRun} />
      ) : null}
      <BriefForm initialBrief={latestRun?.brief ?? null} initialDocuments={documents} workspaceSlug={workspaceSlug} />
    </>
  );
}

const runStatusLabels: Record<ResearchRunSummary["status"], string> = {
  draft: "Brief enregistré",
  queued: "En attente",
  running: "Recherche en cours",
  paused: "Recherche en pause",
  ready_for_review: "Rapport prêt",
  completed: "Rapport prêt",
  partial: "Rapport partiel prêt",
  interrupted: "Recherche interrompue",
  failed: "Recherche interrompue",
};

function RecoverableRun({
  workspaceSlug,
  run,
}: {
  workspaceSlug: string;
  run: ResearchRunSummary;
}) {
  const reportReady = ["ready_for_review", "completed", "partial"].includes(run.status);
  const href = reportReady
    ? `/w/${workspaceSlug}/research/${run.id}/report`
    : `/w/${workspaceSlug}/research/${run.id}`;
  const StatusIcon = run.status === "paused" ? PauseCircle : reportReady ? FileSearch : Clock3;

  return (
    <section className="mb-6 rounded-xl border border-signal bg-[#f6ffdf] p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-lg bg-signal text-signal-ink">
            <StatusIcon size={19} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="truncate">{run.brief.productName}</strong>
              <span className="badge badge-signal">{runStatusLabels[run.status]}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-signal-ink/80">
              {reportReady
                ? "L’analyse automatique est terminée. Le rapport est disponible à tout moment."
                : "Cette mission continue côté serveur. Vous pouvez quitter cette page et reprendre son suivi à tout moment."}
            </p>
          </div>
        </div>
        <Link className="button button-signal flex-none" href={href}>
          {reportReady ? "Ouvrir le rapport" : "Reprendre le suivi"}
          <ArrowRight size={16} />
        </Link>
      </div>
    </section>
  );
}
