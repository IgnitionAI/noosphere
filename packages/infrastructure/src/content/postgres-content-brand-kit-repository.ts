import { and, eq, sql } from "drizzle-orm";
import type { ContentBrandKitRepository, ContentBrandKitView } from "@outbound/application/content/content-brand-kit";
import { contentBrandKitSnapshotSchema } from "@outbound/contracts/content";
import type { Database } from "@outbound/infrastructure/database/client";
import { auditLogs, contentBrandKits, contentOperationRequests, outboxEvents } from "@outbound/infrastructure/database/schema";

export class PostgresContentBrandKitRepository implements ContentBrandKitRepository {
  constructor(private readonly database: Database) {}

  async find(workspaceId: string): Promise<ContentBrandKitView | null> {
    const rows = await this.database.select().from(contentBrandKits).where(eq(contentBrandKits.workspaceId, workspaceId)).limit(1);
    return rows[0] ? toView(rows[0]) : null;
  }

  async findRequest(input: { workspaceId: string; requestKey: string }): Promise<ContentBrandKitView | null> {
    const request = (await this.database.select().from(contentOperationRequests).where(and(
      eq(contentOperationRequests.workspaceId, input.workspaceId),
      eq(contentOperationRequests.operation, "content-brand-kit.update"),
      eq(contentOperationRequests.requestKey, input.requestKey),
    )).limit(1))[0];
    return request ? this.find(input.workspaceId) : null;
  }

  async save(input: Parameters<ContentBrandKitRepository["save"]>[0]): Promise<ContentBrandKitView> {
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.workspaceId}:content-brand-kit`}, 0))`);
      const replay = (await tx.select().from(contentOperationRequests).where(and(
        eq(contentOperationRequests.workspaceId, input.workspaceId),
        eq(contentOperationRequests.operation, "content-brand-kit.update"),
        eq(contentOperationRequests.requestKey, input.requestKey),
      )).limit(1))[0];
      if (replay) {
        const retained = (await tx.select().from(contentBrandKits).where(eq(contentBrandKits.workspaceId, input.workspaceId)).limit(1))[0];
        if (retained) return toView(retained);
      }
      const current = (await tx.select().from(contentBrandKits).where(eq(contentBrandKits.workspaceId, input.workspaceId)).limit(1).for("update"))[0];
      const version = (current?.version ?? 0) + 1;
      const row = (await tx.insert(contentBrandKits).values({
        workspaceId: input.workspaceId,
        version,
        snapshot: input.snapshot,
        updatedBy: input.userId,
        createdAt: current?.createdAt ?? input.now,
        updatedAt: input.now,
      }).onConflictDoUpdate({
        target: contentBrandKits.workspaceId,
        set: { version, snapshot: input.snapshot, updatedBy: input.userId, updatedAt: input.now },
      }).returning())[0]!;
      await tx.insert(contentOperationRequests).values({
        workspaceId: input.workspaceId,
        operation: "content-brand-kit.update",
        requestKey: input.requestKey,
        resourceType: "ContentBrandKit",
        resourceId: input.workspaceId,
        response: { version },
      });
      const event = (await tx.insert(outboxEvents).values({
        workspaceId: input.workspaceId,
        aggregateType: "ContentBrandKit",
        aggregateId: input.workspaceId,
        eventType: "ContentBrandKitUpdated",
        payload: { type: "ContentBrandKitUpdated", workspaceId: input.workspaceId, version },
      }).returning({ id: outboxEvents.id }))[0];
      if (event) await tx.insert(auditLogs).values({
        workspaceId: input.workspaceId,
        actorUserId: input.userId,
        action: "ContentBrandKitUpdated",
        subjectType: "ContentBrandKit",
        subjectId: input.workspaceId,
        changes: {
          version,
          brandName: input.snapshot.brandName,
          logoChecksumSha256: input.snapshot.logo?.checksumSha256 ?? null,
          enabledFormats: input.snapshot.enabledFormats,
          weeklyMix: input.snapshot.weeklyMix,
          voiceTraits: input.snapshot.voice.traits.length,
        },
        sourceEventId: event.id,
      });
      return toView(row);
    });
  }
}

function toView(row: typeof contentBrandKits.$inferSelect): ContentBrandKitView {
  return {
    workspaceId: row.workspaceId,
    version: row.version,
    snapshot: contentBrandKitSnapshotSchema.parse(row.snapshot),
    updatedAt: row.updatedAt,
  };
}
