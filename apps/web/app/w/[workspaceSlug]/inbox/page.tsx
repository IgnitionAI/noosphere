import { AlertTriangle, AtSign, Inbox, LoaderCircle, Mail, MessageCircle, Search, UserRound } from "lucide-react";
import Link from "next/link";
import { WorkspaceConversationDrawer } from "@/components/workspace-conversation-drawer";
import {
  getWorkspaceConversation,
  listWorkspaceConversations,
  type WorkspaceConversationView,
} from "@/lib/api";

export const metadata = { title: "Conversations" };
export const dynamic = "force-dynamic";

type Query = {
  search?: string;
  channel?: string;
  scope?: string;
  period?: string;
  read?: string;
  page?: string;
  conversation?: string;
  prospect?: string;
};

export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<Query>;
}) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  const channel = validChannel(query.channel);
  const scope = validScope(query.scope);
  const period = validPeriod(query.period);
  const read = query.read === "unread" ? "unread" : undefined;
  const page = positivePage(query.page);
  const result = await listWorkspaceConversations(workspaceSlug, {
    ...(channel ? { channel } : {}),
    ...(scope ? { scope } : {}),
    ...(period ? { period } : {}),
    ...(read ? { read } : {}),
    ...(query.search?.trim() ? { search: query.search.trim() } : {}),
    page,
    pageSize: 50,
  });
  const selectedId = query.conversation
    ?? (query.prospect ? result.data.find((item) => item.contactId === query.prospect)?.id : undefined);
  const selected = selectedId ? await getWorkspaceConversation(workspaceSlug, selectedId) : null;
  const closeHref = inboxHref(workspaceSlug, query, { conversation: null, prospect: null });
  const unread = result.data.reduce((total, item) => total + item.unreadCount, 0);
  const campaign = result.data.filter((item) => item.origin === "campaign").length;
  const outside = result.data.length - campaign;

  return (
    <>
      <header className="mb-6">
        <h1 className="page-title">Conversations</h1>
        <p className="mt-2 text-sm text-muted">Toutes les conversations des comptes LinkedIn, email et WhatsApp associés.</p>
      </header>

      {result.sync.errorAccounts > 0 ? (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-danger" role="alert">
          <AlertTriangle className="mt-0.5 shrink-0" size={16} />
          <p><strong>Synchronisation interrompue sur {result.sync.errorAccounts} compte{result.sync.errorAccounts > 1 ? "s" : ""}.</strong> Reconnectez le compte concerné dans Configuration.</p>
        </div>
      ) : result.sync.backfillingAccounts > 0 ? (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-brand-blue/25 bg-blue-50 px-4 py-3 text-sm text-navy" role="status">
          <LoaderCircle className="mt-0.5 shrink-0 animate-spin text-brand-blue" size={16} />
          <p><strong>Historique en cours de synchronisation.</strong> Les conversations déjà importées sont utilisables ; le reste apparaît progressivement, même si vous quittez cette page.</p>
        </div>
      ) : null}

      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={Inbox} label="Conversations" value={result.pagination.total} />
        <Metric icon={MessageCircle} label="Non lus" value={unread} tone="signal" />
        <Metric icon={AtSign} label="En campagne · page" value={campaign} />
        <Metric icon={UserRound} label="Hors campagne · page" value={outside} />
      </section>

      <nav aria-label="Canal de messagerie" className="mb-5 flex flex-wrap gap-2 rounded-xl border border-line bg-white p-2">
        <ChannelTab active={!channel} href={inboxHref(workspaceSlug, query, { channel: null, page: null })} icon={Inbox} label="Tous" />
        <ChannelTab active={channel === "linkedin"} href={inboxHref(workspaceSlug, query, { channel: "linkedin", page: null })} icon={AtSign} label="LinkedIn" />
        <ChannelTab active={channel === "email"} href={inboxHref(workspaceSlug, query, { channel: "email", page: null })} icon={Mail} label="Email" />
        <ChannelTab active={channel === "whatsapp"} href={inboxHref(workspaceSlug, query, { channel: "whatsapp", page: null })} icon={MessageCircle} label="WhatsApp" />
      </nav>

      <section className="panel mb-5">
        <form className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5" method="get">
          <label className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-3 text-muted" size={15} />
            <input className="control w-full pl-9" name="search" defaultValue={query.search ?? ""} placeholder="Contact, campagne, compte ou contenu…" />
          </label>
          <select aria-label="Canal" className="control" name="channel" defaultValue={channel ?? ""}>
            <option value="">Tous les canaux</option>
            <option value="linkedin">LinkedIn</option>
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
          <select aria-label="Origine" className="control" name="scope" defaultValue={scope ?? ""}>
            <option value="">Campagne et hors campagne</option>
            <option value="campaign">En campagne</option>
            <option value="outside_campaign">Hors campagne</option>
          </select>
          <select aria-label="Période" className="control" name="period" defaultValue={period ?? ""}>
            <option value="">Toutes les dates</option>
            <option value="today">Aujourd’hui</option>
            <option value="7d">7 derniers jours</option>
            <option value="30d">30 derniers jours</option>
            <option value="90d">90 derniers jours</option>
          </select>
          <select aria-label="Lecture" className="control" name="read" defaultValue={read ?? ""}>
            <option value="">Lus et non lus</option>
            <option value="unread">Non lus uniquement</option>
          </select>
          <div className="flex gap-2 sm:col-span-2 xl:col-span-4 xl:justify-end">
            <button className="button button-signal" type="submit">Filtrer</button>
            <Link className="button" href={`/w/${workspaceSlug}/inbox`}>Effacer</Link>
          </div>
        </form>
      </section>

      <section className="panel overflow-hidden">
        <div className="panel-header">
          <div><h2 className="font-semibold">Conversations</h2><p className="mt-1 text-xs text-muted">Un thread hors campagne reste manuel tant que vous ne l’ajoutez pas à une campagne.</p></div>
          <span className="badge">{result.pagination.total}</span>
        </div>
        {result.data.length ? (
          <div className="divide-y divide-line">
            {result.data.map((conversation) => (
              <ConversationRow
                conversation={conversation}
                href={inboxHref(workspaceSlug, query, { conversation: conversation.id, prospect: null })}
                key={conversation.id}
              />
            ))}
          </div>
        ) : (
          <div className="panel-body py-14 text-center">
            <Inbox className="mx-auto text-muted" size={30} />
            <h2 className="mt-3 font-semibold">Aucune conversation avec ces filtres</h2>
            <p className="mt-2 text-sm text-muted">Les messages des comptes associés apparaîtront automatiquement ici.</p>
          </div>
        )}
        {result.pagination.total > result.pagination.pageSize ? (
          <footer className="flex items-center justify-between border-t border-line p-3">
            <Link aria-disabled={page <= 1} className={`button ${page <= 1 ? "pointer-events-none opacity-40" : ""}`} href={inboxHref(workspaceSlug, query, { page: String(Math.max(1, page - 1)), conversation: null })}>Précédent</Link>
            <span className="text-xs text-muted">Page {page}</span>
            <Link aria-disabled={!result.pagination.hasNext} className={`button ${!result.pagination.hasNext ? "pointer-events-none opacity-40" : ""}`} href={inboxHref(workspaceSlug, query, { page: String(page + 1), conversation: null })}>Suivant</Link>
          </footer>
        ) : null}
      </section>

      {selected ? <WorkspaceConversationDrawer closeHref={closeHref} conversation={selected} workspaceSlug={workspaceSlug} /> : null}
    </>
  );
}

function ConversationRow({ conversation, href }: { conversation: WorkspaceConversationView; href: string }) {
  const Icon = conversation.channel === "linkedin" ? AtSign : conversation.channel === "email" ? Mail : MessageCircle;
  return (
    <Link className="grid gap-3 p-4 transition hover:bg-slate-50 md:grid-cols-[minmax(240px,1fr)_150px_130px] md:items-center" href={href} scroll={false}>
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100"><UserRound size={16} /></span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-sm">{conversation.firstName} {conversation.lastName}</strong>
            {conversation.unreadCount > 0 ? <span className="badge badge-signal">{conversation.unreadCount} non lu{conversation.unreadCount > 1 ? "s" : ""}</span> : null}
            <span className={conversation.origin === "campaign" ? "badge badge-success" : "badge"}>{conversation.origin === "campaign" ? "campagne" : "hors campagne"}</span>
          </div>
          {conversation.subject ? <p className="mt-1 truncate text-xs font-medium">{conversation.subject}</p> : null}
          <p className="mt-1 truncate text-xs text-muted">{conversation.lastMessage?.body ?? "Aucun contenu"}</p>
        </div>
      </div>
      <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-xs"><Icon size={13} />{conversation.accountName ?? channelLabel(conversation.channel)}</span>
      <span className="text-xs text-muted">{formatRelative(conversation.lastMessageAt)}</span>
    </Link>
  );
}

function Metric({ icon: Icon, label, value, tone }: { icon: typeof Inbox; label: string; value: number; tone?: "signal" }) {
  return <div className={`panel p-4 ${tone === "signal" ? "border-lime-300" : ""}`}><div className="flex items-center gap-2 text-xs text-muted"><Icon size={14} />{label}</div><strong className="mt-2 block text-2xl">{value}</strong></div>;
}

function ChannelTab({ active, href, icon: Icon, label }: { active: boolean; href: string; icon: typeof Inbox; label: string }) {
  return <Link aria-current={active ? "page" : undefined} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${active ? "bg-navy text-white" : "text-muted hover:bg-slate-100 hover:text-ink"}`} href={href}><Icon size={14} />{label}</Link>;
}

function inboxHref(workspaceSlug: string, query: Query, patch: Record<string, string | null>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  for (const [key, value] of Object.entries(patch)) value ? params.set(key, value) : params.delete(key);
  const suffix = params.toString();
  return `/w/${workspaceSlug}/inbox${suffix ? `?${suffix}` : ""}`;
}

function validChannel(value?: string): "linkedin" | "email" | "whatsapp" | undefined {
  return value === "linkedin" || value === "email" || value === "whatsapp" ? value : undefined;
}

function validScope(value?: string): "campaign" | "outside_campaign" | undefined {
  return value === "campaign" || value === "outside_campaign" ? value : undefined;
}

function validPeriod(value?: string): "today" | "7d" | "30d" | "90d" | undefined {
  return value === "today" || value === "7d" || value === "30d" || value === "90d" ? value : undefined;
}

function positivePage(value?: string): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function channelLabel(value: WorkspaceConversationView["channel"]): string {
  return value === "linkedin" ? "LinkedIn" : value === "whatsapp" ? "WhatsApp" : "Email";
}

function formatRelative(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(value));
}
