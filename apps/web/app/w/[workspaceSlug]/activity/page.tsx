import { AlertTriangle, ArrowRight, CheckCircle2, CircleHelp, Clock3, ExternalLink, Fingerprint, Link2, Radio, Settings2, Sparkles } from "lucide-react";
import Link from "next/link";
import { NoosphereAxis } from "@/components/noosphere-axis";
import { getActivity, listAttributionJourneys, type ActivityWorkspacePage, type AttributionJourney, type AttributionTouch, type NoosphereLens } from "@/lib/api";

export const metadata = { title: "Activité — Noosphere" };
export const dynamic = "force-dynamic";

type Query = { lens?: string; cursor?: string };

export default async function ActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<Query>;
}) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  const lens = validLens(query.lens);
  try {
    const activity = await getActivity(workspaceSlug, lens, query.cursor);
    const journeys = lens === "symbiosis"
      ? await listAttributionJourneys(workspaceSlug, { limit: 10 }).catch(() => null)
      : null;
    return (
      <>
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="badge badge-signal w-fit"><Radio size={13} /> Projection en lecture seule</div>
            <h1 className="page-title mt-3">{titleFor(lens)}</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted">{descriptionFor(lens)}</p>
          </div>
          {lens === "outbound" ? <div className="flex flex-wrap gap-2"><Link className="button" href={`/w/${workspaceSlug}/campaigns`}>Toutes les campagnes</Link><Link className="button button-primary" href={`/w/${workspaceSlug}/strategy/product-reading`}>Lancer un ICP <ArrowRight size={14} /></Link></div> : lens === "inbound" ? <div className="flex flex-wrap gap-2"><Link className="button" href={`/w/${workspaceSlug}/content/calendar`}>Calendrier</Link><Link className="button" href={`/w/${workspaceSlug}/settings`}><Settings2 size={14} /> Configuration</Link></div> : <Link className="button" href={`/w/${workspaceSlug}/attribution`}><Link2 size={14} /> Règles et preuves</Link>}
        </header>

        <NoosphereAxis lens={lens} searchParams={{}} workspaceSlug={workspaceSlug} />

        <section className={statusClass(activity.state)}>
          <div className="flex items-start gap-3"><StatusIcon state={activity.state} /><div><strong className="block text-sm">{statusLabel(activity)}</strong><p className="mt-1 text-xs leading-5 text-inherit opacity-80">{activity.headline}</p></div></div>
          <span className="text-xs opacity-75">{qualityLabel(activity.quality)} · mis à jour {formatTime(activity.asOf)}</span>
        </section>

        <section aria-label="Indicateurs de la lens" className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {activity.counters.map((counter) => <article className="panel p-4" key={counter.key}><p className="text-xs text-muted">{counter.label}</p><strong className="metric-value mt-2 block text-navy">{counter.value}</strong></article>)}
        </section>

        <ActivityContent activity={activity} journeys={journeys?.data ?? null} workspaceSlug={workspaceSlug} />
      </>
    );
  } catch {
    return <ActivityError lens={lens} workspaceSlug={workspaceSlug} />;
  }
}

function ActivityContent({ activity, journeys, workspaceSlug }: { activity: ActivityWorkspacePage; journeys: readonly AttributionJourney[] | null; workspaceSlug: string }) {
  if (activity.state === "not_configured") {
    return (
      <section className="panel mt-4 py-16 text-center">
        <Sparkles className="mx-auto text-muted" size={30} />
        <h2 className="mt-4 font-semibold">{activity.lens === "inbound" ? "Inbound LinkedIn sera le prochain moteur activé" : "La Symbiose attend une première publication observable"}</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted">{activity.lens === "inbound" ? "La stratégie, les idées sourcées, le pipeline éditorial et la publication durable seront installés sans perturber Outbound." : "Dès qu’une interaction pourra être reliée à une identité exacte, le parcours apparaîtra ici. Les campagnes Outbound continuent indépendamment."}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {activity.lens === "inbound" ? <Link className="button button-primary" href={`/w/${workspaceSlug}/content/strategy`}>Préparer la stratégie</Link> : <Link className="button button-primary" href={`/w/${workspaceSlug}/content/calendar`}>Voir les contenus</Link>}
          <Link className="button" href={`/w/${workspaceSlug}/settings`}>Vérifier les prérequis</Link>
        </div>
      </section>
    );
  }
  if (activity.lens === "symbiosis") return <SymbiosisContent activity={activity} journeys={journeys} workspaceSlug={workspaceSlug} />;
  return (
    <section className="panel mt-4 overflow-hidden">
      <div className="panel-header"><div><h2 className="font-semibold">Flux opérationnel</h2><p className="mt-1 text-xs text-muted">Quitter cette page ne change aucun job, lease ou prochaine action.</p></div><span className="badge">{activity.items.length}</span></div>
      {activity.items.length ? <div className="divide-y divide-line">{activity.items.map((item) => (
        <Link className="grid gap-3 p-4 transition hover:bg-slate-50 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center" href={workspaceHref(workspaceSlug, item.href)} key={item.id}>
          <span className={item.status === "attention" ? "h-2.5 w-2.5 rounded-full bg-amber-500" : item.status === "running" ? "h-2.5 w-2.5 rounded-full bg-signal" : "h-2.5 w-2.5 rounded-full bg-slate-300"} />
          <span className="min-w-0"><strong className="block truncate text-sm">{item.title}</strong><span className="mt-1 block truncate text-xs text-muted">{item.detail}</span></span>
          <span className="text-xs font-semibold text-muted">{formatDate(item.occurredAt)}</span>
        </Link>
      ))}</div> : <div className="panel-body py-14 text-center"><CheckCircle2 className="mx-auto text-success" size={28} /><h2 className="mt-3 font-semibold">Aucune activité dans cette projection</h2><p className="mt-2 text-sm text-muted">Le moteur est sain et attend sa prochaine échéance.</p></div>}
      {activity.pagination.nextCursor ? <footer className="border-t border-line p-3 text-right"><Link className="button" href={`/w/${workspaceSlug}/activity?lens=${activity.lens}&cursor=${encodeURIComponent(activity.pagination.nextCursor)}`}>Afficher la suite</Link></footer> : null}
    </section>
  );
}

function SymbiosisContent({ activity, journeys, workspaceSlug }: { activity: ActivityWorkspacePage; journeys: readonly AttributionJourney[] | null; workspaceSlug: string }) {
  if (!activity.items.length) return <section className="panel mt-4 py-16 text-center"><CircleHelp className="mx-auto text-muted" size={30} /><h2 className="mt-4 font-semibold">Pas encore de signal partagé</h2><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted">Inbound et Outbound continuent. Cette vue se remplira lorsqu’une interaction pourra être reliée à une identité ou une conversation.</p><Link className="button button-primary mt-5" href={`/w/${workspaceSlug}/content/calendar`}>Voir les contenus planifiés</Link></section>;
  const journey = journeys?.find((item) => item.resolution !== "excluded") ?? null;
  return <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,.85fr)_minmax(0,1.15fr)]">
    <article className="panel overflow-hidden"><div className="panel-header"><div><h2 className="font-semibold">Signaux prioritaires</h2><p className="mt-1 text-xs text-muted">Les exceptions exactes passent avant les parcours déjà résolus.</p></div><span className="badge">{activity.items.length}</span></div><div className="divide-y divide-line">{activity.items.map((item) => <Link className="block p-4 transition hover:bg-slate-50" href={workspaceHref(workspaceSlug, item.href)} key={item.id}><div className="flex items-start justify-between gap-3"><strong className="text-sm">{item.title}</strong><span className={item.status === "attention" ? "badge badge-warning" : item.status === "running" ? "badge" : item.source === "mixed" ? "badge badge-signal" : "badge badge-success"}>{item.status === "attention" ? "À résoudre" : item.status === "running" ? "En résolution" : item.source === "mixed" ? "Mixte" : "Prouvé"}</span></div><p className="mt-2 text-xs leading-5 text-muted">{item.detail}</p></Link>)}</div>{activity.pagination.nextCursor ? <footer className="border-t border-line p-3 text-right"><Link className="button" href={`/w/${workspaceSlug}/activity?lens=symbiosis&cursor=${encodeURIComponent(activity.pagination.nextCursor)}`}>Afficher la suite</Link></footer> : null}</article>
    <article className="panel overflow-hidden"><div className="panel-header"><div><h2 className="font-semibold">Parcours attribué</h2><p className="mt-1 text-xs text-muted">Chaque lien ouvre une preuve ; une inférence reste signalée comme telle.</p></div>{journey ? <span className={journey.resolution === "resolved" ? "badge badge-success" : "badge badge-warning"}>{journey.resolution === "resolved" ? "Identité résolue" : journey.resolution === "ambiguous" ? "Ambigu" : "Inconnu"}</span> : null}</div>{journey ? <JourneyPreview journey={journey} workspaceSlug={workspaceSlug} /> : <div className="p-8 text-center"><AlertTriangle className="mx-auto text-amber-500" size={26} /><h3 className="mt-3 text-sm font-semibold">Parcours détaillé temporairement indisponible</h3><p className="mt-2 text-xs leading-5 text-muted">Les signaux restent visibles. Aucune activation n’est déduite sans les preuves détaillées.</p></div>}</article>
  </section>;
}

function JourneyPreview({ journey, workspaceSlug }: { journey: AttributionJourney; workspaceSlug: string }) {
  const identity = journey.touches.find((touch) => touch.kind === "identity");
  const conversation = journey.touches.find((touch) => touch.kind === "conversation");
  const booking = journey.touches.find((touch) => touch.kind === "booking");
  const nodes = [
    { label: "Contenu", value: excerpt(journey.source.text, 44), href: journey.source.url, external: Boolean(journey.source.url), certainty: "evidence" as const },
    { label: "Interaction", value: interactionLabel(journey.interaction.type), href: `/attribution?interactionId=${journey.interaction.id}`, external: false, certainty: "evidence" as const },
    { label: "Identité", value: identity?.contactName ?? (journey.resolution === "ambiguous" ? "Ambiguë" : "Inconnue"), href: identity?.proofHref, external: false, certainty: identity?.certainty ?? "unknown" },
    { label: "Conversation", value: conversation?.contactName ? "LinkedIn reliée" : "Non reliée", href: conversation?.proofHref, external: false, certainty: conversation?.certainty ?? "unknown" },
    { label: "Appel", value: booking?.bookingStartAt ? formatDate(booking.bookingStartAt) : "Non observé", href: booking?.proofHref, external: false, certainty: booking?.certainty ?? "unknown" },
  ];
  const asserted = journey.touches.filter((touch) => touch.certainty !== "unknown");
  return <div className="p-5"><div className="grid gap-2 sm:grid-cols-5">{nodes.map((node, index) => <div className="relative min-w-0 rounded-xl bg-slate-50 p-3" key={node.label}><span className="text-[10px] font-bold uppercase tracking-wide text-muted">{node.label}</span><strong className="mt-2 block break-words text-xs text-navy">{node.value}</strong><span className={node.certainty === "evidence" ? "mt-2 inline-flex text-[10px] font-semibold text-success" : node.certainty === "inference" ? "mt-2 inline-flex text-[10px] font-semibold text-amber-700" : "mt-2 inline-flex text-[10px] font-semibold text-muted"}>{node.certainty === "evidence" ? "Preuve" : node.certainty === "inference" ? "Inférence" : "Inconnu"}</span>{node.href ? node.external ? <a aria-label={`Ouvrir la preuve ${node.label}`} className="absolute inset-0 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal" href={node.href} rel="noreferrer" target="_blank" /> : <Link aria-label={`Ouvrir la preuve ${node.label}`} className="absolute inset-0 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal" href={workspaceHref(workspaceSlug, node.href)} /> : null}{index < nodes.length - 1 ? <ArrowRight className="absolute -right-2.5 top-1/2 z-10 hidden -translate-y-1/2 text-muted sm:block" size={13} /> : null}</div>)}</div><div className="mt-4 rounded-xl border-l-4 border-signal bg-lime-50 p-4"><div className="flex items-center gap-2 text-xs font-semibold text-navy"><Fingerprint size={14} /> Pourquoi cette attribution ?</div><p className="mt-2 text-xs leading-5 text-muted">{asserted.length ? asserted.map((touch) => `${touchLabel(touch)} : ${touch.rule} (${Math.round(touch.confidence * 100)} %)`).join(" · ") : "Aucun lien n’est affirmé sans preuve résoluble."}</p><Link className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-signal hover:underline" href={`/w/${workspaceSlug}/attribution?interactionId=${journey.interaction.id}`}>Voir toutes les preuves <ExternalLink size={12} /></Link></div></div>;
}

function ActivityError({ lens, workspaceSlug }: { lens: NoosphereLens; workspaceSlug: string }) {
  return <section className="panel border-red-200 bg-red-50"><div className="panel-body py-14 text-center"><AlertTriangle className="mx-auto text-danger" size={30} /><h1 className="mt-4 text-lg font-semibold">Impossible de charger cette activité</h1><p className="mx-auto mt-2 max-w-lg text-sm text-muted">Les opérations en cours continuent. La lens ne pilote aucune mutation.</p><Link className="button mt-5" href={`/w/${workspaceSlug}/activity?lens=${lens}`}>Réessayer</Link></div></section>;
}

function StatusIcon({ state }: { state: ActivityWorkspacePage["state"] }) {
  if (state === "attention") return <AlertTriangle className="mt-0.5 shrink-0" size={16} />;
  if (state === "active") return <Radio className="mt-0.5 shrink-0" size={16} />;
  return <Clock3 className="mt-0.5 shrink-0" size={16} />;
}

function statusClass(state: ActivityWorkspacePage["state"]): string {
  if (state === "attention") return "flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 sm:flex-row sm:items-center sm:justify-between";
  if (state === "not_configured") return "flex flex-col gap-3 rounded-xl border border-line bg-white p-4 text-navy sm:flex-row sm:items-center sm:justify-between";
  return "flex flex-col gap-3 rounded-xl bg-navy p-4 text-white sm:flex-row sm:items-center sm:justify-between";
}

function statusLabel(activity: ActivityWorkspacePage): string {
  if (activity.state === "not_configured") return "Moteur non configuré";
  if (activity.state === "attention") return "Une exception est localisée";
  if (activity.state === "active") return "Moteur actif";
  return "Moteur en veille";
}

function validLens(value?: string): NoosphereLens {
  return value === "inbound" || value === "outbound" ? value : "symbiosis";
}

function titleFor(lens: NoosphereLens): string {
  if (lens === "inbound") return "Créer la demande";
  if (lens === "outbound") return "Capter la demande";
  return "Transformer les signaux";
}

function descriptionFor(lens: NoosphereLens): string {
  if (lens === "inbound") return "De l’idée sourcée à la conversation, sans contenu générique.";
  if (lens === "outbound") return "Des ICP aux appels, avec chaque campagne et chaque job observables.";
  return "Comprends ce qui crée une conversation avant de décider quoi activer.";
}

function qualityLabel(value: ActivityWorkspacePage["quality"]): string {
  return value === "partial" ? "Données partielles" : value === "stale" ? "Données anciennes" : "Données à jour";
}

function interactionLabel(value: AttributionJourney["interaction"]["type"]): string {
  return ({ comment: "Commentaire", reply: "Réponse", reaction: "Réaction", mention: "Mention" })[value];
}

function touchLabel(touch: AttributionTouch): string {
  return ({ identity: "Identité", conversation: "Conversation", campaign: "Campagne", booking: "Appel", opportunity: "Opportunité" })[touch.kind];
}

function excerpt(value: string, max: number): string { return value.length > max ? `${value.slice(0, max)}…` : value; }

function workspaceHref(workspaceSlug: string, href: string): string {
  if (href.startsWith("/w/")) return href;
  return `/w/${workspaceSlug}${href.startsWith("/") ? href : `/${href}`}`;
}

function formatTime(value: string): string { return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(new Date(value)); }
function formatDate(value: string): string { return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(new Date(value)); }
