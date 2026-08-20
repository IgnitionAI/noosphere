import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, FileCheck2, PenLine, SearchCheck, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { getContentGenerationRun, getContentIdeaDetail } from "@/lib/api";
import { ContentControls } from "./content-controls";
import { PublicationControl } from "./publication-control";

export const metadata = { title: "Contenu LinkedIn — Noosphere" };
export const dynamic = "force-dynamic";

export default async function ContentIdeaPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string; ideaId: string }>; searchParams: Promise<{ run?: string }> }) {
  const { workspaceSlug, ideaId } = await params;
  const { run: runId } = await searchParams;
  const [detail, run] = await Promise.all([
    getContentIdeaDetail(workspaceSlug, ideaId),
    runId && /^[0-9a-f-]{36}$/i.test(runId) ? getContentGenerationRun(workspaceSlug, runId) : Promise.resolve(null),
  ]);
  const running = run?.status === "queued" || run?.status === "running";
  const latest = detail.asset?.latest;

  return <>
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div><Link className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-navy" href={`/w/${workspaceSlug}/content/ideas`}><ArrowLeft size={13} /> Idées sourcées</Link><div className="badge badge-signal mt-3 w-fit">LinkedIn · texte</div><h1 className="page-title mt-3">{detail.idea.angle}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{detail.idea.rationale}</p></div>
      <div className="w-full max-w-sm"><ContentControls {...(detail.asset?.id ? { assetId: detail.asset.id } : {})} ideaId={ideaId} {...(run?.id ? { runId: run.id } : {})} running={running} workspaceSlug={workspaceSlug} /></div>
    </header>

    {run ? <PipelineStatus run={run} /> : null}

    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,.6fr)]">
      <main className="space-y-5">
        {latest ? <section className="panel overflow-hidden"><div className="panel-header flex items-center justify-between gap-3"><div><h2 className="font-semibold">Version {latest.version}</h2><p className="mt-1 text-xs text-muted">Snapshot éditorial immuable</p></div><span className={latest.readiness.ready ? "badge badge-success" : "badge badge-warning"}>{latest.readiness.ready ? "Prête" : "Bloquée"}</span></div><article className="whitespace-pre-wrap p-6 text-[15px] leading-7 text-navy">{latest.body}</article></section> : <section className="panel py-16 text-center"><PenLine className="mx-auto text-muted" size={30} /><h2 className="mt-4 font-semibold">Aucun contenu rédigé</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">Le pipeline transforme cette idée en brief, rédige, vérifie chaque preuve puis lance une critique indépendante.</p></section>}

        {latest ? <section className="panel"><div className="panel-header"><h2 className="font-semibold">Audit éditorial indépendant</h2><p className="mt-1 text-xs text-muted">La critique ne peut ni réécrire silencieusement le texte, ni publier.</p></div><div className="panel-body space-y-4"><p className="text-sm leading-6 text-muted">{latest.critique.summary}</p>{latest.readiness.blockers.length ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><strong className="text-sm text-amber-950">Blocages</strong><div className="mt-2 flex flex-wrap gap-2">{latest.readiness.blockers.map((blocker) => <span className="badge badge-warning" key={blocker}>{blockerLabel(blocker)}</span>)}</div></div> : <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950"><CheckCircle2 className="mt-0.5" size={17} /><div><strong className="text-sm">Qualité éditoriale validée</strong><p className="mt-1 text-xs">Hook spécifique, CTA aligné et aucune répétition bloquante détectée.</p></div></div>}{latest.critique.issues.length ? <ul className="space-y-2">{latest.critique.issues.map((issue, index) => <li className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-muted" key={`${issue.code}:${index}`}><strong className="text-navy">{issue.code}</strong> · {issue.message}</li>)}</ul> : null}</div></section> : null}
      </main>

      <aside className="space-y-5">
        {latest?.readiness.ready && detail.asset ? <section className="panel"><div className="panel-header"><h2 className="font-semibold">Publication durable</h2><p className="mt-1 text-xs text-muted">Unipile · LinkedIn texte</p></div><div className="panel-body"><PublicationControl assetId={detail.asset.id} workspaceSlug={workspaceSlug} /></div></section> : null}
        <section className="panel"><div className="panel-header"><h2 className="font-semibold">Preuves de l’idée</h2></div><ul className="panel-body space-y-4">{detail.idea.sources.map((source) => <li className="text-xs leading-5 text-muted" key={`${source.contentHash}:${source.sourceRef}`}><strong className="block text-navy">{source.title}</strong>{source.excerpt}{source.canonicalUrl ? <a className="mt-1 inline-flex items-center gap-1 font-semibold text-signal" href={source.canonicalUrl} rel="noreferrer" target="_blank">Ouvrir la source <ExternalLink size={11} /></a> : null}</li>)}</ul></section>
        {latest ? <section className="panel"><div className="panel-header"><h2 className="font-semibold">Registre des faits</h2></div><div className="panel-body space-y-3">{latest.audit.reviewedClaims.length ? latest.audit.reviewedClaims.map((claim, index) => <div className="rounded-lg bg-slate-50 p-3" key={`${claim.statement}:${index}`}><div className="flex items-center gap-2"><FileCheck2 className={claim.verdict === "supported" ? "text-success" : "text-danger"} size={14} /><strong className="text-xs text-navy">{claim.verdict === "supported" ? "Prouvé" : "Non prouvé"}</strong></div><p className="mt-2 text-xs leading-5 text-muted">{claim.statement}</p><p className="mt-2 text-[11px] text-muted">{claim.sourceKeys.join(" · ") || "Aucune preuve"}</p></div>) : <p className="text-xs text-muted">Le texte ne présente aucun fait externe : les analyses sont explicitement des opinions.</p>}</div></section> : null}
      </aside>
    </div>
  </>;
}

function PipelineStatus({ run }: { run: NonNullable<Awaited<ReturnType<typeof getContentGenerationRun>>> }) {
  if (run.status === "failed") return <section className="mt-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-950"><AlertTriangle className="mt-0.5" size={17} /><div><strong className="text-sm">Génération interrompue</strong><p className="mt-1 text-xs">{run.lastErrorMessage ?? "Le worker appliquera sa politique de reprise."}</p></div></section>;
  if (run.status === "ready" || run.status === "blocked") return <section className={`mt-4 flex items-start gap-3 rounded-xl border p-4 ${run.status === "ready" ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-amber-200 bg-amber-50 text-amber-950"}`}>{run.status === "ready" ? <CheckCircle2 className="mt-0.5" size={17} /> : <ShieldAlert className="mt-0.5" size={17} />}<div><strong className="text-sm">Version {run.status === "ready" ? "prête" : "bloquée par la qualité"}</strong><p className="mt-1 text-xs">Le résultat est conservé ; aucune action de publication n’a été créée.</p></div></section>;
  const stages = ["brief", "writer", "audit", "critic"] as const;
  const active = Math.max(0, stages.indexOf(run.stage as typeof stages[number]));
  return <section className="mt-4 rounded-xl bg-navy p-4 text-white"><div className="flex items-center gap-3"><SearchCheck className="animate-pulse" size={17} /><div><strong className="text-sm">Pipeline éditorial en cours</strong><p className="mt-1 text-xs opacity-80">Le job reste durable si vous quittez cette page.</p></div></div><ol className="mt-4 grid grid-cols-4 gap-2 text-[11px]">{stages.map((stage, index) => <li className={index <= active ? "rounded-lg bg-white/20 px-2 py-2 font-semibold" : "rounded-lg bg-white/5 px-2 py-2 opacity-60"} key={stage}>{stageLabel(stage)}</li>)}</ol></section>;
}

function stageLabel(stage: "brief" | "writer" | "audit" | "critic") { return ({ brief: "Brief", writer: "Rédaction", audit: "Preuves", critic: "Critique" })[stage]; }
function blockerLabel(blocker: string) { return ({ unsupported_claim: "Fait non prouvé", unaudited_claim: "Fait non audité", ungrounded_statement: "Phrase non sourcée", forbidden_topic: "Sujet interdit", generic_language: "Langage générique", repetition: "Répétition", cta_misaligned: "CTA hors offre", editorial_blocker: "Critique bloquante" } as Record<string, string>)[blocker] ?? blocker; }
