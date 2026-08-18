import { Activity, Archive, ArrowRight, CalendarDays, Clock3, Database, Download, ExternalLink, Gauge, Mail, MessageCircle, Settings, ShieldCheck, Sparkles, UsersRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getSession,
  getWorkspaceDataExport,
  getWorkspaceDataPolicy,
  getSetupReadiness,
  listWorkspaceAuditLogs,
  listWorkspaceMembers,
  listWorkspaces,
  OutboundApiError,
} from "@/lib/api";
import { requestExportAction, updateLimitsAction, updateProfileAction, updateRetentionAction, updateSendingAction } from "./actions";
import { ExportRefresh } from "./export-refresh";

export const metadata = { title: "Paramètres" };
export const dynamic = "force-dynamic";

export default async function WorkspaceSettingsPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string }>; searchParams: Promise<{ notice?: string; error?: string; exportId?: string; action?: string; actorUserId?: string; from?: string; to?: string }> }) {
  const [{ workspaceSlug }, query, session, workspaces] = await Promise.all([params, searchParams, getSession(), listWorkspaces()]);
  const workspace = workspaces.find((candidate) => candidate.slug === workspaceSlug);
  if (!session || !workspace) notFound();
  const operationalReader = workspace.role !== "viewer";
  const canOperate = workspace.role === "owner" || workspace.role === "admin" || workspace.role === "operator";
  const canAdminister = workspace.role === "owner" || workspace.role === "admin";
  const [policy, members, audit] = await Promise.all([
    operationalReader ? getWorkspaceDataPolicy(workspaceSlug, workspace.id, canAdminister) : null,
    listWorkspaceMembers(workspaceSlug, workspace.id),
    canAdminister ? listWorkspaceAuditLogs(workspaceSlug, {
      ...(query.action ? { action: query.action } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      limit: 50,
    }) : [],
  ]);
  const readiness = await getSetupReadiness(workspaceSlug).catch(() => null);
  let dataExport: Awaited<ReturnType<typeof getWorkspaceDataExport>> | null = null;
  let exportExpired = false;
  if (canAdminister && query.exportId) {
    try { dataExport = await getWorkspaceDataExport(workspaceSlug, query.exportId); }
    catch (error) { exportExpired = error instanceof OutboundApiError && error.status === 410; }
  }
  const profile = updateProfileAction.bind(null, workspaceSlug, workspace.id);
  const sending = updateSendingAction.bind(null, workspaceSlug, workspace.id);
  const limits = updateLimitsAction.bind(null, workspaceSlug, workspace.id);
  const retention = updateRetentionAction.bind(null, workspaceSlug, workspace.id);
  const requestExport = requestExportAction.bind(null, workspaceSlug, workspace.id);

  return <div className="mx-auto max-w-6xl">
    <ExportRefresh active={dataExport?.status === "pending" || dataExport?.status === "processing"} />
    <header className="border-b border-line pb-6"><div className="badge badge-signal w-fit"><Settings size={13} /> Administration</div><h1 className="page-title mt-3">Paramètres du workspace</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-muted">Profil, équipe, cadence d’envoi, sécurité et cycle de vie des données — chaque mutation sensible reste isolée et auditée.</p></header>
    {query.notice ? <p className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800" role="status">{query.notice}</p> : null}
    {query.error ? <p className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-danger" role="alert">{settingsError(query.error)}</p> : null}

    {readiness ? <section className="panel mt-6"><div className="panel-header"><div><h2 className="font-semibold">Lancement guidé</h2><p className="mt-1 text-xs text-muted">Les prérequis sont vérifiés automatiquement ; les éléments optionnels peuvent être ajoutés plus tard.</p></div><span className={readiness.ready ? "badge badge-success" : "badge badge-warning"}>{readiness.ready ? "Prêt à lancer" : "À compléter"}</span></div><div className="divide-y divide-line">{readiness.items.map((item) => <Link className="flex items-center gap-3 p-4 transition hover:bg-slate-50" href={item.action ? `/w/${workspaceSlug}${item.action.href}` : `/w/${workspaceSlug}/settings`} key={item.key}><span className={`grid h-8 w-8 place-items-center rounded-full ${item.state === "ready" ? "bg-emerald-50 text-success" : item.state === "optional" ? "bg-slate-100 text-muted" : "bg-amber-50 text-warning"}`}>{item.state === "ready" ? <ShieldCheck size={15} /> : <ArrowRight size={15} />}</span><span className="min-w-0 flex-1"><strong className="block text-sm">{item.label}</strong><span className="mt-1 block text-xs text-muted">{item.reason}</span></span><span className="badge">{item.state === "ready" ? "Prêt" : item.state === "optional" ? "Optionnel" : "Action requise"}</span></Link>)}</div></section> : null}

    <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <SettingLink href={`/w/${workspaceSlug}/settings/members`} icon={<UsersRound size={17} />} label="Équipe" detail={`${members.length} membre${members.length > 1 ? "s" : ""}`} />
      {canOperate ? <SettingLink href={`/w/${workspaceSlug}/settings/console`} icon={<Activity size={17} />} label="Console opérateur" detail="Jobs et corrélations" /> : null}
      {canAdminister ? <>
        <SettingLink href={`/w/${workspaceSlug}/settings/channels`} icon={<MessageCircle size={17} />} label="Canaux" detail="Comptes d’envoi" />
        <SettingLink href={`/w/${workspaceSlug}/settings/calendar`} icon={<CalendarDays size={17} />} label="Agenda" detail="Cal.com et RDV" />
        <SettingLink href={`/w/${workspaceSlug}/settings/ai`} icon={<Sparkles size={17} />} label="Modèles IA" detail="Kimi et fallbacks" />
      </> : null}
    </section>

    <section className="panel mt-6"><div className="panel-header"><div><h2 className="font-semibold">Profil</h2><p className="mt-1 text-xs text-muted">Le nom est modifiable ; le slug reste stable pour ne casser aucun lien.</p></div><span className="badge">{workspace.slug}</span></div>{canAdminister ? <form action={profile} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"><label className="text-xs font-semibold text-muted">Nom<input className="control mt-1" defaultValue={workspace.name} maxLength={200} name="name" required /></label><label className="text-xs font-semibold text-muted">Slug immuable<input className="control mt-1 bg-slate-50" disabled value={workspace.slug} /></label><button className="button button-primary" type="submit">Renommer</button></form> : <div className="p-4"><strong>{workspace.name}</strong><p className="mt-1 text-xs text-muted">/{workspace.slug}</p></div>}</section>

    {policy ? <>
      <section className="panel mt-6"><div className="panel-header"><div><h2 className="flex items-center gap-2 font-semibold"><Clock3 size={16} /> Fenêtre d’envoi par défaut</h2><p className="mt-1 text-xs text-muted">Les campagnes gardent leur snapshot ; ces valeurs servent aux prochaines planifications.</p></div></div><form action={canAdminister ? sending : undefined} className="grid gap-4 p-4 lg:grid-cols-4"><label className="text-xs font-semibold text-muted">Fuseau<input className="control mt-1" defaultValue={policy.sending.timezone} disabled={!canAdminister} name="timezone" required /></label><label className="text-xs font-semibold text-muted">Début<input className="control mt-1" defaultValue={policy.sending.windowStart} disabled={!canAdminister} name="windowStart" type="time" /></label><label className="text-xs font-semibold text-muted">Fin<input className="control mt-1" defaultValue={policy.sending.windowEnd} disabled={!canAdminister} name="windowEnd" type="time" /></label><div><span className="text-xs font-semibold text-muted">Jours actifs</span><div className="mt-2 flex flex-wrap gap-2">{[[1,"L"],[2,"M"],[3,"M"],[4,"J"],[5,"V"],[6,"S"],[7,"D"]].map(([day,label]) => <label className="flex items-center gap-1 text-xs" key={day}><input defaultChecked={policy.sending.activeDays.includes(Number(day))} disabled={!canAdminister} name="activeDays" type="checkbox" value={day} />{label}</label>)}</div></div>{canAdminister ? <div className="lg:col-span-4"><button className="button button-primary" type="submit">Enregistrer la fenêtre</button></div> : null}</form></section>

      <section className="panel mt-6"><div className="panel-header"><div><h2 className="flex items-center gap-2 font-semibold"><Gauge size={16} /> Limites quotidiennes</h2><p className="mt-1 text-xs text-muted">Appliquées au dispatch suivant, sans modifier les actions déjà planifiées.</p></div></div><form action={canAdminister ? limits : undefined} className="grid gap-4 p-4 sm:grid-cols-3"><LimitField disabled={!canAdminister} icon={<Mail size={14} />} label="Email" max={500} name="email" value={policy.channelLimits.email} /><LimitField disabled={!canAdminister} icon={<ExternalLink size={14} />} label="LinkedIn" max={100} name="linkedin" value={policy.channelLimits.linkedin} /><LimitField disabled={!canAdminister} icon={<MessageCircle size={14} />} label="WhatsApp" max={200} name="whatsapp" value={policy.channelLimits.whatsapp} />{canAdminister ? <div className="sm:col-span-3"><button className="button button-primary" type="submit">Enregistrer les limites</button></div> : null}</form></section>
    </> : null}

    {canAdminister && policy ? <>
      <section className="panel mt-6"><div className="panel-header"><div><h2 className="flex items-center gap-2 font-semibold"><Archive size={16} /> Rétention</h2><p className="mt-1 text-xs text-muted">Une réduction planifie une purge asynchrone, idempotente et auditée.</p></div></div><form action={retention} className="grid gap-4 p-4 sm:grid-cols-3"><RetentionField label="Invitations expirées" min={30} max={3650} name="invitationsDays" value={policy.retention.invitationsDays} /><RetentionField label="Jobs et events traités" min={30} max={365} name="jobsDays" value={policy.retention.jobsDays} /><RetentionField label="Audit" min={365} max={3650} name="auditDays" value={policy.retention.auditDays} /><label className="text-xs font-semibold text-muted sm:col-span-3">Confirmation si vous réduisez une durée<input className="control mt-1" name="confirmation" placeholder="MODIFIER LA RÉTENTION" /><span className="mt-1 block text-[11px] font-normal">Saisissez exactement « MODIFIER LA RÉTENTION ».</span></label><div className="sm:col-span-3"><button className="button button-primary" type="submit">Enregistrer la rétention</button></div></form></section>

      <section className="panel mt-6" id="data"><div className="panel-header"><div><h2 className="flex items-center gap-2 font-semibold"><Database size={16} /> Export des données</h2><p className="mt-1 text-xs text-muted">Archive isolée au workspace, sans secrets techniques, disponible 72 heures.</p></div></div><div className="p-4"><form action={requestExport}><input name="requestKey" type="hidden" value={crypto.randomUUID()} /><button className="button button-signal" type="submit"><Download size={15} /> Générer une archive</button></form>{dataExport ? <div className="mt-4 rounded-lg border border-line bg-slate-50 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><strong className="text-sm">Export {exportStatus(dataExport.status)}</strong><p className="mt-1 text-xs text-muted">Demandé le {formatDate(dataExport.createdAt)}{dataExport.expiresAt ? ` · expire le ${formatDate(dataExport.expiresAt)}` : ""}</p></div>{dataExport.downloadUrl ? <a className="button button-primary" href={dataExport.downloadUrl}><Download size={14} /> Télécharger</a> : <span className="badge">{dataExport.status === "failed" ? dataExport.failureCode ?? "Échec" : "Préparation…"}</span>}</div></div> : exportExpired ? <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-warning">Le lien de cet export a expiré. Générez une nouvelle archive.</p> : null}</div></section>

      <section className="panel mt-6"><div className="panel-header"><div><h2 className="flex items-center gap-2 font-semibold"><ShieldCheck size={16} /> Journal d’audit</h2><p className="mt-1 text-xs text-muted">Filtrez les mutations sensibles par action, acteur et période.</p></div><span className="badge">{audit.length}</span></div><form className="grid gap-3 border-b border-line p-4 sm:grid-cols-4"><label className="text-xs font-semibold text-muted">Action<input className="control mt-1" defaultValue={query.action ?? ""} name="action" placeholder="ContactAnonymized" /></label><label className="text-xs font-semibold text-muted">Acteur<select className="control mt-1" defaultValue={query.actorUserId ?? ""} name="actorUserId"><option value="">Tous</option>{members.map((member) => <option key={member.userId} value={member.userId}>{member.name || member.email}</option>)}</select></label><label className="text-xs font-semibold text-muted">Du<input className="control mt-1" defaultValue={query.from?.slice(0,10) ?? ""} name="from" type="date" /></label><label className="text-xs font-semibold text-muted">Au<input className="control mt-1" defaultValue={query.to?.slice(0,10) ?? ""} name="to" type="date" /></label><div className="sm:col-span-4"><button className="button" type="submit">Filtrer</button></div></form>{audit.length ? <div className="overflow-x-auto"><table className="data-table min-w-[780px]"><thead><tr><th>Date</th><th>Action</th><th>Acteur</th><th>Cible</th></tr></thead><tbody>{audit.map((entry) => <tr key={entry.id}><td className="text-xs text-muted">{formatDate(entry.createdAt)}</td><td><strong className="text-xs">{entry.action}</strong></td><td className="text-xs">{entry.actorName || entry.actorEmail || "Système"}</td><td className="text-xs text-muted">{entry.subjectType} · {entry.subjectId.slice(0,8)}</td></tr>)}</tbody></table></div> : <div className="p-8 text-center text-sm text-muted">Aucune entrée ne correspond à ces filtres.</div>}</section>
    </> : null}
  </div>;
}

function SettingLink({ href, icon, label, detail }: { href: string; icon: React.ReactNode; label: string; detail: string }) { return <Link className="panel flex items-center gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-md" href={href}><span className="grid h-9 w-9 place-items-center rounded-lg bg-navy text-signal">{icon}</span><span><strong className="block text-sm">{label}</strong><span className="mt-0.5 block text-[11px] text-muted">{detail}</span></span></Link>; }
function LimitField({ label, name, value, max, disabled, icon }: { label: string; name: string; value: number; max: number; disabled: boolean; icon: React.ReactNode }) { return <label className="text-xs font-semibold text-muted"><span className="flex items-center gap-1.5">{icon}{label}</span><input className="control mt-1" defaultValue={value} disabled={disabled} max={max} min={1} name={name} required type="number" /></label>; }
function RetentionField({ label, name, value, min, max }: { label: string; name: string; value: number; min: number; max: number }) { return <label className="text-xs font-semibold text-muted">{label}<input className="control mt-1" defaultValue={value} max={max} min={min} name={name} required type="number" /><span className="mt-1 block text-[11px] font-normal">jours</span></label>; }
function exportStatus(status: string) { return ({ pending: "en attente", processing: "en cours", completed: "prêt", failed: "échoué" } as Record<string,string>)[status] ?? status; }
function formatDate(value: string) { return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(value)); }
function settingsError(code: string) { return ({ TYPED_CONFIRMATION_REQUIRED: "La confirmation typée est requise pour réduire la rétention.", WORKSPACE_CHANNEL_LIMIT_INVALID: "Une limite de canal est hors des bornes autorisées.", WORKSPACE_SENDING_WINDOW_INVALID: "La fenêtre d’envoi est invalide.", WORKSPACE_RETENTION_INVALID: "Une durée de rétention est hors des bornes autorisées.", WORKSPACE_EXPORT_ALREADY_RUNNING: "Un export est déjà en cours." } as Record<string,string>)[code] ?? "La modification n’a pas pu être appliquée."; }
