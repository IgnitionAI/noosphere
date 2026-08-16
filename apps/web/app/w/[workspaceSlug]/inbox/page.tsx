import { AlertTriangle, AtSign, Bot, CalendarDays, Clock, Flame, Inbox, Mail, MessageCircle, Search, UserRound } from "lucide-react";
import Link from "next/link";
import { ProspectActivityDrawer } from "@/components/prospect-activity-drawer";
import { getProspectView, listProspectViews, type ProspectViewSummary } from "@/lib/api";
import {
  buildInboxChannelHref,
  buildInboxHref,
  buildInboxScopeHref,
  inboxPeriod,
  inboxReadState,
  inboxScope,
  matchesInboxPeriod,
  matchesInboxReadState,
  matchesInboxScope,
} from "@/lib/inbox-filters";

export const metadata = { title: "Messagerie" };
export const dynamic = "force-dynamic";

type InboxView = "all" | "replies" | "hot" | "waiting" | "errors";

export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{
    search?: string;
    channel?: string;
    view?: string;
    scope?: string;
    period?: string;
    read?: string;
    prospect?: string;
  }>;
}) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  const view = inboxView(query.view);
  const scope = inboxScope(query.scope);
  const period = inboxPeriod(query.period);
  const readState = inboxReadState(query.read);
  const result = await listProspectViews(workspaceSlug, {
    ...(query.search ? { search: query.search } : {}),
  });
  const contacted = result.data.filter((prospect) => prospect.latestActivity !== null);
  const threads = contacted
    .filter((prospect) => !query.channel || prospect.latestActivity?.channel === query.channel)
    .filter((prospect) => matchesView(prospect, view))
    .filter((prospect) => matchesInboxScope(prospect, scope))
    .filter((prospect) => matchesInboxPeriod(prospect, period))
    .filter((prospect) => matchesInboxReadState(prospect, readState))
    .sort((left, right) => priority(right) - priority(left) || activityTime(right) - activityTime(left));
  const selected = query.prospect ? await getProspectView(workspaceSlug, query.prospect) : null;
  const listHref = buildInboxHref(workspaceSlug, query);
  const replyCount = contacted.filter((prospect) => prospect.latestActivity?.direction === "inbound").length;
  const hotCount = contacted.filter(isHot).length;
  const waitingCount = contacted.filter((prospect) => !prospect.conversation && prospect.latestActivity?.direction === "outbound").length;

  return (
    <>
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-title">Messagerie</h1>
          <p className="mt-2 text-sm text-muted">Messages envoyés, réponses prioritaires et décisions K3 dans une seule file.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link className="button" href={`/w/${workspaceSlug}/settings/calendar`}><CalendarDays size={13} />Agenda</Link>
          <span className="badge badge-success"><Bot size={12} /> Setter IA actif</span>
        </div>
      </header>

      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <InboxMetric icon={Inbox} label="Prospects contactés" value={contacted.length} />
        <InboxMetric icon={MessageCircle} label="Réponses à traiter" value={replyCount} tone="signal" />
        <InboxMetric icon={Flame} label="Prospects chauds" value={hotCount} tone="success" />
        <InboxMetric icon={Clock} label="En attente" value={waitingCount} />
      </section>

      <nav aria-label="Canal de messagerie" className="mb-5 flex flex-wrap gap-2 rounded-xl border border-line bg-white p-2">
        <InboxChannelTab
          active={!query.channel}
          count={contacted.length}
          href={buildInboxChannelHref(workspaceSlug, query, null)}
          icon={Inbox}
          label="Toutes"
        />
        <InboxChannelTab
          active={query.channel === "linkedin"}
          count={contacted.filter((prospect) => prospect.latestActivity?.channel === "linkedin").length}
          href={buildInboxChannelHref(workspaceSlug, query, "linkedin")}
          icon={AtSign}
          label="LinkedIn"
        />
        <InboxChannelTab
          active={query.channel === "email"}
          count={contacted.filter((prospect) => prospect.latestActivity?.channel === "email").length}
          href={buildInboxChannelHref(workspaceSlug, query, "email")}
          icon={Mail}
          label="Email"
        />
        <InboxChannelTab
          active={query.channel === "whatsapp"}
          count={contacted.filter((prospect) => prospect.latestActivity?.channel === "whatsapp").length}
          href={buildInboxChannelHref(workspaceSlug, query, "whatsapp")}
          icon={MessageCircle}
          label="WhatsApp"
        />
      </nav>

      <nav aria-label="Périmètre de campagne" className="mb-5 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-muted">Périmètre</span>
        <InboxScopeTab
          active={scope === "all"}
          href={buildInboxScopeHref(workspaceSlug, query, "all")}
          label="Toutes"
        />
        <InboxScopeTab
          active={scope === "campaign"}
          href={buildInboxScopeHref(workspaceSlug, query, "campaign")}
          label="En campagne"
        />
        <InboxScopeTab
          active={scope === "outside_campaign"}
          href={buildInboxScopeHref(workspaceSlug, query, "outside_campaign")}
          label="Hors campagne"
        />
      </nav>

      <section className="panel mb-5">
        <form className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4" method="get">
          <label className="relative sm:col-span-2 xl:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-3 text-muted" size={15} />
            <input className="control w-full pl-9" name="search" defaultValue={query.search ?? ""} placeholder="Prospect ou entreprise…" />
          </label>
          <select aria-label="Canal" className="control" name="channel" defaultValue={query.channel ?? ""}>
            <option value="">Tous les canaux</option>
            <option value="linkedin">LinkedIn</option>
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
          <select aria-label="Type d’activité" className="control" name="view" defaultValue={view}>
            <option value="all">Toute l’activité</option>
            <option value="replies">Réponses reçues</option>
            <option value="hot">Prospects chauds</option>
            <option value="waiting">En attente</option>
            <option value="errors">Erreurs d’envoi</option>
          </select>
          <select aria-label="Origine de la conversation" className="control" name="scope" defaultValue={scope}>
            <option value="all">Toutes les conversations</option>
            <option value="campaign">En campagne</option>
            <option value="outside_campaign">Hors campagne</option>
          </select>
          <select aria-label="Période" className="control" name="period" defaultValue={period}>
            <option value="all">Toutes les dates</option>
            <option value="today">Aujourd’hui</option>
            <option value="7d">7 derniers jours</option>
            <option value="30d">30 derniers jours</option>
            <option value="90d">90 derniers jours</option>
          </select>
          <select aria-label="Lecture" className="control" name="read" defaultValue={readState}>
            <option value="all">Lus et non lus</option>
            <option value="unread">Non lus uniquement</option>
          </select>
          <div className="flex gap-2">
            <button className="button button-signal flex-1" type="submit">Filtrer</button>
            <Link aria-label="Réinitialiser les filtres" className="button" href={`/w/${workspaceSlug}/inbox`}>Effacer</Link>
          </div>
        </form>
      </section>

      <section className="panel overflow-hidden">
        <div className="panel-header">
          <div><h2 className="font-semibold">Activité commerciale</h2><p className="mt-1 text-xs text-muted">Les réponses et rendez-vous remontent automatiquement en tête.</p></div>
          <span className="badge">{threads.length}</span>
        </div>
        {threads.length ? (
          <div className="divide-y divide-line">
            {threads.map((prospect) => {
              const activity = prospect.latestActivity!;
              const ChannelIcon = channelIcon(activity.channel);
              return (
                <Link
                  className="grid gap-3 p-4 transition hover:bg-slate-50 md:grid-cols-[minmax(220px,1fr)_130px_110px] md:items-center"
                  href={`${listHref}${listHref.includes("?") ? "&" : "?"}prospect=${prospect.id}`}
                  key={prospect.id}
                  scroll={false}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100"><UserRound size={16} /></span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm">{prospect.firstName} {prospect.lastName}</strong>
                        {isHot(prospect) ? <span className="badge badge-success">chaud</span> : null}
                        {prospectCampaignId(prospect) ? <span className="badge badge-success">campagne</span> : <span className="badge">hors campagne</span>}
                        {(prospect.conversation?.unreadCount ?? 0) > 0 ? <span className="badge badge-signal">{prospect.conversation!.unreadCount} non lu{prospect.conversation!.unreadCount > 1 ? "s" : ""}</span> : null}
                      </div>
                      <p className="mt-1 truncate text-xs text-muted">{prospect.currentEmployment ? `${prospect.currentEmployment.title} · ${prospect.currentEmployment.companyName}` : prospect.icpMatches[0]?.companyName ?? "Entreprise à confirmer"}</p>
                      <p className="mt-2 truncate text-xs text-ink">{activity.body ?? activityLabel(activity.status)}</p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium"><ChannelIcon size={13} />{channelLabel(activity.channel)}</span>
                  <span className={activityBadge(activity)}>{activityLabel(activity.status)}</span>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="panel-body py-12 text-center"><Inbox className="mx-auto text-muted" size={28} /><h2 className="mt-3 font-semibold">Aucune activité avec ces filtres</h2><p className="mt-2 text-sm text-muted">Les prochains envois et réponses apparaîtront automatiquement ici.</p></div>
        )}
      </section>

      {selected ? <ProspectActivityDrawer prospect={selected} workspaceSlug={workspaceSlug} closeHref={listHref} /> : null}
    </>
  );
}

function InboxMetric({ icon: Icon, label, value, tone }: { icon: typeof Inbox; label: string; value: number; tone?: "success" | "signal" }) {
  return <div className={`panel p-4 ${tone === "success" ? "border-emerald-200" : tone === "signal" ? "border-lime-300" : ""}`}><div className="flex items-center gap-2 text-xs text-muted"><Icon size={14} />{label}</div><strong className="mt-2 block text-2xl">{value}</strong></div>;
}

function InboxChannelTab({
  active,
  count,
  href,
  icon: Icon,
  label,
}: {
  active: boolean;
  count: number;
  href: string;
  icon: typeof Inbox;
  label: string;
}) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition ${active ? "bg-navy text-white" : "text-muted hover:bg-slate-100 hover:text-navy"}`}
      href={href}
    >
      <Icon size={14} />{label}<span className={active ? "rounded bg-white/15 px-1.5 py-0.5" : "rounded bg-slate-100 px-1.5 py-0.5 text-navy"}>{count}</span>
    </Link>
  );
}

function InboxScopeTab({ active, href, label }: { active: boolean; href: string; label: string }) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${active ? "border-navy bg-navy text-white" : "border-line bg-white text-muted hover:border-navy/30 hover:text-navy"}`}
      href={href}
    >
      {label}
    </Link>
  );
}

function matchesView(prospect: ProspectViewSummary, view: InboxView): boolean {
  if (view === "all") return true;
  if (view === "replies") return prospect.latestActivity?.direction === "inbound";
  if (view === "hot") return isHot(prospect);
  if (view === "waiting") return !prospect.conversation && prospect.latestActivity?.direction === "outbound";
  return prospect.latestActivity?.status === "failed";
}

function prospectCampaignId(prospect: ProspectViewSummary): string | null {
  return prospect.latestActivity?.campaignId ?? prospect.conversation?.campaignId ?? null;
}

function isHot(prospect: ProspectViewSummary): boolean {
  return Boolean(prospect.meeting)
    || ["positive", "meeting_request"].includes(prospect.conversation?.decision?.intent ?? "");
}

function priority(prospect: ProspectViewSummary): number {
  if (prospect.meeting?.status === "booked") return 60;
  if (prospect.conversation?.decision?.intent === "meeting_request") return 50;
  if (prospect.conversation?.decision?.intent === "positive") return 45;
  if (prospect.latestActivity?.direction === "inbound") return 40;
  if (prospect.latestActivity?.status === "failed") return 30;
  if (prospect.latestActivity?.status === "executing") return 20;
  return 10;
}

function activityTime(prospect: ProspectViewSummary): number {
  return new Date(prospect.latestActivity?.occurredAt ?? 0).getTime();
}

function activityBadge(activity: NonNullable<ProspectViewSummary["latestActivity"]>): string {
  if (activity.direction === "inbound") return "badge badge-signal";
  if (activity.status === "sent") return "badge badge-success";
  if (activity.status === "failed") return "badge badge-danger";
  return "badge badge-warning";
}

function activityLabel(status: string): string {
  return ({ received: "Réponse reçue", sent: "Envoyé", scheduled: "Relance planifiée", executing: "Envoi en cours", failed: "Échec", cancelled: "Annulé", skipped: "Ignoré" } as Record<string, string>)[status] ?? status;
}

function channelIcon(channel: "linkedin" | "email" | "whatsapp") {
  return channel === "linkedin" ? AtSign : channel === "email" ? Mail : MessageCircle;
}

function channelLabel(channel: "linkedin" | "email" | "whatsapp") {
  return channel === "linkedin" ? "LinkedIn" : channel === "email" ? "Email" : "WhatsApp";
}

function inboxView(value: string | undefined): InboxView {
  return value === "replies" || value === "hot" || value === "waiting" || value === "errors" ? value : "all";
}
