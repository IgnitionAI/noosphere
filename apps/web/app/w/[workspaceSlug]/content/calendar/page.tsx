import { AlertTriangle, ArrowLeft, CalendarDays, ExternalLink, Send } from "lucide-react";
import Link from "next/link";
import { listContentPublications, type ContentPublication } from "@/lib/api";
import { PublicationActions } from "./publication-actions";

export const metadata = { title: "Calendrier LinkedIn — Noosphere" };
export const dynamic = "force-dynamic";

export default async function ContentCalendarPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string }>; searchParams: Promise<{ cursor?: string }> }) {
  const { workspaceSlug } = await params;
  const { cursor } = await searchParams;
  const publications = await listContentPublications(workspaceSlug, cursor);
  return <>
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><Link className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-navy" href={`/w/${workspaceSlug}/activity?lens=inbound`}><ArrowLeft size={13} /> Activité Inbound</Link><div className="badge badge-signal mt-3 w-fit"><CalendarDays size={13} /> Calendrier durable</div><h1 className="page-title mt-3">Publications LinkedIn</h1><p className="mt-2 max-w-2xl text-sm text-muted">Chaque ligne pointe vers un snapshot exact. Recharge, redémarrage et navigation ne changent pas son exécution.</p></div><Link className="button button-primary" href={`/w/${workspaceSlug}/content/ideas`}>Trouver une idée</Link></header>
    <section className="panel mt-5 overflow-hidden">
      {publications.data.length ? <div className="divide-y divide-line">{publications.data.map((publication) => <PublicationRow key={publication.id} publication={publication} workspaceSlug={workspaceSlug} />)}</div> : <div className="py-16 text-center"><CalendarDays className="mx-auto text-muted" size={30} /><h2 className="mt-4 font-semibold">Aucune publication planifiée</h2><p className="mx-auto mt-2 max-w-lg text-sm text-muted">Créez un contenu depuis une idée sourcée, puis choisissez son échéance LinkedIn.</p></div>}
      {publications.nextCursor ? <footer className="border-t border-line p-3 text-right"><Link className="button" href={`/w/${workspaceSlug}/content/calendar?cursor=${encodeURIComponent(publications.nextCursor)}`}>Afficher la suite</Link></footer> : null}
    </section>
  </>;
}

function PublicationRow({ publication, workspaceSlug }: { readonly publication: ContentPublication; readonly workspaceSlug: string }) {
  const editable = publication.status === "scheduled" || publication.status === "retry";
  return <article className="p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><Send size={15} className="text-signal" /><span className={statusClass(publication.status)}>{statusLabel(publication.status)}</span><span className="text-xs text-muted">{publication.accountSnapshot.displayName}</span></div><p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-navy">{publication.contentSnapshot.body}</p><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted"><span>Prévue {formatDate(publication.scheduledFor)}</span><span>Tentatives {publication.attempts}/{publication.maxAttempts}</span><span className="font-mono">{publication.contentSnapshot.contentHash.slice(0, 10)}</span></div>{publication.lastErrorCode ? <div className={`mt-3 flex items-start gap-2 rounded-lg p-3 text-xs ${publication.status === "unknown" ? "bg-amber-50 text-amber-950" : "bg-red-50 text-red-950"}`}><AlertTriangle size={14} className="mt-0.5" /><span><strong>{publication.lastErrorCode}</strong>{publication.lastErrorMessage ? ` · ${publication.lastErrorMessage}` : ""}</span></div> : null}{editable ? <PublicationActions publicationId={publication.id} scheduledFor={publication.scheduledFor} workspaceSlug={workspaceSlug} /> : null}</div>{publication.providerUrl ? <a className="button shrink-0" href={publication.providerUrl} rel="noreferrer" target="_blank">Voir le post <ExternalLink size={13} /></a> : null}</div></article>;
}

function statusClass(status: ContentPublication["status"]): string { return status === "published" ? "badge badge-success" : status === "unknown" || status === "retry" ? "badge badge-warning" : status === "failed" ? "badge badge-danger" : "badge"; }
function statusLabel(status: ContentPublication["status"]): string { return ({ scheduled: "Planifiée", retry: "Nouvelle tentative", publishing: "Publication en cours", published: "Publiée", unknown: "À réconcilier", failed: "Échec", cancelled: "Annulée" })[status]; }
function formatDate(value: string): string { return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(value)); }
