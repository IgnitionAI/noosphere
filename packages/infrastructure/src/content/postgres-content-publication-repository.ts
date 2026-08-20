import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import type {
  ContentPublicationAccountSnapshot,
  ContentPublicationContentSnapshot,
  ContentPublicationExecution,
  ContentPublicationPolicySnapshot,
  ContentPublicationRepository,
  ContentPublicationStatus,
  ContentPublicationView,
  SocialPublishingAccountResolver,
} from "@outbound/application/content/content-publications";
import { CONTENT_PUBLICATION_JOB_TYPE } from "@outbound/application/content/content-publications";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  auditLogs,
  contentAssets,
  contentAssetVersions,
  contentIdeas,
  contentOperationRequests,
  contentPublicationAttempts,
  contentPublications,
  editorialStrategies,
  editorialStrategyVersions,
  jobs,
  outboxEvents,
} from "@outbound/infrastructure/database/schema";
import type { PostgresUnipileChannelConnections } from "@outbound/infrastructure/channels/postgres-unipile-channel-connections";

export class PostgresSocialPublishingAccountResolver implements SocialPublishingAccountResolver {
  constructor(private readonly connections: PostgresUnipileChannelConnections) {}

  async resolveLinkedin(input: { readonly workspaceId: string }) {
    const accountId = await this.connections.resolveHealthyAccount(input.workspaceId, "linkedin");
    const selected = await this.connections.selectedAccount(input.workspaceId, "linkedin");
    if (!selected || selected.providerAccountId !== accountId) throw new Error("CONTENT_PUBLICATION_ACCOUNT_UNAVAILABLE");
    return {
      accountId,
      displayName: selected.displayName,
      selectionVersion: selected.updatedAt.toISOString(),
    };
  }
}

export class PostgresContentPublicationRepository implements ContentPublicationRepository {
  constructor(private readonly database: Database) {}

  async findRequest(input: { readonly workspaceId: string; readonly operation: string; readonly requestKey: string }): Promise<ContentPublicationView | null> {
    const request = (await this.database.select().from(contentOperationRequests).where(and(
      eq(contentOperationRequests.workspaceId, input.workspaceId),
      eq(contentOperationRequests.operation, input.operation),
      eq(contentOperationRequests.requestKey, input.requestKey),
    )).limit(1))[0];
    return request ? this.find({ workspaceId: input.workspaceId, publicationId: request.resourceId }) : null;
  }

  async schedule(input: Parameters<ContentPublicationRepository["schedule"]>[0]): Promise<ContentPublicationView> {
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.workspaceId}:${input.assetId}:publication`}, 0))`);
      const replay = (await tx.select().from(contentOperationRequests).where(and(
        eq(contentOperationRequests.workspaceId, input.workspaceId),
        eq(contentOperationRequests.operation, "publication.schedule"),
        eq(contentOperationRequests.requestKey, input.requestKey),
      )).limit(1))[0];
      if (replay) {
        const retained = (await tx.select().from(contentPublications).where(and(eq(contentPublications.workspaceId, input.workspaceId), eq(contentPublications.id, replay.resourceId))).limit(1))[0];
        if (retained) return toPublication(retained);
      }

      const asset = (await tx.select().from(contentAssets).where(and(
        eq(contentAssets.workspaceId, input.workspaceId),
        eq(contentAssets.id, input.assetId),
      )).limit(1).for("update"))[0];
      if (!asset) throw new Error("CONTENT_ASSET_NOT_FOUND");
      if (asset.status !== "ready" || asset.latestVersion < 1) throw new Error("CONTENT_ASSET_NOT_READY");
      const version = (await tx.select().from(contentAssetVersions).where(and(
        eq(contentAssetVersions.workspaceId, input.workspaceId),
        eq(contentAssetVersions.assetId, asset.id),
        eq(contentAssetVersions.version, asset.latestVersion),
      )).limit(1))[0];
      if (!version || !version.ready) throw new Error("CONTENT_ASSET_NOT_READY");
      const grounding = (await tx.select({
        strategyVersionId: contentIdeas.strategyVersionId,
        strategyStatus: editorialStrategies.status,
        deletedAt: editorialStrategies.deletedAt,
      }).from(contentIdeas)
        .innerJoin(editorialStrategyVersions, and(
          eq(editorialStrategyVersions.workspaceId, contentIdeas.workspaceId),
          eq(editorialStrategyVersions.id, contentIdeas.strategyVersionId),
        ))
        .innerJoin(editorialStrategies, and(
          eq(editorialStrategies.workspaceId, editorialStrategyVersions.workspaceId),
          eq(editorialStrategies.id, editorialStrategyVersions.strategyId),
        ))
        .where(and(eq(contentIdeas.workspaceId, input.workspaceId), eq(contentIdeas.id, asset.ideaId))).limit(1))[0];
      if (!grounding || grounding.strategyStatus !== "active" || grounding.deletedAt) throw new Error("CONTENT_PUBLICATION_STRATEGY_INACTIVE");

      const publicationId = crypto.randomUUID();
      const contentSnapshot: ContentPublicationContentSnapshot = {
        assetVersionId: version.id,
        body: version.body,
        contentHash: sha256(version.body),
      };
      const policySnapshot: ContentPublicationPolicySnapshot = {
        schemaVersion: 1,
        policyVersion: "linkedin-publishing-v1",
        network: "linkedin",
        assetReady: true,
        strategyVersionId: grounding.strategyVersionId,
        claimsGate: "passed",
      };
      const row = (await tx.insert(contentPublications).values({
        id: publicationId,
        workspaceId: input.workspaceId,
        assetId: asset.id,
        assetVersionId: version.id,
        network: "linkedin",
        provider: "unipile",
        status: "scheduled",
        requestKey: input.requestKey,
        scheduledFor: input.scheduledFor,
        contentSnapshot,
        policySnapshot,
        accountSnapshot: input.account,
        maxAttempts: 4,
        createdBy: input.userId,
        createdAt: input.now,
        updatedAt: input.now,
      }).returning())[0]!;
      await tx.insert(contentOperationRequests).values({
        workspaceId: input.workspaceId,
        operation: "publication.schedule",
        requestKey: input.requestKey,
        resourceType: "ContentPublication",
        resourceId: publicationId,
        response: { publicationId },
      });
      await tx.insert(jobs).values({
        id: crypto.randomUUID(),
        workspaceId: input.workspaceId,
        type: CONTENT_PUBLICATION_JOB_TYPE,
        payload: { publicationId },
        idempotencyKey: `content-publication:${publicationId}:v1`,
        correlationId: `content-publication:${publicationId}`,
        maxAttempts: 4,
        priority: 10,
        availableAt: input.scheduledFor,
        createdAt: input.now,
        updatedAt: input.now,
      });
      await appendEvent(tx, { workspaceId: input.workspaceId, userId: input.userId, publicationId, eventType: "ContentPublicationScheduled", changes: { assetId: asset.id, assetVersionId: version.id, scheduledFor: input.scheduledFor.toISOString(), accountId: input.account.providerAccountId } });
      return toPublication(row);
    });
  }

  async list(input: Parameters<ContentPublicationRepository["list"]>[0]) {
    const cursor = input.cursor ? publicationCursor(input.cursor) : null;
    const rows = await this.database.select().from(contentPublications).where(and(
      eq(contentPublications.workspaceId, input.workspaceId),
      ...(cursor ? [or(
        lt(contentPublications.createdAt, cursor.createdAt),
        and(eq(contentPublications.createdAt, cursor.createdAt), lt(contentPublications.id, cursor.id)),
      )!] : []),
    )).orderBy(desc(contentPublications.createdAt), desc(contentPublications.id)).limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const data = rows.slice(0, input.limit).map(toPublication);
    const last = data.at(-1);
    return { data, nextCursor: hasMore && last ? `${last.createdAt.toISOString()}|${last.id}` : null };
  }

  async find(input: Parameters<ContentPublicationRepository["find"]>[0]): Promise<ContentPublicationView | null> {
    const row = (await this.database.select().from(contentPublications).where(and(
      eq(contentPublications.workspaceId, input.workspaceId),
      eq(contentPublications.id, input.publicationId),
    )).limit(1))[0];
    return row ? toPublication(row) : null;
  }

  async reschedule(input: Parameters<ContentPublicationRepository["reschedule"]>[0]): Promise<ContentPublicationView> {
    return this.database.transaction(async (tx) => {
      const replay = await operationReplay(tx, input.workspaceId, "publication.reschedule", input.requestKey);
      if (replay) return toPublication(replay);
      const row = await lockedPublication(tx, input.workspaceId, input.publicationId);
      if (!row) throw new Error("CONTENT_PUBLICATION_NOT_FOUND");
      if (!(["scheduled", "retry"] as const).includes(row.status as "scheduled" | "retry")) throw new Error("CONTENT_PUBLICATION_NOT_RESCHEDULABLE");
      const updated = (await tx.update(contentPublications).set({ scheduledFor: input.scheduledFor, status: "scheduled", lastErrorCode: null, lastErrorMessage: null, updatedAt: input.now }).where(and(eq(contentPublications.workspaceId, input.workspaceId), eq(contentPublications.id, row.id))).returning())[0]!;
      await tx.update(jobs).set({ status: "pending", availableAt: input.scheduledFor, lockedAt: null, lockedUntil: null, lockedBy: null, completedAt: null, lastErrorCode: null, lastErrorMessage: null, updatedAt: input.now }).where(and(eq(jobs.workspaceId, input.workspaceId), eq(jobs.type, CONTENT_PUBLICATION_JOB_TYPE), eq(jobs.idempotencyKey, `content-publication:${row.id}:v1`)));
      await retainOperation(tx, input, "publication.reschedule");
      await appendEvent(tx, { workspaceId: input.workspaceId, userId: input.userId, publicationId: row.id, eventType: "ContentPublicationRescheduled", changes: { scheduledFor: input.scheduledFor.toISOString() } });
      return toPublication(updated);
    });
  }

  async cancel(input: Parameters<ContentPublicationRepository["cancel"]>[0]): Promise<ContentPublicationView> {
    return this.database.transaction(async (tx) => {
      const replay = await operationReplay(tx, input.workspaceId, "publication.cancel", input.requestKey);
      if (replay) return toPublication(replay);
      const row = await lockedPublication(tx, input.workspaceId, input.publicationId);
      if (!row) throw new Error("CONTENT_PUBLICATION_NOT_FOUND");
      if (row.status === "cancelled") {
        await retainOperation(tx, input, "publication.cancel");
        return toPublication(row);
      }
      if (!(["scheduled", "retry"] as const).includes(row.status as "scheduled" | "retry")) throw new Error("CONTENT_PUBLICATION_NOT_CANCELLABLE");
      const updated = (await tx.update(contentPublications).set({ status: "cancelled", cancelledAt: input.now, updatedAt: input.now }).where(and(eq(contentPublications.workspaceId, input.workspaceId), eq(contentPublications.id, row.id))).returning())[0]!;
      await tx.update(jobs).set({ status: "completed", completedAt: input.now, lockedAt: null, lockedUntil: null, lockedBy: null, updatedAt: input.now }).where(and(eq(jobs.workspaceId, input.workspaceId), eq(jobs.type, CONTENT_PUBLICATION_JOB_TYPE), eq(jobs.idempotencyKey, `content-publication:${row.id}:v1`)));
      await retainOperation(tx, input, "publication.cancel");
      await appendEvent(tx, { workspaceId: input.workspaceId, userId: input.userId, publicationId: row.id, eventType: "ContentPublicationCancelled", changes: {} });
      return toPublication(updated);
    });
  }

  async inspectExecution(input: Parameters<ContentPublicationRepository["inspectExecution"]>[0]): Promise<"ready" | "terminal" | "unknown"> {
    return this.database.transaction(async (tx) => {
      const row = await lockedPublication(tx, input.workspaceId, input.publicationId);
      if (!row) throw new Error("CONTENT_PUBLICATION_NOT_FOUND");
      if (row.status === "publishing") {
        await tx.update(contentPublications).set({ status: "unknown", unknownAt: input.now, lastErrorCode: "CONTENT_PUBLICATION_LEASE_LOST", lastErrorMessage: "A prior publication attempt lost its lease after the provider boundary was entered.", updatedAt: input.now }).where(and(eq(contentPublications.workspaceId, input.workspaceId), eq(contentPublications.id, row.id)));
        if (row.executionToken) await tx.update(contentPublicationAttempts).set({ status: "unknown", errorCode: "CONTENT_PUBLICATION_LEASE_LOST", errorMessage: "Worker lease lost", completedAt: input.now }).where(and(eq(contentPublicationAttempts.workspaceId, input.workspaceId), eq(contentPublicationAttempts.executionToken, row.executionToken)));
        await appendEvent(tx, { workspaceId: input.workspaceId, userId: null, publicationId: row.id, eventType: "ContentPublicationResultUnknown", changes: { code: "CONTENT_PUBLICATION_LEASE_LOST" } });
        return "unknown";
      }
      return row.status === "scheduled" || row.status === "retry" ? "ready" : "terminal";
    });
  }

  async claimExecution(input: Parameters<ContentPublicationRepository["claimExecution"]>[0]): Promise<ContentPublicationExecution> {
    return this.database.transaction(async (tx) => {
      const row = await lockedPublication(tx, input.workspaceId, input.publicationId);
      if (!row) throw new Error("CONTENT_PUBLICATION_NOT_FOUND");
      if (row.status !== "scheduled" && row.status !== "retry") throw new Error("CONTENT_PUBLICATION_NOT_EXECUTABLE");
      if (row.scheduledFor > input.now) throw new Error("CONTENT_PUBLICATION_NOT_DUE");
      if (row.attempts >= row.maxAttempts) throw new Error("CONTENT_PUBLICATION_ATTEMPTS_EXHAUSTED");
      const account = accountSnapshot(row.accountSnapshot);
      const content = contentSnapshot(row.contentSnapshot);
      const policy = policySnapshot(row.policySnapshot);
      if (account.providerAccountId !== input.currentAccountId) throw new Error("CONTENT_PUBLICATION_ACCOUNT_CHANGED");
      if (policy.policyVersion !== "linkedin-publishing-v1" || policy.network !== "linkedin" || policy.claimsGate !== "passed") throw new Error("CONTENT_PUBLICATION_POLICY_INVALID");

      const version = (await tx.select({ ready: contentAssetVersions.ready, body: contentAssetVersions.body, assetStatus: contentAssets.status, strategyVersionId: contentIdeas.strategyVersionId, strategyStatus: editorialStrategies.status, deletedAt: editorialStrategies.deletedAt })
        .from(contentAssetVersions)
        .innerJoin(contentAssets, and(eq(contentAssets.workspaceId, contentAssetVersions.workspaceId), eq(contentAssets.id, contentAssetVersions.assetId)))
        .innerJoin(contentIdeas, and(eq(contentIdeas.workspaceId, contentAssets.workspaceId), eq(contentIdeas.id, contentAssets.ideaId)))
        .innerJoin(editorialStrategyVersions, and(eq(editorialStrategyVersions.workspaceId, contentIdeas.workspaceId), eq(editorialStrategyVersions.id, contentIdeas.strategyVersionId)))
        .innerJoin(editorialStrategies, and(eq(editorialStrategies.workspaceId, editorialStrategyVersions.workspaceId), eq(editorialStrategies.id, editorialStrategyVersions.strategyId)))
        .where(and(eq(contentAssetVersions.workspaceId, input.workspaceId), eq(contentAssetVersions.id, row.assetVersionId))).limit(1))[0];
      if (!version || !version.ready || version.assetStatus !== "ready") throw new Error("CONTENT_PUBLICATION_ASSET_NO_LONGER_READY");
      if (version.strategyStatus !== "active" || version.deletedAt || version.strategyVersionId !== policy.strategyVersionId) throw new Error("CONTENT_PUBLICATION_STRATEGY_INACTIVE");
      if (version.body !== content.body || sha256(version.body) !== content.contentHash || content.assetVersionId !== row.assetVersionId) throw new Error("CONTENT_PUBLICATION_SNAPSHOT_MISMATCH");

      const attempt = row.attempts + 1;
      await tx.update(contentPublications).set({ status: "publishing", attempts: attempt, executionToken: input.executionToken, publishStartedAt: input.now, lastErrorCode: null, lastErrorMessage: null, updatedAt: input.now }).where(and(eq(contentPublications.workspaceId, input.workspaceId), eq(contentPublications.id, row.id)));
      await tx.insert(contentPublicationAttempts).values({
        id: crypto.randomUUID(), workspaceId: input.workspaceId, publicationId: row.id, attempt, executionToken: input.executionToken,
        status: "started", requestSnapshot: { network: "linkedin", accountId: account.providerAccountId, contentHash: content.contentHash, requestKey: row.requestKey }, startedAt: input.now,
      });
      await appendEvent(tx, { workspaceId: input.workspaceId, userId: null, publicationId: row.id, eventType: "ContentPublicationStarted", changes: { attempt, executionToken: input.executionToken } });
      return { publicationId: row.id, executionToken: input.executionToken, accountId: account.providerAccountId, text: content.body, requestKey: row.requestKey, attempt };
    });
  }

  async markPublished(input: Parameters<ContentPublicationRepository["markPublished"]>[0]): Promise<void> {
    await this.database.transaction(async (tx) => {
      const updated = await tx.update(contentPublications).set({ status: "published", providerPostId: input.result.providerPostId, providerSocialId: input.result.socialId, providerUrl: input.result.url, publishedAt: input.result.publishedAt ?? input.now, executionToken: null, updatedAt: input.now }).where(and(eq(contentPublications.workspaceId, input.workspaceId), eq(contentPublications.id, input.publicationId), eq(contentPublications.status, "publishing"), eq(contentPublications.executionToken, input.executionToken))).returning({ id: contentPublications.id });
      if (!updated[0]) throw new Error("CONTENT_PUBLICATION_EXECUTION_CONFLICT");
      await tx.update(contentPublicationAttempts).set({ status: "published", providerPostId: input.result.providerPostId, providerSocialId: input.result.socialId, providerUrl: input.result.url, completedAt: input.now }).where(and(eq(contentPublicationAttempts.workspaceId, input.workspaceId), eq(contentPublicationAttempts.executionToken, input.executionToken)));
      await appendEvent(tx, { workspaceId: input.workspaceId, userId: null, publicationId: input.publicationId, eventType: "ContentPublicationPublished", changes: { providerPostId: input.result.providerPostId, providerUrl: input.result.url } });
    });
  }

  async markRetry(input: Parameters<ContentPublicationRepository["markRetry"]>[0]): Promise<void> {
    await this.markOutcome({ ...input, status: "retry", attemptStatus: "not_sent", scheduledFor: input.availableAt });
  }

  async markFailed(input: Parameters<ContentPublicationRepository["markFailed"]>[0]): Promise<void> {
    await this.markOutcome({ ...input, status: "failed", attemptStatus: "failed" });
  }

  async markUnknown(input: Parameters<ContentPublicationRepository["markUnknown"]>[0]): Promise<void> {
    await this.markOutcome({ ...input, status: "unknown", attemptStatus: "unknown", unknownAt: input.now });
  }

  private async markOutcome(input: {
    readonly workspaceId: string;
    readonly publicationId: string;
    readonly executionToken?: string;
    readonly code: string;
    readonly message: string;
    readonly now: Date;
    readonly status: "retry" | "failed" | "unknown";
    readonly attemptStatus: "not_sent" | "failed" | "unknown";
    readonly scheduledFor?: Date;
    readonly unknownAt?: Date;
  }): Promise<void> {
    await this.database.transaction(async (tx) => {
      const conditions = [eq(contentPublications.workspaceId, input.workspaceId), eq(contentPublications.id, input.publicationId)];
      if (input.executionToken) {
        conditions.push(eq(contentPublications.status, "publishing"), eq(contentPublications.executionToken, input.executionToken));
      } else {
        conditions.push(sql`${contentPublications.status} in ('scheduled', 'retry')`);
      }
      const updated = await tx.update(contentPublications).set({
        status: input.status,
        lastErrorCode: input.code,
        lastErrorMessage: input.message.slice(0, 4_000),
        executionToken: null,
        ...(input.scheduledFor ? { scheduledFor: input.scheduledFor } : {}),
        ...(input.unknownAt ? { unknownAt: input.unknownAt } : {}),
        updatedAt: input.now,
      }).where(and(...conditions)).returning({ id: contentPublications.id });
      if (!updated[0]) throw new Error("CONTENT_PUBLICATION_EXECUTION_CONFLICT");
      if (input.executionToken) await tx.update(contentPublicationAttempts).set({ status: input.attemptStatus, errorCode: input.code, errorMessage: input.message.slice(0, 4_000), completedAt: input.now }).where(and(eq(contentPublicationAttempts.workspaceId, input.workspaceId), eq(contentPublicationAttempts.executionToken, input.executionToken)));
      const eventType = input.status === "retry" ? "ContentPublicationRetryScheduled" : input.status === "unknown" ? "ContentPublicationResultUnknown" : "ContentPublicationFailed";
      await appendEvent(tx, { workspaceId: input.workspaceId, userId: null, publicationId: input.publicationId, eventType, changes: { code: input.code, ...(input.scheduledFor ? { scheduledFor: input.scheduledFor.toISOString() } : {}) } });
    });
  }
}

function toPublication(row: typeof contentPublications.$inferSelect): ContentPublicationView {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    assetId: row.assetId,
    assetVersionId: row.assetVersionId,
    network: "linkedin",
    provider: "unipile",
    status: row.status as ContentPublicationStatus,
    scheduledFor: row.scheduledFor,
    contentSnapshot: contentSnapshot(row.contentSnapshot),
    policySnapshot: policySnapshot(row.policySnapshot),
    accountSnapshot: accountSnapshot(row.accountSnapshot),
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    providerPostId: row.providerPostId,
    providerSocialId: row.providerSocialId,
    providerUrl: row.providerUrl,
    lastErrorCode: row.lastErrorCode,
    lastErrorMessage: row.lastErrorMessage,
    publishedAt: row.publishedAt,
    cancelledAt: row.cancelledAt,
    unknownAt: row.unknownAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function contentSnapshot(value: unknown): ContentPublicationContentSnapshot {
  const record = objectValue(value);
  if (typeof record.assetVersionId !== "string" || typeof record.body !== "string" || typeof record.contentHash !== "string") throw new Error("CONTENT_PUBLICATION_SNAPSHOT_INVALID");
  return { assetVersionId: record.assetVersionId, body: record.body, contentHash: record.contentHash };
}

function policySnapshot(value: unknown): ContentPublicationPolicySnapshot {
  const record = objectValue(value);
  if (record.schemaVersion !== 1 || record.policyVersion !== "linkedin-publishing-v1" || record.network !== "linkedin" || record.assetReady !== true || typeof record.strategyVersionId !== "string" || record.claimsGate !== "passed") throw new Error("CONTENT_PUBLICATION_POLICY_INVALID");
  return { schemaVersion: 1, policyVersion: "linkedin-publishing-v1", network: "linkedin", assetReady: true, strategyVersionId: record.strategyVersionId, claimsGate: "passed" };
}

function accountSnapshot(value: unknown): ContentPublicationAccountSnapshot {
  const record = objectValue(value);
  if (record.provider !== "unipile" || typeof record.providerAccountId !== "string" || typeof record.displayName !== "string" || typeof record.selectionVersion !== "string" || typeof record.observedAt !== "string") throw new Error("CONTENT_PUBLICATION_ACCOUNT_SNAPSHOT_INVALID");
  return { provider: "unipile", providerAccountId: record.providerAccountId, displayName: record.displayName, selectionVersion: record.selectionVersion, observedAt: record.observedAt };
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("CONTENT_PUBLICATION_SNAPSHOT_INVALID");
  return value as Record<string, unknown>;
}

function sha256(value: string): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

function publicationCursor(value: string): { createdAt: Date; id: string } {
  const separator = value.indexOf("|");
  const createdAt = new Date(separator > 0 ? value.slice(0, separator) : "");
  const id = separator > 0 ? value.slice(separator + 1) : "";
  if (Number.isNaN(createdAt.getTime()) || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) throw new Error("CONTENT_PUBLICATION_CURSOR_INVALID");
  return { createdAt, id };
}

async function lockedPublication(tx: any, workspaceId: string, publicationId: string) {
  return (await tx.select().from(contentPublications).where(and(eq(contentPublications.workspaceId, workspaceId), eq(contentPublications.id, publicationId))).limit(1).for("update"))[0] as typeof contentPublications.$inferSelect | undefined;
}

async function operationReplay(tx: any, workspaceId: string, operation: string, requestKey: string) {
  const request = (await tx.select().from(contentOperationRequests).where(and(eq(contentOperationRequests.workspaceId, workspaceId), eq(contentOperationRequests.operation, operation), eq(contentOperationRequests.requestKey, requestKey))).limit(1))[0];
  return request ? lockedPublication(tx, workspaceId, request.resourceId) : null;
}

async function retainOperation(tx: any, input: { workspaceId: string; publicationId: string; requestKey: string }, operation: string) {
  await tx.insert(contentOperationRequests).values({ workspaceId: input.workspaceId, operation, requestKey: input.requestKey, resourceType: "ContentPublication", resourceId: input.publicationId, response: { publicationId: input.publicationId } });
}

async function appendEvent(tx: any, input: { workspaceId: string; userId: string | null; publicationId: string; eventType: string; changes: unknown }) {
  const events = await tx.insert(outboxEvents).values({ workspaceId: input.workspaceId, aggregateType: "ContentPublication", aggregateId: input.publicationId, eventType: input.eventType, payload: { type: input.eventType, publicationId: input.publicationId, workspaceId: input.workspaceId, ...input.changes as object } }).returning({ id: outboxEvents.id });
  if (events[0]) await tx.insert(auditLogs).values({ workspaceId: input.workspaceId, actorUserId: input.userId, action: input.eventType, subjectType: "ContentPublication", subjectId: input.publicationId, changes: input.changes, sourceEventId: events[0].id });
}
