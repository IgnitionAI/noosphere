import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  aiPolicyVersions,
  aiPolicies,
  calendarConnections,
  campaigns,
  connectedAccounts,
  icpVersions,
  offerVersions,
  outboxEvents,
  productResearchRuns,
  workspaceOnboarding,
  workspaces,
  auditLogs,
} from "@outbound/infrastructure/database/schema";
import type { WorkspaceRole } from "@outbound/interface/http/request-context";

export const WORKSPACE_ONBOARDING_STEPS = [
  "workspace",
  "product",
  "icp",
  "sending_account",
  "calendar",
  "prerequisites",
  "autopilot",
] as const;

export type WorkspaceOnboardingStep = (typeof WORKSPACE_ONBOARDING_STEPS)[number];
export type WorkspaceOnboardingStatus = "pending" | "completed" | "skipped";

type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface WorkspaceOnboardingStepView {
  readonly key: WorkspaceOnboardingStep;
  readonly position: number;
  readonly title: string;
  readonly description: string;
  readonly optional: boolean;
  readonly status: WorkspaceOnboardingStatus;
  readonly canMutate: boolean;
  readonly requiredRole: "member" | "owner_or_admin";
  readonly prerequisite: {
    readonly satisfied: boolean;
    readonly code: string;
    readonly message: string;
    readonly href: string;
  };
  readonly actorUserId: string | null;
  readonly completedAt: Date | null;
}

export interface WorkspaceOnboardingProgress {
  readonly workspaceId: string;
  readonly currentStep: WorkspaceOnboardingStep | null;
  readonly completed: boolean;
  readonly completedCount: number;
  readonly steps: readonly WorkspaceOnboardingStepView[];
  readonly nextAction: { readonly label: string; readonly href: string };
}

export class WorkspaceOnboardingError extends Error {
  constructor(readonly code: string, readonly status: number, readonly details: Record<string, unknown> = {}) {
    super(code);
    this.name = "WorkspaceOnboardingError";
  }
}

export class PostgresWorkspaceOnboarding {
  constructor(private readonly database: Database) {}

  async getProgress(input: { workspaceId: string; actorUserId: string; role: WorkspaceRole; now?: Date }): Promise<WorkspaceOnboardingProgress> {
    const now = input.now ?? new Date();
    await this.#ensureStarted(input.workspaceId, input.actorUserId, now);
    await this.#reconcileAutopilot(input.workspaceId, input.actorUserId, now);
    return this.#readProgress(this.database, input.workspaceId, input.role);
  }

  async completeStep(input: { workspaceId: string; step: WorkspaceOnboardingStep; actorUserId: string; role: WorkspaceRole; now?: Date }): Promise<WorkspaceOnboardingProgress> {
    assertCanComplete(input.step, input.role);
    const now = input.now ?? new Date();
    await this.database.transaction(async (tx) => {
      await lockWorkspace(tx, input.workspaceId);
      await ensureRows(tx, input.workspaceId, now);
      if (input.step === "autopilot") {
        await ensureAutopilot(tx, input.workspaceId, input.actorUserId, now);
      }
      const rows = await tx.select().from(workspaceOnboarding).where(eq(workspaceOnboarding.workspaceId, input.workspaceId));
      const current = rows.find((row) => row.step === input.step);
      if (!current) throw new WorkspaceOnboardingError("ONBOARDING_STEP_NOT_FOUND", 404);
      if (current.status === "completed") return;
      assertPreviousStepsCompleted(rows, input.step);
      const prerequisites = await readPrerequisites(tx, input.workspaceId);
      const prerequisite = prerequisiteFor(input.step, prerequisites);
      if (!prerequisite.satisfied) {
        throw new WorkspaceOnboardingError("ONBOARDING_PREREQUISITE_MISSING", 409, {
          step: input.step,
          prerequisite: prerequisite.code,
          href: prerequisite.href,
        });
      }
      await tx.update(workspaceOnboarding).set({ status: "completed", actorUserId: input.actorUserId, completedAt: now, updatedAt: now }).where(and(eq(workspaceOnboarding.workspaceId, input.workspaceId), eq(workspaceOnboarding.step, input.step)));
      await tx.insert(outboxEvents).values({
        workspaceId: input.workspaceId,
        aggregateType: "WorkspaceOnboarding",
        aggregateId: input.workspaceId,
        eventType: "OnboardingStepCompleted",
        payload: { workspaceId: input.workspaceId, step: input.step, actorUserId: input.actorUserId, role: input.role },
        createdAt: now,
      });
      if (input.step === "autopilot") await recordCompletion(tx, input.workspaceId, input.actorUserId, now);
    });
    return this.#readProgress(this.database, input.workspaceId, input.role);
  }

  async #reconcileAutopilot(workspaceId: string, actorUserId: string, now: Date): Promise<void> {
    await this.database.transaction(async (tx) => {
      await lockWorkspace(tx, workspaceId);
      await ensureRows(tx, workspaceId, now);
      await ensureAutopilot(tx, workspaceId, actorUserId, now);
      const rows = await tx.select().from(workspaceOnboarding).where(eq(workspaceOnboarding.workspaceId, workspaceId));
      const autopilot = rows.find((row) => row.step === "autopilot");
      if (!autopilot || autopilot.status !== "pending") return;
      try {
        assertPreviousStepsCompleted(rows, "autopilot");
      } catch {
        return;
      }
      const prerequisites = await readPrerequisites(tx, workspaceId);
      if (!prerequisites.autopilotReady) return;
      await tx.update(workspaceOnboarding).set({
        status: "completed",
        actorUserId,
        completedAt: now,
        updatedAt: now,
      }).where(and(
        eq(workspaceOnboarding.workspaceId, workspaceId),
        eq(workspaceOnboarding.step, "autopilot"),
        eq(workspaceOnboarding.status, "pending"),
      ));
      await tx.insert(outboxEvents).values({
        workspaceId,
        aggregateType: "WorkspaceOnboarding",
        aggregateId: workspaceId,
        eventType: "OnboardingStepCompleted",
        payload: { workspaceId, step: "autopilot", actorUserId, source: "ai_autopilot" },
        createdAt: now,
      });
      await recordCompletion(tx, workspaceId, actorUserId, now);
    });
  }

  async skipOptionalStep(input: { workspaceId: string; step: WorkspaceOnboardingStep; actorUserId: string; role: WorkspaceRole; now?: Date }): Promise<WorkspaceOnboardingProgress> {
    if (input.step !== "calendar") throw new WorkspaceOnboardingError("ONBOARDING_STEP_NOT_OPTIONAL", 409);
    if (!["owner", "admin", "operator"].includes(input.role)) throw new WorkspaceOnboardingError("ONBOARDING_MUTATION_FORBIDDEN", 403);
    const now = input.now ?? new Date();
    await this.database.transaction(async (tx) => {
      await lockWorkspace(tx, input.workspaceId);
      await ensureRows(tx, input.workspaceId, now);
      const rows = await tx.select().from(workspaceOnboarding).where(eq(workspaceOnboarding.workspaceId, input.workspaceId));
      const current = rows.find((row) => row.step === input.step);
      if (!current) throw new WorkspaceOnboardingError("ONBOARDING_STEP_NOT_FOUND", 404);
      if (current.status === "skipped" || current.status === "completed") return;
      assertPreviousStepsCompleted(rows, input.step);
      await tx.update(workspaceOnboarding).set({ status: "skipped", actorUserId: input.actorUserId, completedAt: now, updatedAt: now }).where(and(eq(workspaceOnboarding.workspaceId, input.workspaceId), eq(workspaceOnboarding.step, input.step)));
      await tx.insert(outboxEvents).values({
        workspaceId: input.workspaceId,
        aggregateType: "WorkspaceOnboarding",
        aggregateId: input.workspaceId,
        eventType: "OnboardingStepSkipped",
        payload: { workspaceId: input.workspaceId, step: input.step, actorUserId: input.actorUserId, role: input.role },
        createdAt: now,
      });
    });
    return this.#readProgress(this.database, input.workspaceId, input.role);
  }

  async #ensureStarted(workspaceId: string, actorUserId: string, now: Date): Promise<void> {
    await this.database.transaction(async (tx) => {
      await lockWorkspace(tx, workspaceId);
      const [existing] = await tx.select({ step: workspaceOnboarding.step }).from(workspaceOnboarding).where(eq(workspaceOnboarding.workspaceId, workspaceId)).limit(1);
      if (existing) return;
      await ensureRows(tx, workspaceId, now);
      await tx.insert(outboxEvents).values({
        workspaceId,
        aggregateType: "WorkspaceOnboarding",
        aggregateId: workspaceId,
        eventType: "OnboardingStarted",
        payload: { workspaceId, actorUserId },
        createdAt: now,
      });
    });
  }

  async #readProgress(executor: Executor, workspaceId: string, role: WorkspaceRole): Promise<WorkspaceOnboardingProgress> {
    const [rows, prerequisites] = await Promise.all([
      executor.select().from(workspaceOnboarding).where(eq(workspaceOnboarding.workspaceId, workspaceId)),
      readPrerequisites(executor, workspaceId),
    ]);
    const byStep = new Map(rows.map((row) => [row.step, row]));
    const steps = WORKSPACE_ONBOARDING_STEPS.map((key, index): WorkspaceOnboardingStepView => {
      const definition = STEP_DEFINITIONS[key];
      const row = byStep.get(key);
      return {
        key,
        position: index + 1,
        title: definition.title,
        description: definition.description,
        optional: definition.optional,
        status: row?.status ?? "pending",
        canMutate: canComplete(key, role),
        requiredRole: definition.requiredRole,
        prerequisite: prerequisiteFor(key, prerequisites),
        actorUserId: row?.actorUserId ?? null,
        completedAt: row?.completedAt ?? null,
      };
    });
    const currentStep = steps.find((step) => step.status === "pending")?.key ?? null;
    const completed = steps.find((step) => step.key === "autopilot")?.status === "completed";
    return {
      workspaceId,
      currentStep,
      completed,
      completedCount: steps.filter((step) => step.status !== "pending").length,
      steps,
      nextAction: completed
        ? { label: "Découvrir des prospects", href: "/prospects/discover" }
        : { label: "Continuer la configuration", href: currentStep ? `#${currentStep}` : "#autopilot" },
    };
  }
}

const STEP_DEFINITIONS: Record<WorkspaceOnboardingStep, { title: string; description: string; optional: boolean; requiredRole: "member" | "owner_or_admin" }> = {
  workspace: { title: "Workspace", description: "Confirmez le nom et le profil de votre espace de travail.", optional: false, requiredRole: "member" },
  product: { title: "Produit", description: "Décrivez ce que vous vendez via une lecture produit ou une offre publiée.", optional: false, requiredRole: "member" },
  icp: { title: "ICP", description: "Publiez au moins une version d’ICP exploitable par le sourcing.", optional: false, requiredRole: "member" },
  sending_account: { title: "Compte d’envoi", description: "Connectez et vérifiez au moins un compte Unipile.", optional: false, requiredRole: "owner_or_admin" },
  calendar: { title: "Calendrier", description: "Connectez Cal.com pour proposer et réserver des rendez-vous.", optional: true, requiredRole: "owner_or_admin" },
  prerequisites: { title: "Prérequis", description: "Vérifiez les éléments obligatoires avant l’activation.", optional: false, requiredRole: "member" },
  autopilot: { title: "Autopilote", description: "L’IA prépare une première campagne prête à démarrer.", optional: false, requiredRole: "member" },
};

type Prerequisites = Awaited<ReturnType<typeof readPrerequisites>>;

async function readPrerequisites(executor: Executor, workspaceId: string) {
  const [workspace, productResearch, offer, icp, account, calendar, autopilotPolicy, campaign] = await Promise.all([
    executor.select({ id: workspaces.id, name: workspaces.name, status: workspaces.status }).from(workspaces).where(and(eq(workspaces.id, workspaceId), eq(workspaces.status, "active"))).limit(1),
    executor.select({ id: productResearchRuns.id }).from(productResearchRuns).where(and(eq(productResearchRuns.workspaceId, workspaceId), inArray(productResearchRuns.status, ["ready_for_review", "completed", "partial"]))).limit(1),
    executor.select({ id: offerVersions.id }).from(offerVersions).where(eq(offerVersions.workspaceId, workspaceId)).limit(1),
    executor.select({ id: icpVersions.id }).from(icpVersions).where(eq(icpVersions.workspaceId, workspaceId)).limit(1),
    executor.select({ id: connectedAccounts.id }).from(connectedAccounts).where(and(eq(connectedAccounts.workspaceId, workspaceId), eq(connectedAccounts.provider, "unipile"), eq(connectedAccounts.status, "connected"))).limit(1),
    executor.select({ id: calendarConnections.id }).from(calendarConnections).where(and(eq(calendarConnections.workspaceId, workspaceId), eq(calendarConnections.status, "active"))).limit(1),
    executor.select({ id: aiPolicyVersions.id }).from(aiPolicyVersions).where(eq(aiPolicyVersions.workspaceId, workspaceId)).limit(1),
    executor.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.workspaceId, workspaceId), inArray(campaigns.status, ["draft", "active"]), isNotNull(campaigns.aiPolicyVersionId))).limit(1),
  ]);
  const workspaceReady = Boolean(workspace[0]?.name.trim());
  const productReady = Boolean(productResearch[0] || offer[0]);
  const icpReady = Boolean(icp[0]);
  const sendingReady = Boolean(account[0]);
  const calendarReady = Boolean(calendar[0]);
  const autopilotReady = Boolean(autopilotPolicy[0] && campaign[0]);
  return { workspaceReady, productReady, icpReady, sendingReady, calendarReady, prerequisitesReady: workspaceReady && productReady && icpReady && sendingReady, autopilotReady };
}

const DEFAULT_AUTOPILOT_POLICY_RULES = {
  firstContactRequiresHumanApproval: true,
  responsesRequireHumanApproval: true,
  followUpsMayBeAutomated: false,
} as const;

/**
 * The onboarding flow is deliberately self-serve: the agent can publish a
 * conservative policy and wire it to a campaign without asking the operator
 * to copy IDs between five editors. Sending remains safe because first
 * contacts and replies still require human approval and campaign execution
 * defaults to dry-run.
 */
async function ensureAutopilot(
  tx: Transaction,
  workspaceId: string,
  actorUserId: string,
  now: Date,
): Promise<{ policyVersionId: string | null; attachedCampaignIds: readonly string[] }> {
  const candidates = await tx
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(
      eq(campaigns.workspaceId, workspaceId),
      // Active snapshots are immutable. A draft is the safe hand-off point for
      // the agent; the campaign worker will activate it when its population is
      // ready, without another configuration screen.
      eq(campaigns.status, "draft"),
      isNull(campaigns.aiPolicyVersionId),
    ));
  if (!candidates.length) return { policyVersionId: null, attachedCampaignIds: [] };

  const [latest] = await tx
    .select({ id: aiPolicyVersions.id })
    .from(aiPolicyVersions)
    .where(eq(aiPolicyVersions.workspaceId, workspaceId))
    .orderBy(desc(aiPolicyVersions.publishedAt))
    .limit(1);

  let policyVersionId = latest?.id ?? null;
  if (!policyVersionId) {
    const [existingPolicy] = await tx
      .select()
      .from(aiPolicies)
      .where(and(eq(aiPolicies.workspaceId, workspaceId), isNull(aiPolicies.deletedAt)))
      .orderBy(desc(aiPolicies.updatedAt))
      .limit(1);
    const policyId = existingPolicy?.id ?? crypto.randomUUID();
    const rules = safeAutopilotPolicyRules(existingPolicy?.draftRules);
    if (!existingPolicy) {
      await tx.insert(aiPolicies).values({
        id: policyId,
        workspaceId,
        name: "Politique IA autopilote",
        currentVersion: 0,
        draftRules: rules,
        createdBy: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    policyVersionId = crypto.randomUUID();
    await tx.insert(aiPolicyVersions).values({
      id: policyVersionId,
      workspaceId,
      policyId,
      version: 1,
      rules,
      publishedBy: null,
      publishedAt: now,
      createdAt: now,
    });
    await tx.update(aiPolicies).set({ currentVersion: 1, updatedAt: now }).where(and(
      eq(aiPolicies.workspaceId, workspaceId),
      eq(aiPolicies.id, policyId),
    ));
    const [event] = await tx.insert(outboxEvents).values({
      workspaceId,
      aggregateType: "AIPolicy",
      aggregateId: policyId,
      eventType: "AIPolicyVersionPublished",
      payload: {
        type: "AIPolicyVersionPublished",
        policyId,
        version: 1,
        versionId: policyVersionId,
        workspaceId,
        actorUserId,
        source: "ai_autopilot",
      },
      createdAt: now,
    }).returning({ id: outboxEvents.id });
    if (event) {
      await tx.insert(auditLogs).values({
        workspaceId,
        actorUserId,
        action: "AIPolicyVersionPublished",
        subjectType: "AIPolicy",
        subjectId: policyId,
        changes: { version: 1, versionId: policyVersionId, source: "ai_autopilot" },
        sourceEventId: event.id,
        correlationId: `workspace-onboarding:${workspaceId}`,
        createdAt: now,
      });
    }
  }

  if (!policyVersionId) return { policyVersionId, attachedCampaignIds: [] };

  // This only adds an immutable policy reference; it does not rewrite any
  // already scheduled or sent action. Existing active campaigns can therefore
  // be repaired without changing their message content or delivery state.
  const attachedCampaignIds: string[] = [];
  for (const candidate of candidates) {
    const [updated] = await tx.update(campaigns).set({
      aiPolicyVersionId: policyVersionId,
      updatedAt: now,
    }).where(and(
      eq(campaigns.workspaceId, workspaceId),
      eq(campaigns.id, candidate.id),
      isNull(campaigns.aiPolicyVersionId),
    )).returning({ id: campaigns.id });
    if (!updated) continue;
    attachedCampaignIds.push(updated.id);
    await tx.insert(outboxEvents).values({
      workspaceId,
      aggregateType: "Campaign",
      aggregateId: updated.id,
      eventType: "CampaignAutopilotPolicyAttached",
      payload: { campaignId: updated.id, aiPolicyVersionId: policyVersionId, source: "ai_autopilot" },
      createdAt: now,
    });
  }
  return { policyVersionId, attachedCampaignIds };
}

function safeAutopilotPolicyRules(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_AUTOPILOT_POLICY_RULES;
  const source = value as Record<string, unknown>;
  return {
    // These two invariants cannot be disabled by an AI-generated policy.
    firstContactRequiresHumanApproval: true,
    responsesRequireHumanApproval: true,
    followUpsMayBeAutomated: source.followUpsMayBeAutomated === true,
    ...(source.escalationRules && typeof source.escalationRules === "object" && !Array.isArray(source.escalationRules)
      ? { escalationRules: source.escalationRules }
      : {}),
  };
}

function prerequisiteFor(step: WorkspaceOnboardingStep, value: Prerequisites) {
  const map = {
    workspace: { satisfied: value.workspaceReady, code: "WORKSPACE_PROFILE_MISSING", message: "Le workspace doit avoir un nom actif.", href: "/settings" },
    product: { satisfied: value.productReady, code: "PRODUCT_READING_MISSING", message: "Aucune lecture produit terminée ni offre publiée.", href: "/strategy/product-reading" },
    icp: { satisfied: value.icpReady, code: "PUBLISHED_ICP_MISSING", message: "Aucune version d’ICP publiée.", href: "/icps" },
    sending_account: { satisfied: value.sendingReady, code: "VERIFIED_SENDING_ACCOUNT_MISSING", message: "Aucun compte d’envoi Unipile connecté et vérifié.", href: "/integrations" },
    calendar: { satisfied: value.calendarReady, code: "CALENDAR_CONNECTION_MISSING", message: "Cal.com n’est pas connecté. Cette étape reste facultative.", href: "/settings/calendar" },
    prerequisites: { satisfied: value.prerequisitesReady, code: "MANDATORY_PREREQUISITES_MISSING", message: "Un ou plusieurs prérequis obligatoires sont encore manquants.", href: "#prerequisites" },
    autopilot: { satisfied: value.autopilotReady, code: "AUTOPILOT_CAMPAIGN_MISSING", message: "Aucune campagne active n’utilise encore une politique IA publiée.", href: "/campaigns" },
  } satisfies Record<WorkspaceOnboardingStep, { satisfied: boolean; code: string; message: string; href: string }>;
  return map[step];
}

function canComplete(step: WorkspaceOnboardingStep, role: WorkspaceRole) {
  if (role === "viewer" || role === "reviewer") return false;
  if (STEP_DEFINITIONS[step].requiredRole === "owner_or_admin") return role === "owner" || role === "admin";
  return role === "owner" || role === "admin" || role === "operator";
}

function assertCanComplete(step: WorkspaceOnboardingStep, role: WorkspaceRole) {
  if (!canComplete(step, role)) throw new WorkspaceOnboardingError("ONBOARDING_MUTATION_FORBIDDEN", 403, { step, requiredRole: STEP_DEFINITIONS[step].requiredRole });
}

function assertPreviousStepsCompleted(rows: readonly (typeof workspaceOnboarding.$inferSelect)[], step: WorkspaceOnboardingStep) {
  const position = WORKSPACE_ONBOARDING_STEPS.indexOf(step);
  const statuses = new Map(rows.map((row) => [row.step, row.status]));
  const missing = WORKSPACE_ONBOARDING_STEPS.slice(0, position).find((candidate) => statuses.get(candidate) === "pending" || !statuses.has(candidate));
  if (missing) throw new WorkspaceOnboardingError("ONBOARDING_PREVIOUS_STEP_INCOMPLETE", 409, { step, previousStep: missing });
}

async function ensureRows(executor: Executor, workspaceId: string, now: Date) {
  await executor.insert(workspaceOnboarding).values(WORKSPACE_ONBOARDING_STEPS.map((step) => ({ workspaceId, step, status: "pending" as const, createdAt: now, updatedAt: now }))).onConflictDoNothing();
}

async function lockWorkspace(executor: Executor, workspaceId: string) {
  const [workspace] = await executor.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).for("update").limit(1);
  if (!workspace) throw new WorkspaceOnboardingError("WORKSPACE_NOT_FOUND", 404);
}

async function recordCompletion(executor: Executor, workspaceId: string, actorUserId: string, now: Date) {
  const [event] = await executor.insert(outboxEvents).values({
    workspaceId,
    aggregateType: "WorkspaceOnboarding",
    aggregateId: workspaceId,
    eventType: "OnboardingCompleted",
    payload: { workspaceId, actorUserId, nextAction: "prospects.discover" },
    createdAt: now,
  }).returning({ id: outboxEvents.id });
  if (!event) throw new WorkspaceOnboardingError("ONBOARDING_COMPLETION_EVENT_FAILED", 409);
  await executor.insert(auditLogs).values({
    workspaceId,
    actorUserId,
    action: "OnboardingCompleted",
    subjectType: "Workspace",
    subjectId: workspaceId,
    changes: { steps: WORKSPACE_ONBOARDING_STEPS, nextAction: "prospects.discover" },
    correlationId: `workspace-onboarding:${workspaceId}`,
    sourceEventId: event.id,
    createdAt: now,
  });
}
