import { sql } from "drizzle-orm";
import type { Clock } from "@outbound/application/shared/ports";
import type { AuthorizedKnowledgeClaim, AuthorizedKnowledgeSource, KnowledgeRetriever } from "@outbound/application/knowledge/knowledge-retriever";
import type { Database } from "@outbound/infrastructure/database/client";

interface KnowledgeRow extends Record<string, unknown> {
  claim_id: string;
  claim: string;
  offer_claim_id: string | null;
  source_id: string;
  source_type: "product_document" | "proof" | "customer_case" | "objection_response";
  title: string;
  content: string;
  published_at: Date;
  freshness_until: Date;
  rank: number | string;
}

export class PostgresKnowledgeRetriever implements KnowledgeRetriever {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async search(input: { workspaceId: string; query: string; limit: number }): Promise<readonly AuthorizedKnowledgeClaim[]> {
    const query = input.query.trim().slice(0, 1_000);
    const limit = Math.max(1, Math.min(20, input.limit));
    const tsQuery = fullTextOrQuery(query);
    if (!tsQuery) return [];
    const now = this.clock.now();
    const rows = await this.database.execute<KnowledgeRow>(sql`
      SELECT kc.id AS claim_id,
             kc.claim,
             kc.offer_claim_id,
             ks.id AS source_id,
             ks.type AS source_type,
             ks.title,
             COALESCE(ks.content, rd.extracted_markdown, '') AS content,
             ks.published_at,
             ks.freshness_until,
             greatest(
               ts_rank_cd(to_tsvector('simple', kc.claim), to_tsquery('simple', ${tsQuery})),
               ts_rank_cd(to_tsvector('simple', coalesce(ks.title, '') || ' ' || coalesce(ks.content, '') || ' ' || coalesce(rd.extracted_markdown, '')), to_tsquery('simple', ${tsQuery}))
             ) AS rank
      FROM knowledge_claims kc
      JOIN knowledge_claim_sources kcs ON kcs.workspace_id = kc.workspace_id AND kcs.claim_id = kc.id
      JOIN knowledge_sources ks ON ks.workspace_id = kcs.workspace_id AND ks.id = kcs.source_id
      LEFT JOIN research_documents rd ON rd.workspace_id = ks.workspace_id AND rd.id = ks.research_document_id
      WHERE kc.workspace_id = ${input.workspaceId}
        AND kc.status = 'validated'
        AND ks.status = 'validated'
        AND ks.freshness_until > ${now.toISOString()}::timestamptz
        AND (
          to_tsvector('simple', kc.claim) @@ to_tsquery('simple', ${tsQuery})
          OR to_tsvector('simple', coalesce(ks.title, '') || ' ' || coalesce(ks.content, '') || ' ' || coalesce(rd.extracted_markdown, '')) @@ to_tsquery('simple', ${tsQuery})
        )
      ORDER BY rank DESC, kc.id, ks.id
      LIMIT ${limit * 5}
    `);
    const claims = new Map<string, Omit<AuthorizedKnowledgeClaim, "sources"> & { sources: AuthorizedKnowledgeSource[] }>();
    for (const row of rows) {
      const source = {
        sourceId: row.source_id,
        type: row.source_type,
        title: row.title,
        excerpt: excerpt(row.content, query),
        publishedAt: new Date(row.published_at).toISOString(),
        freshnessUntil: new Date(row.freshness_until).toISOString(),
      } as const;
      const current = claims.get(row.claim_id);
      if (current) {
        current.sources.push(source);
      } else {
        claims.set(row.claim_id, { claimId: row.claim_id, claim: row.claim, offerClaimId: row.offer_claim_id, sources: [source] });
      }
      if (claims.size >= limit && !current) break;
    }
    return [...claims.values()].slice(0, limit);
  }
}

function fullTextOrQuery(value: string): string {
  const tokens = value.toLocaleLowerCase("fr-FR").match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  return [...new Set(tokens)].slice(0, 16).join(" | ");
}

function excerpt(content: string, query: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  const firstTerm = query.toLocaleLowerCase().split(/\s+/).find((term) => term.length > 2);
  const match = firstTerm ? compact.toLocaleLowerCase().indexOf(firstTerm) : -1;
  const start = Math.max(0, match < 0 ? 0 : match - 180);
  return compact.slice(start, start + 600);
}
