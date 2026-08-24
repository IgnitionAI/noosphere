import { and, eq, isNull, lte, ne, or, sql } from "drizzle-orm";
import type {
  ContentPublicationReconciliationLease,
  ContentPublicationReconciliationRepository,
  ContentPublicationReconciliationTarget,
} from "@outbound/application/content/content-publication-reconciliation";
import type { SocialContentSnapshot } from "@outbound/application/content/social-ports";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  auditLogs,
  contentPublicationAttempts,
  contentPublicationReconciliations,
  contentPublications,
  outboxEvents,
} from "@outbound/infrastructure/database/schema";

interface ReconciliationCriteriaSnapshot {
  readonly schemaVersion: 1;
  readonly provider: "unipile";
  readonly providerAccountId: string;
  readonly contentFingerprint: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly correlationId: string;
}

export class PostgresContentPublicationReconciliationRepository implements ContentPublicationReconciliationRepository {
  constructor(private readonly database: Database) {}

  async listDue(input: { readonly now: Date; readonly workspaceId?: string }): Promise<readonly ContentPublicationReconciliationTarget[]> {
    const rows = await this.database.select({
      workspaceId: contentPublicationReconciliations.workspaceId,
      reconciliationId: contentPublicationReconciliations.id,
      publicationId: contentPublicationReconciliations.publicationId,
    }).from(contentPublicationReconciliations).where(and(
      isNull(contentPublicationReconciliations.completedAt),
      sql`${contentPublicationReconciliations.status} in ('pending', 'searching', 'error')`,
      or(
        and(
          ne(contentPublicationReconciliations.status, "searching"),
          lte(contentPublicationReconciliations.nextAttemptAt, input.now),
        ),
        and(
          eq(contentPublicationReconciliations.status, "searching"),
          lte(contentPublicationReconciliations.lockedUntil, input.now),
        ),
      ),
      ...(input.workspaceId ? [eq(contentPublicationReconciliations.workspaceId, input.workspaceId)] : []),
    )).limit(50);
    return rows;
  }

  async acquire(input: ContentPublicationReconciliationTarget & { readonly now: Date; readonly leaseMs: number }): Promise<ContentPublicationReconciliationLease | null> {
    return this.database.transaction(async (tx) => {
      const row = (await tx.select().from(contentPublicationReconciliations).where(and(
        eq(contentPublicationReconciliations.workspaceId, input.workspaceId),
        eq(contentPublicationReconciliations.id, input.reconciliationId),
        eq(contentPublicationReconciliations.publicationId, input.publicationId),
      )).limit(1).for("update"))[0];
      if (!row || row.completedAt || row.attempts >= row.maxAttempts) return null;
      const due = row.status === "searching"
        ? Boolean(row.lockedUntil && row.lockedUntil <= input.now)
        : Boolean(row.nextAttemptAt && row.nextAttemptAt <= input.now);
      if (!due) return null;
      const publication = (await tx.select({ status: contentPublications.status }).from(contentPublications).where(and(
        eq(contentPublications.workspaceId, input.workspaceId),
        eq(contentPublications.id, input.publicationId),
      )).limit(1).for("update"))[0];
      if (!publication || publication.status !== "unknown") {
        await tx.update(contentPublicationReconciliations).set({
          status: publication?.status === "published" ? "matched" : "error",
          completedAt: input.now,
          leaseToken: null,
          lockedUntil: null,
          nextAttemptAt: null,
          lastErrorCode: publication?.status === "published" ? null : "CONTENT_PUBLICATION_NO_LONGER_UNKNOWN",
          updatedAt: input.now,
        }).where(eq(contentPublicationReconciliations.id, row.id));
        return null;
      }
      const leaseToken = crypto.randomUUID();
      const attempt = row.attempts + 1;
      const updated = (await tx.update(contentPublicationReconciliations).set({
        status: "searching",
        attempts: attempt,
        leaseToken,
        lockedUntil: new Date(input.now.getTime() + input.leaseMs),
        nextAttemptAt: null,
        startedAt: row.startedAt ?? input.now,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: input.now,
      }).where(and(
        eq(contentPublicationReconciliations.workspaceId, input.workspaceId),
        eq(contentPublicationReconciliations.id, row.id),
      )).returning())[0];
      if (!updated) return null;
      const criteria = criteriaSnapshot(updated.criteriaSnapshot);
      return {
        workspaceId: updated.workspaceId,
        reconciliationId: updated.id,
        publicationId: updated.publicationId,
        leaseToken,
        providerAccountId: criteria.providerAccountId,
        contentFingerprint: criteria.contentFingerprint,
        windowStart: new Date(criteria.windowStart),
        windowEnd: new Date(criteria.windowEnd),
        attempt,
        maxAttempts: updated.maxAttempts,
      };
    });
  }

  async markMatched(input: { readonly lease: ContentPublicationReconciliationLease; readonly match: SocialContentSnapshot; readonly now: Date }): Promise<void> {
    await this.database.transaction(async (tx) => {
      const locked = await lockLease(tx, input.lease);
      if (!locked) throw new Error("CONTENT_PUBLICATION_RECONCILIATION_LEASE_LOST");
      const publication = (await tx.update(contentPublications).set({
        status: "published",
        providerPostId: input.match.providerPostId,
        providerSocialId: input.match.socialId,
        providerUrl: input.match.url,
        publishedAt: input.match.publishedAt ?? input.now,
        unknownAt: null,
        executionToken: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: input.now,
      }).where(and(
        eq(contentPublications.workspaceId, input.lease.workspaceId),
        eq(contentPublications.id, input.lease.publicationId),
        eq(contentPublications.status, "unknown"),
      )).returning({ id: contentPublications.id }))[0];
      if (!publication) throw new Error("CONTENT_PUBLICATION_RECONCILIATION_CONFLICT");
      await tx.update(contentPublicationAttempts).set({
        status: "published",
        providerPostId: input.match.providerPostId,
        providerSocialId: input.match.socialId,
        providerUrl: input.match.url,
        errorCode: null,
        errorMessage: null,
        completedAt: input.now,
      }).where(and(
        eq(contentPublicationAttempts.workspaceId, input.lease.workspaceId),
        eq(contentPublicationAttempts.publicationId, input.lease.publicationId),
        eq(contentPublicationAttempts.status, "unknown"),
      ));
      await tx.update(contentPublicationReconciliations).set({
        status: "matched",
        candidatesCount: 1,
        matchedProviderPostId: input.match.providerPostId,
        matchedProviderSocialId: input.match.socialId,
        matchedProviderUrl: input.match.url,
        matchedPublishedAt: input.match.publishedAt,
        leaseToken: null,
        lockedUntil: null,
        nextAttemptAt: null,
        completedAt: input.now,
        updatedAt: input.now,
      }).where(eq(contentPublicationReconciliations.id, input.lease.reconciliationId));
      await appendDecision(tx, input.lease, "ContentPublicationReconciled", {
        outcome: "matched",
        candidatesCount: 1,
        providerPostId: input.match.providerPostId,
        attempt: input.lease.attempt,
      });
    });
  }

  async markNoMatch(input: { readonly lease: ContentPublicationReconciliationLease; readonly candidatesCount: number; readonly terminal: boolean; readonly nextAttemptAt: Date; readonly now: Date }): Promise<void> {
    await this.#completeSearch({
      lease: input.lease,
      status: input.terminal ? "not_found" : "pending",
      candidatesCount: input.candidatesCount,
      nextAttemptAt: input.terminal ? null : input.nextAttemptAt,
      completedAt: input.terminal ? input.now : null,
      code: input.terminal ? "CONTENT_PUBLICATION_PROVIDER_NOT_FOUND" : null,
      now: input.now,
    });
  }

  async markAmbiguous(input: { readonly lease: ContentPublicationReconciliationLease; readonly candidatesCount: number; readonly now: Date }): Promise<void> {
    await this.#completeSearch({
      lease: input.lease,
      status: "ambiguous",
      candidatesCount: input.candidatesCount,
      nextAttemptAt: null,
      completedAt: input.now,
      code: "CONTENT_PUBLICATION_PROVIDER_MATCH_AMBIGUOUS",
      now: input.now,
    });
  }

  async markProviderError(input: { readonly lease: ContentPublicationReconciliationLease; readonly code: string; readonly terminal: boolean; readonly nextAttemptAt: Date; readonly now: Date }): Promise<void> {
    await this.#completeSearch({
      lease: input.lease,
      status: "error",
      candidatesCount: 0,
      nextAttemptAt: input.terminal ? null : input.nextAttemptAt,
      completedAt: input.terminal ? input.now : null,
      code: input.code,
      now: input.now,
    });
  }

  async #completeSearch(input: {
    readonly lease: ContentPublicationReconciliationLease;
    readonly status: "pending" | "not_found" | "ambiguous" | "error";
    readonly candidatesCount: number;
    readonly nextAttemptAt: Date | null;
    readonly completedAt: Date | null;
    readonly code: string | null;
    readonly now: Date;
  }): Promise<void> {
    await this.database.transaction(async (tx) => {
      const locked = await lockLease(tx, input.lease);
      if (!locked) throw new Error("CONTENT_PUBLICATION_RECONCILIATION_LEASE_LOST");
      const updated = await tx.update(contentPublicationReconciliations).set({
        status: input.status,
        candidatesCount: input.candidatesCount,
        leaseToken: null,
        lockedUntil: null,
        nextAttemptAt: input.nextAttemptAt,
        completedAt: input.completedAt,
        lastErrorCode: input.code,
        lastErrorMessage: input.code ? safeDecisionMessage(input.code) : null,
        updatedAt: input.now,
      }).where(and(
        eq(contentPublicationReconciliations.workspaceId, input.lease.workspaceId),
        eq(contentPublicationReconciliations.id, input.lease.reconciliationId),
        eq(contentPublicationReconciliations.leaseToken, input.lease.leaseToken),
      )).returning({ id: contentPublicationReconciliations.id });
      if (!updated[0]) throw new Error("CONTENT_PUBLICATION_RECONCILIATION_LEASE_LOST");
      if (input.completedAt) {
        await appendDecision(tx, input.lease, "ContentPublicationReconciliationDecided", {
          outcome: input.status,
          candidatesCount: input.candidatesCount,
          code: input.code,
          attempt: input.lease.attempt,
        });
      }
    });
  }
}

async function lockLease(tx: any, lease: ContentPublicationReconciliationLease) {
  return (await tx.select({ id: contentPublicationReconciliations.id }).from(contentPublicationReconciliations).where(and(
    eq(contentPublicationReconciliations.workspaceId, lease.workspaceId),
    eq(contentPublicationReconciliations.id, lease.reconciliationId),
    eq(contentPublicationReconciliations.publicationId, lease.publicationId),
    eq(contentPublicationReconciliations.status, "searching"),
    eq(contentPublicationReconciliations.leaseToken, lease.leaseToken),
  )).limit(1).for("update"))[0];
}

async function appendDecision(tx: any, lease: ContentPublicationReconciliationLease, eventType: string, changes: Record<string, unknown>) {
  const [event] = await tx.insert(outboxEvents).values({
    workspaceId: lease.workspaceId,
    aggregateType: "ContentPublication",
    aggregateId: lease.publicationId,
    eventType,
    payload: { type: eventType, workspaceId: lease.workspaceId, publicationId: lease.publicationId, correlationId: `content-publication:${lease.publicationId}`, ...changes },
  }).returning({ id: outboxEvents.id });
  if (event) await tx.insert(auditLogs).values({
    workspaceId: lease.workspaceId,
    actorUserId: null,
    action: eventType,
    subjectType: "ContentPublication",
    subjectId: lease.publicationId,
    changes: { correlationId: `content-publication:${lease.publicationId}`, ...changes },
    sourceEventId: event.id,
  });
}

function criteriaSnapshot(value: unknown): ReconciliationCriteriaSnapshot {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  if (record.schemaVersion !== 1 || record.provider !== "unipile" || typeof record.providerAccountId !== "string" || typeof record.contentFingerprint !== "string" || typeof record.windowStart !== "string" || typeof record.windowEnd !== "string" || typeof record.correlationId !== "string") throw new Error("CONTENT_PUBLICATION_RECONCILIATION_CRITERIA_INVALID");
  return record as unknown as ReconciliationCriteriaSnapshot;
}

function safeDecisionMessage(code: string): string {
  if (code === "CONTENT_PUBLICATION_PROVIDER_NOT_FOUND") return "No matching provider publication was observed before the reconciliation window closed.";
  if (code === "CONTENT_PUBLICATION_PROVIDER_MATCH_AMBIGUOUS") return "More than one provider publication matched the durable fingerprint and time window.";
  return `Provider reconciliation failed (${code}).`;
}
