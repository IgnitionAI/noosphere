import { AlertTriangle, ArrowLeft, BarChart3, CalendarDays, ExternalLink, MessageCircle, RefreshCw, Repeat2, Send, Sparkles, ThumbsUp } from "lucide-react";
import Link from "next/link";
import { getSocialContentSyncStatus, listContentPublications, listSocialContent, type ContentPublication, type SocialContentItem, type SocialContentSyncStatus } from "@/lib/api";
import { PublicationActions } from "./publication-actions";

export const metadata = { title: "Calendrier LinkedIn — Noosphere" };
export const dynamic = "force-dynamic";

export default async function ContentCalendarPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string }>; searchParams: Promise<{ cursor?: string; socialCursor?: string }> }) {
  const { workspaceSlug } = await params;
  const { cursor, socialCursor } = await searchParams;
  const [publications, observed, sync] = await Promise.all([
    listContentPublications(workspaceSlug, cursor),
    listSocialContent(workspaceSlug, socialCursor),
    getSocialContentSyncStatus(workspaceSlug),
  ]);
  return <>
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><Link className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-navy" href={`/w/${workspaceSlug}/activity?lens=inbound`}><ArrowLeft size={13} /> Activité Inbound</Link><div className="badge badge-signal mt-3 w-fit"><CalendarDays size={13} /> Calendrier durable</div><h1 className="page-title mt-3">Publications LinkedIn</h1><p className="mt-2 max-w-2xl text-sm text-muted">Chaque ligne pointe vers un snapshot exact. Recharge, redémarrage et navigation ne changent pas son exécution.</p></div><Link className="button button-primary" href={`/w/${workspaceSlug}/content/ideas`}>Trouver une idée</Link></header>
    <section className="panel mt-5 overflow-hidden">
      {publications.data.length ? <div className="divide-y divide-line">{publications.data.map((publication) => <PublicationRow key={publication.id} publication={publication} workspaceSlug={workspaceSlug} />)}</div> : <div className="py-16 text-center"><CalendarDays className="mx-auto text-muted" size={30} /><h2 className="mt-4 font-semibold">Aucune publication planifiée</h2><p className="mx-auto mt-2 max-w-lg text-sm text-muted">Créez un contenu depuis une idée sourcée, puis choisissez son échéance LinkedIn.</p></div>}
      {publications.nextCursor ? <footer className="border-t border-line p-3 text-right"><Link className="button" href={`/w/${workspaceSlug}/content/calendar?cursor=${encodeURIComponent(publications.nextCursor)}`}>Afficher la suite</Link></footer> : null}
    </section>
    <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="panel overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-line p-5 sm:flex-row sm:items-center sm:justify-between"><div><div className="badge badge-signal w-fit"><BarChart3 size={13} /> Réalité LinkedIn</div><h2 className="mt-3 text-lg font-semibold text-navy">Posts observés sur le compte</h2><p className="mt-1 text-sm text-muted">Les publications Noosphere et les posts externes sont distingués, avec les compteurs cumulés remontés par LinkedIn.</p></div><span className="text-xs text-muted">{observed.data.length} post{observed.data.length > 1 ? "s" : ""}</span></div>
        {observed.data.length ? <div className="divide-y divide-line">{observed.data.map((item) => <ObservedPostRow item={item} key={item.id} />)}</div> : <div className="py-14 text-center"><BarChart3 className="mx-auto text-muted" size={28} /><h3 className="mt-3 font-semibold">Aucun post observé</h3><p className="mx-auto mt-2 max-w-lg text-sm text-muted">La synchronisation affichera ici les publications du compte LinkedIn connecté, y compris celles créées hors Noosphere.</p></div>}
        {observed.nextCursor ? <footer className="border-t border-line p-3 text-right"><Link className="button" href={`/w/${workspaceSlug}/content/calendar?${calendarQuery(cursor, observed.nextCursor)}`}>Afficher les posts précédents</Link></footer> : null}
      </div>
      <SyncStatusCard sync={sync} />
    </section>
  </>;
}

function PublicationRow({ publication, workspaceSlug }: { readonly publication: ContentPublication; readonly workspaceSlug: string }) {
  const editable = publication.status === "scheduled" || publication.status === "retry";
  return <article className="p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><Send size={15} className="text-signal" /><span className={statusClass(publication.status)}>{statusLabel(publication.status)}</span><span className="text-xs text-muted">{publication.accountSnapshot.displayName}</span></div><p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-navy">{publication.contentSnapshot.body}</p><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted"><span>Prévue {formatDate(publication.scheduledFor)}</span><span>Tentatives {publication.attempts}/{publication.maxAttempts}</span><span className="font-mono">{publication.contentSnapshot.contentHash.slice(0, 10)}</span></div>{publication.lastErrorCode ? <div className={`mt-3 flex items-start gap-2 rounded-lg p-3 text-xs ${publication.status === "unknown" ? "bg-amber-50 text-amber-950" : "bg-red-50 text-red-950"}`}><AlertTriangle size={14} className="mt-0.5" /><span><strong>{publication.lastErrorCode}</strong>{publication.lastErrorMessage ? ` · ${publication.lastErrorMessage}` : ""}</span></div> : null}{editable ? <PublicationActions publicationId={publication.id} scheduledFor={publication.scheduledFor} workspaceSlug={workspaceSlug} /> : null}</div>{publication.providerUrl ? <a className="button shrink-0" href={publication.providerUrl} rel="noreferrer" target="_blank">Voir le post <ExternalLink size={13} /></a> : null}</div></article>;
}

function ObservedPostRow({ item }: { readonly item: SocialContentItem }) {
  return <article className="p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className={item.origin === "internal" ? "badge badge-signal" : "badge"}>{item.origin === "internal" ? <><Sparkles size={12} /> Noosphere</> : "Externe"}</span><span className="text-xs text-muted">{item.publishedAt ? formatDate(item.publishedAt) : "Date LinkedIn indisponible"}</span></div><p className="mt-3 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-navy">{item.text}</p><div className="mt-4 flex flex-wrap gap-4 text-xs text-muted"><Metric icon={<BarChart3 size={13} />} label="Impressions" value={item.impressions} /><Metric icon={<ThumbsUp size={13} />} label="Réactions" value={item.reactions} /><Metric icon={<MessageCircle size={13} />} label="Commentaires" value={item.comments} /><Metric icon={<Repeat2 size={13} />} label="Reposts" value={item.reposts} /></div>{item.metricsObservedAt ? <p className="mt-3 text-[11px] text-muted">Métriques actualisées {relativeDate(item.metricsObservedAt)}</p> : <p className="mt-3 text-[11px] text-amber-700">Métriques encore indisponibles</p>}</div>{item.url ? <a className="button shrink-0" href={item.url} rel="noreferrer" target="_blank">Voir sur LinkedIn <ExternalLink size={13} /></a> : null}</div></article>;
}

function SyncStatusCard({ sync }: { readonly sync: SocialContentSyncStatus }) {
  const label = ({ not_configured: "Compte requis", idle: "Synchronisé", syncing: "Synchronisation en cours", error: "Attention requise" })[sync.status];
  return <aside className="panel h-fit p-5"><div className="flex items-center gap-2"><RefreshCw size={15} className={sync.status === "error" ? "text-red-600" : "text-signal"} /><h2 className="font-semibold text-navy">Synchronisation LinkedIn</h2></div><span className={`mt-4 inline-flex ${sync.status === "error" ? "badge badge-danger" : sync.status === "not_configured" ? "badge badge-warning" : "badge badge-success"}`}>{label}</span><dl className="mt-5 space-y-4 text-xs"><div><dt className="text-muted">Historique initial</dt><dd className="mt-1 font-medium text-navy">{sync.backfillComplete ? "Terminé" : "En cours"}</dd></div><div><dt className="text-muted">Dernier succès</dt><dd className="mt-1 font-medium text-navy">{sync.lastSuccessAt ? relativeDate(sync.lastSuccessAt) : "Pas encore exécuté"}</dd></div><div><dt className="text-muted">Prochain passage</dt><dd className="mt-1 font-medium text-navy">{sync.nextSyncAt ? formatDate(sync.nextSyncAt) : "Automatique"}</dd></div></dl>{sync.lastErrorCode ? <div className="mt-5 rounded-lg bg-red-50 p-3 text-xs text-red-950"><strong>{sync.lastErrorCode}</strong>{sync.lastErrorMessage ? <p className="mt-1 break-words">{sync.lastErrorMessage}</p> : null}</div> : null}</aside>;
}

function Metric({ icon, label, value }: { readonly icon: React.ReactNode; readonly label: string; readonly value: number | null }) { return <span className="inline-flex items-center gap-1.5" title={label}>{icon}<strong className="font-semibold text-navy">{value === null ? "—" : new Intl.NumberFormat("fr-FR", { notation: value >= 10_000 ? "compact" : "standard" }).format(value)}</strong><span>{label}</span></span>; }
function calendarQuery(publicationCursor: string | undefined, socialCursor: string): string { const query = new URLSearchParams({ socialCursor }); if (publicationCursor) query.set("cursor", publicationCursor); return query.toString(); }
function relativeDate(value: string): string { const deltaMinutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000)); if (deltaMinutes < 1) return "à l’instant"; if (deltaMinutes < 60) return `il y a ${deltaMinutes} min`; const hours = Math.round(deltaMinutes / 60); return hours < 24 ? `il y a ${hours} h` : `le ${formatDate(value)}`; }

function statusClass(status: ContentPublication["status"]): string { return status === "published" ? "badge badge-success" : status === "unknown" || status === "retry" ? "badge badge-warning" : status === "failed" ? "badge badge-danger" : "badge"; }
function statusLabel(status: ContentPublication["status"]): string { return ({ scheduled: "Planifiée", retry: "Nouvelle tentative", publishing: "Publication en cours", published: "Publiée", unknown: "À réconcilier", failed: "Échec", cancelled: "Annulée" })[status]; }
function formatDate(value: string): string { return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(value)); }
