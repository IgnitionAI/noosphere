import { ArrowLeft, Check, Rocket } from "lucide-react";
import Link from "next/link";
import { CrmPermissionState } from "@/components/crm-states";
import { listWorkspaces, OutboundApiError } from "@/lib/api";
import { MutationForm } from "../../research/[runId]/report/mutation-form";
import { createCampaignAction } from "../actions";
import { loadPublishedOptions, type PublishedOption } from "../version-options";

export const metadata = { title: "Nouvelle campagne" };
export const dynamic = "force-dynamic";

export default async function NewCampaignPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const workspace = (await listWorkspaces()).find((item) => item.slug === workspaceSlug);
  if (!workspace || !["operator", "admin", "owner"].includes(workspace.role)) return <CrmPermissionState resource="la création de campagnes" />;
  let options;
  try { options = await loadPublishedOptions(workspaceSlug); } catch (error) {
    if (error instanceof OutboundApiError && (error.status === 401 || error.status === 403)) return <CrmPermissionState resource="les versions publiées" />;
    throw error;
  }
  const create = createCampaignAction.bind(null, workspaceSlug);
  return (
    <>
      <Link className="mb-4 inline-flex items-center gap-2 text-xs font-semibold text-muted" href={`/w/${workspaceSlug}/campaigns`}><ArrowLeft size={14} /> Retour aux campagnes</Link>
      <header className="mb-6"><span className="badge badge-signal">Builder · snapshot versionné</span><h1 className="page-title mt-3">Nouvelle campagne</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-muted">Assemblez uniquement des versions publiées. Les cinq références seront figées lors de l’activation.</p></header>
      <MutationForm action={create} className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]" successMessage="Campagne créée.">
        <section className="panel"><div className="panel-header"><h2 className="font-semibold">Configuration</h2></div><div className="panel-body space-y-4">
          <label className="block text-xs font-semibold text-muted">Nom *<input className="control mt-1 w-full" name="name" required placeholder="Outbound Q3" /></label>
          <label className="block text-xs font-semibold text-muted">Objectif<textarea className="control mt-1 min-h-20 w-full" name="objective" placeholder="Décrire l’objectif de la campagne…" /></label>
          <Picker label="ICP publié" name="icpVersionId" options={options.icp} emptyHref={`/w/${workspaceSlug}/icps`} emptyLabel="Aucun ICP publié → publier un ICP" required />
          <Picker label="Offre publiée" name="offerVersionId" options={options.offer} emptyHref={`/w/${workspaceSlug}/offers`} emptyLabel="Aucune offre publiée → créer une offre" required />
          <Picker label="Stratégie de message publiée" name="messagingStrategyVersionId" options={options.strategy} emptyHref={`/w/${workspaceSlug}/messaging`} emptyLabel="Aucune stratégie publiée → configurer les messages" required />
          <Picker label="Politique IA publiée" name="aiPolicyVersionId" options={options.policy} emptyHref={`/w/${workspaceSlug}/messaging`} emptyLabel="Aucune politique publiée → configurer la supervision" required />
          <Picker label="Séquence publiée" name="sequenceVersionId" options={options.sequence} emptyHref={`/w/${workspaceSlug}/sequences`} emptyLabel="Aucune séquence publiée → créer une séquence" required />
        </div></section>
        <aside className="panel"><div className="panel-header"><h2 className="flex items-center gap-2 font-semibold"><Rocket size={15} className="text-brand-blue" /> Étapes</h2></div><div className="panel-body space-y-3 text-xs text-muted"><p><Check size={13} className="mr-1 inline text-success" />Créez le brouillon avec cinq références.</p><p><Check size={13} className="mr-1 inline text-success" />Lancez le préflight depuis la fiche.</p><p><Check size={13} className="mr-1 inline text-success" />Corrigez les blocages avant activation.</p><button className="button button-signal mt-3 w-full" type="submit">Créer la campagne</button></div></aside>
      </MutationForm>
    </>
  );
}

function Picker({ label, name, options, emptyHref, emptyLabel, required }: { label: string; name: string; options: readonly PublishedOption[]; emptyHref: string; emptyLabel: string; required?: boolean }) {
  return <label className="block text-xs font-semibold text-muted">{label}<select className="control mt-1 w-full" name={name} required={required} defaultValue=""><option value="">{options.length ? "Sélectionner une version…" : emptyLabel}</option>{options.map((option) => <option key={option.id} value={option.id}>v{option.version} · {option.label} · {formatDate(option.publishedAt)}</option>)}</select>{!options.length ? <Link className="mt-1 inline-block text-brand-blue" href={emptyHref}>{emptyLabel}</Link> : null}</label>;
}
function formatDate(value: string): string { return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(value)); }
