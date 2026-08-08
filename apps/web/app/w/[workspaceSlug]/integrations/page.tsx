import { CheckCircle2, Link2, PlugZap, RefreshCw, ShieldAlert, Unplug } from "lucide-react";
import { CrmEmptyState, CrmPermissionState } from "@/components/crm-states";
import { listConnectedAccounts, listWorkspaces, OutboundApiError, type ConnectedAccount } from "@/lib/api";
import { MutationForm } from "../research/[runId]/report/mutation-form";
import { accountAction, connectAccountAction } from "./actions";

export const metadata = { title: "Intégrations" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: "connexion en attente", className: "badge badge-warning" },
  connected: { label: "sain", className: "badge badge-success" },
  degraded: { label: "dégradé · actions suspendues", className: "badge badge-danger" },
  disconnected: { label: "déconnecté", className: "badge" },
  unknown: { label: "inconnu · vérification nécessaire", className: "badge badge-warning" },
};

export default async function IntegrationsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const workspace = (await listWorkspaces()).find((item) => item.slug === workspaceSlug);
  if (!workspace) return <CrmPermissionState resource="les intégrations" />;
  let accounts: ConnectedAccount[];
  try { accounts = (await listConnectedAccounts(workspaceSlug)).data; } catch (error) {
    if (error instanceof OutboundApiError && (error.status === 401 || error.status === 403)) return <CrmPermissionState resource="les intégrations" />;
    throw error;
  }
  const canManage = ["admin", "owner"].includes(workspace.role);
  return <>
    <header className="mb-6"><span className="badge badge-signal">Unipile · comptes connectés</span><h1 className="page-title mt-3">Intégrations</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-muted">Suivez la santé et les capacités réelles de vos comptes d’envoi. Les secrets sont transmis directement au serveur et ne sont jamais réaffichés.</p></header>
    {canManage ? <ConnectForm workspaceSlug={workspaceSlug} /> : <p className="mb-5 rounded-lg border border-line bg-slate-50 p-3 text-xs text-muted">Votre rôle peut consulter la santé des comptes. La connexion, reconnexion et déconnexion sont réservées aux admins et owners.</p>}
    <section className="panel"><div className="panel-header"><h2 className="flex items-center gap-2 font-semibold"><PlugZap size={16} className="text-brand-blue" /> Comptes connectés</h2><span className="badge">{accounts.length}</span></div><div className="panel-body">{accounts.length === 0 ? <CrmEmptyState title="Aucun compte connecté" description="Connectez un compte Unipile pour rendre les canaux disponibles au préflight des campagnes." /> : <div className="grid gap-4 lg:grid-cols-2">{accounts.map((account) => <AccountCard account={account} canManage={canManage} workspaceSlug={workspaceSlug} key={account.id} />)}</div>}</div></section>
  </>;
}

function ConnectForm({ workspaceSlug }: { workspaceSlug: string }) {
  return <section className="panel mb-5"><div className="panel-header"><h2 className="flex items-center gap-2 font-semibold"><Link2 size={15} className="text-brand-blue" /> Connecter un compte Unipile</h2></div><MutationForm action={connectAccountAction.bind(null, workspaceSlug)} className="panel-body grid gap-3 sm:grid-cols-2" successMessage="Compte connecté. Son statut et ses capacités ont été enregistrés."><label className="block text-xs font-semibold text-muted">Identifiant du compte<input className="control mt-1 w-full" name="providerAccountId" required placeholder="Identifiant Unipile" /></label><label className="block text-xs font-semibold text-muted">Nom d’affichage<input className="control mt-1 w-full" name="displayName" placeholder="LinkedIn Sales" /></label><label className="block text-xs font-semibold text-muted sm:col-span-2">Secret d’accès<input className="control mt-1 w-full" name="accessToken" required type="password" autoComplete="new-password" /></label><p className="text-[11px] leading-4 text-muted sm:col-span-2">Le secret est envoyé au backend pour stockage chiffré. Il n’est ni conservé dans le formulaire, ni renvoyé dans la réponse.</p><button className="button button-signal sm:col-span-2" type="submit"><PlugZap size={14} /> Connecter</button></MutationForm></section>;
}

function AccountCard({ account, canManage, workspaceSlug }: { account: ConnectedAccount; canManage: boolean; workspaceSlug: string }) {
  const status = STATUS[account.status] ?? { label: "statut inconnu", className: "badge badge-warning" };
  const check = accountAction.bind(null, workspaceSlug, account.id, "check");
  const reconnect = accountAction.bind(null, workspaceSlug, account.id, "reconnect");
  const disconnect = accountAction.bind(null, workspaceSlug, account.id, "disconnect");
  return <article className="rounded-lg border border-line p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="truncate text-sm">{account.displayName || account.providerAccountId}</strong><span className={status.className}>{status.label}</span></div><p className="mt-1 text-xs text-muted">Provider : {account.provider} · ID : <span className="font-mono">{account.providerAccountId}</span></p></div><span className="badge">{account.status}</span></div>{account.status === "degraded" ? <p className="mt-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-red-50 p-3 text-xs text-danger"><ShieldAlert className="mt-0.5 shrink-0" size={14} /><span><strong>Actions suspendues pour ce compte uniquement.</strong><br />{account.lastErrorMessage || account.lastErrorCode || "Une vérification a détecté un problème."} Les autres comptes restent utilisables.</span></p> : null}{account.status === "unknown" ? <p className="mt-3 rounded-lg border border-warning/30 bg-amber-50 p-3 text-xs text-warning">Statut inconnu : le fournisseur n’a pas pu être vérifié. Ne le présentez pas comme sain.</p> : null}<div className="mt-3 rounded-lg bg-slate-50 p-3"><h3 className="text-xs font-semibold text-navy">Capacités et quotas réels</h3>{Object.keys(account.capabilities).length || Object.keys(account.quotas).length ? <div className="mt-2 grid gap-1 text-[11px] text-muted">{Object.entries(account.capabilities).map(([key, value]) => <p key={`cap-${key}`}><strong>{key} :</strong> {formatValue(value)}</p>)}{Object.entries(account.quotas).map(([key, value]) => <p key={`quota-${key}`}><strong>quota {key} :</strong> {formatValue(value)}</p>)}</div> : <p className="mt-1 text-[11px] text-muted">Capacités redacted pour ce rôle ou non encore disponibles.</p>}</div><p className="mt-3 text-[11px] text-muted">Dernière vérification : {account.lastCheckedAt ? formatDate(account.lastCheckedAt) : "jamais"}</p>{canManage ? <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">{account.status === "degraded" || account.status === "unknown" || account.status === "disconnected" ? <MutationForm action={reconnect} confirmation="Reconnecter ce compte via le fournisseur ?" successMessage="Demande de reconnexion effectuée."><button className="button" type="submit"><RefreshCw size={13} /> Reconnecter</button></MutationForm> : <MutationForm action={check} successMessage="Vérification actualisée."><button className="button" type="submit"><RefreshCw size={13} /> Vérifier</button></MutationForm>}<MutationForm action={disconnect} confirmation="Déconnecter ce compte ? L’historique des conversations et actions sera conservé." successMessage="Compte déconnecté. L’historique est conservé."><button className="button" type="submit"><Unplug size={13} /> Déconnecter</button></MutationForm></div> : null}<div className="mt-3 text-[11px] text-muted"><CheckCircle2 className="mr-1 inline text-success" size={12} />Les secrets ne sont jamais affichés.</div></article>;
}

function formatValue(value: unknown): string { return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value); }
function formatDate(value: string): string { return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
