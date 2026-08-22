import { and, eq, sql } from "drizzle-orm";
import { completeFormatPerformance, type ContentFormatPerformance, type ContentPerformanceRepository } from "@outbound/application/content/content-performance";
import type { LinkedinContentFormat } from "@outbound/domain/content/content-brand-kit";
import type { Database } from "@outbound/infrastructure/database/client";
import { contentAssets, contentPublications, socialContentItems } from "@outbound/infrastructure/database/schema";

export class PostgresContentPerformanceRepository implements ContentPerformanceRepository {
  constructor(private readonly database: Database) {}

  async read(workspaceId: string) {
    const rows = await this.database.select({
      format: contentAssets.type,
      publications: sql<number>`count(distinct ${contentPublications.id})`,
      impressions: sql<number>`coalesce(sum(${socialContentItems.impressions}), 0)`,
      reactions: sql<number>`coalesce(sum(${socialContentItems.reactions}), 0)`,
      comments: sql<number>`coalesce(sum(${socialContentItems.comments}), 0)`,
      reposts: sql<number>`coalesce(sum(${socialContentItems.reposts}), 0)`,
    }).from(contentPublications)
      .innerJoin(contentAssets, and(
        eq(contentAssets.workspaceId, contentPublications.workspaceId),
        eq(contentAssets.id, contentPublications.assetId),
      ))
      .leftJoin(socialContentItems, and(
        eq(socialContentItems.workspaceId, contentPublications.workspaceId),
        eq(socialContentItems.publicationId, contentPublications.id),
      ))
      .where(and(eq(contentPublications.workspaceId, workspaceId), eq(contentPublications.status, "published")))
      .groupBy(contentAssets.type);
    const formats: ContentFormatPerformance[] = rows.map((row) => {
      const impressions = Number(row.impressions);
      const engagements = Number(row.reactions) + Number(row.comments) + Number(row.reposts);
      return {
        format: row.format as LinkedinContentFormat,
        publications: Number(row.publications),
        impressions,
        reactions: Number(row.reactions),
        comments: Number(row.comments),
        reposts: Number(row.reposts),
        engagementRate: impressions > 0 ? Math.round((engagements / impressions) * 10_000) / 100 : null,
      };
    });
    return { formats: completeFormatPerformance(formats), observedAt: new Date() };
  }
}
