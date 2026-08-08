import { and, eq, isNull } from "drizzle-orm";
import type { OpportunityStage } from "@outbound/domain/pipeline/opportunity";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  opportunities,
  opportunityStageHistory,
} from "@outbound/infrastructure/database/schema";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function upsertOpportunityStage(tx: Transaction, input: {
  workspaceId: string;
  contactId: string;
  campaignId: string | null;
  stage: OpportunityStage;
  nextAction: string;
  source: string;
  reason: string;
  now: Date;
}): Promise<{ id: string; fromStage: string | null; changed: boolean }> {
  const campaignPredicate = input.campaignId
    ? eq(opportunities.campaignId, input.campaignId)
    : isNull(opportunities.campaignId);
  const [existing] = await tx
    .select({ id: opportunities.id, stage: opportunities.stage })
    .from(opportunities)
    .where(and(
      eq(opportunities.workspaceId, input.workspaceId),
      eq(opportunities.contactId, input.contactId),
      campaignPredicate,
    ))
    .limit(1);
  if (existing) {
    await tx.update(opportunities).set({
      stage: input.stage,
      nextAction: input.nextAction,
      updatedAt: input.now,
    }).where(and(
      eq(opportunities.workspaceId, input.workspaceId),
      eq(opportunities.id, existing.id),
    ));
    const changed = existing.stage !== input.stage;
    if (changed) await insertHistory(tx, { ...input, opportunityId: existing.id, fromStage: existing.stage });
    return { id: existing.id, fromStage: existing.stage, changed };
  }
  const id = crypto.randomUUID();
  await tx.insert(opportunities).values({
    id,
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    campaignId: input.campaignId,
    stage: input.stage,
    nextAction: input.nextAction,
    createdAt: input.now,
    updatedAt: input.now,
  });
  await insertHistory(tx, { ...input, opportunityId: id, fromStage: null });
  return { id, fromStage: null, changed: true };
}

async function insertHistory(tx: Transaction, input: {
  workspaceId: string;
  opportunityId: string;
  fromStage: string | null;
  stage: OpportunityStage;
  source: string;
  reason: string;
  now: Date;
}): Promise<void> {
  await tx.insert(opportunityStageHistory).values({
    id: crypto.randomUUID(),
    workspaceId: input.workspaceId,
    opportunityId: input.opportunityId,
    fromStage: input.fromStage,
    toStage: input.stage,
    source: input.source,
    reason: input.reason,
    createdAt: input.now,
  });
}
