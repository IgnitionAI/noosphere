import { z } from "zod";
import type { AuthenticatedSessionReader, WorkspaceMembershipDirectory } from "@outbound/interface/http/authenticated-workspace-context";
import type { RequestContextResolver, WorkspaceRole } from "@outbound/interface/http/request-context";
import { WorkspaceManagementError } from "@outbound/infrastructure/workspaces/postgres-workspace-repository";

const roleSchema = z.enum(["viewer", "operator", "reviewer", "admin", "owner"]);
const createWorkspaceSchema = z.object({ name: z.string().trim().min(1).max(200), slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120).optional() });
const inviteSchema = z.object({ email: z.email(), role: roleSchema });
const changeRoleSchema = z.object({ role: roleSchema });
const setStatusSchema = z.object({ status: z.enum(["active", "disabled"]) });

const membersPath = /^\/api\/v1\/workspaces\/([^/]+)\/members$/;
const invitationsPath = /^\/api\/v1\/workspaces\/([^/]+)\/invitations$/;
const revokePath = /^\/api\/v1\/invitations\/([^/]+)\/actions\/revoke$/;
const acceptPath = /^\/api\/v1\/invitations\/([^/]+)\/actions\/accept$/;
const memberActionPath = /^\/api\/v1\/workspaces\/([^/]+)\/members\/([^/]+)\/actions\/(change-role|set-status)$/;

export interface WorkspaceManagementService {
  createWorkspace(input: { userId: string; name: string; slug?: string | null }): Promise<unknown>;
  listMembers(workspaceId: string): Promise<readonly unknown[]>;
  listInvitations(workspaceId: string): Promise<readonly unknown[]>;
  invite(input: { workspaceId: string; actorUserId: string; email: string; proposedRole: WorkspaceRole; actorRole?: WorkspaceRole }): Promise<InvitationView>;
  acceptInvitation(input: { invitationId: string; userId: string }): Promise<unknown>;
  revokeInvitation(input: { workspaceId: string; invitationId: string; actorUserId: string }): Promise<unknown>;
  changeRole(input: { workspaceId: string; targetUserId: string; actorUserId: string; role: WorkspaceRole; actorRole: WorkspaceRole }): Promise<unknown>;
  setStatus(input: { workspaceId: string; targetUserId: string; actorUserId: string; status: "active" | "disabled"; actorRole: WorkspaceRole }): Promise<unknown>;
}

export interface WorkspaceInvitationMailer {
  send(input: { invitationId: string; workspaceId: string; email: string; proposedRole: WorkspaceRole; expiresAt: Date }): Promise<void>;
}

type InvitationView = { readonly id: string; readonly workspaceId: string; readonly email: string; readonly proposedRole: WorkspaceRole; readonly expiresAt: Date };

export function createWorkspaceHttpHandler(dependencies: {
  readonly sessions: AuthenticatedSessionReader;
  readonly memberships: WorkspaceMembershipDirectory;
  readonly contextResolver?: RequestContextResolver;
  readonly management?: WorkspaceManagementService;
  readonly mailer?: WorkspaceInvitationMailer;
}) {
  const contextResolver = dependencies.contextResolver;
  return async function handle(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    try {
      const session = await dependencies.sessions.getSession(request.headers);
      if (pathname === "/api/v1/workspaces") {
        if (!session) return problem(401, "AUTHENTICATION_REQUIRED", "Authentication required");
        if (request.method === "GET") {
          const memberships = await dependencies.memberships.listActiveMemberships(session.userId);
          return Response.json({ data: memberships.map((membership) => ({ id: membership.workspaceId, slug: membership.slug, name: membership.name, role: membership.role, lastSelectedAt: membership.lastSelectedAt?.toISOString() ?? null })) });
        }
        if (request.method === "POST") {
          requireManagement(dependencies.management);
          const body = createWorkspaceSchema.parse(await request.json());
          return Response.json(await dependencies.management.createWorkspace({ userId: session.userId, name: body.name, ...(body.slug ? { slug: body.slug } : {}) }), { status: 201 });
        }
        return methodNotAllowed("GET, POST");
      }
      if (!dependencies.management) return problem(404, "ROUTE_NOT_FOUND", "Route not found");
      if (acceptPath.test(pathname)) {
        if (!session) return problem(401, "AUTHENTICATION_REQUIRED", "Authentication required");
        if (request.method !== "POST") return methodNotAllowed("POST");
        return Response.json(await dependencies.management.acceptInvitation({ invitationId: uuid(pathname, acceptPath), userId: session.userId }));
      }
      if (!session) return problem(401, "AUTHENTICATION_REQUIRED", "Authentication required");
      const revoke = revokePath.exec(pathname);
      if (revoke && request.method === "POST") {
        const context = await requireContextResolver(contextResolver).resolve(request);
        assertWorkspace(context.workspaceId, revoke[1]!);
        requireAdmin(context.role);
        return Response.json(await dependencies.management.revokeInvitation({ workspaceId: context.workspaceId, invitationId: revoke[1]!, actorUserId: context.userId }));
      }
      const members = membersPath.exec(pathname);
      if (members) {
        const context = await resolveContext(requireContextResolver(contextResolver), request, members[1]!);
        if (request.method === "GET") {
          requireReader(context.role);
          const members = await dependencies.management.listMembers(context.workspaceId);
          return Response.json({ data: members.map((member) => redactMember(member, context.role)) });
        }
        return methodNotAllowed("GET");
      }
      const invitations = invitationsPath.exec(pathname);
      if (invitations) {
        const context = await resolveContext(requireContextResolver(contextResolver), request, invitations[1]!);
        requireAdmin(context.role);
        if (request.method === "GET") return Response.json({ data: await dependencies.management.listInvitations(context.workspaceId) });
        if (request.method === "POST") {
          const body = inviteSchema.parse(await request.json());
          const invitation = await dependencies.management.invite({ workspaceId: context.workspaceId, actorUserId: context.userId, actorRole: context.role, email: body.email, proposedRole: body.role });
          let emailDelivery: "sent" | "failed" = "sent";
          if (dependencies.mailer) {
            try { await dependencies.mailer.send({ invitationId: invitation.id, workspaceId: invitation.workspaceId, email: invitation.email, proposedRole: invitation.proposedRole, expiresAt: invitation.expiresAt }); } catch { emailDelivery = "failed"; }
          }
          return Response.json({ ...invitation, emailDelivery }, { status: 201 });
        }
        return methodNotAllowed("GET, POST");
      }
      const action = memberActionPath.exec(pathname);
      if (action && request.method === "POST") {
        const context = await resolveContext(requireContextResolver(contextResolver), request, action[1]!);
        const targetUserId = action[2]!;
        requireAdmin(context.role);
        if (action[3] === "change-role") {
          const body = changeRoleSchema.parse(await request.json());
          return Response.json(await dependencies.management.changeRole({ workspaceId: context.workspaceId, targetUserId, actorUserId: context.userId, role: body.role, actorRole: context.role }));
        }
        const body = setStatusSchema.parse(await request.json());
        return Response.json(await dependencies.management.setStatus({ workspaceId: context.workspaceId, targetUserId, actorUserId: context.userId, status: body.status, actorRole: context.role }));
      }
      return problem(404, "ROUTE_NOT_FOUND", "Route not found");
    } catch (error) {
      if (error instanceof WorkspaceManagementError) return problem(error.status, error.code, error.code, error.details);
      if (error instanceof SyntaxError || error instanceof z.ZodError) return problem(422, "VALIDATION_FAILED", error instanceof Error ? error.message : "Invalid request");
      if (error instanceof Error && error.name === "RequestAuthenticationError") return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      if (error instanceof Error && error.name === "WorkspaceAccessDeniedError") return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      if (error instanceof Error && error.name === "WorkspaceContextRequiredError") return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      throw error;
    }
  };
}

async function resolveContext(resolver: RequestContextResolver, request: Request, workspaceId: string) {
  const context = await resolver.resolve(request);
  assertWorkspace(context.workspaceId, workspaceId);
  return context;
}

function uuid(pathname: string, pattern: RegExp) {
  const match = pattern.exec(pathname);
  const value = match?.[1];
  if (!value || !/^[0-9a-f-]{36}$/i.test(value)) throw new WorkspaceManagementError("INVALID_ID", 422);
  return value;
}

function assertWorkspace(contextWorkspaceId: string, requestedWorkspaceId: string) {
  if (contextWorkspaceId !== requestedWorkspaceId) throw new WorkspaceManagementError("WORKSPACE_FORBIDDEN", 403);
}

function requireReader(role: WorkspaceRole) {
  if (!["viewer", "operator", "reviewer", "admin", "owner"].includes(role)) throw new WorkspaceManagementError("WORKSPACE_FORBIDDEN", 403);
}

function redactMember(member: unknown, role: WorkspaceRole) {
  if (role === "owner" || role === "admin" || typeof member !== "object" || member === null || !("email" in member)) return member;
  const value = member as { email?: unknown };
  if (typeof value.email !== "string") return member;
  return { ...value, email: maskEmail(value.email) };
}

function maskEmail(email: string) {
  const [local, domain] = email.split("@", 2);
  if (!domain) return "***";
  const localPart = local ?? "";
  return `${localPart.length > 1 ? `${localPart[0]}***` : "***"}@${domain}`;
}

function requireAdmin(role: WorkspaceRole) {
  if (!["admin", "owner"].includes(role)) throw new WorkspaceManagementError("WORKSPACE_MEMBER_MUTATION_FORBIDDEN", 403);
}

function requireManagement(management: WorkspaceManagementService | undefined): asserts management is WorkspaceManagementService {
  if (!management) throw new WorkspaceManagementError("WORKSPACE_MANAGEMENT_UNAVAILABLE", 503);
}

function requireContextResolver(resolver: RequestContextResolver | undefined): RequestContextResolver {
  if (!resolver) throw new WorkspaceManagementError("WORKSPACE_CONTEXT_REQUIRED", 400);
  return resolver;
}

function methodNotAllowed(allow: string) {
  const response = problem(405, "METHOD_NOT_ALLOWED", "The HTTP method is not allowed for this route");
  response.headers.set("allow", allow);
  return response;
}

function problem(status: number, code: string, detail: string, details: Record<string, unknown> = {}) {
  return Response.json({ type: `https://ignition-outbound.local/problems/${code.toLowerCase()}`, title: code, status, detail, code, ...details }, { status, headers: { "content-type": "application/problem+json; charset=utf-8" } });
}
