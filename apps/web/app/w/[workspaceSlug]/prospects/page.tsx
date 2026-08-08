import { AtSign, Filter, Mail, MessageCircle, Search, UserRound } from "lucide-react";
import Link from "next/link";
import { getProspectView, listProspectViews } from "@/lib/api";
import { ProspectActivityDrawer } from "@/components/prospect-activity-drawer";

export const metadata = { title: "Prospects" };
export const dynamic = "force-dynamic";

export default async function ProspectsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ search?: string; icp?: string; channel?: string; prospect?: string }>;
}) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  const result = await listProspectViews(workspaceSlug, {
    ...(query.search ? { search: query.search } : {}),
    ...(query.icp ? { icpVersionId: query.icp } : {}),
    ...(query.channel ? { channel: query.channel } : {}),
  });
  const selected = query.prospect ? await getProspectView(workspaceSlug, query.prospect) : null;
  const listHref = prospectListHref(workspaceSlug, query);

  return (
    <>
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-title">Prospects</h1>
          <p className="mt-2 text-sm text-muted">
            ICP, canaux disponibles, avis IA et conversations dans une seule vue.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge">{result.data.length} affiché{result.data.length > 1 ? "s" : ""}</span>
          <Link className="button button-signal" href={`/w/${workspaceSlug}/prospects/discover`}>Nouvelle recherche</Link>
        </div>
      </header>

      <section className="panel mb-5">
        <form className="grid gap-3 p-4 md:grid-cols-[minmax(220px,1fr)_240px_180px_auto]" method="get">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 text-muted" size={15} />
            <input className="control w-full pl-9" name="search" defaultValue={query.search ?? ""} placeholder="Nom ou prénom…" />
          </label>
          <select className="control" name="icp" defaultValue={query.icp ?? ""}>
            <option value="">Tous les ICP</option>
            {result.filters.icps.map((icp) => <option value={icp.id} key={icp.id}>{icp.name}</option>)}
          </select>
          <select className="control" name="channel" defaultValue={query.channel ?? ""}>
            <option value="">Tous les canaux</option>
            <option value="linkedin">LinkedIn</option>
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
          <button className="button" type="submit"><Filter size={14} /> Filtrer</button>
        </form>
      </section>

      <div className="grid items-start gap-5">
        <section className="panel min-w-0 overflow-hidden">
          {result.data.length === 0 ? (
            <div className="panel-body py-12 text-center">
              <UserRound className="mx-auto text-muted" size={28} />
              <h2 className="mt-3 font-semibold">Aucun prospect avec ces filtres</h2>
              <p className="mt-2 text-sm text-muted">La recherche quotidienne ajoutera automatiquement les nouvelles cibles qualifiées.</p>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {result.data.map((prospect) => {
                const active = selected?.id === prospect.id;
                const bestIcp = prospect.icpMatches[0];
                return (
                  <Link
                    className={`block p-4 transition hover:bg-slate-50 ${active ? "bg-blue-50/70" : ""}`}
                    href={`${listHref}${listHref.includes("?") ? "&" : "?"}prospect=${prospect.id}`}
                    key={prospect.id}
                    scroll={false}
                  >
                    <div className="flex items-start gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-navy"><UserRound size={17} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="text-sm">{prospect.firstName} {prospect.lastName}</strong>
                          {bestIcp?.score !== null && bestIcp?.score !== undefined ? <span className="badge badge-signal">{bestIcp.score}/100</span> : null}
                          {prospect.conversation?.decision?.intent === "positive" || prospect.conversation?.decision?.intent === "meeting_request" ? <span className="badge badge-success">chaud</span> : null}
                        </div>
                        <p className="mt-1 truncate text-xs text-muted">
                          {prospect.currentEmployment ? `${prospect.currentEmployment.title} · ${prospect.currentEmployment.companyName}` : bestIcp?.headline ?? "Fonction à confirmer"}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {bestIcp ? <span className="badge">{bestIcp.icpName}</span> : <span className="badge">hors campagne</span>}
                          <ChannelBadges channels={prospect.channels} />
                        </div>
                        <p className="mt-3 truncate text-xs text-ink">
                          {prospect.conversation?.lastMessage?.body ?? prospect.aiOpinion?.summary ?? "Pas encore de conversation."}
                        </p>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {selected ? <ProspectActivityDrawer prospect={selected} workspaceSlug={workspaceSlug} closeHref={listHref} /> : null}
      </div>
    </>
  );
}

function ChannelBadges({ channels }: { channels: { linkedin: boolean; email: boolean; whatsapp: boolean } }) {
  return <>{channels.linkedin ? <span className="badge"><AtSign size={11} /> LinkedIn</span> : null}{channels.email ? <span className="badge"><Mail size={11} /> Email</span> : null}{channels.whatsapp ? <span className="badge"><MessageCircle size={11} /> WhatsApp</span> : null}</>;
}

function prospectListHref(workspaceSlug: string, query: { search?: string; icp?: string; channel?: string }) {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.icp) params.set("icp", query.icp);
  if (query.channel) params.set("channel", query.channel);
  return `/w/${workspaceSlug}/prospects${params.size ? `?${params.toString()}` : ""}`;
}
