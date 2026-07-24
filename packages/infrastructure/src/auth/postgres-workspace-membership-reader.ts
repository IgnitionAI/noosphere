import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  workspaces,
  workspaceMembers,
} from "@outbound/infrastructure/database/schema";
import type {
  WorkspaceMembershipDirectory,
  WorkspaceMembershipReader,
} from "@outbound/interface/http/authenticated-workspace-context";

export class PostgresWorkspaceMembershipReader
  implements WorkspaceMembershipReader, WorkspaceMembershipDirectory
{
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

  async listActiveMemberships(userId: string) {
    return this.db
      .select({
        workspaceId: workspaceMembers.workspaceId,
        slug: workspaces.slug,
        name: workspaces.name,
        role: workspaceMembers.role,
        lastSelectedAt: workspaceMembers.lastSelectedAt,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(
        and(
          eq(workspaceMembers.userId, userId),
          eq(workspaceMembers.status, "active"),
          eq(workspaces.status, "active"),
          isNull(workspaces.deletedAt),
        ),
      )
      .orderBy(
        sql`${workspaceMembers.lastSelectedAt} desc nulls last`,
        asc(workspaces.name),
      );
  }
}
