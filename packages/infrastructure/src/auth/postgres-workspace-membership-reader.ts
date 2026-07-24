import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  workspaces,
  workspaceMembers,
} from "@outbound/infrastructure/database/schema";
import type { WorkspaceMembershipReader } from "@outbound/interface/http/authenticated-workspace-context";

export class PostgresWorkspaceMembershipReader implements WorkspaceMembershipReader {
  constructor(private readonly db: Database) {}

  async findActiveMembership(input: {
    userId: string;
    workspaceSlug: string;
  }) {
    const [membership] = await this.db
      .select({
        workspaceId: workspaceMembers.workspaceId,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(
        and(
          eq(workspaceMembers.userId, input.userId),
          eq(workspaceMembers.status, "active"),
          eq(workspaces.slug, input.workspaceSlug),
          eq(workspaces.status, "active"),
          isNull(workspaces.deletedAt),
        ),
      )
      .limit(1);
    return membership ?? null;
  }
}
