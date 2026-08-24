import { sql } from "drizzle-orm";
import type { Database } from "@outbound/infrastructure/database/client";
import type { PostgresVersionedKnowledgeIndexer, PreparedKnowledgeChunk } from "@outbound/infrastructure/knowledge/postgres-versioned-knowledge-index";

interface ProjectionRow extends Record<string, unknown> {
  workspaceId: string;
  sourceType: "knowledge_source" | "offer" | "proof";
  sourceId: string;
  title: string;
  content: string;
  format: string;
  validationStatus: string;
  offerId: string | null;
  sourceCreatedAt: Date;
  tags: string[];
}

export class PostgresKnowledgeProjectionReconciler {
  constructor(
    private readonly db: Database,
    private readonly indexer: PostgresVersionedKnowledgeIndexer,
    private readonly maxDocuments = 10,
  ) {}

  async reconcile(): Promise<number> {
    const rows = await this.db.execute<ProjectionRow>(sql`
      with published_offers as (
        select o.workspace_id as "workspaceId", 'offer'::text as "sourceType", o.id as "sourceId",
          ov.name as title,
          concat_ws(E'\n\n',
            '# ' || ov.name,
            '## Proposition de valeur' || E'\n' || ov.value_proposition,
            '## Public cible' || E'\n' || ov.target_audience,
            '## Objections' || E'\n' || ov.objections::text,
            '## Allégations autorisées' || E'\n' || coalesce(string_agg(oc.claim, E'\n- ' order by oc.id), '')
          ) as content,
          'application/vnd.noosphere.offer+markdown'::text as format,
          'validated'::text as "validationStatus", o.id as "offerId",
          ov.published_at as "sourceCreatedAt", array['offer']::text[] as tags
        from offers o
        join offer_versions ov on ov.workspace_id = o.workspace_id and ov.offer_id = o.id and ov.version = o.current_version
        left join offer_claims oc on oc.workspace_id = ov.workspace_id and oc.offer_version_id = ov.id
          and oc.validation_status in ('sourced', 'validated')
        where o.deleted_at is null and o.current_version > 0
        group by o.workspace_id, o.id, ov.id
      ), validated_sources as (
        select ks.workspace_id as "workspaceId", 'knowledge_source'::text as "sourceType", ks.id as "sourceId",
          ks.title, concat_ws(E'\n\n', '# ' || ks.title, coalesce(ks.content, rd.extracted_markdown, '')) as content,
          'text/markdown'::text as format, 'validated'::text as "validationStatus", null::uuid as "offerId",
          ks.published_at as "sourceCreatedAt", array[ks.type::text]::text[] as tags
        from knowledge_sources ks
        left join research_documents rd on rd.workspace_id = ks.workspace_id and rd.id = ks.research_document_id
        where ks.status = 'validated' and ks.freshness_until > now()
          and length(btrim(coalesce(ks.content, rd.extracted_markdown, ''))) > 0
      ), validated_proofs as (
        select kc.workspace_id as "workspaceId", 'proof'::text as "sourceType", kc.id as "sourceId",
          left(kc.claim, 500) as title,
          concat_ws(E'\n\n', '# Preuve validée', kc.claim,
            '## Sources', coalesce(string_agg(ks.title || E'\n' || coalesce(ks.content, ''), E'\n\n' order by ks.id), '')
          ) as content,
          'application/vnd.noosphere.proof+markdown'::text as format,
          'validated'::text as "validationStatus", ov.offer_id as "offerId",
          coalesce(kc.validated_at, kc.created_at) as "sourceCreatedAt", array['proof']::text[] as tags
        from knowledge_claims kc
        left join knowledge_claim_sources kcs on kcs.workspace_id = kc.workspace_id and kcs.claim_id = kc.id
        left join knowledge_sources ks on ks.workspace_id = kcs.workspace_id and ks.id = kcs.source_id and ks.status = 'validated'
        left join offer_claims oc on oc.workspace_id = kc.workspace_id and oc.id = kc.offer_claim_id
        left join offer_versions ov on ov.workspace_id = oc.workspace_id and ov.id = oc.offer_version_id
        where kc.status = 'validated'
        group by kc.workspace_id, kc.id, ov.offer_id
      )
      select * from (
        select * from published_offers
        union all select * from validated_sources
        union all select * from validated_proofs
      ) projections
      order by "sourceCreatedAt", "sourceId"
    `);
    let indexed = 0;
    for (const row of rows) {
      if (indexed >= this.maxDocuments) break;
      const content = row.content.trim();
      if (!content) continue;
      const changed = await this.indexer.indexTextDocument({
        workspaceId: row.workspaceId,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        title: row.title,
        format: row.format,
        language: detectLanguage(content),
        validationStatus: row.validationStatus,
        contentHash: sha256(content),
        sourceCreatedAt: new Date(row.sourceCreatedAt),
        offerId: row.offerId,
        tags: row.tags,
        chunks: chunkMarkdown(content),
      });
      if (changed) indexed += 1;
    }
    return indexed;
  }
}

function chunkMarkdown(markdown: string): PreparedKnowledgeChunk[] {
  const chunks: PreparedKnowledgeChunk[] = [];
  const size = 3_500;
  const step = 3_000;
  for (let offset = 0, ordinal = 0; offset < markdown.length; offset += step, ordinal += 1) {
    const content = markdown.slice(offset, offset + size).trim();
    if (!content) continue;
    const heading = content.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim() ?? null;
    chunks.push({ content, heading, locator: `section:${ordinal + 1}` });
  }
  return chunks;
}

function detectLanguage(content: string): "fr" | "en" | null {
  const normalized = content.toLocaleLowerCase();
  const french = (normalized.match(/\b(le|la|les|des|une|avec|pour|dans|votre)\b/g) ?? []).length;
  const english = (normalized.match(/\b(the|and|with|for|from|your|this|that)\b/g) ?? []).length;
  if (french === english) return null;
  return french > english ? "fr" : "en";
}

function sha256(value: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(value);
  return hasher.digest("hex");
}
