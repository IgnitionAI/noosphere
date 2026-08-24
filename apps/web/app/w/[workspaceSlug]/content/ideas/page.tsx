import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Clock3, ExternalLink, Lightbulb, Radar, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { getContentIdeaDiscoveryRun, listContentIdeas, type ContentIdeaStatus } from "@/lib/api";
import { IdeasControls } from "./ideas-controls";

export const metadata = { title: "Idées sourcées — Noosphere" };
export const dynamic = "force-dynamic";

type Query = { run?: string; cursor?: string; status?: string };

export default async function ContentIdeasPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string }>; searchParams: Promise<Query> }) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  const status = validStatus(query.status);
  const [ideas, run] = await Promise.all([
    listContentIdeas(workspaceSlug, { ...(query.cursor ? { cursor: query.cursor } : {}), ...(status ? { status } : {}), limit: 25 }),
    query.run ? getContentIdeaDiscoveryRun(workspaceSlug, query.run) : Promise.resolve(null),
  ]);
  const running = run?.status === "queued" || run?.status === "running";
  return <>
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><Link className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-ink" href={`/w/${workspaceSlug}/activity?lens=inbound`}><ArrowLeft size={13} /> Activité Inbound</Link><div className="badge badge-signal mt-3 w-fit"><Radar size={13} /> Radar quotidien</div><h1 className="page-title mt-3">Idées sourcées</h1><p className="mt-2 max-w-2xl text-sm text-muted">Chaque angle conserve ses preuves, sa fraîcheur et son ICP. Ce radar ne rédige et ne publie rien.</p></div>
      <IdeasControls {...(run?.id ? { runId: run.id } : {})} running={running} workspaceSlug={workspaceSlug} />
    </header>

    {run ? <RunStatus run={run} /> : null}

    <nav aria-label="Filtrer les idées" className="mt-4 flex flex-wrap gap-2">
      <Filter href={`/w/${workspaceSlug}/content/ideas${query.run ? `?run=${query.run}` : ""}`} selected={!status}>Toutes</Filter>
      {(["discovered", "shortlisted", "briefed"] as const).map((value) => <Filter href={`/w/${workspaceSlug}/content/ideas?status=${value}${query.run ? `&run=${query.run}` : ""}`} key={value} selected={status === value}>{statusLabel(value)}</Filter>)}
    </nav>

    {ideas.data.length ? <section className="mt-4 grid min-w-0 gap-4 xl:grid-cols-2">{ideas.data.map((idea) => <article className="panel min-w-0 overflow-hidden p-5" key={idea.id}><div className="flex min-w-0 items-start justify-between gap-4"><div className="min-w-0"><div className="flex min-w-0 flex-wrap gap-2"><span className="badge badge-signal">{idea.pillar}</span><span className="badge">{idea.audience}</span></div><h2 className="mt-3 break-words text-lg font-semibold leading-7 text-ink">{idea.angle}</h2></div><strong className="shrink-0 text-xl text-ink">{idea.priority}</strong></div><p className="mt-3 break-words text-sm leading-6 text-muted">{idea.rationale}</p><div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-xs text-muted"><span className="inline-flex items-center gap-1"><Clock3 size={13} /> Frais jusqu’au {formatDate(idea.freshnessUntil)}</span><span className="inline-flex items-center gap-1 font-semibold text-success"><ShieldCheck size={13} /> {idea.sources.length} preuve{idea.sources.length === 1 ? "" : "s"}</span></div><details className="mt-3 min-w-0 overflow-hidden rounded-lg bg-slate-50 p-3"><summary className="flex cursor-pointer text-xs font-semibold text-ink">Voir les preuves résolubles</summary><ul className="mt-3 min-w-0 space-y-3">{idea.sources.map((source) => <li className="min-w-0 break-words text-xs leading-5 text-muted" key={`${source.contentHash}:${source.sourceRef}`}><strong className="block break-words text-ink">{source.title}</strong><span>{source.excerpt}</span>{source.canonicalUrl ? <a className="ml-2 inline-flex items-center gap-1 font-semibold text-signal" href={source.canonicalUrl} rel="noreferrer" target="_blank">Source <ExternalLink size={11} /></a> : <span className="ml-2 badge">{sourceType(source.type)}</span>}</li>)}</ul></details><Link className="button mt-4 w-full justify-center" href={`/w/${workspaceSlug}/content/ideas/${idea.id}`}>Ouvrir et rédiger <ArrowRight size={14} /></Link></article>)}</section> : <section className="panel mt-4 py-16 text-center"><Lightbulb className="mx-auto text-muted" size={30} /><h2 className="mt-4 font-semibold">Aucune idée dans ce filtre</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">Activez d’abord la stratégie, puis lancez le radar. Les résultats apparaissent sans quitter la page.</p></section>}

    {ideas.nextCursor ? <footer className="mt-4 text-center"><Link className="button" href={`/w/${workspaceSlug}/content/ideas?${new URLSearchParams({ ...(status ? { status } : {}), ...(query.run ? { run: query.run } : {}), cursor: ideas.nextCursor }).toString()}`}>Afficher la suite</Link></footer> : null}
  </>;
}

function RunStatus({ run }: { run: NonNullable<Awaited<ReturnType<typeof getContentIdeaDiscoveryRun>>> }) {
  if (run.status === "failed") return <section className="mt-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-950"><AlertTriangle className="mt-0.5" size={17} /><div><strong className="text-sm">Recherche interrompue</strong><p className="mt-1 text-xs">{run.lastErrorMessage ?? "Le worker retentera selon sa politique durable."}</p></div></section>;
  if (run.status === "completed" || run.status === "partial") return <section className="mt-4 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950"><CheckCircle2 className="mt-0.5" size={17} /><div><strong className="text-sm">Recherche {run.status === "partial" ? "partielle" : "terminée"}</strong><p className="mt-1 text-xs">{run.ideaCount} nouvelle{run.ideaCount === 1 ? "" : "s"} idée{run.ideaCount === 1 ? "" : "s"}, {run.sourceCount} source{run.sourceCount === 1 ? "" : "s"} collectée{run.sourceCount === 1 ? "" : "s"}.</p></div></section>;
  return <section className="mt-4 flex items-start gap-3 rounded-xl bg-navy p-4 text-white"><Radar className="mt-0.5 animate-pulse" size={17} /><div className="flex-1"><strong className="text-sm">Recherche en cours</strong><p className="mt-1 text-xs opacity-80">{run.cursor}/{run.queryLimit} requêtes · le job reste durable si vous quittez cette page.</p><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/20"><span className="block h-full bg-lime" style={{ width: `${Math.round(run.cursor / Math.max(1, run.queryLimit) * 100)}%` }} /></div></div></section>;
}
function Filter({ href, selected, children }: { href: string; selected: boolean; children: React.ReactNode }) { return <Link className={selected ? "button button-primary" : "button"} href={href}>{children}</Link>; }
function validStatus(value?: string): ContentIdeaStatus | undefined { return value === "discovered" || value === "shortlisted" || value === "briefed" || value === "discarded" || value === "expired" ? value : undefined; }
function statusLabel(value: ContentIdeaStatus): string { return ({ discovered: "Découvertes", shortlisted: "Prioritaires", briefed: "Briefées", discarded: "Écartées", expired: "Expirées" })[value]; }
function sourceType(value: string): string { return ({ offer_claim: "Claim offre", knowledge_claim: "Connaissance", conversation_message: "Conversation", public_web: "Web" } as Record<string, string>)[value] ?? value; }
function formatDate(value: string): string { return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Paris" }).format(new Date(value)); }
