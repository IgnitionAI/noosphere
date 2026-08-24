import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Clock, IdGenerator } from "@outbound/application/shared/ports";
import {
  assertKnowledgeContentHasNoProspectPii,
  assertKnowledgeSourceCanBeValidated,
  deriveKnowledgeClaimStatus,
  transitionKnowledgeSource,
} from "@outbound/domain/knowledge/knowledge-source";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  auditLogs,
  jobs,
  knowledgeClaims,
  knowledgeClaimSources,
  knowledgeSources,
  offerClaims,
  outboxEvents,
  researchDocuments,
} from "@outbound/infrastructure/database/schema";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type SourceType = typeof knowledgeSources.$inferInsert.type;

export class KnowledgeServiceError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "KnowledgeServiceError";
  }
}

export class PostgresKnowledgeService {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async createSource(input: {
    workspaceId: string;
    actorUserId: string;
    type: SourceType;
    title: string;
    content: string | null;
    researchDocumentId: string | null;
    authorName: string;
    publishedAt: Date;
    freshnessUntil: Date | null;
  }) {
    const title = input.title.trim();
    const authorName = input.authorName.trim();
    const content = input.content?.trim() || null;
    if (!title || title.length > 500 || !authorName || authorName.length > 300) throw new KnowledgeServiceError("KNOWLEDGE_SOURCE_INVALID", 422);
    if (!content && !input.researchDocumentId) throw new KnowledgeServiceError("KNOWLEDGE_SOURCE_CONTENT_REQUIRED", 422);
    return this.database.transaction(async (tx) => {
      let inspectedContent = content ?? "";
      if (input.researchDocumentId) {
        const [document] = await tx.select().from(researchDocuments).where(and(eq(researchDocuments.workspaceId, input.workspaceId), eq(researchDocuments.id, input.researchDocumentId))).limit(1);
        if (!document || document.status !== "ready" || !document.extractedMarkdown) throw new KnowledgeServiceError("KNOWLEDGE_DOCUMENT_NOT_READY", 422);
        inspectedContent = `${inspectedContent}\n${document.extractedMarkdown}`;
      }
      try { assertKnowledgeContentHasNoProspectPii(`${title}\n${inspectedContent ?? ""}`); }
      catch { throw new KnowledgeServiceError("KNOWLEDGE_PROSPECT_PII_DETECTED", 422); }
      const id = this.ids.generate();
      const [source] = await tx.insert(knowledgeSources).values({
        id,
        workspaceId: input.workspaceId,
        type: input.type,
        title,
        content,
        researchDocumentId: input.researchDocumentId,
        authorName,
        publishedAt: input.publishedAt,
        freshnessUntil: input.freshnessUntil,
        createdBy: input.actorUserId,
        createdAt: this.clock.now(),
        updatedAt: this.clock.now(),
      }).returning();
      if (!source) throw new KnowledgeServiceError("KNOWLEDGE_SOURCE_CREATE_FAILED", 409);
      await recordMutation(tx, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, eventType: "KnowledgeSourceCreated", subjectType: "KnowledgeSource", subjectId: id, changes: { type: input.type, title } });
      return source;
    });
  }

  async validateSource(input: { workspaceId: string; actorUserId: string; sourceId: string }) {
    return this.database.transaction(async (tx) => {
      const [source] = await tx.select().from(knowledgeSources).where(and(eq(knowledgeSources.workspaceId, input.workspaceId), eq(knowledgeSources.id, input.sourceId))).for("update").limit(1);
      if (!source) throw new KnowledgeServiceError("KNOWLEDGE_SOURCE_NOT_FOUND", 404);
      let status: "validated";
      try {
        status = transitionKnowledgeSource(source.status, "validate") as "validated";
        assertKnowledgeSourceCanBeValidated({ freshnessUntil: source.freshnessUntil, now: this.clock.now() });
      } catch (error) {
        const code = error instanceof Error ? error.message : "KNOWLEDGE_SOURCE_INVALID";
        throw new KnowledgeServiceError(code, code === "KNOWLEDGE_SOURCE_TRANSITION_INVALID" ? 409 : 422);
      }
      const [validated] = await tx.update(knowledgeSources).set({ status, validatedBy: input.actorUserId, validatedAt: this.clock.now(), updatedAt: this.clock.now() }).where(and(eq(knowledgeSources.workspaceId, input.workspaceId), eq(knowledgeSources.id, input.sourceId))).returning();
      const eventId = await recordMutation(tx, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, eventType: "KnowledgeSourceValidated", subjectType: "KnowledgeSource", subjectId: input.sourceId, changes: { freshnessUntil: source.freshnessUntil!.toISOString() } });
      await tx.insert(jobs).values({
        id: this.ids.generate(),
        workspaceId: input.workspaceId,
        type: "knowledge.source.expire",
        payload: { workspaceId: input.workspaceId, sourceId: input.sourceId },
        idempotencyKey: `knowledge-expire:${input.sourceId}:${source.freshnessUntil!.toISOString()}`,
        correlationId: `knowledge-expire:${eventId}`,
        maxAttempts: 3,
        availableAt: source.freshnessUntil!,
      }).onConflictDoNothing();
      return validated!;
    });
  }

  async withdrawSource(input: { workspaceId: string; actorUserId: string; sourceId: string; reason: string }) {
    const reason = input.reason.trim();
    if (reason.length < 3 || reason.length > 1_000) throw new KnowledgeServiceError("KNOWLEDGE_WITHDRAWAL_REASON_REQUIRED", 422);
    return this.database.transaction(async (tx) => {
      const [source] = await tx.select().from(knowledgeSources).where(and(eq(knowledgeSources.workspaceId, input.workspaceId), eq(knowledgeSources.id, input.sourceId))).for("update").limit(1);
      if (!source) throw new KnowledgeServiceError("KNOWLEDGE_SOURCE_NOT_FOUND", 404);
      try { transitionKnowledgeSource(source.status, "withdraw"); }
      catch { throw new KnowledgeServiceError("KNOWLEDGE_SOURCE_TRANSITION_INVALID", 409); }
      const [withdrawn] = await tx.update(knowledgeSources).set({ status: "withdrawn", withdrawnBy: input.actorUserId, withdrawnAt: this.clock.now(), withdrawalReason: reason, updatedAt: this.clock.now() }).where(and(eq(knowledgeSources.workspaceId, input.workspaceId), eq(knowledgeSources.id, input.sourceId))).returning();
      await recordMutation(tx, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, eventType: "KnowledgeSourceWithdrawn", subjectType: "KnowledgeSource", subjectId: input.sourceId, changes: { reason } });
      return withdrawn!;
    });
  }

  async expireSource(input: { workspaceId: string; sourceId: string }): Promise<boolean> {
    return this.database.transaction(async (tx) => {
      const [source] = await tx.select().from(knowledgeSources).where(and(eq(knowledgeSources.workspaceId, input.workspaceId), eq(knowledgeSources.id, input.sourceId))).for("update").limit(1);
      if (!source || source.status !== "validated") return false;
      if (!source.freshnessUntil || source.freshnessUntil > this.clock.now()) throw new KnowledgeServiceError("KNOWLEDGE_SOURCE_NOT_DUE", 409);
      await tx.update(knowledgeSources).set({ status: "expired", updatedAt: this.clock.now() }).where(and(eq(knowledgeSources.workspaceId, input.workspaceId), eq(knowledgeSources.id, input.sourceId), eq(knowledgeSources.status, "validated")));
      await recordMutation(tx, { workspaceId: input.workspaceId, actorUserId: null, eventType: "KnowledgeSourceExpired", subjectType: "KnowledgeSource", subjectId: input.sourceId, changes: { freshnessUntil: source.freshnessUntil.toISOString() } });
      return true;
    });
  }

  async createClaim(input: { workspaceId: string; actorUserId: string; claim: string; offerClaimId: string | null; sourceIds: readonly string[] }) {
    const claim = input.claim.trim();
    if (!claim || claim.length > 5_000) throw new KnowledgeServiceError("KNOWLEDGE_CLAIM_INVALID", 422);
    try { assertKnowledgeContentHasNoProspectPii(claim); }
    catch { throw new KnowledgeServiceError("KNOWLEDGE_PROSPECT_PII_DETECTED", 422); }
    const sourceIds = [...new Set(input.sourceIds)];
    return this.database.transaction(async (tx) => {
      if (input.offerClaimId) {
        const [offerClaim] = await tx.select({ id: offerClaims.id }).from(offerClaims).where(and(eq(offerClaims.workspaceId, input.workspaceId), eq(offerClaims.id, input.offerClaimId))).limit(1);
        if (!offerClaim) throw new KnowledgeServiceError("OFFER_CLAIM_NOT_FOUND", 422);
      }
      if (sourceIds.length) {
        const sources = await tx.select({ id: knowledgeSources.id }).from(knowledgeSources).where(and(eq(knowledgeSources.workspaceId, input.workspaceId), inArray(knowledgeSources.id, sourceIds)));
        if (sources.length !== sourceIds.length) throw new KnowledgeServiceError("KNOWLEDGE_SOURCE_NOT_FOUND", 422);
      }
      const id = this.ids.generate();
      const [created] = await tx.insert(knowledgeClaims).values({ id, workspaceId: input.workspaceId, claim, offerClaimId: input.offerClaimId, createdBy: input.actorUserId, createdAt: this.clock.now(), updatedAt: this.clock.now() }).returning();
      if (sourceIds.length) await tx.insert(knowledgeClaimSources).values(sourceIds.map((sourceId) => ({ workspaceId: input.workspaceId, claimId: id, sourceId, createdAt: this.clock.now() })));
      await recordMutation(tx, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, eventType: "KnowledgeClaimCreated", subjectType: "KnowledgeClaim", subjectId: id, changes: { sourceIds, offerClaimId: input.offerClaimId } });
      return created!;
    });
  }

  async validateClaim(input: { workspaceId: string; actorUserId: string; claimId: string }) {
    return this.database.transaction(async (tx) => {
      const [claim] = await tx.select().from(knowledgeClaims).where(and(eq(knowledgeClaims.workspaceId, input.workspaceId), eq(knowledgeClaims.id, input.claimId))).for("update").limit(1);
      if (!claim) throw new KnowledgeServiceError("KNOWLEDGE_CLAIM_NOT_FOUND", 404);
      if (claim.status !== "draft") throw new KnowledgeServiceError("KNOWLEDGE_CLAIM_TRANSITION_INVALID", 409);
      const sources = await tx.select({ status: knowledgeSources.status, freshnessUntil: knowledgeSources.freshnessUntil }).from(knowledgeClaimSources).innerJoin(knowledgeSources, and(eq(knowledgeSources.workspaceId, knowledgeClaimSources.workspaceId), eq(knowledgeSources.id, knowledgeClaimSources.sourceId))).where(and(eq(knowledgeClaimSources.workspaceId, input.workspaceId), eq(knowledgeClaimSources.claimId, input.claimId)));
      if (deriveKnowledgeClaimStatus("validated", sources, this.clock.now()) !== "validated") throw new KnowledgeServiceError("KNOWLEDGE_CLAIM_SOURCE_INVALID", 422);
      const [validated] = await tx.update(knowledgeClaims).set({ status: "validated", validatedBy: input.actorUserId, validatedAt: this.clock.now(), updatedAt: this.clock.now() }).where(and(eq(knowledgeClaims.workspaceId, input.workspaceId), eq(knowledgeClaims.id, input.claimId))).returning();
      await recordMutation(tx, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, eventType: "KnowledgeClaimValidated", subjectType: "KnowledgeClaim", subjectId: input.claimId, changes: { sourceCount: sources.length } });
      return validated!;
    });
  }

  async listSources(input: { workspaceId: string; type?: SourceType; status?: typeof knowledgeSources.$inferSelect.status; fresh?: boolean }) {
    const conditions = [eq(knowledgeSources.workspaceId, input.workspaceId)];
    if (input.type) conditions.push(eq(knowledgeSources.type, input.type));
    if (input.status) conditions.push(eq(knowledgeSources.status, input.status));
    const rows = await this.database.select().from(knowledgeSources).where(and(...conditions)).orderBy(desc(knowledgeSources.updatedAt), asc(knowledgeSources.id));
    return rows.filter((source) => input.fresh === undefined || (source.status === "validated" && source.freshnessUntil !== null && source.freshnessUntil > this.clock.now()) === input.fresh).map((source) => ({ ...source, effectiveStatus: source.status === "validated" && source.freshnessUntil !== null && source.freshnessUntil <= this.clock.now() ? "expired" as const : source.status }));
  }

  async listClaims(input: { workspaceId: string }) {
    const claims = await this.database.select().from(knowledgeClaims).where(eq(knowledgeClaims.workspaceId, input.workspaceId)).orderBy(desc(knowledgeClaims.updatedAt), asc(knowledgeClaims.id));
    if (!claims.length) return [];
    const links = await this.database.select({ claimId: knowledgeClaimSources.claimId, source: knowledgeSources }).from(knowledgeClaimSources).innerJoin(knowledgeSources, and(eq(knowledgeSources.workspaceId, knowledgeClaimSources.workspaceId), eq(knowledgeSources.id, knowledgeClaimSources.sourceId))).where(and(eq(knowledgeClaimSources.workspaceId, input.workspaceId), inArray(knowledgeClaimSources.claimId, claims.map((claim) => claim.id))));
    return claims.map((claim) => {
      const sources = links.filter((link) => link.claimId === claim.id).map((link) => link.source);
      return { ...claim, sources, effectiveStatus: deriveKnowledgeClaimStatus(claim.status, sources, this.clock.now()) };
    });
  }
}

async function recordMutation(tx: Transaction, input: { workspaceId: string; actorUserId: string | null; eventType: string; subjectType: string; subjectId: string; changes: Record<string, unknown> }) {
  const [event] = await tx.insert(outboxEvents).values({ workspaceId: input.workspaceId, aggregateType: input.subjectType, aggregateId: input.subjectId, eventType: input.eventType, payload: input.changes }).returning({ id: outboxEvents.id });
  if (!event) throw new KnowledgeServiceError("KNOWLEDGE_EVENT_FAILED", 409);
  await tx.insert(auditLogs).values({ workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: input.eventType, subjectType: input.subjectType, subjectId: input.subjectId, changes: input.changes, sourceEventId: event.id });
  return event.id;
}
