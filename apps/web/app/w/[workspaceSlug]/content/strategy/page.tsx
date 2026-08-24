import { AlertTriangle, ArrowLeft, Bot, BrainCircuit, CheckCircle2, PauseCircle, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { getContentAutopilot, getContentBrandKit, getContentPerformance, getEditorialLearning, getEditorialStrategy, type LinkedinContentFormat } from "@/lib/api";
import { StrategyActions } from "./strategy-actions";
import { AutopilotControls } from "./autopilot-controls";
import { FormatControls } from "./format-controls";

export const metadata = { title: "Stratégie Inbound — Noosphere" };
export const dynamic = "force-dynamic";

export default async function EditorialStrategyPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const [strategy, autopilot, learning, brandKit, performance] = await Promise.all([getEditorialStrategy(workspaceSlug), getContentAutopilot(workspaceSlug), getEditorialLearning(workspaceSlug), getContentBrandKit(workspaceSlug), getContentPerformance(workspaceSlug)]);
  return (
    <>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-ink" href={`/w/${workspaceSlug}/activity?lens=inbound`}><ArrowLeft size={13} /> Activité Inbound</Link>
          <div className="badge badge-signal mt-3 w-fit"><Sparkles size={13} /> Stratégie éditoriale ancrée</div>
          <h1 className="page-title mt-3">Stratégie LinkedIn</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">Noosphere relie l’offre publiée, l’ICP actif et les claims autorisés avant de produire une seule idée.</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          {strategy?.currentVersion ? <Link className="button button-primary w-full sm:w-auto" href={`/w/${workspaceSlug}/content/ideas`}>Ouvrir le radar d’idées</Link> : null}
          <StrategyActions currentVersion={strategy?.currentVersion ?? 0} hasStrategy={Boolean(strategy)} workspaceSlug={workspaceSlug} />
        </div>
      </header>

      {!strategy ? <section className="panel mt-5 py-16 text-center"><AlertTriangle className="mx-auto text-warning" size={30} /><h2 className="mt-4 font-semibold">Aucune stratégie dérivée</h2><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted">Publiez d’abord une offre et un ICP. La dérivation K3 conservera exactement les versions utilisées.</p><div className="mt-5 flex justify-center gap-2"><Link className="button" href={`/w/${workspaceSlug}/settings`}>Vérifier les prérequis</Link></div></section> : (
        <>
          <section className="mt-5 grid gap-3 sm:grid-cols-3">
            <Metric label="Audience" value={strategy.draft.audience.name} />
            <Metric label="Cadence" value={`${autopilot.postsPerWeek} posts / semaine`} />
            <Metric label="Version active" value={strategy.currentVersion ? `v${strategy.currentVersion}` : "Brouillon"} />
          </section>

          <section className={`panel mt-4 p-5 ${autopilot.enabled ? "border-success/30" : "border-warning/40"}`}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-2xl">
                <div className="flex items-center gap-2"><span className={autopilot.enabled ? "badge badge-success" : "badge badge-warning"}>{autopilot.enabled ? <Bot size={13} /> : <PauseCircle size={13} />}{autopilot.enabled ? "Autopilote actif" : "Autopilote en pause"}</span></div>
                <h2 className="mt-3 text-lg font-semibold text-ink">De la recherche à la publication, sans validation manuelle</h2>
                <p className="mt-2 text-sm leading-6 text-muted">Chaque jour, Noosphere recherche des sujets sourcés, sélectionne les meilleurs, rédige, audite les preuves, critique le texte puis planifie LinkedIn selon la cadence. Un contenu bloqué n’arrête pas les autres.</p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted"><span className="badge">{autopilot.queuedIdeas} idées</span><span className="badge">{autopilot.generatingAssets} en rédaction</span><span className="badge">{autopilot.scheduledPublications} planifiées</span>{autopilot.exceptions ? <span className="badge badge-warning">{autopilot.exceptions} exception{autopilot.exceptions === 1 ? "" : "s"}</span> : null}</div>
              </div>
              <div className="w-full shrink-0 lg:w-[420px]"><AutopilotControls enabled={autopilot.enabled} localTime={autopilot.localTime} publicationDays={autopilot.publicationDays} publicationTimes={autopilot.publicationTimes} timezone={autopilot.timezone} workspaceSlug={workspaceSlug} /></div>
            </div>
          </section>

          <section className="panel mt-4 p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><div className="badge badge-signal w-fit"><Sparkles size={13} /> Formats vivants</div><h2 className="mt-3 text-lg font-semibold text-ink">Noosphere choisit le bon support pour chaque idée</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-muted">Texte, image ou carrousel PDF : le même pipeline vérifie les preuves et la qualité avant de rendre puis publier le média.</p></div><Link className="badge hover:border-slate-300" href={`/w/${workspaceSlug}/settings/brand`}>Identité v{brandKit.version} · Modifier</Link></div>
            <FormatControls initial={brandKit.snapshot} workspaceSlug={workspaceSlug} />
            <div className="mt-5 border-t border-line pt-5"><h3 className="text-sm font-semibold text-ink">Performance par format</h3><div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{performance.formats.map((item) => <article className="rounded-xl border border-line bg-white p-4" key={item.format}><p className="text-xs font-semibold text-muted">{formatLabel(item.format)}</p><div className="mt-2 flex items-baseline justify-between gap-3"><strong className="text-xl text-ink">{item.publications}</strong><span className="text-xs text-muted">publication{item.publications === 1 ? "" : "s"}</span></div><p className="mt-2 text-xs text-muted">{item.impressions.toLocaleString("fr-FR")} impressions · {item.engagementRate === null ? "—" : `${item.engagementRate}%`} engagement</p></article>)}</div></div>
          </section>

          <section className="panel mt-4 p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-2xl">
                <div className="badge badge-signal w-fit"><BrainCircuit size={13} /> Apprentissage borné</div>
                <h2 className="mt-3 text-lg font-semibold text-ink">Les réponses orientent les prochains sujets, jamais la policy</h2>
                <p className="mt-2 text-sm leading-6 text-muted">Noosphere sépare les réponses observées des appels seulement attribués. Il peut prioriser un pilier et un angle existants, sans inventer de claim, ajouter un canal, augmenter la cadence ou élargir l’ICP.</p>
              </div>
              {learning ? <div className="flex shrink-0 flex-wrap gap-2"><span className="badge badge-success">v{learning.version}</span><span className="badge">{learning.facts.length} fait{learning.facts.length === 1 ? "" : "s"}</span><span className="badge">{learning.inferences.length} inférence{learning.inferences.length === 1 ? "" : "s"}</span></div> : <span className="badge">En attente de réponses</span>}
            </div>
            {learning?.recommendations.length ? <div className="mt-4 grid gap-3 lg:grid-cols-2">{learning.recommendations.slice(0, 4).map((item) => <article className="rounded-xl border border-line bg-surface-subtle p-4" key={`${item.pillar}:${item.angle}`}><div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-ink">{item.pillar}</h3><span className="badge badge-signal">Score {item.score}</span></div><p className="mt-2 text-sm leading-6 text-muted">{item.angle}</p><div className="mt-3 flex flex-wrap items-center gap-2"><span className="badge">{item.audience}</span><span className="text-xs font-semibold text-ink">{item.rationale}</span></div></article>)}</div> : <p className="mt-4 text-sm text-muted">Une recommandation apparaîtra après une réponse à un contenu ou un appel attribué. Un simple like ne suffit pas.</p>}
          </section>

          <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
              <div className="panel min-w-0 overflow-hidden">
              <div className="panel-header"><div><h2 className="font-semibold">Piliers éditoriaux</h2><p className="mt-1 text-xs text-muted">Chaque promesse indique le type de preuve requis avant rédaction.</p></div><span className="badge">{strategy.draft.pillars.length}</span></div>
              <div className="divide-y divide-line">{strategy.draft.pillars.map((pillar, index) => <article className="p-5" key={pillar.name}><div className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-bold text-white">{index + 1}</span><div><h3 className="font-semibold">{pillar.name}</h3><p className="mt-2 text-sm leading-6 text-muted">{pillar.promise}</p><div className="mt-3 flex flex-wrap gap-2">{pillar.proofTypes.map((proof) => <span className="badge" key={proof}>{proof}</span>)}</div></div></div></article>)}</div>
            </div>

            <div className="space-y-4">
              <section className="panel p-5"><h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="text-success" size={17} /> Contrat de vérité</h2><p className="mt-3 text-sm leading-6 text-muted">{strategy.draft.allowedClaimIds.length} claim{strategy.draft.allowedClaimIds.length === 1 ? "" : "s"} sourcé{strategy.draft.allowedClaimIds.length === 1 ? "" : "s"} ou validé{strategy.draft.allowedClaimIds.length === 1 ? "" : "s"} peuvent être utilisés. Les autres faits restent des opinions explicites.</p><div className="mt-3 flex items-center gap-2 text-xs font-semibold text-success"><CheckCircle2 size={14} /> Claims vérifiés côté serveur</div></section>
              <section className="panel min-w-0 p-5"><h2 className="font-semibold">Voix</h2><div className="mt-3 flex flex-wrap gap-2">{strategy.draft.voice.traits.map((trait) => <span className="badge badge-signal" key={trait}>{trait}</span>)}</div><h3 className="mt-5 text-xs font-bold uppercase tracking-wide text-muted">À éviter</h3><ul className="mt-2 space-y-2 text-sm text-muted">{strategy.draft.voice.avoid.map((item) => <li key={item}>— {item}</li>)}</ul></section>
              <section className="panel p-5"><h2 className="font-semibold">Traçabilité IA</h2><dl className="mt-3 space-y-2 text-xs text-muted"><div className="flex justify-between gap-4"><dt>Provider</dt><dd className="font-semibold text-ink">{strategy.derivation.provider}</dd></div><div className="flex justify-between gap-4"><dt>Modèle</dt><dd className="font-semibold text-ink">{strategy.derivation.model}</dd></div><div className="flex justify-between gap-4"><dt>Prompt</dt><dd className="font-semibold text-ink">{strategy.derivation.promptVersion}</dd></div></dl></section>
            </div>
          </section>
        </>
      )}
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <article className="panel p-4"><p className="text-xs text-muted">{label}</p><strong className="mt-2 block truncate text-lg text-ink">{value}</strong></article>; }
function formatLabel(format: LinkedinContentFormat): string { return { linkedin_text: "Texte", linkedin_image: "Image", linkedin_document: "Carrousel PDF", linkedin_video: "Vidéo" }[format]; }
