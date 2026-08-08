import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { AIPolicyRules, MessagingStrategyRules } from "@outbound/domain/gtm/messaging-strategy";
import { assertHumanSupervisionPolicy, validateMessagingStrategy } from "@outbound/domain/gtm/messaging-strategy";
import type {
  AIPolicyView,
  AIPolicyVersionView,
  MessagingStrategyRepository,
  MessagingStrategyVersionView,
  MessagingStrategyView,
} from "@outbound/application/gtm/messaging-strategy-ports";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  aiPolicies,
  aiPolicyVersions,
  auditLogs,
  messagingStrategies,
  messagingStrategyVersions,
  offerClaims,
  outboxEvents,
} from "@outbound/infrastructure/database/schema";

export class PostgresMessagingStrategyRepository implements MessagingStrategyRepository {
  constructor(private readonly db: Database) {}

  async listStrategies(workspaceId: string): Promise<readonly MessagingStrategyView[]> {
    const rows = await this.db.select().from(messagingStrategies)
      .where(and(eq(messagingStrategies.workspaceId, workspaceId), isNull(messagingStrategies.deletedAt)))
      .orderBy(desc(messagingStrategies.updatedAt));
    return rows.map(toStrategy);
  }

  async getStrategy(input: { workspaceId: string; strategyId: string }): Promise<MessagingStrategyView | null> {
    const rows = await this.db.select().from(messagingStrategies).where(and(
      eq(messagingStrategies.workspaceId, input.workspaceId),
      eq(messagingStrategies.id, input.strategyId),
    )).limit(1);
    const strategy = rows[0];
    if (!strategy) return null;
    const versions = await this.db.select().from(messagingStrategyVersions).where(and(
      eq(messagingStrategyVersions.workspaceId, input.workspaceId),
      eq(messagingStrategyVersions.strategyId, input.strategyId),
    )).orderBy(desc(messagingStrategyVersions.version));
    return { ...toStrategy(strategy), versions: versions.map(toStrategyVersion) };
  }

  async createStrategy(input: { id: string; workspaceId: string; name: string; draftRules: MessagingStrategyRules; createdBy: string }): Promise<MessagingStrategyView> {
    try {
      const rows = await this.db.insert(messagingStrategies).values({
        id: input.id, workspaceId: input.workspaceId, name: input.name,
        draftRules: input.draftRules, createdBy: input.createdBy,
      }).returning();
      return toStrategy(rows[0]!);
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error("MESSAGING_STRATEGY_NAME_CONFLICT");
      throw error;
    }
  }

  async updateStrategy(input: { workspaceId: string; strategyId: string; name?: string; draftRules?: MessagingStrategyRules }): Promise<MessagingStrategyView> {
    const fields = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.draftRules !== undefined ? { draftRules: input.draftRules } : {}),
      updatedAt: new Date(),
    };
    try {
      const rows = await this.db.update(messagingStrategies).set(fields).where(and(
        eq(messagingStrategies.workspaceId, input.workspaceId), eq(messagingStrategies.id, input.strategyId),
      )).returning();
      if (!rows[0]) throw new Error("MESSAGING_STRATEGY_NOT_FOUND");
      return toStrategy(rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error("MESSAGING_STRATEGY_NAME_CONFLICT");
      throw error;
    }
  }

  async publishStrategy(input: { id: string; workspaceId: string; strategyId: string; userId: string; publishedAt: Date }): Promise<MessagingStrategyVersionView> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sqlLock(input.strategyId));
      const containers = await tx.select().from(messagingStrategies).where(and(
        eq(messagingStrategies.workspaceId, input.workspaceId), eq(messagingStrategies.id, input.strategyId),
      )).limit(1);
      const strategy = containers[0];
      if (!strategy) throw new Error("MESSAGING_STRATEGY_NOT_FOUND");
      if (strategy.deletedAt) throw new Error("MESSAGING_STRATEGY_DELETED");
      const rules = asStrategyRules(strategy.draftRules);
      validateStrategy(rules);
      await validateReferencedClaims(tx, input.workspaceId, rules);
      const previous = await tx.select().from(messagingStrategyVersions).where(and(
        eq(messagingStrategyVersions.workspaceId, input.workspaceId), eq(messagingStrategyVersions.strategyId, input.strategyId),
      )).orderBy(desc(messagingStrategyVersions.version)).limit(1);
      const latest = previous[0];
      if (latest && sameJson(latest.rules, rules)) return toStrategyVersion(latest);
      const version = (latest?.version ?? 0) + 1;
      let inserted;
      try {
        inserted = await tx.insert(messagingStrategyVersions).values({
          id: input.id, workspaceId: input.workspaceId, strategyId: input.strategyId,
          version, rules, publishedBy: input.userId, publishedAt: input.publishedAt,
        }).returning();
      } catch (error) {
        if (isUniqueViolation(error)) throw new Error("MESSAGING_STRATEGY_VERSION_ALLOCATION_CONFLICT");
        throw error;
      }
      const published = inserted[0]!;
      await tx.update(messagingStrategies).set({ currentVersion: version, updatedAt: input.publishedAt }).where(and(
        eq(messagingStrategies.workspaceId, input.workspaceId), eq(messagingStrategies.id, input.strategyId),
      ));
      await writePublication(tx, {
        workspaceId: input.workspaceId, userId: input.userId, aggregateType: "MessagingStrategy",
        aggregateId: input.strategyId, eventType: "MessagingStrategyVersionPublished",
        payload: { type: "MessagingStrategyVersionPublished", strategyId: input.strategyId, versionId: published.id, version, workspaceId: input.workspaceId, actorUserId: input.userId },
      });
      return toStrategyVersion(published);
    });
  }

  async listPolicies(workspaceId: string): Promise<readonly AIPolicyView[]> {
    const rows = await this.db.select().from(aiPolicies)
      .where(and(eq(aiPolicies.workspaceId, workspaceId), isNull(aiPolicies.deletedAt)))
      .orderBy(desc(aiPolicies.updatedAt));
    return rows.map(toPolicy);
  }

  async getPolicy(input: { workspaceId: string; policyId: string }): Promise<AIPolicyView | null> {
    const rows = await this.db.select().from(aiPolicies).where(and(
      eq(aiPolicies.workspaceId, input.workspaceId), eq(aiPolicies.id, input.policyId),
    )).limit(1);
    const policy = rows[0];
    if (!policy) return null;
    const versions = await this.db.select().from(aiPolicyVersions).where(and(
      eq(aiPolicyVersions.workspaceId, input.workspaceId), eq(aiPolicyVersions.policyId, input.policyId),
    )).orderBy(desc(aiPolicyVersions.version));
    return { ...toPolicy(policy), versions: versions.map(toPolicyVersion) };
  }

  async createPolicy(input: { id: string; workspaceId: string; name: string; draftRules: AIPolicyRules; createdBy: string }): Promise<AIPolicyView> {
    try {
      assertHumanSupervisionPolicy(input.draftRules);
      const rows = await this.db.insert(aiPolicies).values({
        id: input.id, workspaceId: input.workspaceId, name: input.name,
        draftRules: input.draftRules, createdBy: input.createdBy,
      }).returning();
      return toPolicy(rows[0]!);
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error("AI_POLICY_NAME_CONFLICT");
      throw error;
    }
  }

  async updatePolicy(input: { workspaceId: string; policyId: string; name?: string; draftRules?: AIPolicyRules }): Promise<AIPolicyView> {
    if (input.draftRules) assertHumanSupervisionPolicy(input.draftRules);
    const fields = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.draftRules !== undefined ? { draftRules: input.draftRules } : {}),
      updatedAt: new Date(),
    };
    try {
      const rows = await this.db.update(aiPolicies).set(fields).where(and(
        eq(aiPolicies.workspaceId, input.workspaceId), eq(aiPolicies.id, input.policyId),
      )).returning();
      if (!rows[0]) throw new Error("AI_POLICY_NOT_FOUND");
      return toPolicy(rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error("AI_POLICY_NAME_CONFLICT");
      throw error;
    }
  }

  async publishPolicy(input: { id: string; workspaceId: string; policyId: string; userId: string; publishedAt: Date }): Promise<AIPolicyVersionView> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sqlLock(input.policyId));
      const containers = await tx.select().from(aiPolicies).where(and(
        eq(aiPolicies.workspaceId, input.workspaceId), eq(aiPolicies.id, input.policyId),
      )).limit(1);
      const policy = containers[0];
      if (!policy) throw new Error("AI_POLICY_NOT_FOUND");
      if (policy.deletedAt) throw new Error("AI_POLICY_DELETED");
      const rules = asPolicyRules(policy.draftRules);
      assertHumanSupervisionPolicy(rules);
      const previous = await tx.select().from(aiPolicyVersions).where(and(
        eq(aiPolicyVersions.workspaceId, input.workspaceId), eq(aiPolicyVersions.policyId, input.policyId),
      )).orderBy(desc(aiPolicyVersions.version)).limit(1);
      const latest = previous[0];
      if (latest && sameJson(latest.rules, rules)) return toPolicyVersion(latest);
      const version = (latest?.version ?? 0) + 1;
      let inserted;
      try {
        inserted = await tx.insert(aiPolicyVersions).values({
          id: input.id, workspaceId: input.workspaceId, policyId: input.policyId,
          version, rules, publishedBy: input.userId, publishedAt: input.publishedAt,
        }).returning();
      } catch (error) {
        if (isUniqueViolation(error)) throw new Error("AI_POLICY_VERSION_ALLOCATION_CONFLICT");
        throw error;
      }
      const published = inserted[0]!;
      await tx.update(aiPolicies).set({ currentVersion: version, updatedAt: input.publishedAt }).where(and(
        eq(aiPolicies.workspaceId, input.workspaceId), eq(aiPolicies.id, input.policyId),
      ));
      await writePublication(tx, {
        workspaceId: input.workspaceId, userId: input.userId, aggregateType: "AIPolicy",
        aggregateId: input.policyId, eventType: "AIPolicyVersionPublished",
        payload: { type: "AIPolicyVersionPublished", policyId: input.policyId, versionId: published.id, version, workspaceId: input.workspaceId, actorUserId: input.userId },
      });
      return toPolicyVersion(published);
    });
  }
}

function toStrategy(value: typeof messagingStrategies.$inferSelect): MessagingStrategyView {
  return { ...value, draftRules: asStrategyRules(value.draftRules), deletedAt: value.deletedAt, createdAt: value.createdAt, updatedAt: value.updatedAt };
}
function toStrategyVersion(value: typeof messagingStrategyVersions.$inferSelect): MessagingStrategyVersionView {
  return { ...value, rules: asStrategyRules(value.rules), publishedBy: value.publishedBy, publishedAt: value.publishedAt, createdAt: value.createdAt };
}
function toPolicy(value: typeof aiPolicies.$inferSelect): AIPolicyView {
  return { ...value, draftRules: asPolicyRules(value.draftRules), deletedAt: value.deletedAt, createdAt: value.createdAt, updatedAt: value.updatedAt };
}
function toPolicyVersion(value: typeof aiPolicyVersions.$inferSelect): AIPolicyVersionView {
  return { ...value, rules: asPolicyRules(value.rules), publishedBy: value.publishedBy, publishedAt: value.publishedAt, createdAt: value.createdAt };
}

function asStrategyRules(value: unknown): MessagingStrategyRules {
  const rules = value && typeof value === "object" ? value as Partial<MessagingStrategyRules> : {};
  return { tone: typeof rules.tone === "string" ? rules.tone : "", angle: typeof rules.angle === "string" ? rules.angle : "", templates: Array.isArray(rules.templates) ? rules.templates : [], allowedClaimIds: Array.isArray(rules.allowedClaimIds) ? rules.allowedClaimIds.filter((id): id is string => typeof id === "string") : [], ...(typeof (rules as { offerVersionId?: unknown }).offerVersionId === "string" ? { offerVersionId: (rules as { offerVersionId: string }).offerVersionId } : {}) } as MessagingStrategyRules;
}
function asPolicyRules(value: unknown): AIPolicyRules {
  const rules = value && typeof value === "object" ? value as Partial<AIPolicyRules> : {};
  return {
    ...(rules.firstContactRequiresHumanApproval !== undefined ? { firstContactRequiresHumanApproval: rules.firstContactRequiresHumanApproval } : {}),
    ...(rules.responsesRequireHumanApproval !== undefined ? { responsesRequireHumanApproval: rules.responsesRequireHumanApproval } : {}),
    followUpsMayBeAutomated: rules.followUpsMayBeAutomated === true,
    ...(rules.escalationRules ? { escalationRules: rules.escalationRules } : {}),
  };
}
function validateStrategy(rules: MessagingStrategyRules): void {
  const errors = validateMessagingStrategy(rules);
  if (errors.length) throw new Error(`MESSAGING_STRATEGY_INVALID:${JSON.stringify(errors)}`);
}
async function validateReferencedClaims(tx: any, workspaceId: string, rules: MessagingStrategyRules): Promise<void> {
  const claimIds = rules.allowedClaimIds;
  if (!claimIds.length) return;
  const offerVersionId = (rules as MessagingStrategyRules & { offerVersionId?: string }).offerVersionId;
  if (!offerVersionId) throw new Error(`MESSAGING_CLAIMS_INVALID:${claimIds.join(",")}`);
  const rows = await tx.select({ id: offerClaims.id, validationStatus: offerClaims.validationStatus }).from(offerClaims).where(and(
    eq(offerClaims.workspaceId, workspaceId), eq(offerClaims.offerVersionId, offerVersionId),
  ));
  const byId = new Map<string, string>(rows.map((row: { id: string; validationStatus: string }) => [row.id, row.validationStatus] as [string, string]));
  const blocked = claimIds.filter((id) => !byId.has(id) || ["hypothesis", "invalidated"].includes(byId.get(id)!));
  if (blocked.length) throw new Error(`MESSAGING_CLAIMS_INVALID:${blocked.join(",")}`);
}
function sqlLock(id: string) { return sql`select pg_advisory_xact_lock(hashtextextended(${id}, 0))`; }
async function writePublication(tx: any, input: { workspaceId: string; userId: string; aggregateType: string; aggregateId: string; eventType: string; payload: unknown }) {
  const [event] = await tx.insert(outboxEvents).values({ workspaceId: input.workspaceId, aggregateType: input.aggregateType, aggregateId: input.aggregateId, eventType: input.eventType, payload: input.payload }).returning({ id: outboxEvents.id });
  if (!event) throw new Error("MESSAGING_PUBLICATION_EVENT_FAILED");
  await tx.insert(auditLogs).values({ workspaceId: input.workspaceId, actorUserId: input.userId, action: input.eventType, subjectType: input.aggregateType, subjectId: input.aggregateId, changes: input.payload, sourceEventId: event.id });
}
function isUniqueViolation(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505"; }
function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}
function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, canonicalJson(nested)]));
  }
  return value;
}
