export type WorkspaceRole = "viewer" | "operator" | "reviewer" | "admin" | "owner";

export interface RequestContext {
  readonly userId: string;
  readonly workspaceId: string;
  readonly role: WorkspaceRole;
}

export interface RequestContextResolver {
  resolve(request: Request): Promise<RequestContext>;
}

export class RequestAuthenticationError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "RequestAuthenticationError";
  }
}
