import type {
  RequestContext,
  RequestContextResolver,
  WorkspaceRole,
} from "@outbound/interface/http/request-context";
import {
  RequestAuthenticationError,
  WorkspaceAccessDeniedError,
  WorkspaceContextRequiredError,
} from "@outbound/interface/http/request-context";

const workspaceSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface AuthenticatedSessionReader {
  getSession(headers: Headers): Promise<{ readonly userId: string } | null>;
}

export interface WorkspaceMembershipReader {
  findActiveMembership(input: {
    readonly userId: string;
    readonly workspaceSlug: string;
  }): Promise<{ readonly workspaceId: string; readonly role: WorkspaceRole } | null>;
}

export class AuthenticatedWorkspaceContextResolver implements RequestContextResolver {
  constructor(
    private readonly sessions: AuthenticatedSessionReader,
    private readonly memberships: WorkspaceMembershipReader,
  ) {}

  async resolve(request: Request): Promise<RequestContext> {
    const session = await this.sessions.getSession(request.headers);
    if (!session) throw new RequestAuthenticationError();

    const workspaceSlug = request.headers.get("x-workspace-slug")?.trim().toLowerCase();
    if (
      !workspaceSlug ||
      workspaceSlug.length > 120 ||
      !workspaceSlugPattern.test(workspaceSlug)
    ) {
      throw new WorkspaceContextRequiredError();
    }

    const membership = await this.memberships.findActiveMembership({
      userId: session.userId,
      workspaceSlug,
    });
    if (!membership) throw new WorkspaceAccessDeniedError();

    return {
      userId: session.userId,
      workspaceId: membership.workspaceId,
      role: membership.role,
    };
  }
}
