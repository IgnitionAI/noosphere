import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import {
  aiPolicies,
  aiPolicyVersions,
  auditLogs,
  authUsers,
  campaigns,
  connectedAccounts,
  icps,
  icpVersions,
  outboxEvents,
  productResearchRuns,
  workspaceOnboarding,
  workspaces,
} from "@outbound/infrastructure/database/schema";
import { PostgresWorkspaceOnboarding } from "@outbound/infrastructure/workspaces/postgres-workspace-onboarding";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("F-052 workspace onboarding", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const service = new PostgresWorkspaceOnboarding(database.db);
  const workspaceId = crypto.randomUUID();
  const otherWorkspaceId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const operatorId = crypto.randomUUID();
  const icpId = crypto.randomUUID();
  const icpVersionId = crypto.randomUUID();
  const policyId = crypto.randomUUID();
  const policyVersionId = crypto.randomUUID();
  const now = new Date("2026-08-09T08:00:00.000Z");

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values([
      { id: workspaceId, slug: `f052-${workspaceId}`, name: "F-052" },
      { id: otherWorkspaceId, slug: `f052-other-${otherWorkspaceId}`, name: "F-052 Other" },
    ]);
    await database.db.insert(authUsers).values([
      { id: ownerId, name: "F-052 Owner", email: `f052-owner-${ownerId}@example.com` },
      { id: operatorId, name: "F-052 Operator", email: `f052-operator-${operatorId}@example.com` },
    ]);
  });

  afterAll(async () => {
    await database.client.begin(async (sql) => {
      await sql`delete from campaigns where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`alter table ai_policy_versions disable trigger user`;
      await sql`delete from ai_policy_versions where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`alter table ai_policy_versions enable trigger user`;
      await sql`delete from ai_policies where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`delete from connected_accounts where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`alter table icp_versions disable trigger user`;
      await sql`delete from icp_versions where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`alter table icp_versions enable trigger user`;
      await sql`delete from icps where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`delete from product_research_runs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`delete from workspace_onboarding where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`delete from outbox_events where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`alter table audit_logs disable trigger user`;
      await sql`delete from audit_logs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`alter table audit_logs enable trigger user`;
      await sql`delete from auth_users where id in (${ownerId}, ${operatorId})`;
      await sql`delete from workspaces where id in (${workspaceId}, ${otherWorkspaceId})`;
    });
    await database.close();
  });

  test("persists seven shared steps and validates real prerequisites in order", async () => {
    const started = await service.getProgress({ workspaceId, actorUserId: ownerId, role: "owner", now });
    expect(started).toMatchObject({ currentStep: "workspace", completedCount: 0, completed: false });
    expect(await database.db.select().from(workspaceOnboarding).where(eq(workspaceOnboarding.workspaceId, workspaceId))).toHaveLength(7);
    expect((await service.getProgress({ workspaceId, actorUserId: operatorId, role: "operator", now })).currentStep).toBe("workspace");
    await expect(service.completeStep({ workspaceId, step: "workspace", actorUserId: operatorId, role: "viewer", now })).rejects.toMatchObject({ code: "ONBOARDING_MUTATION_FORBIDDEN" });
    await expect(service.completeStep({ workspaceId, step: "workspace", actorUserId: operatorId, role: "reviewer", now })).rejects.toMatchObject({ code: "ONBOARDING_MUTATION_FORBIDDEN" });

    const workspaceCompleted = await service.completeStep({ workspaceId, step: "workspace", actorUserId: ownerId, role: "owner", now });
    expect(workspaceCompleted.currentStep).toBe("product");
    await expect(service.completeStep({ workspaceId, step: "product", actorUserId: ownerId, role: "owner", now })).rejects.toMatchObject({ code: "ONBOARDING_PREREQUISITE_MISSING" });

    await database.db.insert(productResearchRuns).values({ id: crypto.randomUUID(), workspaceId, brief: { productUrl: "https://example.com" }, status: "completed", completedStages: [], version: 1, createdAt: now, updatedAt: now });
    await service.completeStep({ workspaceId, step: "product", actorUserId: ownerId, role: "owner", now });
    await database.db.insert(icps).values({ id: icpId, workspaceId, name: "ICP F-052", currentVersion: 1, createdAt: now, updatedAt: now });
    await database.db.insert(icpVersions).values({ id: icpVersionId, workspaceId, icpId, version: 1, name: "ICP F-052", confidence: "0.9000", criteria: [], buyingCommittee: [], problems: [], signals: [], exclusions: [], unknowns: [], unresolvedContradictions: [], blockedFindings: [], publishedBy: ownerId, publishedAt: now, createdAt: now });
    await service.completeStep({ workspaceId, step: "icp", actorUserId: ownerId, role: "owner", now });

    await database.db.insert(connectedAccounts).values({ id: crypto.randomUUID(), workspaceId, provider: "unipile", providerAccountId: "f052-account", displayName: "F-052", status: "connected", capabilities: { email: true }, quotas: {}, encryptedSecret: "encrypted-for-test", createdBy: ownerId, createdAt: now, updatedAt: now });
    await expect(service.completeStep({ workspaceId, step: "sending_account", actorUserId: operatorId, role: "operator", now })).rejects.toMatchObject({ code: "ONBOARDING_MUTATION_FORBIDDEN" });
    await service.completeStep({ workspaceId, step: "sending_account", actorUserId: ownerId, role: "owner", now });
    const skipped = await service.skipOptionalStep({ workspaceId, step: "calendar", actorUserId: operatorId, role: "operator", now });
    expect(skipped.currentStep).toBe("prerequisites");
    await service.skipOptionalStep({ workspaceId, step: "calendar", actorUserId: operatorId, role: "operator", now });
    await service.completeStep({ workspaceId, step: "prerequisites", actorUserId: operatorId, role: "operator", now });
  });

  test("completes autopilot idempotently and isolates another workspace", async () => {
    const automaticCampaignId = crypto.randomUUID();
    await database.db.insert(campaigns).values({
      id: automaticCampaignId,
      workspaceId,
      name: "F-052 automatic campaign",
      objective: "Configuration générée par l’IA",
      status: "draft",
      icpVersionId,
      channel: "email",
      sequenceId: crypto.randomUUID(),
      autopilotPolicy: { enabled: true },
      createdBy: ownerId,
      createdAt: now,
      updatedAt: now,
    });
    const automaticProgress = await service.getProgress({ workspaceId, actorUserId: ownerId, role: "owner", now });
    const [automaticCampaign] = await database.db.select({ aiPolicyVersionId: campaigns.aiPolicyVersionId }).from(campaigns).where(eq(campaigns.id, automaticCampaignId));
    expect(automaticCampaign?.aiPolicyVersionId).not.toBeNull();
    expect(automaticProgress).toMatchObject({ completed: true, currentStep: null });

    await database.db.insert(aiPolicies).values({ id: policyId, workspaceId, name: "F-052 policy", currentVersion: 1, draftRules: {}, createdBy: ownerId, createdAt: now, updatedAt: now });
    await database.db.insert(aiPolicyVersions).values({ id: policyVersionId, workspaceId, policyId, version: 1, rules: {}, publishedBy: ownerId, publishedAt: now, createdAt: now });
    await database.db.insert(campaigns).values({ id: crypto.randomUUID(), workspaceId, name: "F-052 campaign", objective: "Première campagne", status: "active", icpVersionId, aiPolicyVersionId: policyVersionId, channel: "email", sequenceId: crypto.randomUUID(), autopilotPolicy: { enabled: true }, createdBy: ownerId, activatedBy: ownerId, activatedAt: now, createdAt: now, updatedAt: now });

    const completed = await service.completeStep({ workspaceId, step: "autopilot", actorUserId: ownerId, role: "owner", now });
    const replay = await service.completeStep({ workspaceId, step: "autopilot", actorUserId: ownerId, role: "owner", now });
    expect(completed).toMatchObject({ completed: true, currentStep: null, completedCount: 7, nextAction: { href: "/prospects/discover" } });
    expect(replay).toMatchObject({ completed: true, completedCount: 7 });
    expect(await database.db.select().from(outboxEvents).where(and(eq(outboxEvents.workspaceId, workspaceId), eq(outboxEvents.eventType, "OnboardingCompleted")))).toHaveLength(1);
    expect(await database.db.select().from(auditLogs).where(and(eq(auditLogs.workspaceId, workspaceId), eq(auditLogs.action, "OnboardingCompleted")))).toHaveLength(1);

    const other = await service.getProgress({ workspaceId: otherWorkspaceId, actorUserId: ownerId, role: "owner", now });
    expect(other).toMatchObject({ currentStep: "workspace", completedCount: 0, completed: false });
    expect(await database.db.select().from(workspaceOnboarding).where(eq(workspaceOnboarding.workspaceId, otherWorkspaceId))).toHaveLength(7);
  });
});
