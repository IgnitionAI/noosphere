import { CheckCircle2, Link2, PlugZap, RefreshCw, ShieldAlert, Unplug } from "lucide-react";
import { CrmEmptyState, CrmPermissionState } from "@/components/crm-states";
import {
  getConnectedAccountImpact,
  getConnectedAccountOnboarding,
  getConnectedAccountQuotas,
  listConnectedAccounts,
  listWorkspaces,
  OutboundApiError,
  type AccountQuota,
  type AccountSuspensionImpact,
  type ConnectedAccount,
  type ConnectionOnboarding,
} from "@/lib/api";
import { MutationForm } from "../research/[runId]/report/mutation-form";
import { accountAction, startOnboardingAction } from "./actions";
import { OnboardingProgress, OnboardingStartForm } from "./onboarding-client";

export const metadata = { title: "Intégrations" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: "connexion en attente", className: "badge badge-warning" },
  connected: { label: "sain", className: "badge badge-success" },
  degraded: { label: "dégradé · actions suspendues", className: "badge badge-danger" },
  disconnected: { label: "déconnecté", className: "badge" },
  unknown: { label: "inconnu · vérification nécessaire", className: "badge badge-warning" },
};

export default async function IntegrationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ onboardingId?: string; channel?: string }>;
}) {
  const { workspaceSlug } = await params;
  const { onboardingId, channel } = await searchParams;
  const workspace = (await listWorkspaces()).find((item) => item.slug === workspaceSlug);
  if (!workspace) return <CrmPermissionState resource="les intégrations" />;
  let accounts: ConnectedAccount[];
  try {
    accounts = (await listConnectedAccounts(workspaceSlug)).data;
  } catch (error) {
    if (error instanceof OutboundApiError && (error.status === 401 || error.status === 403)) return <CrmPermissionState resource="les intégrations" />;
    throw error;
  }
  const canManage = ["admin", "owner"].includes(workspace.role);
  const canReadOperations = ["operator", "admin", "owner"].includes(workspace.role);
  const defaultChannel = channel === "email" || channel === "linkedin" || channel === "whatsapp" ? channel : undefined;
  const onboarding = canManage && onboardingId ? await loadOnboarding(workspaceSlug, onboardingId) : null;
  const quotaEntries = canReadOperations
    ? await Promise.all(accounts.map(async (account) => [account.id, await loadQuota(workspaceSlug, account.id)] as const))
    : [];
  const impactEntries = canReadOperations
    ? await Promise.all(accounts.filter((account) => account.status === "degraded").map(async (account) => [account.id, await loadImpact(workspaceSlug, account.id)] as const))
    : [];
  const quotas = new Map(quotaEntries.filter((entry): entry is [string, AccountQuota] => entry[1] !== null));
  const impacts = new Map(impactEntries.filter((entry): entry is [string, AccountSuspensionImpact] => entry[1] !== null));
  const start = startOnboardingAction.bind(null, workspaceSlug);

  return (
    <>
      <header className="mb-6">
        <span className="badge badge-signal">Unipile · comptes connectés</span>
        <h1 className="page-title mt-3">Intégrations</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">Suivez la santé et les capacités réelles de vos comptes d’envoi. L’assistant utilise un lien hébergé : aucun secret ne transite par le navigateur.</p>
      </header>

      {canManage ? <OnboardingSection action={start} {...(defaultChannel ? { defaultChannel } : {})} /> : <p className="mb-5 rounded-lg border border-line bg-slate-50 p-3 text-xs text-muted">Votre rôle peut consulter la santé des comptes. La connexion, reconnexion et déconnexion sont réservées aux admins et owners.</p>}
      {onboarding ? <OnboardingProgress onboarding={onboarding} workspaceSlug={workspaceSlug} /> : null}

      <section className="panel">
        <div className="panel-header"><h2 className="flex items-center gap-2 font-semibold"><PlugZap size={16} className="text-brand-blue" /> Comptes connectés</h2><span className="badge">{accounts.length}</span></div>
        <div className="panel-body">
          {accounts.length === 0 ? <CrmEmptyState title="Aucun compte connecté" description="Lancez l’assistant pour rendre les canaux disponibles au préflight des campagnes." /> : <div className="grid gap-4 lg:grid-cols-2">{accounts.map((account) => <AccountCard account={account} canManage={canManage} impact={impacts.get(account.id) ?? null} quota={quotas.get(account.id) ?? null} workspaceSlug={workspaceSlug} key={account.id} />)}</div>}
        </div>
      </section>
    </>
  );
}

function OnboardingSection({ action, defaultChannel }: { action: (formData: FormData) => Promise<void>; defaultChannel?: "email" | "linkedin" | "whatsapp" }) {
  return <section className="panel mb-5" id="connect-account"><div className="panel-header"><div><h2 className="flex items-center gap-2 font-semibold"><Link2 size={15} className="text-brand-blue" /> Connecter un compte</h2><p className="mt-1 text-xs text-muted">Choisissez un canal. Un onboarding actif pour ce canal sera repris automatiquement.</p></div></div><div className="panel-body"><OnboardingStartForm action={action} {...(defaultChannel ? { defaultChannel } : {})} /></div></section>;
}

function AccountCard({ account, canManage, workspaceSlug, quota, impact }: { account: ConnectedAccount; canManage: boolean; workspaceSlug: string; quota: AccountQuota | null; impact: AccountSuspensionImpact | null }) {
  const status = STATUS[account.status] ?? { label: "statut inconnu", className: "badge badge-warning" };
  const check = accountAction.bind(null, workspaceSlug, account.id, "check");
  const reconnect = accountAction.bind(null, workspaceSlug, account.id, "reconnect");
  const disconnect = accountAction.bind(null, workspaceSlug, account.id, "disconnect");
  return <article className="rounded-lg border border-line p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="truncate text-sm">{account.displayName || account.providerAccountId}</strong><span className={status.className}>{status.label}</span></div><p className="mt-1 text-xs text-muted">Provider : {account.provider} · ID : <span className="font-mono">{account.providerAccountId}</span></p></div><span className="badge">{account.status}</span></div>{account.status === "degraded" ? <p className="mt-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-red-50 p-3 text-xs text-danger"><ShieldAlert className="mt-0.5 shrink-0" size={14} /><span><strong>Actions suspendues pour ce compte uniquement.</strong><br />{account.lastErrorMessage || account.lastErrorCode || "Une vérification a détecté un problème."} Les autres comptes restent utilisables.</span></p> : null}{account.status === "unknown" ? <p className="mt-3 rounded-lg border border-warning/30 bg-amber-50 p-3 text-xs text-warning">Statut inconnu : le fournisseur n’a pas pu être vérifié. Ne le présentez pas comme sain.</p> : null}<div className="mt-3 rounded-lg bg-slate-50 p-3"><h3 className="text-xs font-semibold text-ink">Quotas du jour</h3>{quota ? <QuotaPanel quota={quota} /> : <p className="mt-1 text-[11px] text-muted">Quotas non disponibles pour ce rôle ou ce compte.</p>}</div>{impact ? <ImpactPanel impact={impact} /> : null}<div className="mt-3 rounded-lg border border-line p-3"><h3 className="text-xs font-semibold text-ink">Capacités confirmées</h3>{Object.keys(account.capabilities).length ? <div className="mt-2 grid gap-1 text-[11px] text-muted">{Object.entries(account.capabilities).map(([key, value]) => <p key={key}><strong>{key} :</strong> {formatValue(value)}</p>)}</div> : <p className="mt-1 text-[11px] text-muted">Aucune capacité confirmée pour ce rôle ou ce compte.</p>}</div><p className="mt-3 text-[11px] text-muted">Dernière vérification : {account.lastCheckedAt ? formatDate(account.lastCheckedAt) : "jamais"}</p>{canManage ? <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">{account.status === "degraded" || account.status === "unknown" || account.status === "disconnected" ? <MutationForm action={reconnect} confirmation="Reconnecter ce compte via le fournisseur ?" successMessage="Demande de reconnexion effectuée."><button className="button" type="submit"><RefreshCw size={13} /> Reconnecter</button></MutationForm> : <MutationForm action={check} successMessage="Vérification actualisée."><button className="button" type="submit"><RefreshCw size={13} /> Vérifier</button></MutationForm>}<MutationForm action={disconnect} confirmation="Déconnecter ce compte ? L’historique des conversations et actions sera conservé." successMessage="Compte déconnecté. L’historique est conservé."><button className="button" type="submit"><Unplug size={13} /> Déconnecter</button></MutationForm></div> : null}<div className="mt-3 text-[11px] text-muted"><CheckCircle2 className="mr-1 inline text-success" size={12} />Les secrets ne sont jamais affichés.</div></article>;
}

function QuotaPanel({ quota }: { quota: AccountQuota }) {
  return <div className="mt-2 space-y-2"><p className="text-[10px] text-muted">Référence : {quota.referenceDate} · {quota.timezone}</p>{quota.channels.length ? quota.channels.map((channel) => <div key={channel.channel}><div className="flex items-center justify-between gap-2 text-[11px]"><span className="font-medium capitalize text-ink">{channel.channel}</span><span className={`badge ${channel.state === "reached" ? "badge-danger" : channel.state === "near_limit" ? "badge-warning" : channel.state === "ok" ? "badge-success" : ""}`}>{channel.sentToday} / {channel.limit === null ? "sans limite" : channel.limit}</span></div>{channel.percentage !== null ? <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className={`h-full ${channel.state === "reached" ? "bg-danger" : channel.state === "near_limit" ? "bg-warning" : "bg-success"}`} style={{ width: `${Math.min(100, channel.percentage)}%` }} /></div> : null}</div>) : <p className="text-[11px] text-muted">Aucun canal avec capacité d’envoi confirmée.</p>}</div>;
}

function ImpactPanel({ impact }: { impact: AccountSuspensionImpact }) {
  return <div className="mt-3 rounded-lg border border-danger/25 bg-red-50 p-3"><h3 className="text-xs font-semibold text-danger">Impact de la suspension</h3>{impact.campaigns.length ? <div className="mt-2 space-y-1 text-[11px] text-danger">{impact.campaigns.map((campaign) => <p key={campaign.campaignId}><strong>{campaign.campaignName}</strong> · {campaign.suspendedActions} action{campaign.suspendedActions > 1 ? "s" : ""} suspendue{campaign.suspendedActions > 1 ? "s" : ""}</p>)}</div> : <p className="mt-1 text-[11px] text-danger">Aucune campagne active affectée.</p>}</div>;
}

async function loadOnboarding(workspaceSlug: string, onboardingId: string): Promise<ConnectionOnboarding | null> { try { return await getConnectedAccountOnboarding(workspaceSlug, onboardingId); } catch { return null; } }
async function loadQuota(workspaceSlug: string, accountId: string): Promise<AccountQuota | null> { try { return await getConnectedAccountQuotas(workspaceSlug, accountId); } catch { return null; } }
async function loadImpact(workspaceSlug: string, accountId: string): Promise<AccountSuspensionImpact | null> { try { return await getConnectedAccountImpact(workspaceSlug, accountId); } catch { return null; } }
function formatValue(value: unknown): string { return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value); }
function formatDate(value: string): string { return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
