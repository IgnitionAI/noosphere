import { AlertTriangle, ArrowLeft, Bot, Check, CheckCircle2, Clock3, ExternalLink, FileCheck2, PenLine, SearchCheck, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { getContentAutopilot, getContentGenerationRun, getContentIdeaDetail } from "@/lib/api";
import { ContentControls } from "./content-controls";
import { PublicationControl } from "./publication-control";

export const metadata = { title: "Contenu LinkedIn — Noosphere" };
export const dynamic = "force-dynamic";

export default async function ContentIdeaPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string; ideaId: string }>; searchParams: Promise<{ run?: string }> }) {
  const { workspaceSlug, ideaId } = await params;
  const { run: runId } = await searchParams;
  const [detail, run, autopilot] = await Promise.all([
    getContentIdeaDetail(workspaceSlug, ideaId),
    runId && /^[0-9a-f-]{36}$/i.test(runId) ? getContentGenerationRun(workspaceSlug, runId) : Promise.resolve(null),
    getContentAutopilot(workspaceSlug),
  ]);
  const running = run?.status === "queued" || run?.status === "running";
  const latest = detail.asset?.latest;

  return <>
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div><Link className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-navy" href={`/w/${workspaceSlug}/content/ideas`}><ArrowLeft size={13} /> Idées sourcées</Link><div className="badge badge-signal mt-3 w-fit">LinkedIn · texte</div><h1 className="page-title mt-3">{detail.idea.angle}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{detail.idea.rationale}</p></div>
      {!autopilot.enabled ? <div className="w-full max-w-sm"><ContentControls {...(detail.asset?.id ? { assetId: detail.asset.id } : {})} ideaId={ideaId} {...(run?.id ? { runId: run.id } : {})} running={running} workspaceSlug={workspaceSlug} /></div> : null}
    </header>

    {run ? <PipelineStatus run={run} /> : null}
    <InboundJourney asset={detail.asset} autopilot={autopilot} publication={detail.publication} running={running} workspaceSlug={workspaceSlug} />

    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,.6fr)]">
      <main className="space-y-5">
        {latest ? <section className="panel overflow-hidden"><div className="panel-header flex items-center justify-between gap-3"><div><h2 className="font-semibold">Version {latest.version}</h2><p className="mt-1 text-xs text-muted">Snapshot éditorial immuable</p></div><span className={latest.readiness.ready ? "badge badge-success" : "badge badge-warning"}>{latest.readiness.ready ? "Prête" : "Bloquée"}</span></div><article className="whitespace-pre-wrap p-6 text-[15px] leading-7 text-navy">{latest.body}</article></section> : <section className="panel py-16 text-center"><PenLine className="mx-auto text-muted" size={30} /><h2 className="mt-4 font-semibold">Aucun contenu rédigé</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">Le pipeline transforme cette idée en brief, rédige, vérifie chaque preuve puis lance une critique indépendante.</p></section>}

        {latest ? <details className="panel group"><summary className="panel-header cursor-pointer list-none"><div><h2 className="font-semibold">Pourquoi ce post est prêt</h2><p className="mt-1 text-xs text-muted">Voir l’audit éditorial et les éventuels blocages.</p></div><span className="badge">Détails</span></summary><div className="panel-body space-y-4 border-t border-line"><p className="text-sm leading-6 text-muted">{latest.critique.summary}</p>{latest.readiness.blockers.length ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><strong className="text-sm text-amber-950">Blocages</strong><div className="mt-2 flex flex-wrap gap-2">{latest.readiness.blockers.map((blocker) => <span className="badge badge-warning" key={blocker}>{blockerLabel(blocker)}</span>)}</div></div> : <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950"><CheckCircle2 className="mt-0.5" size={17} /><div><strong className="text-sm">Qualité éditoriale validée</strong><p className="mt-1 text-xs">Hook spécifique, CTA aligné et aucune répétition bloquante détectée.</p></div></div>}{latest.critique.issues.length ? <ul className="space-y-2">{latest.critique.issues.map((issue, index) => <li className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-muted" key={`${issue.code}:${index}`}><strong className="text-navy">{issue.code}</strong> · {issue.message}</li>)}</ul> : null}</div></details> : null}

        {autopilot.enabled && latest ? <details className="panel"><summary className="panel-header cursor-pointer list-none"><div><h2 className="font-semibold">Ajuster ce post</h2><p className="mt-1 text-xs text-muted">Optionnel : créer une nouvelle version sans publier.</p></div><span className="badge">Modifier</span></summary><div className="panel-body border-t border-line"><ContentControls assetId={detail.asset!.id} ideaId={ideaId} {...(run?.id ? { runId: run.id } : {})} running={running} workspaceSlug={workspaceSlug} /></div></details> : null}
      </main>

      <aside className="space-y-5">
        {!autopilot.enabled && latest?.readiness.ready && detail.asset ? <section className="panel"><div className="panel-header"><h2 className="font-semibold">Planifier manuellement</h2><p className="mt-1 text-xs text-muted">Disponible lorsque l’Inbound est en pause.</p></div><div className="panel-body"><PublicationControl assetId={detail.asset.id} workspaceSlug={workspaceSlug} /></div></section> : null}
        <details className="panel"><summary className="panel-header cursor-pointer list-none"><div><h2 className="font-semibold">Sources utilisées</h2><p className="mt-1 text-xs text-muted">{detail.idea.sources.length} preuve{detail.idea.sources.length === 1 ? "" : "s"} vérifiable{detail.idea.sources.length === 1 ? "" : "s"}</p></div><span className="badge">Voir</span></summary><ul className="panel-body space-y-4 border-t border-line">{detail.idea.sources.map((source) => <li className="text-xs leading-5 text-muted" key={`${source.contentHash}:${source.sourceRef}`}><strong className="block text-navy">{source.title}</strong>{source.excerpt}{source.canonicalUrl ? <a className="mt-1 inline-flex items-center gap-1 font-semibold text-signal" href={source.canonicalUrl} rel="noreferrer" target="_blank">Ouvrir la source <ExternalLink size={11} /></a> : null}</li>)}</ul></details>
        {latest ? <details className="panel"><summary className="panel-header cursor-pointer list-none"><div><h2 className="font-semibold">Faits vérifiés</h2><p className="mt-1 text-xs text-muted">Traçabilité du texte</p></div><span className="badge">Voir</span></summary><div className="panel-body space-y-3 border-t border-line">{latest.audit.reviewedClaims.length ? latest.audit.reviewedClaims.map((claim, index) => <div className="rounded-lg bg-slate-50 p-3" key={`${claim.statement}:${index}`}><div className="flex items-center gap-2"><FileCheck2 className={claim.verdict === "supported" ? "text-success" : "text-danger"} size={14} /><strong className="text-xs text-navy">{claim.verdict === "supported" ? "Prouvé" : "Non prouvé"}</strong></div><p className="mt-2 text-xs leading-5 text-muted">{claim.statement}</p><p className="mt-2 text-[11px] text-muted">{claim.sourceKeys.join(" · ") || "Aucune preuve"}</p></div>) : <p className="text-xs text-muted">Le texte ne présente aucun fait externe : les analyses sont explicitement des opinions.</p>}</div></details> : null}
      </aside>
    </div>
  </>;
}

function InboundJourney({ asset, autopilot, publication, running, workspaceSlug }: {
  asset: Awaited<ReturnType<typeof getContentIdeaDetail>>["asset"];
  autopilot: Awaited<ReturnType<typeof getContentAutopilot>>;
  publication: Awaited<ReturnType<typeof getContentIdeaDetail>>["publication"];
  running: boolean;
  workspaceSlug: string;
}) {
  const ready = Boolean(asset?.latest?.readiness.ready);
  const blocked = asset?.status === "blocked";
  const publicationState = publication ? publicationJourney(publication) : null;
  const publicationCopy = publicationState?.copy ?? (autopilot.enabled
    ? ready
      ? "Noosphere choisira automatiquement le prochain créneau prévu par votre cadence."
      : blocked
        ? "Noosphere tente une correction bornée. Ce texte ne sera jamais publié tant qu’il reste bloqué."
        : "Une fois le texte validé, Noosphere choisira automatiquement le prochain créneau."
    : "L’Inbound est en pause : aucune publication automatique ne partira.");
  return <section className={`panel mt-5 p-5 ${autopilot.enabled ? "border-success/30" : "border-warning/40"}`}>
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <div className="flex items-center gap-2"><Bot className={autopilot.enabled ? "text-success" : "text-warning"} size={18} /><h2 className="font-semibold text-navy">Ce que Noosphere fait</h2></div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{publicationCopy}</p>
      </div>
      {publicationState ? <Link className={publicationState.complete ? "badge badge-success shrink-0" : "badge badge-signal shrink-0"} href={`/w/${workspaceSlug}/content/calendar`}>{publicationState.badge}</Link> : !autopilot.enabled ? <Link className="button button-primary shrink-0" href={`/w/${workspaceSlug}/activity?lens=inbound`}>Démarrer l’Inbound</Link> : <span className="badge badge-success shrink-0">Automatique</span>}
    </div>
    <ol className="mt-5 grid gap-2 sm:grid-cols-3">
      <JourneyStep complete label="Idée sélectionnée" />
      <JourneyStep active={running} complete={Boolean(asset?.latest)} label={blocked ? "Correction automatique" : running ? "Rédaction en cours" : asset?.latest ? "Texte rédigé" : "Rédaction à venir"} />
      <JourneyStep active={publicationState?.active ?? (ready && autopilot.enabled)} complete={publicationState?.complete ?? false} label={publicationState?.label ?? (autopilot.enabled ? "Publication selon la cadence" : "Publication en pause")} />
    </ol>
  </section>;
}

function publicationJourney(publication: NonNullable<Awaited<ReturnType<typeof getContentIdeaDetail>>["publication"]>) {
  const planned = formatPublicationDate(publication.scheduledFor);
  if (publication.status === "published") return { active: false, complete: true, badge: "Publié", label: "Publié sur LinkedIn", copy: `Ce post a été publié sur LinkedIn ${publication.publishedAt ? formatPublicationDate(publication.publishedAt) : planned}.` };
  if (publication.status === "scheduled") return { active: true, complete: false, badge: "Planifié", label: `Publication ${planned}`, copy: `Ce post est prêt et sera publié automatiquement sur LinkedIn ${planned}.` };
  if (publication.status === "retry") return { active: true, complete: false, badge: "Nouvelle tentative", label: "Nouvelle tentative prévue", copy: `LinkedIn n’a pas reçu le post. Une nouvelle tentative sûre est prévue ${planned}.` };
  if (publication.status === "publishing") return { active: true, complete: false, badge: "En cours", label: "Publication en cours", copy: "La publication est en cours. Noosphere attend le résultat LinkedIn avant toute autre action." };
  if (publication.status === "unknown") return { active: true, complete: false, badge: "Vérification", label: "Vérification LinkedIn", copy: "Le résultat LinkedIn est incertain. Noosphere vérifie le compte et ne renverra jamais le post en double." };
  if (publication.status === "failed") return { active: false, complete: false, badge: "Non publié", label: "Publication non envoyée", copy: "Ce post n’a pas été publié. La cause est visible dans le calendrier ; aucun renvoi silencieux n’est effectué." };
  return { active: false, complete: false, badge: "Annulé", label: "Publication annulée", copy: "Cette planification a été annulée. Le post reste conservé et ne sera pas envoyé par cette tentative." };
}

function formatPublicationDate(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(value));
}

function JourneyStep({ label, complete = false, active = false }: { label: string; complete?: boolean; active?: boolean }) {
  return <li className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-xs font-semibold ${complete ? "border-emerald-200 bg-emerald-50 text-emerald-950" : active ? "border-sky-200 bg-sky-50 text-sky-950" : "border-line bg-surface-subtle text-muted"}`}>
    {complete ? <Check size={14} /> : <Clock3 className={active ? "animate-pulse" : ""} size={14} />}{label}
  </li>;
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
