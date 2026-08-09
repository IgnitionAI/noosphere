import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  aiPolicyVersions,
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
    await this.#ensureStarted(input.workspaceId, input.actorUserId, input.now ?? new Date());
    return this.#readProgress(this.database, input.workspaceId, input.role);
  }

  async completeStep(input: { workspaceId: string; step: WorkspaceOnboardingStep; actorUserId: string; role: WorkspaceRole; now?: Date }): Promise<WorkspaceOnboardingProgress> {
    assertCanComplete(input.step, input.role);
    const now = input.now ?? new Date();
    await this.database.transaction(async (tx) => {
      await lockWorkspace(tx, input.workspaceId);
      await ensureRows(tx, input.workspaceId, now);
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
  autopilot: { title: "Autopilote", description: "Activez une première campagne avec une politique IA publiée.", optional: false, requiredRole: "member" },
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
    executor.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.workspaceId, workspaceId), eq(campaigns.status, "active"), isNotNull(campaigns.aiPolicyVersionId))).limit(1),
  ]);
  const workspaceReady = Boolean(workspace[0]?.name.trim());
  const productReady = Boolean(productResearch[0] || offer[0]);
  const icpReady = Boolean(icp[0]);
  const sendingReady = Boolean(account[0]);
  const calendarReady = Boolean(calendar[0]);
  const autopilotReady = Boolean(autopilotPolicy[0] && campaign[0]);
  return { workspaceReady, productReady, icpReady, sendingReady, calendarReady, prerequisitesReady: workspaceReady && productReady && icpReady && sendingReady, autopilotReady };
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
