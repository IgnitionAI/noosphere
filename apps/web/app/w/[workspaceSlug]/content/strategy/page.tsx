import { AlertTriangle, ArrowLeft, CheckCircle2, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { getEditorialStrategy } from "@/lib/api";
import { StrategyActions } from "./strategy-actions";

export const metadata = { title: "Stratégie Inbound — Noosphere" };
export const dynamic = "force-dynamic";

export default async function EditorialStrategyPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const strategy = await getEditorialStrategy(workspaceSlug);
  return (
    <>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-navy" href={`/w/${workspaceSlug}/activity?lens=inbound`}><ArrowLeft size={13} /> Activité Inbound</Link>
          <div className="badge badge-signal mt-3 w-fit"><Sparkles size={13} /> Stratégie éditoriale ancrée</div>
          <h1 className="page-title mt-3">Stratégie LinkedIn</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">Noosphere relie l’offre publiée, l’ICP actif et les claims autorisés avant de produire une seule idée.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {strategy?.currentVersion ? <Link className="button button-primary" href={`/w/${workspaceSlug}/content/ideas`}>Ouvrir le radar d’idées</Link> : null}
          <StrategyActions currentVersion={strategy?.currentVersion ?? 0} hasStrategy={Boolean(strategy)} workspaceSlug={workspaceSlug} />
        </div>
      </header>

      {!strategy ? <section className="panel mt-5 py-16 text-center"><AlertTriangle className="mx-auto text-warning" size={30} /><h2 className="mt-4 font-semibold">Aucune stratégie dérivée</h2><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted">Publiez d’abord une offre et un ICP. La dérivation K3 conservera exactement les versions utilisées.</p><div className="mt-5 flex justify-center gap-2"><Link className="button" href={`/w/${workspaceSlug}/settings`}>Vérifier les prérequis</Link></div></section> : (
        <>
          <section className="mt-5 grid gap-3 sm:grid-cols-3">
            <Metric label="Audience" value={strategy.draft.audience.name} />
            <Metric label="Cadence" value={`${strategy.draft.cadence.postsPerWeek} posts / semaine`} />
            <Metric label="Version active" value={strategy.currentVersion ? `v${strategy.currentVersion}` : "Brouillon"} />
          </section>

          <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
            <div className="panel overflow-hidden">
              <div className="panel-header"><div><h2 className="font-semibold">Piliers éditoriaux</h2><p className="mt-1 text-xs text-muted">Chaque promesse indique le type de preuve requis avant rédaction.</p></div><span className="badge">{strategy.draft.pillars.length}</span></div>
              <div className="divide-y divide-line">{strategy.draft.pillars.map((pillar, index) => <article className="p-5" key={pillar.name}><div className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-bold text-white">{index + 1}</span><div><h3 className="font-semibold">{pillar.name}</h3><p className="mt-2 text-sm leading-6 text-muted">{pillar.promise}</p><div className="mt-3 flex flex-wrap gap-2">{pillar.proofTypes.map((proof) => <span className="badge" key={proof}>{proof}</span>)}</div></div></div></article>)}</div>
            </div>

            <div className="space-y-4">
              <section className="panel p-5"><h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="text-success" size={17} /> Contrat de vérité</h2><p className="mt-3 text-sm leading-6 text-muted">{strategy.draft.allowedClaimIds.length} claim{strategy.draft.allowedClaimIds.length === 1 ? "" : "s"} sourcé{strategy.draft.allowedClaimIds.length === 1 ? "" : "s"} ou validé{strategy.draft.allowedClaimIds.length === 1 ? "" : "s"} peuvent être utilisés. Les autres faits restent des opinions explicites.</p><div className="mt-3 flex items-center gap-2 text-xs font-semibold text-success"><CheckCircle2 size={14} /> Claims vérifiés côté serveur</div></section>
              <section className="panel p-5"><h2 className="font-semibold">Voix</h2><div className="mt-3 flex flex-wrap gap-2">{strategy.draft.voice.traits.map((trait) => <span className="badge badge-signal" key={trait}>{trait}</span>)}</div><h3 className="mt-5 text-xs font-bold uppercase tracking-wide text-muted">À éviter</h3><ul className="mt-2 space-y-2 text-sm text-muted">{strategy.draft.voice.avoid.map((item) => <li key={item}>— {item}</li>)}</ul></section>
              <section className="panel p-5"><h2 className="font-semibold">Traçabilité IA</h2><dl className="mt-3 space-y-2 text-xs text-muted"><div className="flex justify-between gap-4"><dt>Provider</dt><dd className="font-semibold text-navy">{strategy.derivation.provider}</dd></div><div className="flex justify-between gap-4"><dt>Modèle</dt><dd className="font-semibold text-navy">{strategy.derivation.model}</dd></div><div className="flex justify-between gap-4"><dt>Prompt</dt><dd className="font-semibold text-navy">{strategy.derivation.promptVersion}</dd></div></dl></section>
            </div>
          </section>
        </>
      )}
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <article className="panel p-4"><p className="text-xs text-muted">{label}</p><strong className="mt-2 block truncate text-lg text-navy">{value}</strong></article>; }
