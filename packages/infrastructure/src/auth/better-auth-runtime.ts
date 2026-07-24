import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  authAccounts,
  authSessions,
  authUsers,
  authVerifications,
} from "@outbound/infrastructure/database/schema";
import {
  AuthenticatedWorkspaceContextResolver,
  type AuthenticatedSessionReader,
} from "@outbound/interface/http/authenticated-workspace-context";
import { PostgresWorkspaceMembershipReader } from "@outbound/infrastructure/auth/postgres-workspace-membership-reader";
import type { RequestContextResolver } from "@outbound/interface/http/request-context";

export interface BetterAuthRuntime {
  readonly contextResolver: RequestContextResolver;
  handle(request: Request): Promise<Response>;
}

export interface BetterAuthRuntimeOptions {
  readonly baseUrl: string;
  readonly secret: string;
  readonly trustedOrigins: readonly string[];
  readonly allowSignUp?: boolean;
}

export function createBetterAuthRuntime(
  db: Database,
  options: BetterAuthRuntimeOptions,
): BetterAuthRuntime {
  const auth = betterAuth({
    appName: "Ignition Outbound",
    baseURL: options.baseUrl,
    secret: options.secret,
    trustedOrigins: [...options.trustedOrigins],
    telemetry: { enabled: false },
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
      },
    }),
    advanced: {
      database: {
        generateId: "uuid",
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: options.allowSignUp !== true,
      revokeSessionsOnPasswordReset: true,
    },
  });
  const sessions: AuthenticatedSessionReader = {
    async getSession(headers) {
      const session = await auth.api.getSession({ headers });
      return session ? { userId: session.user.id } : null;
    },
  };
  const contextResolver = new AuthenticatedWorkspaceContextResolver(
    sessions,
    new PostgresWorkspaceMembershipReader(db),
  );

  return {
    contextResolver,
    handle(request) {
      return auth.handler(request);
    },
  };
}
