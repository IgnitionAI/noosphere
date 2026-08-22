import { Clock3, MailPlus, ShieldCheck, UserRoundCog, UsersRound } from "lucide-react";
import { notFound } from "next/navigation";
import {
  getSession,
  listWorkspaceInvitations,
  listWorkspaceMembers,
  listWorkspaces,
  type WorkspaceMember,
} from "@/lib/api";
import {
  canManageWorkspaceMember,
  manageableWorkspaceRoles,
  workspaceMemberLabel,
  workspaceRoleLabels,
} from "@/lib/workspace-members";
import {
  changeMemberRoleAction,
  inviteMemberAction,
  revokeInvitationAction,
  setMemberStatusAction,
} from "./actions";
import { CopyInvitationLink } from "./copy-invitation-link";

export const metadata = { title: "Équipe" };
export const dynamic = "force-dynamic";

export default async function WorkspaceMembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const [{ workspaceSlug }, query, session, workspaces] = await Promise.all([
    params,
    searchParams,
    getSession(),
    listWorkspaces(),
  ]);
  const workspace = workspaces.find((candidate) => candidate.slug === workspaceSlug);
  if (!session || !workspace) notFound();
  const canManage = workspace.role === "owner" || workspace.role === "admin";
  const [members, invitations] = await Promise.all([
    listWorkspaceMembers(workspaceSlug, workspace.id),
    canManage ? listWorkspaceInvitations(workspaceSlug, workspace.id) : Promise.resolve([]),
  ]);
  const invite = inviteMemberAction.bind(null, workspaceSlug, workspace.id);

  return (
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="badge badge-signal w-fit"><UsersRound size={13} /> Workspace</div>
          <h1 className="page-title mt-3">Équipe et accès</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Invitez les collaborateurs, attribuez leurs responsabilités et suspendez un accès sans perdre l’historique.
          </p>
        </div>
        <span className="badge badge-success"><ShieldCheck size={13} /> {members.filter((member) => member.status === "active").length} accès actifs</span>
      </header>

      {query.notice ? <p className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800" role="status">{query.notice}</p> : null}
      {query.error ? <p className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-danger" role="alert">{errorMessage(query.error)}</p> : null}

      {canManage ? (
        <section className="panel mt-6">
          <div className="panel-header"><div><h2 className="flex items-center gap-2 font-semibold"><MailPlus size={16} /> Inviter un membre</h2><p className="mt-1 text-xs text-muted">Le lien expire après 7 jours et ne peut être consommé qu’une fois.</p></div></div>
          <form action={invite} className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-end">
            <label className="text-xs font-semibold text-muted">Email professionnel<input autoComplete="email" className="control mt-1" name="email" placeholder="prenom@entreprise.com" required type="email" /></label>
            <label className="text-xs font-semibold text-muted">Rôle proposé<select className="control mt-1" defaultValue="operator" name="role">{manageableWorkspaceRoles(workspace.role).map((role) => <option key={role} value={role}>{workspaceRoleLabels[role]}</option>)}</select></label>
            <button className="button button-signal" type="submit">Créer l’invitation</button>
          </form>
        </section>
      ) : null}

      <section className="panel mt-6 overflow-hidden">
        <div className="panel-header"><div><h2 className="font-semibold">Membres</h2><p className="mt-1 text-xs text-muted">Les mutations sensibles sont validées et auditées côté serveur.</p></div><span className="badge">{members.length}</span></div>
        <div className="overflow-x-auto">
          <table className="data-table min-w-[840px]">
            <thead><tr><th>Membre</th><th>Rôle</th><th>Statut</th><th>Arrivée</th><th className="text-right">Actions</th></tr></thead>
            <tbody>{members.map((member) => <MemberRow actorUserId={session.user.id} actorRole={workspace.role} key={member.userId} member={member} workspaceId={workspace.id} workspaceSlug={workspaceSlug} />)}</tbody>
          </table>
        </div>
      </section>

      {canManage ? (
        <section className="panel mt-6 overflow-hidden">
          <div className="panel-header"><div><h2 className="flex items-center gap-2 font-semibold"><Clock3 size={16} /> Invitations en attente</h2><p className="mt-1 text-xs text-muted">Si aucun email n’est configuré, copiez simplement le lien sécurisé.</p></div><span className="badge">{invitations.length}</span></div>
          {invitations.length ? <div className="divide-y divide-line">{invitations.map((invitation) => {
            const revoke = revokeInvitationAction.bind(null, workspaceSlug, invitation.id);
            return <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center" key={invitation.id}><div className="min-w-0 flex-1"><strong className="block truncate text-sm">{invitation.email}</strong><p className="mt-1 text-xs text-muted">{workspaceRoleLabels[invitation.proposedRole]} · expire le {formatDate(invitation.expiresAt)}</p></div><div className="flex flex-wrap gap-2"><CopyInvitationLink invitationId={invitation.id} /><form action={revoke}><button className="button min-h-8 px-2.5 text-xs text-danger" type="submit">Révoquer</button></form></div></div>;
          })}</div> : <div className="p-8 text-center text-sm text-muted">Aucune invitation en attente.</div>}
        </section>
      ) : null}
    </div>
  );
}

function MemberRow({ actorUserId, actorRole, member, workspaceId, workspaceSlug }: { actorUserId: string; actorRole: "viewer" | "operator" | "reviewer" | "admin" | "owner"; member: WorkspaceMember; workspaceId: string; workspaceSlug: string }) {
  const manageable = canManageWorkspaceMember({ actorUserId, actorRole, member });
  const changeRole = changeMemberRoleAction.bind(null, workspaceSlug, workspaceId, member.userId);
  const nextStatus = member.status === "active" ? "disabled" : "active";
  const setStatus = setMemberStatusAction.bind(null, workspaceSlug, workspaceId, member.userId, nextStatus);
  return <tr><td><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-ink"><UserRoundCog size={15} /></span><div><strong className="block text-sm">{workspaceMemberLabel(member)}{member.userId === actorUserId ? " (vous)" : ""}</strong><span className="text-xs text-muted">{member.email}</span></div></div></td><td>{manageable ? <form action={changeRole} className="flex items-center gap-2"><select aria-label={`Rôle de ${workspaceMemberLabel(member)}`} className="control min-w-40" defaultValue={member.role} name="role">{manageableWorkspaceRoles(actorRole).map((role) => <option key={role} value={role}>{workspaceRoleLabels[role]}</option>)}</select><button className="button min-h-8 px-2.5 text-xs" type="submit">Mettre à jour</button></form> : <span className="badge">{workspaceRoleLabels[member.role]}</span>}</td><td><span className={member.status === "active" ? "badge badge-success" : "badge badge-warning"}>{member.status === "active" ? "Actif" : "Désactivé"}</span></td><td className="text-xs text-muted">{formatDate(member.joinedAt)}</td><td className="text-right">{manageable ? <form action={setStatus}><button className={`button min-h-8 px-2.5 text-xs ${member.status === "active" ? "text-danger" : ""}`} type="submit">{member.status === "active" ? "Désactiver" : "Réactiver"}</button></form> : <span className="text-xs text-muted">Protégé</span>}</td></tr>;
}

function formatDate(value: string) { return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "Europe/Paris" }).format(new Date(value)); }

function errorMessage(code: string) {
  return ({ WORKSPACE_LAST_OWNER: "Le dernier owner actif ne peut pas être rétrogradé ou désactivé.", WORKSPACE_SELF_ROLE_CHANGE_FORBIDDEN: "Vous ne pouvez pas modifier votre propre rôle.", WORKSPACE_SELF_MUTATION_FORBIDDEN: "Vous ne pouvez pas désactiver votre propre accès.", WORKSPACE_OWNER_MANAGEMENT_REQUIRED: "Seul un owner peut administrer un autre owner.", WORKSPACE_MEMBER_ALREADY_ACTIVE: "Cette personne est déjà membre actif du workspace.", VALIDATION_FAILED: "Vérifiez l’email et le rôle choisis." } as Record<string, string>)[code] ?? "La modification n’a pas pu être appliquée. Réessayez.";
}
