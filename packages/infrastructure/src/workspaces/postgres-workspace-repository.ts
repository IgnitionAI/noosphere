import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  auditLogs,
  authUsers,
  outboxEvents,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from "@outbound/infrastructure/database/schema";
import type { WorkspaceRole } from "@outbound/interface/http/request-context";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";
type MemberStatus = "active" | "disabled";

const ROLE_RANK: Record<WorkspaceRole, number> = {
  viewer: 0,
  reviewer: 1,
  operator: 2,
  admin: 3,
  owner: 4,
};

export class WorkspaceManagementError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = "WorkspaceManagementError";
  }
}

export class PostgresWorkspaceRepository {
  constructor(private readonly db: Database) {}

  async createWorkspace(input: { userId: string; name: string; slug?: string | null; now?: Date }) {
    const now = input.now ?? new Date();
    return this.db.transaction(async (tx) => {
      const baseSlug = normalizeSlug(input.slug || input.name);
      let workspace: typeof workspaces.$inferSelect | undefined;
      for (let attempt = 0; attempt < 4 && !workspace; attempt += 1) {
        const slug = attempt === 0 ? baseSlug : `${baseSlug}-${randomSuffix()}`;
        try {
          [workspace] = await tx.insert(workspaces).values({ id: crypto.randomUUID(), slug, name: input.name.trim(), createdAt: now, updatedAt: now }).returning();
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
        }
      }
      if (!workspace) throw new WorkspaceManagementError("WORKSPACE_SLUG_UNAVAILABLE", 409);
      await tx.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: input.userId, role: "owner", status: "active", joinedAt: now });
      const event = await insertEvent(tx, {
        workspaceId: workspace.id,
        aggregateType: "Workspace",
        aggregateId: workspace.id,
        eventType: "WorkspaceCreated",
        payload: { workspaceId: workspace.id, slug: workspace.slug, createdBy: input.userId },
      });
      await tx.insert(auditLogs).values({ workspaceId: workspace.id, actorUserId: input.userId, action: "WorkspaceCreated", subjectType: "Workspace", subjectId: workspace.id, changes: { after: { name: workspace.name, slug: workspace.slug } }, sourceEventId: event.id, createdAt: now });
      return { ...workspace, role: "owner" as const };
    });
  }

  async listMembers(workspaceId: string) {
    return this.db
      .select({ workspaceId: workspaceMembers.workspaceId, userId: workspaceMembers.userId, email: authUsers.email, name: authUsers.name, role: workspaceMembers.role, status: workspaceMembers.status, joinedAt: workspaceMembers.joinedAt, lastSelectedAt: workspaceMembers.lastSelectedAt })
      .from(workspaceMembers)
      .innerJoin(authUsers, eq(authUsers.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, workspaceId))
      .orderBy(asc(authUsers.name), asc(authUsers.email));
  }

  async listInvitations(workspaceId: string, now = new Date()) {
    await this.expirePending(workspaceId, now);
    return this.db.select({ id: workspaceInvitations.id, workspaceId: workspaceInvitations.workspaceId, email: workspaceInvitations.email, proposedRole: workspaceInvitations.proposedRole, status: workspaceInvitations.status, expiresAt: workspaceInvitations.expiresAt, invitedBy: workspaceInvitations.invitedBy, acceptedBy: workspaceInvitations.acceptedBy, acceptedAt: workspaceInvitations.acceptedAt, revokedAt: workspaceInvitations.revokedAt, createdAt: workspaceInvitations.createdAt, updatedAt: workspaceInvitations.updatedAt }).from(workspaceInvitations).where(and(eq(workspaceInvitations.workspaceId, workspaceId), eq(workspaceInvitations.status, "pending"))).orderBy(desc(workspaceInvitations.createdAt));
  }

  async invite(input: { workspaceId: string; actorUserId: string; email: string; proposedRole: WorkspaceRole; actorRole?: WorkspaceRole; now?: Date }) {
    const now = input.now ?? new Date();
    const email = normalizeEmail(input.email);
    return this.db.transaction(async (tx) => {
      await lockWorkspace(tx, input.workspaceId);
      if (input.proposedRole === "owner" && (input.actorRole ?? "owner") !== "owner") throw new WorkspaceManagementError("WORKSPACE_OWNER_MANAGEMENT_REQUIRED", 403);
      const [existingUser] = await tx.select({ id: authUsers.id }).from(authUsers).where(eq(sql<string>`lower(${authUsers.email})`, email)).limit(1);
      if (existingUser) {
        const [member] = await tx.select({ status: workspaceMembers.status }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, existingUser.id))).limit(1);
        if (member?.status === "active") throw new WorkspaceManagementError("WORKSPACE_MEMBER_ALREADY_ACTIVE", 409);
      }
      const [pending] = await tx.select().from(workspaceInvitations).where(and(eq(workspaceInvitations.workspaceId, input.workspaceId), eq(sql<string>`lower(${workspaceInvitations.email})`, email), eq(workspaceInvitations.status, "pending"))).limit(1);
      let invitation: typeof workspaceInvitations.$inferSelect | undefined;
      if (pending) {
        [invitation] = await tx.update(workspaceInvitations).set({ proposedRole: input.proposedRole, expiresAt: new Date(now.getTime() + INVITATION_TTL_MS), invitedBy: input.actorUserId, updatedAt: now }).where(eq(workspaceInvitations.id, pending.id)).returning();
      } else {
        [invitation] = await tx.insert(workspaceInvitations).values({ id: crypto.randomUUID(), workspaceId: input.workspaceId, email, proposedRole: input.proposedRole, status: "pending", expiresAt: new Date(now.getTime() + INVITATION_TTL_MS), invitedBy: input.actorUserId, createdAt: now, updatedAt: now }).returning();
      }
      if (!invitation) throw new WorkspaceManagementError("WORKSPACE_INVITATION_FAILED", 409);
      const event = await insertEvent(tx, { workspaceId: input.workspaceId, aggregateType: "WorkspaceInvitation", aggregateId: invitation.id, eventType: "WorkspaceMemberInvited", payload: { invitationId: invitation.id, email, proposedRole: input.proposedRole, expiresAt: invitation.expiresAt.toISOString() } });
      await tx.insert(auditLogs).values({ workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "WorkspaceMemberInvited", subjectType: "WorkspaceInvitation", subjectId: invitation.id, changes: { after: { email, proposedRole: input.proposedRole, expiresAt: invitation.expiresAt.toISOString() }, renewed: Boolean(pending) }, sourceEventId: event.id, createdAt: now });
      return invitation;
    });
  }

  async acceptInvitation(input: { invitationId: string; userId: string; now?: Date }) {
    const now = input.now ?? new Date();
    const result = await this.db.transaction(async (tx) => {
      const [invitation] = await tx.select().from(workspaceInvitations).where(eq(workspaceInvitations.id, input.invitationId)).for("update").limit(1);
      if (!invitation) throw new WorkspaceManagementError("WORKSPACE_INVITATION_NOT_FOUND", 404);
      if (invitation.status === "accepted" && invitation.acceptedBy === input.userId) {
        const [member] = await tx.select().from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, invitation.workspaceId), eq(workspaceMembers.userId, input.userId))).limit(1);
        if (!member) throw new WorkspaceManagementError("WORKSPACE_MEMBER_NOT_FOUND", 404);
        return { invitation, member };
      }
      if (invitation.status !== "pending") throw new WorkspaceManagementError("WORKSPACE_INVITATION_CONSUMED", 409);
      if (invitation.expiresAt <= now) {
        await tx.update(workspaceInvitations).set({ status: "expired", updatedAt: now }).where(eq(workspaceInvitations.id, invitation.id));
        return new WorkspaceManagementError("WORKSPACE_INVITATION_EXPIRED", 410);
      }
      const [user] = await tx.select({ id: authUsers.id, email: authUsers.email }).from(authUsers).where(eq(authUsers.id, input.userId)).limit(1);
      if (!user || normalizeEmail(user.email) !== normalizeEmail(invitation.email)) throw new WorkspaceManagementError("WORKSPACE_INVITATION_EMAIL_MISMATCH", 403);
      const [membership] = await tx.select().from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, invitation.workspaceId), eq(workspaceMembers.userId, input.userId))).for("update").limit(1);
      if (membership?.status === "active") throw new WorkspaceManagementError("WORKSPACE_MEMBER_ALREADY_ACTIVE", 409);
      const [updatedMember] = membership
        ? await tx.update(workspaceMembers).set({ role: invitation.proposedRole, status: "active", joinedAt: now }).where(and(eq(workspaceMembers.workspaceId, invitation.workspaceId), eq(workspaceMembers.userId, input.userId))).returning()
        : await tx.insert(workspaceMembers).values({ workspaceId: invitation.workspaceId, userId: input.userId, role: invitation.proposedRole, status: "active", joinedAt: now }).returning();
      if (!updatedMember) throw new WorkspaceManagementError("WORKSPACE_MEMBER_UPDATE_FAILED", 409);
      const [updatedInvitation] = await tx.update(workspaceInvitations).set({ status: "accepted", acceptedBy: input.userId, acceptedAt: now, updatedAt: now }).where(eq(workspaceInvitations.id, invitation.id)).returning();
      if (!updatedInvitation) throw new WorkspaceManagementError("WORKSPACE_INVITATION_UPDATE_FAILED", 409);
      const event = await insertEvent(tx, { workspaceId: invitation.workspaceId, aggregateType: "WorkspaceInvitation", aggregateId: invitation.id, eventType: "WorkspaceInvitationAccepted", payload: { invitationId: invitation.id, userId: input.userId, role: updatedMember.role } });
      await tx.insert(auditLogs).values({ workspaceId: invitation.workspaceId, actorUserId: input.userId, action: "WorkspaceInvitationAccepted", subjectType: "WorkspaceMember", subjectId: input.userId, changes: { after: { role: updatedMember.role, status: updatedMember.status } }, sourceEventId: event.id, createdAt: now });
      return { invitation: updatedInvitation, member: updatedMember };
    });
    if (result instanceof WorkspaceManagementError) throw result;
    return result;
  }

  async revokeInvitation(input: { workspaceId: string; invitationId: string; actorUserId: string; now?: Date }) {
    const now = input.now ?? new Date();
    return this.db.transaction(async (tx) => {
      const [invitation] = await tx.select().from(workspaceInvitations).where(and(eq(workspaceInvitations.id, input.invitationId), eq(workspaceInvitations.workspaceId, input.workspaceId))).for("update").limit(1);
      if (!invitation) throw new WorkspaceManagementError("WORKSPACE_INVITATION_NOT_FOUND", 404);
      if (invitation.status !== "pending") throw new WorkspaceManagementError("WORKSPACE_INVITATION_NOT_PENDING", 409);
      const [updated] = await tx.update(workspaceInvitations).set({ status: "revoked", revokedAt: now, updatedAt: now }).where(eq(workspaceInvitations.id, invitation.id)).returning();
      if (!updated) throw new WorkspaceManagementError("WORKSPACE_INVITATION_UPDATE_FAILED", 409);
      const event = await insertEvent(tx, { workspaceId: input.workspaceId, aggregateType: "WorkspaceInvitation", aggregateId: invitation.id, eventType: "WorkspaceInvitationRevoked", payload: { invitationId: invitation.id } });
      await tx.insert(auditLogs).values({ workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "WorkspaceInvitationRevoked", subjectType: "WorkspaceInvitation", subjectId: invitation.id, changes: { before: { status: invitation.status }, after: { status: updated.status } }, sourceEventId: event.id, createdAt: now });
      return updated;
    });
  }

  async changeRole(input: { workspaceId: string; targetUserId: string; actorUserId: string; role: WorkspaceRole; actorRole: WorkspaceRole; now?: Date }) {
    const now = input.now ?? new Date();
    return this.db.transaction(async (tx) => {
      await lockWorkspace(tx, input.workspaceId);
      assertRoleMutationAllowed(input.actorRole, input.actorUserId, input.targetUserId, input.role);
      const [target] = await tx.select().from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, input.targetUserId))).for("update").limit(1);
      if (!target) throw new WorkspaceManagementError("WORKSPACE_MEMBER_NOT_FOUND", 404);
      if (target.role === "owner" && input.actorRole !== "owner") throw new WorkspaceManagementError("WORKSPACE_OWNER_MANAGEMENT_REQUIRED", 403);
      if (target.role === input.role) return target;
      if (target.role === "owner" && input.role !== "owner") await assertNotLastOwner(tx, input.workspaceId, input.targetUserId);
      const [updated] = await tx.update(workspaceMembers).set({ role: input.role }).where(and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, input.targetUserId))).returning();
      if (!updated) throw new WorkspaceManagementError("WORKSPACE_MEMBER_UPDATE_FAILED", 409);
      const event = await insertEvent(tx, { workspaceId: input.workspaceId, aggregateType: "WorkspaceMember", aggregateId: input.targetUserId, eventType: "WorkspaceMemberRoleChanged", payload: { userId: input.targetUserId, beforeRole: target.role, afterRole: input.role } });
      await tx.insert(auditLogs).values({ workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "WorkspaceMemberRoleChanged", subjectType: "WorkspaceMember", subjectId: input.targetUserId, changes: { before: { role: target.role }, after: { role: updated.role } }, sourceEventId: event.id, createdAt: now });
      return updated;
    });
  }

  async setStatus(input: { workspaceId: string; targetUserId: string; actorUserId: string; status: MemberStatus; actorRole: WorkspaceRole; now?: Date }) {
    const now = input.now ?? new Date();
    return this.db.transaction(async (tx) => {
      await lockWorkspace(tx, input.workspaceId);
      if (input.actorRole !== "owner" && input.actorRole !== "admin") throw new WorkspaceManagementError("WORKSPACE_MEMBER_MUTATION_FORBIDDEN", 403);
      if (input.actorUserId === input.targetUserId) throw new WorkspaceManagementError("WORKSPACE_SELF_MUTATION_FORBIDDEN", 403);
      const [target] = await tx.select().from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, input.targetUserId))).for("update").limit(1);
      if (!target) throw new WorkspaceManagementError("WORKSPACE_MEMBER_NOT_FOUND", 404);
      if (target.role === "owner" && input.actorRole !== "owner") throw new WorkspaceManagementError("WORKSPACE_OWNER_MANAGEMENT_REQUIRED", 403);
      if (target.status === input.status) return target;
      if (target.role === "owner" && target.status === "active" && input.status === "disabled") await assertNotLastOwner(tx, input.workspaceId, input.targetUserId);
      const [updated] = await tx.update(workspaceMembers).set({ status: input.status }).where(and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, input.targetUserId))).returning();
      if (!updated) throw new WorkspaceManagementError("WORKSPACE_MEMBER_UPDATE_FAILED", 409);
      const eventType = input.status === "disabled" ? "WorkspaceMemberDeactivated" : "WorkspaceMemberReactivated";
      const event = await insertEvent(tx, { workspaceId: input.workspaceId, aggregateType: "WorkspaceMember", aggregateId: input.targetUserId, eventType, payload: { userId: input.targetUserId, beforeStatus: target.status, afterStatus: input.status } });
      await tx.insert(auditLogs).values({ workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: eventType, subjectType: "WorkspaceMember", subjectId: input.targetUserId, changes: { before: { status: target.status }, after: { status: updated.status } }, sourceEventId: event.id, createdAt: now });
      return updated;
    });
  }

  private async expirePending(workspaceId: string, now: Date) {
    await this.db.update(workspaceInvitations).set({ status: "expired", updatedAt: now }).where(and(eq(workspaceInvitations.workspaceId, workspaceId), eq(workspaceInvitations.status, "pending"), sql`${workspaceInvitations.expiresAt} <= ${now.toISOString()}`));
  }
}

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function lockWorkspace(tx: Transaction, workspaceId: string) {
  const [workspace] = await tx.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).for("update").limit(1);
  if (!workspace) throw new WorkspaceManagementError("WORKSPACE_NOT_FOUND", 404);
}

async function assertNotLastOwner(tx: Transaction, workspaceId: string, targetUserId: string) {
  const [owners] = await tx.select({ count: count() }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, "owner"), eq(workspaceMembers.status, "active")));
  if (Number(owners?.count ?? 0) <= 1) throw new WorkspaceManagementError("WORKSPACE_LAST_OWNER", 409);
  if (!targetUserId) throw new WorkspaceManagementError("WORKSPACE_MEMBER_NOT_FOUND", 404);
}

function assertRoleMutationAllowed(actorRole: WorkspaceRole, actorUserId: string, targetUserId: string, nextRole: WorkspaceRole) {
  if (actorUserId === targetUserId) throw new WorkspaceManagementError("WORKSPACE_SELF_ROLE_CHANGE_FORBIDDEN", 403);
  if (actorRole !== "owner" && actorRole !== "admin") throw new WorkspaceManagementError("WORKSPACE_MEMBER_MUTATION_FORBIDDEN", 403);
  if (nextRole === "owner" && actorRole !== "owner") throw new WorkspaceManagementError("WORKSPACE_OWNER_MANAGEMENT_REQUIRED", 403);
  if (ROLE_RANK[nextRole] > ROLE_RANK[actorRole] && actorRole !== "owner") throw new WorkspaceManagementError("WORKSPACE_ROLE_ESCALATION_FORBIDDEN", 403);
}

async function insertEvent(tx: Transaction, input: { workspaceId: string; aggregateType: string; aggregateId: string; eventType: string; payload: Record<string, unknown> }) {
  const [event] = await tx.insert(outboxEvents).values(input).returning({ id: outboxEvents.id });
  if (!event) throw new WorkspaceManagementError("WORKSPACE_EVENT_FAILED", 409);
  return event;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeSlug(value: string) {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  return slug || "workspace";
}

function randomSuffix() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 8);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
}
