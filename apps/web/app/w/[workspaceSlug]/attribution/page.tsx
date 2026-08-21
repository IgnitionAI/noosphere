import { ArrowLeft, ArrowRight, CircleHelp, ExternalLink, Fingerprint, Link2, PhoneCall } from "lucide-react";
import Link from "next/link";
import { listAttributionJourneys, type AttributionJourney, type AttributionTouch } from "@/lib/api";

export const metadata = { title: "Attribution — Noosphere" };
export const dynamic = "force-dynamic";

export default async function AttributionPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string }>; searchParams: Promise<{ cursor?: string; interactionId?: string; bookingId?: string }> }) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  const journeys = await listAttributionJourneys(workspaceSlug, query);
  return <>
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><Link className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-navy" href={`/w/${workspaceSlug}/activity?lens=symbiosis`}><ArrowLeft size={13} /> Activité Symbiose</Link><div className="badge badge-signal mt-3 w-fit"><Link2 size={13} /> Preuves et inférences</div><h1 className="page-title mt-3">Parcours attribués</h1><p className="mt-2 max-w-2xl text-sm text-muted">Du contenu à l’appel, chaque lien affiche sa règle. Une proximité temporelle reste une corrélation, jamais une causalité certaine.</p></div><Link className="button" href={`/w/${workspaceSlug}/content/calendar`}>Voir les engagements</Link></header>
    {journeys.data.length ? <section className="mt-5 space-y-4">{journeys.data.map((journey) => <JourneyCard journey={journey} key={journey.interaction.id} workspaceSlug={workspaceSlug} />)}</section> : <section className="panel mt-5 py-16 text-center"><CircleHelp className="mx-auto text-muted" size={30} /><h2 className="mt-4 font-semibold">Aucun parcours attribuable</h2><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted">Les interactions sans identité exacte resteront visibles comme inconnues. Noosphere ne fusionne jamais un contact à partir de son nom ou de son titre.</p></section>}
    {journeys.nextCursor ? <footer className="mt-4 text-right"><Link className="button" href={`/w/${workspaceSlug}/attribution?cursor=${encodeURIComponent(journeys.nextCursor)}`}>Afficher la suite</Link></footer> : null}
  </>;
}

function JourneyCard({ journey, workspaceSlug }: { readonly journey: AttributionJourney; readonly workspaceSlug: string }) {
  const identity = journey.touches.find((touch) => touch.kind === "identity");
  const destinations = journey.touches.filter((touch) => touch.kind !== "identity");
  return <article className="panel overflow-hidden"><div className="border-b border-line p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><span className={resolutionClass(journey.resolution)}>{resolutionLabel(journey.resolution)}</span><strong className="text-sm text-navy">{journey.interaction.actorName ?? "Identité LinkedIn inconnue"}</strong><span className="text-xs text-muted">{interactionLabel(journey.interaction.type)}</span></div><p className="mt-3 text-sm leading-6 text-navy">{journey.interaction.body ?? journey.interaction.reaction ?? "Interaction observée"}</p><p className="mt-2 line-clamp-2 text-xs text-muted">Sur « {journey.source.text} »</p></div>{journey.source.url ? <a className="button shrink-0" href={journey.source.url} rel="noreferrer" target="_blank">Preuve source <ExternalLink size={13} /></a> : null}</div></div>
    <div className="p-5"><div className="flex flex-wrap items-center gap-2 text-xs"><Fingerprint size={14} className="text-signal" /><strong>{identity?.rule ?? "Résolution en attente"}</strong><span className="badge">confiance {Math.round((identity?.confidence ?? 0) * 100)} %</span>{identity?.proofHref ? <Link className="font-semibold text-signal hover:underline" href={workspaceHref(workspaceSlug, identity.proofHref)}>Ouvrir la preuve</Link> : null}</div>
      {destinations.length ? <div className="mt-5 grid gap-3 lg:grid-cols-2">{destinations.map((touch) => <TouchCard key={touch.id} touch={touch} workspaceSlug={workspaceSlug} />)}</div> : <div className="mt-5 rounded-xl border border-dashed border-line p-4 text-sm text-muted">Aucune conversation ni appel relié. Le parcours reste explicitement incomplet.</div>}
    </div></article>;
}

function TouchCard({ touch, workspaceSlug }: { readonly touch: AttributionTouch; readonly workspaceSlug: string }) {
  return <div className="rounded-xl border border-line p-4"><div className="flex items-start justify-between gap-3"><div><span className={touch.certainty === "evidence" ? "badge badge-success" : touch.certainty === "inference" ? "badge badge-warning" : "badge"}>{touch.certainty === "evidence" ? "Preuve" : touch.certainty === "inference" ? "Inférence" : "Inconnu"}</span><h3 className="mt-2 text-sm font-semibold text-navy">{touchTitle(touch)}</h3></div>{touch.kind === "booking" ? <PhoneCall size={16} className="text-signal" /> : <ArrowRight size={16} className="text-muted" />}</div><p className="mt-2 text-xs leading-5 text-muted">{touch.rule} · confiance {Math.round(touch.confidence * 100)} %{touch.position ? ` · ${positionLabel(touch.position)}` : ""}</p>{touch.proofHref ? <Link className="mt-3 inline-flex text-xs font-semibold text-signal hover:underline" href={workspaceHref(workspaceSlug, touch.proofHref)}>Ouvrir la preuve</Link> : null}</div>;
}

function touchTitle(touch: AttributionTouch): string { if (touch.kind === "conversation") return `Conversation ${touch.contactName ?? "LinkedIn"}`; if (touch.kind === "campaign") return touch.campaignName ?? "Campagne associée"; if (touch.kind === "booking") return touch.bookingStartAt ? `Appel du ${formatDate(touch.bookingStartAt)}` : "Appel associé"; if (touch.kind === "opportunity") return "Opportunité associée"; return touch.contactName ?? "Identité résolue"; }
function resolutionLabel(value: AttributionJourney["resolution"]): string { return ({ resolved: "Identité résolue", ambiguous: "Identité ambiguë", unknown: "Attribution inconnue", excluded: "Interaction propriétaire" })[value]; }
function resolutionClass(value: AttributionJourney["resolution"]): string { return value === "resolved" ? "badge badge-success" : value === "ambiguous" ? "badge badge-warning" : "badge"; }
function interactionLabel(value: AttributionJourney["interaction"]["type"]): string { return ({ comment: "Commentaire", reply: "Réponse", reaction: "Réaction", mention: "Mention" })[value]; }
function positionLabel(value: NonNullable<AttributionTouch["position"]>): string { return ({ first: "premier touch", last: "dernier touch", first_and_last: "premier et dernier touch", middle: "touch intermédiaire" })[value]; }
function workspaceHref(workspaceSlug: string, href: string): string { return href.startsWith("/w/") ? href : `/w/${workspaceSlug}${href.startsWith("/") ? href : `/${href}`}`; }
function formatDate(value: string): string { return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(value)); }
