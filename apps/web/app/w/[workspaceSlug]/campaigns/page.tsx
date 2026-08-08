import { Megaphone, Plus } from "lucide-react";
import Link from "next/link";
import { CrmEmptyState, CrmPermissionState } from "@/components/crm-states";
import { listCampaigns, listWorkspaces, OutboundApiError } from "@/lib/api";

export const metadata = { title: "Campagnes" };
export const dynamic = "force-dynamic";
const STATUS: Record<string, { label: string; className: string }> = { draft: { label: "brouillon", className: "badge" }, active: { label: "active", className: "badge badge-success" }, paused: { label: "en pause", className: "badge badge-warning" }, archived: { label: "archivée", className: "badge" } };

export default async function CampaignsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const workspace = (await listWorkspaces()).find((item) => item.slug === workspaceSlug);
  if (!workspace) return <CrmPermissionState resource="les campagnes" />;
  let campaigns;
  try { campaigns = await listCampaigns(workspaceSlug); } catch (error) {
    if (error instanceof OutboundApiError && (error.status === 401 || error.status === 403)) return <CrmPermissionState resource="les campagnes" />;
    throw error;
  }
  const canEdit = ["operator", "admin", "owner"].includes(workspace.role);
  return <>
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h1 className="page-title">Campagnes</h1><p className="mt-2 max-w-3xl text-sm text-muted">Assemblez cinq versions publiées, vérifiez le préflight puis activez un snapshot immuable.</p></div>{canEdit ? <Link className="button button-signal" href={`/w/${workspaceSlug}/campaigns/new`}><Plus size={15} /> Nouvelle campagne</Link> : null}</header>
    <section className="panel"><div className="panel-header"><h2 className="flex items-center gap-2 font-semibold"><Megaphone size={16} className="text-brand-blue" /> Toutes les campagnes</h2><span className="badge">{campaigns.data.length}</span></div><div className="panel-body">{campaigns.data.length === 0 ? <CrmEmptyState title="Aucune campagne" description="Créez un premier brouillon à partir de versions publiées." href={canEdit ? `/w/${workspaceSlug}/campaigns/new` : undefined} action={canEdit ? "Créer une campagne" : undefined} /> : <div className="space-y-2">{campaigns.data.map((campaign) => { const status = STATUS[campaign.status] ?? STATUS.draft!; return <Link className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-4 hover:border-brand-blue" href={`/w/${workspaceSlug}/campaigns/${campaign.id}`} key={campaign.id}><span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-navy"><Megaphone size={16} /></span><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{campaign.name}</strong><span className="block truncate text-xs text-muted">{campaign.objective || "Aucun objectif renseigné"}</span></span><span className={status.className}>{status.label}</span><span className="text-[11px] text-muted">{formatDate(campaign.updatedAt)}</span></Link>; })}</div>}</div></section>
  </>;
}
function formatDate(value: string): string { return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(value)); }
