import { Bot, CheckCircle2, MessageSquareText, Plus, ShieldCheck } from "lucide-react";
import { CrmEmptyState, CrmPermissionState } from "@/components/crm-states";
import { MutationForm } from "../research/[runId]/report/mutation-form";
import {
  listAIPolicies,
  listMessagingStrategies,
  listWorkspaces,
  OutboundApiError,
  type AIPolicy,
  type MessagingChannel,
  type MessagingStrategy,
  type MessagingTemplate,
} from "@/lib/api";
import {
  createAIPolicyAction,
  createMessagingSetupAction,
  createMessagingStrategyAction,
  publishAIPolicyAction,
  publishMessagingStrategyAction,
  updateAIPolicyAction,
  updateMessagingStrategyAction,
} from "./actions";

export const metadata = { title: "Stratégie de message" };
export const dynamic = "force-dynamic";
const VARIABLES = ["contact.first_name", "contact.last_name", "contact.title", "contact.email", "company.name", "company.industry", "sender.first_name", "sender.last_name", "offer.name", "icp.name"];
const CHANNELS: readonly MessagingChannel[] = ["linkedin", "email", "whatsapp"];

export default async function MessagingPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  let strategies: MessagingStrategy[];
  let policies: AIPolicy[];
  try {
    [strategies, policies] = await Promise.all([listMessagingStrategies(workspaceSlug).then((result) => result.data), listAIPolicies(workspaceSlug).then((result) => result.data)]);
  } catch (error) {
    if (error instanceof OutboundApiError && (error.status === 401 || error.status === 403)) return <CrmPermissionState resource="la stratégie de message" />;
    throw error;
  }
  const workspace = (await listWorkspaces()).find((item) => item.slug === workspaceSlug);
  const canEdit = workspace ? ["operator", "admin", "owner"].includes(workspace.role) : false;
  const canPublish = workspace ? ["admin", "owner"].includes(workspace.role) : false;
  const strategy = strategies[0];
  const policy = policies[0];

  return (
    <>
      <header className="mb-6">
        <h1 className="page-title">Stratégie de message</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">Rédigez les templates et laissez l’IA gérer les envois, relances et réponses. Les arrêts de sécurité restent automatiques.</p>
      </header>
      {!strategy && !policy ? (
        <section className="panel"><div className="panel-body flex flex-col items-start gap-4"><div><h2 className="font-semibold">Aucune configuration</h2><p className="mt-1 text-sm text-muted">Créez la stratégie et la politique d’automatisation pour commencer.</p></div>{canEdit ? <MutationForm action={createMessagingSetupAction.bind(null, workspaceSlug)} successMessage="Les brouillons stratégie et politique ont été créés."><button className="button button-signal" type="submit"><Plus size={15} /> Créer la configuration</button></MutationForm> : <CrmEmptyState title="Aucune stratégie publiée" description="Un operator, admin ou owner doit créer la configuration." />}</div></section>
      ) : null}
      {!strategy && policy ? <CreateMissing title="Créer une stratégie de message" action={createMessagingStrategyAction.bind(null, workspaceSlug)} canEdit={canEdit} /> : null}
      {strategy && !policy ? <CreateMissing title="Créer une politique d’automatisation IA" action={createAIPolicyAction.bind(null, workspaceSlug)} canEdit={canEdit} /> : null}
      {strategy ? <StrategyEditor canEdit={canEdit} canPublish={canPublish} strategy={strategy} workspaceSlug={workspaceSlug} /> : null}
      {policy ? <PolicyEditor canEdit={canEdit} canPublish={canPublish} policy={policy} workspaceSlug={workspaceSlug} /> : null}
      <section className="panel mt-5"><div className="panel-header"><h2 className="flex items-center gap-2 font-semibold"><CheckCircle2 className="text-brand-blue" size={16} /> Variables autorisées</h2></div><div className="panel-body"><p className="text-xs text-muted">La liste vient du contrat de domaine ; toute variable inconnue bloque la publication et est signalée avec le chemin du template.</p><div className="mt-3 flex flex-wrap gap-2">{VARIABLES.map((variable) => <code className="rounded bg-slate-100 px-2 py-1 text-[11px] text-ink" key={variable}>{`{{${variable}}}`}</code>)}</div></div></section>
    </>
  );
}

function CreateMissing({ title, action, canEdit }: { title: string; action: (formData: FormData) => Promise<void>; canEdit: boolean }) {
  return <section className="panel mb-5"><div className="panel-body flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-semibold">{title}</h2><p className="mt-1 text-xs text-muted">Le conteneur manquant sera créé en brouillon.</p></div>{canEdit ? <MutationForm action={action}><button className="button button-signal" type="submit"><Plus size={15} /> Créer le brouillon</button></MutationForm> : <span className="text-xs text-muted">Modification réservée aux operator/admin/owner.</span>}</div></section>;
}

function StrategyEditor({ strategy, workspaceSlug, canEdit, canPublish }: { strategy: MessagingStrategy; workspaceSlug: string; canEdit: boolean; canPublish: boolean }) {
  const update = updateMessagingStrategyAction.bind(null, workspaceSlug, strategy.id);
  const publish = publishMessagingStrategyAction.bind(null, workspaceSlug, strategy.id);
  return <section className="panel mb-5"><div className="panel-header"><h2 className="flex items-center gap-2 font-semibold"><MessageSquareText className="text-brand-blue" size={16} /> Stratégie · brouillon</h2><span className="badge">v{strategy.currentVersion || "—"}</span></div><div className="panel-body">{canEdit ? <MutationForm action={update} successMessage="Le brouillon de stratégie a été enregistré."><StrategyFields strategy={strategy} /><button className="button button-signal mt-4" type="submit">Enregistrer le brouillon</button></MutationForm> : <StrategyReadOnly strategy={strategy} />}{canPublish ? <MutationForm action={publish} className="mt-5 border-t border-line pt-4" confirmation="Publier cette stratégie ? La version publiée sera immuable." successMessage="La stratégie a été publiée."><button className="button" type="submit">Publier la stratégie</button></MutationForm> : <p className="mt-4 text-xs text-muted">Publication réservée aux owners/admins.</p>}{strategy.versions?.length ? <VersionHistory versions={strategy.versions} /> : null}</div></section>;
}

function StrategyFields({ strategy }: { strategy: MessagingStrategy }) {
  return <div className="space-y-4"><label className="block text-xs font-semibold text-muted">Nom<input className="control mt-1 w-full" name="name" required defaultValue={strategy.name} /></label><div className="grid gap-3 md:grid-cols-2"><label className="text-xs font-semibold text-muted">Ton<textarea className="control mt-1 min-h-20 w-full" name="tone" defaultValue={strategy.draftRules.tone} /></label><label className="text-xs font-semibold text-muted">Angle<textarea className="control mt-1 min-h-20 w-full" name="angle" defaultValue={strategy.draftRules.angle} /></label></div><label className="block text-xs font-semibold text-muted">OfferVersion ID référencée<input className="control mt-1 w-full font-mono text-xs" name="offerVersionId" placeholder="UUID de l’OfferVersion publiée" defaultValue={strategy.draftRules.offerVersionId ?? ""} /></label><label className="block text-xs font-semibold text-muted">Claims autorisés (UUID, séparés par espace ou virgule)<textarea className="control mt-1 min-h-16 w-full font-mono text-xs" name="allowedClaimIds" defaultValue={strategy.draftRules.allowedClaimIds.join("\n")} /></label><div className="space-y-3"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Templates par canal</h3>{CHANNELS.map((channel) => <TemplateFields channel={channel} key={channel} template={strategy.draftRules.templates.find((item) => item.channel === channel)} />)}</div></div>;
}

function TemplateFields({ channel, template }: { channel: MessagingChannel; template: MessagingTemplate | undefined }) {
  return <fieldset className="rounded-lg border border-line p-3"><legend className="px-1 text-sm font-semibold text-ink">{channelLabel(channel)}</legend><div className="grid gap-3 md:grid-cols-2"><label className="text-xs font-semibold text-muted md:col-span-2">Corps<textarea className="control mt-1 min-h-28 w-full" name={`${channel}.body`} defaultValue={template?.body ?? ""} placeholder="Bonjour {{contact.first_name}}…" /></label><label className="text-xs font-semibold text-muted">Objet (email)<input className="control mt-1 w-full" name={`${channel}.subject`} defaultValue={template?.subject ?? ""} /></label><label className="text-xs font-semibold text-muted">Longueur maximale<input className="control mt-1 w-full" min="1" name={`${channel}.maxLength`} type="number" defaultValue={template?.maxLength ?? ""} /></label><label className="text-xs font-semibold text-muted">CTA<input className="control mt-1 w-full" name={`${channel}.cta`} defaultValue={template?.cta ?? ""} /></label><label className="text-xs font-semibold text-muted">Contraintes (JSON facultatif)<input className="control mt-1 w-full font-mono text-xs" name={`${channel}.constraints`} defaultValue={template?.constraints ? JSON.stringify(template.constraints) : ""} placeholder='{"links":true}' /></label></div></fieldset>;
}

function StrategyReadOnly({ strategy }: { strategy: MessagingStrategy }) { return <div className="space-y-3 text-sm"><p><span className="text-xs text-muted">Nom</span><br /><strong>{strategy.name}</strong></p><p><span className="text-xs text-muted">Ton</span><br />{strategy.draftRules.tone || "—"}</p><p><span className="text-xs text-muted">Angle</span><br />{strategy.draftRules.angle || "—"}</p><p className="text-xs text-muted">Édition réservée aux operator/admin/owner.</p></div>; }

function PolicyEditor({ policy, workspaceSlug, canEdit, canPublish }: { policy: AIPolicy; workspaceSlug: string; canEdit: boolean; canPublish: boolean }) {
  const update = updateAIPolicyAction.bind(null, workspaceSlug, policy.id);
  const publish = publishAIPolicyAction.bind(null, workspaceSlug, policy.id);
  const rules = policy.draftRules;
  return <section className="panel mb-5"><div className="panel-header"><h2 className="flex items-center gap-2 font-semibold"><Bot className="text-brand-blue" size={16} /> Politique d’automatisation IA</h2><span className="badge">v{policy.currentVersion || "—"}</span></div><div className="panel-body">{canEdit ? <MutationForm action={update} successMessage="La politique d’automatisation a été enregistrée."><label className="block text-xs font-semibold text-muted">Nom<input className="control mt-1 w-full" name="name" required defaultValue={policy.name} /></label><div className="mt-4 grid gap-3 md:grid-cols-3"><ReadOnlyRule label="Premier contact" autonomous={rules.firstContactRequiresHumanApproval !== true} /><ReadOnlyRule label="Réponses" autonomous={rules.responsesRequireHumanApproval !== true} /><label className="flex items-start gap-2 rounded-lg border border-line p-3 text-xs font-semibold text-muted"><input className="mt-0.5" name="followUpsMayBeAutomated" type="checkbox" defaultChecked={rules.followUpsMayBeAutomated} />Relances automatisées autorisées</label></div><label className="mt-3 block text-xs font-semibold text-muted">Règles d’escalade (JSON facultatif)<textarea className="control mt-1 min-h-20 w-full font-mono text-xs" name="escalationRules" defaultValue={rules.escalationRules ? JSON.stringify(rules.escalationRules, null, 2) : ""} /></label><button className="button button-signal mt-4" type="submit">Enregistrer la politique</button></MutationForm> : <PolicyReadOnly policy={policy} />}{canPublish ? <MutationForm action={publish} className="mt-5 border-t border-line pt-4" confirmation="Publier cette politique ? La version publiée sera immuable." successMessage="La politique a été publiée."><button className="button" type="submit">Publier la politique</button></MutationForm> : <p className="mt-4 text-xs text-muted">Publication réservée aux owners/admins.</p>}{policy.versions?.length ? <VersionHistory versions={policy.versions} /> : null}</div></section>;
}

function ReadOnlyRule({ label, autonomous = true }: { label: string; autonomous?: boolean }) { return <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-emerald-50 p-3 text-xs text-success"><ShieldCheck className="shrink-0" size={15} /><span>{label} : {autonomous ? "envoi autonome activé" : "validation humaine requise"}</span></div>; }
function PolicyReadOnly({ policy }: { policy: AIPolicy }) { return <div className="space-y-3 text-sm"><p><span className="text-xs text-muted">Nom</span><br /><strong>{policy.name}</strong></p><ReadOnlyRule label="Premier contact" autonomous={policy.draftRules.firstContactRequiresHumanApproval !== true} /><ReadOnlyRule label="Réponses" autonomous={policy.draftRules.responsesRequireHumanApproval !== true} /><p className="text-xs text-muted">Édition réservée aux operator/admin/owner.</p></div>; }
function VersionHistory({ versions }: { versions: readonly { version: number; publishedAt: string; publishedBy: string | null }[] }) { return <div className="mt-5 border-t border-line pt-4"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Versions publiées · lecture seule</h3><ul className="mt-2 space-y-2">{versions.map((version) => <li className="flex flex-wrap justify-between gap-2 rounded border border-line p-2 text-xs" key={version.version}><span className="font-semibold">v{version.version}</span><span className="text-muted">{formatDate(version.publishedAt)} · {version.publishedBy ?? "auteur inconnu"}</span></li>)}</ul></div>; }
function channelLabel(channel: MessagingChannel): string { return ({ linkedin: "LinkedIn", email: "Email", whatsapp: "WhatsApp" })[channel]; }
function formatDate(value: string): string { return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
