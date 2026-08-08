import { ArrowLeft, Archive, Pause, Play, Rocket } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CrmPermissionState } from "@/components/crm-states";
import { getCampaign, listWorkspaces, OutboundApiError } from "@/lib/api";
import { MutationForm } from "../../research/[runId]/report/mutation-form";
import { lifecycleCampaignAction, activateCampaignAction, updateCampaignAction } from "../actions";
import { loadPublishedOptions, type PublishedOption } from "../version-options";
import { PreflightPanel } from "../preflight-panel";

export const metadata = { title: "Campagne" };
export const dynamic = "force-dynamic";

const REF_FIELDS = ["offerVersionId", "icpVersionId", "messagingStrategyVersionId", "aiPolicyVersionId", "sequenceVersionId"] as const;
const REF_LABELS: Record<string, string> = { offerVersionId: "Offre", icpVersionId: "ICP", messagingStrategyVersionId: "Stratégie de message", aiPolicyVersionId: "Politique IA", sequenceVersionId: "Séquence" };
const STATUS: Record<string, string> = { draft: "brouillon", active: "active", paused: "en pause", archived: "archivée" };

export default async function CampaignDetailPage({ params }: { params: Promise<{ workspaceSlug: string; campaignId: string }> }) {
  const { workspaceSlug, campaignId } = await params;
  const workspace = (await listWorkspaces()).find((item) => item.slug === workspaceSlug);
  if (!workspace) return <CrmPermissionState resource="cette campagne" />;
  let campaign;
  try { campaign = await getCampaign(workspaceSlug, campaignId); } catch (error) {
    if (error instanceof OutboundApiError && error.status === 404) notFound();
    if (error instanceof OutboundApiError && (error.status === 401 || error.status === 403)) return <CrmPermissionState resource="cette campagne" />;
    throw error;
  }
  const canEdit = ["operator", "admin", "owner"].includes(workspace.role);
  const canTransition = ["admin", "owner"].includes(workspace.role);
  const options = campaign.status === "draft" && canEdit ? await loadPublishedOptions(workspaceSlug) : null;
  const update = updateCampaignAction.bind(null, workspaceSlug, campaign.id);
  const activate = activateCampaignAction.bind(null, workspaceSlug, campaign.id);
  return <>
    <Link className="mb-4 inline-flex items-center gap-2 text-xs font-semibold text-muted" href={`/w/${workspaceSlug}/campaigns`}><ArrowLeft size={14} /> Retour aux campagnes</Link>
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><span className={`badge ${campaign.status === "active" ? "badge-success" : ""}`}>{STATUS[campaign.status]}</span><h1 className="page-title mt-3">{campaign.name}</h1><p className="mt-2 max-w-3xl text-sm text-muted">{campaign.objective || "Aucun objectif renseigné"}</p></div><span className="badge">Snapshot {campaign.status === "draft" ? "en préparation" : "figé"}</span></header>
    {campaign.status === "draft" && canEdit && options ? <MutationForm action={update} className="panel mb-5" successMessage="Brouillon mis à jour."><div className="panel-header"><h2 className="font-semibold">Builder</h2></div><div className="panel-body space-y-4"><label className="block text-xs font-semibold text-muted">Nom<input className="control mt-1 w-full" name="name" required defaultValue={campaign.name} /></label><label className="block text-xs font-semibold text-muted">Objectif<textarea className="control mt-1 min-h-20 w-full" name="objective" defaultValue={campaign.objective} /></label><div className="grid gap-3 md:grid-cols-2">{REF_FIELDS.map((field) => <Picker key={field} field={field} value={campaign[field]} options={optionsFor(field, options)} />)}</div><button className="button button-signal" type="submit">Enregistrer les références</button></div></MutationForm> : null}
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]"><section className="panel"><div className="panel-header"><h2 className="font-semibold">Snapshot des versions</h2></div><div className="panel-body space-y-3">{REF_FIELDS.map((field) => <div className="flex flex-col gap-1 rounded-lg border border-line p-3 sm:flex-row sm:items-center sm:justify-between" key={field}><span className="text-xs font-semibold text-muted">{REF_LABELS[field]}</span><span className="font-mono text-xs text-navy">{campaign[field]}</span></div>)}<p className="text-[11px] leading-4 text-muted">Ces cinq références sont immuables après activation. Une évolution exige une nouvelle campagne.</p></div></section><div className="space-y-5"><PreflightPanel campaignId={campaign.id} workspaceSlug={workspaceSlug} />{campaign.status === "draft" && canTransition ? <MutationForm action={activate} confirmation="Activer la campagne ? Le snapshot des cinq versions sera figé." successMessage="Campagne activée."><button className="button button-signal w-full" type="submit"><Rocket size={14} /> Activer la campagne</button></MutationForm> : null}<LifecycleActions campaignId={campaign.id} status={campaign.status} workspaceSlug={workspaceSlug} canTransition={canTransition} /></div></div>
  </>;
}

function optionsFor(field: typeof REF_FIELDS[number], options: Awaited<ReturnType<typeof loadPublishedOptions>>): readonly PublishedOption[] { return field === "offerVersionId" ? options.offer : field === "icpVersionId" ? options.icp : field === "messagingStrategyVersionId" ? options.strategy : field === "aiPolicyVersionId" ? options.policy : options.sequence; }
function Picker({ field, value, options }: { field: typeof REF_FIELDS[number]; value: string; options: readonly PublishedOption[] }) { return <label className="block text-xs font-semibold text-muted">{REF_LABELS[field]}<select className="control mt-1 w-full" name={field} defaultValue={value} required>{options.map((option) => <option key={option.id} value={option.id}>v{option.version} · {option.label}</option>)}{!options.some((option) => option.id === value) ? <option value={value}>Référence actuelle · {value}</option> : null}</select></label>; }
function LifecycleActions({ workspaceSlug, campaignId, status, canTransition }: { workspaceSlug: string; campaignId: string; status: string; canTransition: boolean }) { if (!canTransition) return <p className="text-xs text-muted">Pause, reprise et archivage sont réservés aux admins/owners.</p>; const action = (transition: "pause" | "resume" | "archive") => lifecycleCampaignAction.bind(null, workspaceSlug, campaignId, transition); return <div className="flex flex-wrap gap-2">{status === "active" ? <MutationForm action={action("pause")} confirmation="Mettre la campagne en pause ?" successMessage="Campagne mise en pause."><button className="button" type="submit"><Pause size={14} /> Pause</button></MutationForm> : null}{status === "paused" ? <MutationForm action={action("resume")} confirmation="Reprendre la campagne ?" successMessage="Campagne reprise."><button className="button button-signal" type="submit"><Play size={14} /> Reprendre</button></MutationForm> : null}{status !== "archived" ? <MutationForm action={action("archive")} confirmation="Archiver la campagne ? Cette action est irréversible." successMessage="Campagne archivée."><button className="button" type="submit"><Archive size={14} /> Archiver</button></MutationForm> : null}</div>; }
