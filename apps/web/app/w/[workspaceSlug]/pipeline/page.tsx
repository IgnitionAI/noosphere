import { CalendarCheck, CheckCircle2, CircleDollarSign, Flame, Kanban, RotateCcw, UserRound } from "lucide-react";
import Link from "next/link";
import { CrmPermissionState } from "@/components/crm-states";
import {
  getPipeline,
  getPipelineForecast,
  listLostReasons,
  listOffers,
  listOfferVersions,
  listWorkspaceMembers,
  listWorkspaces,
  OutboundApiError,
  type OfferVersion,
  type PipelineOpportunity,
} from "@/lib/api";
import { OpportunityDrawer } from "./opportunity-drawer";

export const metadata = { title: "Pipeline" };
export const dynamic = "force-dynamic";

const columns = [
  { id: "qualified", title: "Qualifiés", description: "Intérêt confirmé", icon: Flame },
  { id: "meeting", title: "Rendez-vous", description: "Demandés ou réservés", icon: CalendarCheck },
  { id: "follow_up", title: "À suivre", description: "Après rendez-vous ou no-show", icon: RotateCcw },
  { id: "closed", title: "Clôturés", description: "Gagnés ou perdus", icon: CheckCircle2 },
] as const;

export default async function PipelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ opportunity?: string; ownerId?: string }>;
}) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  let pipeline: Awaited<ReturnType<typeof getPipeline>>;
  let workspaces: Awaited<ReturnType<typeof listWorkspaces>>;
  try {
    [pipeline, workspaces] = await Promise.all([getPipeline(workspaceSlug), listWorkspaces()]);
  } catch (error) {
    if (error instanceof OutboundApiError && (error.status === 401 || error.status === 403)) return <CrmPermissionState resource="le pipeline" />;
    throw error;
  }
  const workspace = workspaces.find((candidate) => candidate.slug === workspaceSlug);
  if (!workspace) return <CrmPermissionState resource="le pipeline" />;
  const ownerIds = [...new Set(pipeline.data.map((item) => item.ownerUserId).filter((id): id is string => Boolean(id)))];
  const ownerId = query.ownerId;
  const visibleData = ownerId ? pipeline.data.filter((item) => item.ownerUserId === ownerId) : pipeline.data;
  const selected = query.opportunity ? pipeline.data.find((item) => item.id === query.opportunity) ?? null : null;
  const [forecast, reasons, offers, members] = await Promise.all([
    getPipelineForecast(workspaceSlug).catch(() => ({ data: [] })),
    listLostReasons(workspaceSlug, workspace.id).then((result) => result.data).catch(() => []),
    listOffers(workspaceSlug).then((result) => result.data).catch(() => []),
    listWorkspaceMembers(workspaceSlug, workspace.id).catch(() => []),
  ]);
  const ownerOptions = ownerIds.map((id) => {
    const member = members.find((candidate) => candidate.userId === id);
    return { id, label: member?.name?.trim() || member?.email || `Membre · ${id.slice(0, 8)}` };
  });
  const ownerLabels = new Map(ownerOptions.map((option) => [option.id, option.label]));
  const offerVersions = (await Promise.all(offers.map((offer) => listOfferVersions(workspaceSlug, offer.id).then((result) => result.data).catch(() => [])))).flat() as OfferVersion[];
  const listHref = `/w/${workspaceSlug}/pipeline`;

  return (
    <>
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="badge badge-signal w-fit"><Kanban size={13} /> Revenu</div>
          <h1 className="page-title mt-3">Pipeline commercial</h1>
          <p className="mt-2 text-sm text-muted">Les décisions K3 et les rendez-vous déplacent automatiquement les opportunités.</p>
        </div>
        <span className="badge badge-success"><CircleDollarSign size={13} /> Autopilote actif</span>
      </header>

      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Opportunités" value={visibleData.length} />
        <Metric label="Qualifiés" value={visibleData.filter((item) => item.column === "qualified").length} />
        <Metric label="RDV réservés" value={visibleData.filter((item) => item.stage === "meeting_booked").length} tone="signal" />
        <Metric label="À suivre" value={visibleData.filter((item) => item.column === "follow_up").length} />
        <Metric label="Gagnés" value={visibleData.filter((item) => item.stage === "won").length} tone="success" />
      </section>

      <section className="panel mb-5"><div className="panel-header"><div><h2 className="font-semibold">Filtres et prévisions</h2><p className="mt-1 text-xs text-muted">La prévision est une projection du revenu pondéré, jamais une promesse.</p></div></div><form className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"><label className="text-xs font-semibold text-muted">Responsable<select className="control mt-1 w-full" defaultValue={ownerId ?? ""} name="ownerId"><option value="">Tous les responsables</option>{ownerOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><button className="button button-primary" type="submit">Filtrer</button></form><div className="border-t border-line p-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{forecast.data.length ? forecast.data.map((row) => <div className="rounded-lg border border-line bg-slate-50/60 p-3" key={`${row.period}:${row.stage}:${row.ownerUserId ?? "none"}`}><p className="text-[11px] text-muted">{row.period} · {stageLabel(row.stage)}{row.ownerUserId ? ` · ${ownerLabels.get(row.ownerUserId) ?? "Responsable inconnu"}` : ""}</p><p className="mt-2 text-sm font-semibold text-navy">{workspace.role === "viewer" || row.weightedRevenue === undefined ? "Montant masqué" : formatCurrency(row.weightedRevenue)}</p><p className="mt-1 text-[11px] text-muted">{row.count} opportunité{row.count > 1 ? "s" : ""} · revenu pondéré</p></div>) : <p className="text-sm text-muted">Aucune prévision disponible pour le moment.</p>}</div></div></section>

      {visibleData.length ? (
        <section className="grid items-start gap-4 xl:grid-cols-4">
          {columns.map((column) => {
            const items = visibleData.filter((item) => item.column === column.id);
            const Icon = column.icon;
            return (
              <div className="rounded-xl border border-line bg-slate-100/70 p-3" key={column.id}>
                <div className="mb-3 flex items-center justify-between gap-2 px-1">
                  <div>
                    <h2 className="flex items-center gap-2 text-sm font-semibold"><Icon size={15} />{column.title}</h2>
                    <p className="mt-1 text-[11px] text-muted">{column.description}</p>
                  </div>
                  <span className="badge">{items.length}</span>
                </div>
                <div className="space-y-3">
                  {items.map((opportunity) => (
                    <OpportunityCard key={opportunity.id} opportunity={opportunity} {...(opportunity.ownerUserId && ownerLabels.get(opportunity.ownerUserId) ? { ownerLabel: ownerLabels.get(opportunity.ownerUserId)! } : {})} workspaceSlug={workspaceSlug} />
                  ))}
                  {!items.length ? <div className="rounded-xl border border-dashed border-line bg-white/60 px-3 py-8 text-center text-xs text-muted">Aucune opportunité</div> : null}
                </div>
              </div>
            );
          })}
        </section>
      ) : (
        <section className="panel py-16 text-center">
          <Kanban className="mx-auto text-muted" size={30} />
          <h2 className="mt-4 font-semibold">Le pipeline se remplira automatiquement</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">Une réponse positive, une demande de rendez-vous ou une réservation créera la première opportunité.</p>
          <Link className="button mt-5" href={`/w/${workspaceSlug}/inbox`}>Voir la Messagerie</Link>
        </section>
      )}

      {selected ? <OpportunityDrawer opportunity={selected} workspaceSlug={workspaceSlug} workspaceRole={workspace.role} ownerOptions={ownerOptions} offerVersions={offerVersions} lostReasons={reasons} closeHref={listHref} /> : null}
    </>
  );
}

function OpportunityCard({ opportunity, workspaceSlug, ownerLabel }: { opportunity: PipelineOpportunity; workspaceSlug: string; ownerLabel?: string }) {
  return (
    <Link className="block rounded-xl border border-line bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md" href={`/w/${workspaceSlug}/pipeline?opportunity=${opportunity.id}`} scroll={false}>
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100"><UserRound size={15} /></span>
        <div className="min-w-0">
          <strong className="block truncate text-sm">{opportunity.firstName} {opportunity.lastName}</strong>
          <p className="mt-1 truncate text-[11px] text-muted">{opportunity.jobTitle ?? "Fonction à confirmer"}{opportunity.companyName ? ` · ${opportunity.companyName}` : ""}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className={stageBadge(opportunity.stage)}>{stageLabel(opportunity.stage)}</span>
        {opportunity.icpName ? <span className="badge truncate">{opportunity.icpName}</span> : null}
        <span className="badge">{opportunity.probability}%</span>
      </div>
      {opportunity.amount === undefined ? <p className="mt-3 text-xs text-muted">Montant masqué</p> : opportunity.amount !== null ? <p className="mt-3 text-xs font-semibold text-navy">{formatCurrency(opportunity.amount, opportunity.currency)}</p> : null}
      {opportunity.meeting ? <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-emerald-800"><CalendarCheck size={13} />{formatDate(opportunity.meeting.startAt)}</p> : null}
      {ownerLabel ? <p className="mt-3 flex items-center gap-2 text-[11px] text-muted"><UserRound size={12} />{ownerLabel}</p> : null}
      {opportunity.nextAction ? <p className="mt-3 line-clamp-3 text-[11px] leading-5 text-muted">{opportunity.nextAction}</p> : null}
      <p className="mt-3 text-[10px] text-muted">{opportunity.history.length} transition{opportunity.history.length > 1 ? "s" : ""} auditée{opportunity.history.length > 1 ? "s" : ""}</p>
    </Link>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "signal" | "success" }) {
  return <div className={`panel p-4 ${tone === "signal" ? "border-lime-300" : tone === "success" ? "border-emerald-200" : ""}`}><p className="text-xs text-muted">{label}</p><strong className="mt-2 block text-2xl">{value}</strong></div>;
}

function stageLabel(stage: string): string {
  return ({ qualified: "Qualifié", meeting_requested: "RDV demandé", meeting_booked: "RDV réservé", meeting_no_show: "À replanifier", meeting_completed: "RDV terminé", won: "Gagné", lost: "Perdu" } as Record<string, string>)[stage] ?? stage;
}

function stageBadge(stage: string): string {
  if (stage === "won" || stage === "meeting_booked") return "badge badge-success";
  if (stage === "lost" || stage === "meeting_no_show") return "badge badge-warning";
  if (stage === "meeting_requested") return "badge badge-signal";
  return "badge";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(value));
}

function formatCurrency(value: number, currency?: string | null): string { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: currency || "EUR", maximumFractionDigits: 2 }).format(value); }
