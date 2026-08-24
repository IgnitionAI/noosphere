import { Users } from "lucide-react";
import { CrmPermissionState } from "@/components/crm-states";
import { listCampaignProspects, listWorkspaces, OutboundApiError } from "@/lib/api";
import { PopulationTable } from "./population-table";

export async function PopulationPanel({ workspaceSlug, campaignId, sequenceVersionId }: { workspaceSlug: string; campaignId: string; sequenceVersionId: string }) {
  const workspace = (await listWorkspaces()).find((item) => item.slug === workspaceSlug);
  if (!workspace) return <CrmPermissionState resource="la population de la campagne" />;
  let prospects;
  try { prospects = await listCampaignProspects(workspaceSlug, campaignId); } catch (error) {
    if (error instanceof OutboundApiError && (error.status === 401 || error.status === 403)) return <CrmPermissionState resource="la population de la campagne" />;
    throw error;
  }
  return <section className="panel mt-5"><div className="panel-header"><h2 className="flex items-center gap-2 font-semibold"><Users size={16} className="text-brand-blue" /> Population · scores explicables</h2><span className="badge">{prospects.data.length}</span></div><div className="panel-body"><p className="mb-4 max-w-3xl text-xs leading-5 text-muted">Chaque score est déterministe et détaillé par faits constatés, données manquantes et exclusions. Un critère exclusif exclut toujours le prospect, quel que soit son score.</p><PopulationTable canMutate={["operator", "admin", "owner"].includes(workspace.role)} campaignId={campaignId} prospects={prospects.data} sequenceVersionId={sequenceVersionId} workspaceSlug={workspaceSlug} /></div></section>;
}
