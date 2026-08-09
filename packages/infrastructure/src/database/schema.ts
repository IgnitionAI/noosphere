import { sql } from "drizzle-orm";
import {
  emptyProspectChannels,
  type ProspectChannels,
} from "@outbound/domain/crm/prospect-channels";
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
  vector,
} from "drizzle-orm/pg-core";

export const productResearchStatusEnum = pgEnum("product_research_status", [
  "draft",
  "queued",
  "running",
  "paused",
  "ready_for_review",
  "completed",
  "partial",
  "interrupted",
  "failed",
]);
export const researchStageEnum = pgEnum("research_stage", [
  "product_analysis",
  "competitor_discovery",
  "competitor_analysis",
  "buyer_landscape_discovery",
  "segment_synthesis",
  "icp_synthesis",
  "evidence_review",
  "product_truth",
  "problem_mapping",
  "organization_discovery",
  "market_investigation",
  "buying_context",
  "sourcing_validation",
  "icp_composition",
  "adversarial_review",
  "objective_ranking",
]);
export const researchStageStatusEnum = pgEnum("research_stage_status", [
  "running",
  "completed",
  "failed",
  "invalidated",
]);
export const researchCheckpointReviewEnum = pgEnum("research_checkpoint_review", [
  "machine",
  "human_reviewed",
]);
export const jobStatusEnum = pgEnum("job_status", [
  "pending",
  "running",
  "retry",
  "completed",
  "dead_lettered",
]);
export const workspaceStatusEnum = pgEnum("workspace_status", ["active", "suspended"]);
export const workspaceMemberStatusEnum = pgEnum("workspace_member_status", [
  "active",
  "disabled",
]);
export const workspaceInvitationStatusEnum = pgEnum("workspace_invitation_status", [
  "pending",
  "accepted",
  "revoked",
  "expired",
]);
export const workspaceExportStatusEnum = pgEnum("workspace_export_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);
export const knowledgeSourceTypeEnum = pgEnum("knowledge_source_type", [
  "product_document",
  "proof",
  "customer_case",
  "objection_response",
]);
export const knowledgeSourceStatusEnum = pgEnum("knowledge_source_status", [
  "draft",
  "validated",
  "expired",
  "withdrawn",
]);
export const knowledgeClaimStatusEnum = pgEnum("knowledge_claim_status", [
  "draft",
  "validated",
]);
export const aiCapabilityEnum = pgEnum("ai_capability", [
  "icp_research",
  "message_generation",
  "setter",
]);
export const aiConfigurationStatusEnum = pgEnum("ai_configuration_status", [
  "candidate",
  "shadow",
  "active",
  "retired",
]);
export const evaluationRunStatusEnum = pgEnum("evaluation_run_status", [
  "queued",
  "running",
  "completed",
  "partial",
  "failed",
]);
export const evaluationCaseResultStatusEnum = pgEnum("evaluation_case_result_status", [
  "pending",
  "completed",
  "failed",
]);
export const workspaceRoleEnum = pgEnum("workspace_role", [
  "viewer",
  "operator",
  "reviewer",
  "admin",
  "owner",
]);
export const researchDocumentStatusEnum = pgEnum("research_document_status", [
  "uploading",
  "uploaded",
  "processing",
  "ready",
  "failed",
  "deleted",
]);
export const offerStatusEnum = pgEnum("offer_status", ["draft", "archived"]);
export const offerClaimValidationStatusEnum = pgEnum("offer_claim_validation_status", [
  "hypothesis",
  "sourced",
  "validated",
  "invalidated",
]);
export const connectedAccountStatusEnum = pgEnum("connected_account_status", [
  "pending",
  "connected",
  "degraded",
  "disconnected",
  "unknown",
]);

export const connectionOnboardingStatusEnum = pgEnum("connection_onboarding_status", [
  "initiated",
  "awaiting_callback",
  "verifying",
  "completed",
  "failed",
  "expired",
]);

export const connectionOnboardingStepEnum = pgEnum("connection_onboarding_step", [
  "initiation",
  "callback",
  "verification",
]);

export const workspaceOnboardingStepEnum = pgEnum("workspace_onboarding_step", [
  "workspace",
  "product",
  "icp",
  "sending_account",
  "calendar",
  "prerequisites",
  "autopilot",
]);

export const workspaceOnboardingStatusEnum = pgEnum("workspace_onboarding_status", [
  "pending",
  "completed",
  "skipped",
]);

export const accountHealthAlertStatusEnum = pgEnum("account_health_alert_status", [
  "active",
  "acknowledged",
  "resolved",
]);

export const authUsers = pgTable(
  "auth_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("auth_users_email_uq").on(sql`lower(${table.email})`)],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("auth_sessions_user_idx").on(table.userId),
    index("auth_sessions_expires_idx").on(table.expiresAt),
  ],
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("auth_accounts_provider_account_uq").on(table.providerId, table.accountId),
    index("auth_accounts_user_idx").on(table.userId),
  ],
);

export const authVerifications = pgTable(
  "auth_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("auth_verifications_identifier_idx").on(table.identifier)],
);

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: varchar("slug", { length: 120 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  status: workspaceStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    role: workspaceRoleEnum("role").notNull(),
    status: workspaceMemberStatusEnum("status").notNull().default("active"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    lastSelectedAt: timestamp("last_selected_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index("workspace_members_user_status_idx").on(table.userId, table.status),
  ],
);

export const workspaceInvitations = pgTable(
  "workspace_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 320 }).notNull(),
    proposedRole: workspaceRoleEnum("proposed_role").notNull(),
    status: workspaceInvitationStatusEnum("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    invitedBy: uuid("invited_by").references(() => authUsers.id, { onDelete: "set null" }),
    acceptedBy: uuid("accepted_by").references(() => authUsers.id, { onDelete: "set null" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("workspace_invitations_workspace_id_uq").on(table.workspaceId, table.id),
    index("workspace_invitations_workspace_status_idx").on(table.workspaceId, table.status, table.createdAt),
    uniqueIndex("workspace_invitations_pending_email_uq")
      .on(table.workspaceId, sql`lower(${table.email})`)
      .where(sql`${table.status} = 'pending'`),
  ],
);

export const workspaceAiSettings = pgTable("workspace_ai_settings", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  researchModels: jsonb("research_models").notNull(),
  synthesisModels: jsonb("synthesis_models").notNull(),
  updatedBy: uuid("updated_by")
    .notNull()
    .references(() => authUsers.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workspaceDataSettings = pgTable("workspace_data_settings", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  timezone: varchar("timezone", { length: 120 }).notNull().default("Europe/Paris"),
  activeDays: jsonb("active_days").notNull().default([1, 2, 3, 4, 5]),
  windowStart: varchar("window_start", { length: 5 }).notNull().default("09:00"),
  windowEnd: varchar("window_end", { length: 5 }).notNull().default("17:00"),
  linkedinDailyLimit: integer("linkedin_daily_limit").notNull().default(20),
  emailDailyLimit: integer("email_daily_limit").notNull().default(50),
  whatsappDailyLimit: integer("whatsapp_daily_limit").notNull().default(30),
  invitationsRetentionDays: integer("invitations_retention_days").notNull().default(90),
  jobsRetentionDays: integer("jobs_retention_days").notNull().default(90),
  auditRetentionDays: integer("audit_retention_days").notNull().default(365),
  updatedBy: uuid("updated_by").references(() => authUsers.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workspaceOnboarding = pgTable(
  "workspace_onboarding",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    step: workspaceOnboardingStepEnum("step").notNull(),
    status: workspaceOnboardingStatusEnum("status").notNull().default("pending"),
    actorUserId: uuid("actor_user_id").references(() => authUsers.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.step] }),
    index("workspace_onboarding_workspace_status_idx").on(table.workspaceId, table.status, table.updatedAt),
  ],
);

export const workspaceExports = pgTable(
  "workspace_exports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    requestKey: varchar("request_key", { length: 200 }).notNull(),
    status: workspaceExportStatusEnum("status").notNull().default("pending"),
    objectKey: varchar("object_key", { length: 800 }),
    sizeBytes: integer("size_bytes"),
    checksumSha256: varchar("checksum_sha256", { length: 64 }),
    requestedBy: uuid("requested_by").references(() => authUsers.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failureCode: varchar("failure_code", { length: 120 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("workspace_exports_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("workspace_exports_request_key_uq").on(table.workspaceId, table.requestKey),
    uniqueIndex("workspace_exports_active_uq")
      .on(table.workspaceId)
      .where(sql`${table.status} in ('pending', 'processing')`),
    index("workspace_exports_workspace_created_idx").on(table.workspaceId, table.createdAt),
  ],
);

export const dailyProspectingSchedules = pgTable(
  "daily_prospecting_schedules",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    localTime: varchar("local_time", { length: 5 }).notNull().default("06:00"),
    timezone: varchar("timezone", { length: 120 }).notNull().default("Europe/Paris"),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    lastScheduledDate: varchar("last_scheduled_date", { length: 10 }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("daily_prospecting_schedules_due_idx").on(table.enabled, table.nextRunAt)],
);

export const dailySourcingCycleStatusEnum = pgEnum("daily_sourcing_cycle_status", [
  "scheduled",
  "running",
  "completed",
  "partial",
  "failed",
  "action_required",
]);

export const sourcingFrontierStatusEnum = pgEnum("sourcing_frontier_status", [
  "active",
  "saturated",
  "paused",
]);

export const dailySourcingCycles = pgTable(
  "daily_sourcing_cycles",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    localDate: varchar("local_date", { length: 10 }).notNull(),
    timezone: varchar("timezone", { length: 120 }).notNull().default("Europe/Paris"),
    status: dailySourcingCycleStatusEnum("status").notNull().default("scheduled"),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    pageLimit: integer("page_limit").notNull().default(150),
    pageAttempts: integer("page_attempts").notNull().default(0),
    verificationLimit: integer("verification_limit").notNull().default(60),
    verificationAttempts: integer("verification_attempts").notNull().default(0),
    maxPagesPerCompany: integer("max_pages_per_company").notNull().default(4),
    maxConcurrentPerDomain: integer("max_concurrent_per_domain").notNull().default(2),
    activeIcpCount: integer("active_icp_count").notNull().default(0),
    scheduledRunCount: integer("scheduled_run_count").notNull().default(0),
    summary: jsonb("summary").notNull().default({}),
    errorCode: varchar("error_code", { length: 120 }),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("daily_sourcing_cycles_workspace_date_uq").on(
      table.workspaceId,
      table.localDate,
    ),
    index("daily_sourcing_cycles_workspace_status_idx").on(
      table.workspaceId,
      table.status,
      table.createdAt,
    ),
  ],
);

export const sourcingFrontiers = pgTable(
  "sourcing_frontiers",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    icpVersionId: uuid("icp_version_id")
      .notNull()
      .references(() => icpVersions.id, { onDelete: "cascade" }),
    channel: varchar("channel", { length: 40 }).notNull().default("whatsapp"),
    sourceKind: varchar("source_kind", { length: 80 }).notNull().default("web"),
    regionKey: varchar("region_key", { length: 120 }).notNull().default("fr-metropolitan"),
    querySeed: text("query_seed").notNull(),
    queryFingerprint: varchar("query_fingerprint", { length: 128 }).notNull(),
    status: sourcingFrontierStatusEnum("status").notNull().default("active"),
    rotationOrdinal: integer("rotation_ordinal").notNull().default(0),
    consecutiveEmptyRuns: integer("consecutive_empty_runs").notNull().default(0),
    pageAttempts: integer("page_attempts").notNull().default(0),
    verifiedFound: integer("verified_found").notNull().default(0),
    yieldEma: numeric("yield_ema", { precision: 10, scale: 6 }).notNull().default("0"),
    nextEligibleAt: timestamp("next_eligible_at", { withTimezone: true }).notNull(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastYieldAt: timestamp("last_yield_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sourcing_frontiers_logical_uq").on(
      table.workspaceId,
      table.icpVersionId,
      table.channel,
      table.sourceKind,
      table.regionKey,
      table.queryFingerprint,
    ),
    index("sourcing_frontiers_due_idx").on(
      table.workspaceId,
      table.channel,
      table.status,
      table.nextEligibleAt,
    ),
  ],
);

export const productResearchRuns = pgTable(
  "product_research_runs",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    brief: jsonb("brief").notNull(),
    status: productResearchStatusEnum("status").notNull().default("draft"),
    activeStage: researchStageEnum("active_stage"),
    completedStages: jsonb("completed_stages").notNull().default(sql`'[]'::jsonb`),
    version: integer("version").notNull().default(0),
    executionStartedAt: timestamp("execution_started_at", { withTimezone: true }),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("product_research_runs_workspace_id_id_uq").on(table.workspaceId, table.id),
    index("product_research_runs_workspace_status_idx").on(table.workspaceId, table.status),
    uniqueIndex("product_research_runs_one_active_workspace_uq")
      .on(table.workspaceId)
      .where(sql`${table.status} in ('queued', 'running', 'paused')`),
  ],
);

export const researchStageRuns = pgTable(
  "research_stage_runs",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    runId: uuid("run_id").notNull(),
    stage: researchStageEnum("stage").notNull(),
    workItemKey: varchar("work_item_key", { length: 160 }).notNull().default("main"),
    attempt: integer("attempt").notNull(),
    status: researchStageStatusEnum("status").notNull(),
    review: researchCheckpointReviewEnum("review").notNull().default("machine"),
    inputHash: varchar("input_hash", { length: 128 }).notNull(),
    outputHash: varchar("output_hash", { length: 128 }),
    output: jsonb("output"),
    errorCode: varchar("error_code", { length: 120 }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.runId],
      foreignColumns: [productResearchRuns.workspaceId, productResearchRuns.id],
      name: "research_stage_runs_workspace_run_fk",
    }).onDelete("cascade"),
    uniqueIndex("research_stage_runs_attempt_uq").on(
      table.workspaceId,
      table.runId,
      table.stage,
      table.workItemKey,
      table.attempt,
    ),
    unique("research_stage_runs_workspace_id_uq").on(table.workspaceId, table.id),
    index("research_stage_runs_completed_idx").on(
      table.workspaceId,
      table.runId,
      table.stage,
      table.status,
    ),
  ],
);

export const researchWorkItems = pgTable(
  "research_work_items",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    runId: uuid("run_id").notNull(),
    stage: researchStageEnum("stage").notNull(),
    workItemKey: varchar("work_item_key", { length: 160 }).notNull(),
    subjectArtifactKey: varchar("subject_artifact_key", { length: 160 }).notNull(),
    ordinal: integer("ordinal").notNull(),
    status: varchar("status", { length: 30 }).notNull().default("pending"),
    errorCode: varchar("error_code", { length: 120 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.runId],
      foreignColumns: [productResearchRuns.workspaceId, productResearchRuns.id],
      name: "research_work_items_workspace_run_fk",
    }).onDelete("cascade"),
    uniqueIndex("research_work_items_key_uq").on(
      table.workspaceId,
      table.runId,
      table.stage,
      table.workItemKey,
    ),
    index("research_work_items_join_idx").on(
      table.workspaceId,
      table.runId,
      table.stage,
      table.status,
    ),
  ],
);

export const researchToolRequests = pgTable(
  "research_tool_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    runId: uuid("run_id").notNull(),
    toolName: varchar("tool_name", { length: 120 }).notNull(),
    normalizedInputHash: varchar("normalized_input_hash", { length: 128 }).notNull(),
    normalizedInput: jsonb("normalized_input").notNull(),
    status: varchar("status", { length: 30 }).notNull(),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    output: text("output"),
    contentHash: varchar("content_hash", { length: 128 }),
    retryable: boolean("retryable").notNull().default(true),
    lastErrorCode: varchar("last_error_code", { length: 120 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.runId],
      foreignColumns: [productResearchRuns.workspaceId, productResearchRuns.id],
      name: "research_tool_requests_workspace_run_fk",
    }).onDelete("cascade"),
    uniqueIndex("research_tool_requests_input_uq").on(
      table.workspaceId,
      table.runId,
      table.toolName,
      table.normalizedInputHash,
    ),
    index("research_tool_requests_lease_idx").on(table.status, table.leaseExpiresAt),
  ],
);

export const evaluationDatasets = pgTable(
  "evaluation_datasets",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    capability: aiCapabilityEnum("capability").notNull(),
    name: varchar("name", { length: 300 }).notNull(),
    description: text("description"),
    rubricVersion: varchar("rubric_version", { length: 120 }).notNull(),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("evaluation_datasets_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("evaluation_datasets_workspace_name_version_uq").on(table.workspaceId, table.name, table.version),
    index("evaluation_datasets_workspace_capability_idx").on(table.workspaceId, table.capability, table.createdAt),
  ],
);

export const evaluationCases = pgTable(
  "evaluation_cases",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    datasetId: uuid("dataset_id").notNull(),
    name: varchar("name", { length: 300 }).notNull(),
    input: jsonb("input").notNull(),
    expected: jsonb("expected").notNull().default({}),
    criteria: jsonb("criteria").notNull().default({}),
    authorizedKnowledgeClaimIds: jsonb("authorized_knowledge_claim_ids").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.datasetId],
      foreignColumns: [evaluationDatasets.workspaceId, evaluationDatasets.id],
      name: "evaluation_cases_workspace_dataset_fk",
    }).onDelete("cascade"),
    unique("evaluation_cases_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("evaluation_cases_dataset_name_uq").on(table.workspaceId, table.datasetId, table.name),
  ],
);

export const aiPromptVersions = pgTable(
  "ai_prompt_versions",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    capability: aiCapabilityEnum("capability").notNull(),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    previousVersionId: uuid("previous_version_id"),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("ai_prompt_versions_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("ai_prompt_versions_workspace_capability_version_uq").on(table.workspaceId, table.capability, table.version),
    foreignKey({
      columns: [table.workspaceId, table.previousVersionId],
      foreignColumns: [table.workspaceId, table.id],
      name: "ai_prompt_versions_previous_fk",
    }).onDelete("restrict"),
  ],
);

export const aiConfigurations = pgTable(
  "ai_configurations",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    capability: aiCapabilityEnum("capability").notNull(),
    provider: varchar("provider", { length: 120 }).notNull(),
    model: varchar("model", { length: 200 }).notNull(),
    promptVersionId: uuid("prompt_version_id").notNull(),
    status: aiConfigurationStatusEnum("status").notNull().default("candidate"),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    promotedBy: uuid("promoted_by").references(() => authUsers.id, { onDelete: "set null" }),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("ai_configurations_workspace_id_uq").on(table.workspaceId, table.id),
    foreignKey({
      columns: [table.workspaceId, table.promptVersionId],
      foreignColumns: [aiPromptVersions.workspaceId, aiPromptVersions.id],
      name: "ai_configurations_workspace_prompt_fk",
    }).onDelete("restrict"),
    uniqueIndex("ai_configurations_active_capability_uq")
      .on(table.workspaceId, table.capability)
      .where(sql`${table.status} = 'active'`),
    index("ai_configurations_workspace_capability_idx").on(table.workspaceId, table.capability, table.status),
  ],
);

export const aiRuns = pgTable(
  "ai_runs",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    productResearchRunId: uuid("product_research_run_id"),
    researchStageRunId: uuid("research_stage_run_id"),
    purpose: varchar("purpose", { length: 120 }).notNull(),
    provider: varchar("provider", { length: 120 }).notNull(),
    model: varchar("model", { length: 200 }).notNull(),
    promptVersion: varchar("prompt_version", { length: 120 }).notNull(),
    promptVersionId: uuid("prompt_version_id"),
    aiConfigurationId: uuid("ai_configuration_id"),
    shadow: boolean("shadow").notNull().default(false),
    inputHash: varchar("input_hash", { length: 128 }).notNull(),
    parameters: jsonb("parameters").notNull().default(sql`'{}'::jsonb`),
    output: jsonb("output"),
    status: varchar("status", { length: 50 }).notNull(),
    cost: numeric("cost", { precision: 19, scale: 6 }),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.productResearchRunId],
      foreignColumns: [productResearchRuns.workspaceId, productResearchRuns.id],
      name: "ai_runs_workspace_research_run_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.researchStageRunId],
      foreignColumns: [researchStageRuns.workspaceId, researchStageRuns.id],
      name: "ai_runs_workspace_stage_run_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.promptVersionId],
      foreignColumns: [aiPromptVersions.workspaceId, aiPromptVersions.id],
      name: "ai_runs_workspace_prompt_version_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.aiConfigurationId],
      foreignColumns: [aiConfigurations.workspaceId, aiConfigurations.id],
      name: "ai_runs_workspace_configuration_fk",
    }).onDelete("restrict"),
    unique("ai_runs_workspace_id_uq").on(table.workspaceId, table.id),
    index("ai_runs_workspace_research_idx").on(table.workspaceId, table.productResearchRunId),
  ],
);

export const evaluationRuns = pgTable(
  "evaluation_runs",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    datasetId: uuid("dataset_id").notNull(),
    configurationId: uuid("configuration_id").notNull(),
    requestKey: varchar("request_key", { length: 300 }).notNull(),
    status: evaluationRunStatusEnum("status").notNull().default("queued"),
    totalCases: integer("total_cases").notNull(),
    completedCases: integer("completed_cases").notNull().default(0),
    failedCases: integer("failed_cases").notNull().default(0),
    aggregateScores: jsonb("aggregate_scores").notNull().default({}),
    totalCost: numeric("total_cost", { precision: 19, scale: 6 }),
    totalLatencyMs: integer("total_latency_ms"),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.datasetId], foreignColumns: [evaluationDatasets.workspaceId, evaluationDatasets.id], name: "evaluation_runs_workspace_dataset_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.workspaceId, table.configurationId], foreignColumns: [aiConfigurations.workspaceId, aiConfigurations.id], name: "evaluation_runs_workspace_configuration_fk" }).onDelete("restrict"),
    unique("evaluation_runs_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("evaluation_runs_workspace_request_uq").on(table.workspaceId, table.requestKey),
    index("evaluation_runs_workspace_created_idx").on(table.workspaceId, table.createdAt),
  ],
);

export const evaluationCaseResults = pgTable(
  "evaluation_case_results",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    evaluationRunId: uuid("evaluation_run_id").notNull(),
    evaluationCaseId: uuid("evaluation_case_id").notNull(),
    aiRunId: uuid("ai_run_id"),
    status: evaluationCaseResultStatusEnum("status").notNull().default("pending"),
    output: jsonb("output"),
    scores: jsonb("scores").notNull().default({}),
    cost: numeric("cost", { precision: 19, scale: 6 }),
    latencyMs: integer("latency_ms"),
    errorCode: varchar("error_code", { length: 120 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.evaluationRunId], foreignColumns: [evaluationRuns.workspaceId, evaluationRuns.id], name: "evaluation_case_results_workspace_run_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.evaluationCaseId], foreignColumns: [evaluationCases.workspaceId, evaluationCases.id], name: "evaluation_case_results_workspace_case_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.workspaceId, table.aiRunId], foreignColumns: [aiRuns.workspaceId, aiRuns.id], name: "evaluation_case_results_workspace_ai_run_fk" }).onDelete("restrict"),
    uniqueIndex("evaluation_case_results_run_case_uq").on(table.workspaceId, table.evaluationRunId, table.evaluationCaseId),
  ],
);

export const aiFeedbacks = pgTable(
  "ai_feedbacks",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    aiRunId: uuid("ai_run_id").notNull(),
    rating: integer("rating").notNull(),
    reason: varchar("reason", { length: 1000 }),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.aiRunId], foreignColumns: [aiRuns.workspaceId, aiRuns.id], name: "ai_feedbacks_workspace_ai_run_fk" }).onDelete("cascade"),
    uniqueIndex("ai_feedbacks_workspace_run_author_uq").on(table.workspaceId, table.aiRunId, table.createdBy),
    check("ai_feedbacks_rating_ck", sql`${table.rating} in (-1, 1)`),
  ],
);

export const aiToolRuns = pgTable(
  "ai_tool_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    productResearchRunId: uuid("product_research_run_id"),
    researchStageRunId: uuid("research_stage_run_id"),
    correlationId: varchar("correlation_id", { length: 200 }).notNull(),
    toolName: varchar("tool_name", { length: 120 }).notNull(),
    status: varchar("status", { length: 40 }).notNull(),
    input: jsonb("input").notNull().default(sql`'{}'::jsonb`),
    outputMetadata: jsonb("output_metadata").notNull().default(sql`'{}'::jsonb`),
    latencyMs: integer("latency_ms").notNull(),
    errorCode: varchar("error_code", { length: 120 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ai_tool_runs_workspace_run_idx").on(table.workspaceId, table.productResearchRunId),
    index("ai_tool_runs_stage_idx").on(table.workspaceId, table.researchStageRunId),
  ],
);

export const researchDocuments = pgTable(
  "research_documents",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    filename: varchar("filename", { length: 500 }).notNull(),
    contentType: varchar("content_type", { length: 200 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    checksumSha256: varchar("checksum_sha256", { length: 64 }).notNull(),
    objectKey: text("object_key").notNull(),
    status: researchDocumentStatusEnum("status").notNull().default("uploading"),
    extractedMarkdown: text("extracted_markdown"),
    failureCode: varchar("failure_code", { length: 120 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("research_documents_workspace_checksum_uq").on(
      table.workspaceId,
      table.checksumSha256,
    ),
    unique("research_documents_workspace_id_uq").on(table.workspaceId, table.id),
    index("research_documents_workspace_status_idx").on(table.workspaceId, table.status),
  ],
);

export const researchDocumentChunks = pgTable(
  "research_document_chunks",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    documentId: uuid("document_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    content: text("content").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    tokenCount: integer("token_count").notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.documentId],
      foreignColumns: [researchDocuments.workspaceId, researchDocuments.id],
      name: "research_document_chunks_workspace_document_fk",
    }).onDelete("cascade"),
    uniqueIndex("research_document_chunks_ordinal_uq").on(
      table.workspaceId,
      table.documentId,
      table.ordinal,
    ),
    unique("research_document_chunks_workspace_id_uq").on(table.workspaceId, table.id),
    index("research_document_chunks_workspace_document_idx").on(
      table.workspaceId,
      table.documentId,
    ),
    index("research_document_chunks_embedding_hnsw_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
  ],
);

export const productResearchRunDocuments = pgTable(
  "product_research_run_documents",
  {
    workspaceId: uuid("workspace_id").notNull(),
    runId: uuid("run_id").notNull(),
    documentId: uuid("document_id").notNull(),
    attachedAt: timestamp("attached_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.runId, table.documentId] }),
    foreignKey({
      columns: [table.workspaceId, table.runId],
      foreignColumns: [productResearchRuns.workspaceId, productResearchRuns.id],
      name: "product_research_run_documents_workspace_run_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.documentId],
      foreignColumns: [researchDocuments.workspaceId, researchDocuments.id],
      name: "product_research_run_documents_workspace_document_fk",
    }).onDelete("restrict"),
  ],
);

export const marketEvidence = pgTable(
  "market_evidence",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    runId: uuid("run_id").notNull(),
    sourceType: varchar("source_type", { length: 40 }).notNull(),
    url: text("url"),
    title: text("title").notNull(),
    excerpt: text("excerpt").notNull(),
    contentHash: varchar("content_hash", { length: 128 }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.runId],
      foreignColumns: [productResearchRuns.workspaceId, productResearchRuns.id],
      name: "market_evidence_workspace_run_fk",
    }).onDelete("cascade"),
    uniqueIndex("market_evidence_run_hash_uq").on(table.workspaceId, table.runId, table.contentHash),
    unique("market_evidence_workspace_id_uq").on(table.workspaceId, table.id),
  ],
);

export const competitorCandidates = pgTable(
  "competitor_candidates",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    runId: uuid("run_id").notNull(),
    name: varchar("name", { length: 300 }).notNull(),
    url: text("url"),
    relation: varchar("relation", { length: 40 }).notNull(),
    rationale: text("rationale").notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
    qualificationStatus: varchar("qualification_status", { length: 40 }).notNull().default("candidate"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.runId],
      foreignColumns: [productResearchRuns.workspaceId, productResearchRuns.id],
      name: "competitor_candidates_workspace_run_fk",
    }).onDelete("cascade"),
    index("competitor_candidates_workspace_run_idx").on(table.workspaceId, table.runId),
  ],
);

export const researchFindings = pgTable(
  "research_findings",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    runId: uuid("run_id").notNull(),
    stage: researchStageEnum("stage").notNull(),
    findingPath: varchar("finding_path", { length: 500 }).notNull(),
    statement: text("statement").notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
    hypothesis: boolean("hypothesis").notNull(),
    reviewStatus: varchar("review_status", { length: 40 }).notNull().default("unreviewed"),
    reviewReason: text("review_reason"),
    reviewedBy: uuid("reviewed_by").references(() => authUsers.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    humanEdited: boolean("human_edited").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.runId],
      foreignColumns: [productResearchRuns.workspaceId, productResearchRuns.id],
      name: "research_findings_workspace_run_fk",
    }).onDelete("cascade"),
    uniqueIndex("research_findings_path_uq").on(table.workspaceId, table.runId, table.findingPath),
    unique("research_findings_workspace_id_uq").on(table.workspaceId, table.id),
  ],
);

export const researchFindingEvidence = pgTable(
  "research_finding_evidence",
  {
    workspaceId: uuid("workspace_id").notNull(),
    findingId: uuid("finding_id").notNull(),
    evidenceId: uuid("evidence_id").notNull(),
  },
  (table) => [
    primaryKey({
      name: "research_finding_evidence_pk",
      columns: [table.workspaceId, table.findingId, table.evidenceId],
    }),
    foreignKey({
      columns: [table.workspaceId, table.findingId],
      foreignColumns: [researchFindings.workspaceId, researchFindings.id],
      name: "research_finding_evidence_workspace_finding_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.evidenceId],
      foreignColumns: [marketEvidence.workspaceId, marketEvidence.id],
      name: "research_finding_evidence_workspace_evidence_fk",
    }).onDelete("cascade"),
    index("research_finding_evidence_workspace_idx").on(table.workspaceId, table.findingId),
  ],
);

export const icpProposals = pgTable(
  "icp_proposals",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    runId: uuid("run_id").notNull(),
    name: varchar("name", { length: 500 }).notNull(),
    rank: integer("rank").notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
    criteria: jsonb("criteria").notNull(),
    buyingCommittee: jsonb("buying_committee").notNull(),
    problems: jsonb("problems").notNull(),
    signals: jsonb("signals").notNull(),
    exclusions: jsonb("exclusions").notNull(),
    unknowns: jsonb("unknowns").notNull(),
    humanEdited: boolean("human_edited").notNull().default(false),
    reviewStatus: varchar("review_status", { length: 40 }).notNull().default("pending"),
    reviewReason: text("review_reason"),
    reviewedBy: uuid("reviewed_by").references(() => authUsers.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.runId],
      foreignColumns: [productResearchRuns.workspaceId, productResearchRuns.id],
      name: "icp_proposals_workspace_run_fk",
    }).onDelete("cascade"),
    uniqueIndex("icp_proposals_rank_uq").on(table.workspaceId, table.runId, table.rank),
  ],
);

export const icps = pgTable(
  "icps",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    name: varchar("name", { length: 500 }).notNull(),
    currentVersion: integer("current_version").notNull().default(0),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId], foreignColumns: [workspaces.id], name: "icps_workspace_fk" }).onDelete("cascade"),
    unique("icps_workspace_id_uq").on(table.workspaceId, table.id),
  ],
);

export const icpVersions = pgTable(
  "icp_versions",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    icpId: uuid("icp_id").notNull(),
    runId: uuid("run_id"),
    proposalId: uuid("proposal_id"),
    version: integer("version").notNull(),
    name: varchar("name", { length: 500 }).notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
    criteria: jsonb("criteria").notNull(),
    buyingCommittee: jsonb("buying_committee").notNull(),
    problems: jsonb("problems").notNull(),
    signals: jsonb("signals").notNull(),
    exclusions: jsonb("exclusions").notNull(),
    unknowns: jsonb("unknowns").notNull(),
    unresolvedContradictions: jsonb("unresolved_contradictions").notNull(),
    blockedFindings: jsonb("blocked_findings").notNull(),
    publishedBy: uuid("published_by").references(() => authUsers.id),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.icpId],
      foreignColumns: [icps.workspaceId, icps.id],
      name: "icp_versions_workspace_icp_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.runId],
      foreignColumns: [productResearchRuns.workspaceId, productResearchRuns.id],
      name: "icp_versions_workspace_run_fk",
    }).onDelete("restrict"),
    uniqueIndex("icp_versions_proposal_uq").on(table.workspaceId, table.proposalId),
    unique("icp_versions_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("icp_versions_icp_version_uq").on(table.workspaceId, table.icpId, table.version),
    index("icp_versions_workspace_idx").on(table.workspaceId, table.publishedAt),
  ],
);

export const icpCriterion = pgTable(
  "icp_criterion",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    icpVersionId: uuid("icp_version_id").notNull(),
    dimension: varchar("dimension", { length: 200 }).notNull(),
    operator: varchar("operator", { length: 60 }).notNull(),
    expectedValue: jsonb("expected_value").notNull(),
    weight: numeric("weight", { precision: 5, scale: 4 }),
    required: boolean("required").notNull().default(false),
    exclusion: boolean("exclusion").notNull().default(false),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.icpVersionId], foreignColumns: [icpVersions.workspaceId, icpVersions.id], name: "icp_criterion_workspace_version_fk" }).onDelete("restrict"),
    index("icp_criterion_workspace_version_idx").on(table.workspaceId, table.icpVersionId),
  ],
);

export const messagingStrategies = pgTable(
  "messaging_strategies",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    name: varchar("name", { length: 500 }).notNull(),
    currentVersion: integer("current_version").notNull().default(0),
    draftRules: jsonb("draft_rules").notNull().default({}),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => authUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId], foreignColumns: [workspaces.id], name: "messaging_strategies_workspace_fk" }).onDelete("cascade"),
    unique("messaging_strategies_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("messaging_strategies_workspace_name_uq").on(table.workspaceId, sql`lower(${table.name})`).where(sql`${table.deletedAt} IS NULL`),
  ],
);

export const messagingStrategyVersions = pgTable(
  "messaging_strategy_versions",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    strategyId: uuid("strategy_id").notNull(),
    version: integer("version").notNull(),
    rules: jsonb("rules").notNull().default({}),
    publishedBy: uuid("published_by").references(() => authUsers.id),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.strategyId], foreignColumns: [messagingStrategies.workspaceId, messagingStrategies.id], name: "messaging_strategy_versions_workspace_strategy_fk" }).onDelete("restrict"),
    unique("messaging_strategy_versions_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("messaging_strategy_versions_strategy_version_uq").on(table.workspaceId, table.strategyId, table.version),
    index("messaging_strategy_versions_workspace_idx").on(table.workspaceId, table.publishedAt),
  ],
);

export const aiPolicies = pgTable(
  "ai_policies",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    name: varchar("name", { length: 500 }).notNull(),
    currentVersion: integer("current_version").notNull().default(0),
    draftRules: jsonb("draft_rules").notNull().default({}),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => authUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId], foreignColumns: [workspaces.id], name: "ai_policies_workspace_fk" }).onDelete("cascade"),
    unique("ai_policies_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("ai_policies_workspace_name_uq").on(table.workspaceId, sql`lower(${table.name})`).where(sql`${table.deletedAt} IS NULL`),
  ],
);

export const aiPolicyVersions = pgTable(
  "ai_policy_versions",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    policyId: uuid("policy_id").notNull(),
    version: integer("version").notNull(),
    rules: jsonb("rules").notNull().default({}),
    publishedBy: uuid("published_by").references(() => authUsers.id),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.policyId], foreignColumns: [aiPolicies.workspaceId, aiPolicies.id], name: "ai_policy_versions_workspace_policy_fk" }).onDelete("restrict"),
    unique("ai_policy_versions_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("ai_policy_versions_policy_version_uq").on(table.workspaceId, table.policyId, table.version),
    index("ai_policy_versions_workspace_idx").on(table.workspaceId, table.publishedAt),
  ],
);

export const offers = pgTable(
  "offers",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    name: varchar("name", { length: 500 }).notNull(),
    status: offerStatusEnum("status").notNull().default("draft"),
    currentVersion: integer("current_version").notNull().default(0),
    category: varchar("category", { length: 80 }).notNull().default("autre"),
    valueProposition: text("value_proposition").notNull().default(""),
    targetAudience: text("target_audience").notNull().default(""),
    pricing: jsonb("pricing").notNull().default({}),
    commercialRules: jsonb("commercial_rules").notNull().default({}),
    constraints: jsonb("constraints").notNull().default({}),
    claims: jsonb("claims").notNull().default([]),
    objections: jsonb("objections").notNull().default([]),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => authUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId], foreignColumns: [workspaces.id], name: "offers_workspace_fk" }).onDelete("cascade"),
    unique("offers_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("offers_workspace_name_uq").on(table.workspaceId, table.name),
  ],
);

export const offerVersions = pgTable(
  "offer_versions",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    offerId: uuid("offer_id").notNull(),
    version: integer("version").notNull(),
    name: varchar("name", { length: 500 }).notNull(),
    category: varchar("category", { length: 80 }).notNull(),
    valueProposition: text("value_proposition").notNull(),
    targetAudience: text("target_audience").notNull(),
    pricing: jsonb("pricing").notNull().default({}),
    commercialRules: jsonb("commercial_rules").notNull().default({}),
    constraints: jsonb("constraints").notNull().default({}),
    objections: jsonb("objections").notNull().default([]),
    publishedBy: uuid("published_by").references(() => authUsers.id),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.offerId], foreignColumns: [offers.workspaceId, offers.id], name: "offer_versions_workspace_offer_fk" }).onDelete("restrict"),
    unique("offer_versions_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("offer_versions_offer_version_uq").on(table.workspaceId, table.offerId, table.version),
    index("offer_versions_workspace_idx").on(table.workspaceId, table.publishedAt),
  ],
);

export const offerClaims = pgTable(
  "offer_claims",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    offerVersionId: uuid("offer_version_id").notNull(),
    claim: text("claim").notNull(),
    validationStatus: offerClaimValidationStatusEnum("validation_status").notNull(),
    evidenceUri: text("evidence_uri"),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.offerVersionId], foreignColumns: [offerVersions.workspaceId, offerVersions.id], name: "offer_claims_workspace_version_fk" }).onDelete("restrict"),
    unique("offer_claims_workspace_id_uq").on(table.workspaceId, table.id),
    index("offer_claims_workspace_version_idx").on(table.workspaceId, table.offerVersionId),
  ],
);

export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    type: knowledgeSourceTypeEnum("type").notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    content: text("content"),
    researchDocumentId: uuid("research_document_id"),
    authorName: varchar("author_name", { length: 300 }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    freshnessUntil: timestamp("freshness_until", { withTimezone: true }),
    status: knowledgeSourceStatusEnum("status").notNull().default("draft"),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    validatedBy: uuid("validated_by").references(() => authUsers.id, { onDelete: "set null" }),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    withdrawnBy: uuid("withdrawn_by").references(() => authUsers.id, { onDelete: "set null" }),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    withdrawalReason: text("withdrawal_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.researchDocumentId], foreignColumns: [researchDocuments.workspaceId, researchDocuments.id], name: "knowledge_sources_workspace_document_fk" }).onDelete("restrict"),
    unique("knowledge_sources_workspace_id_uq").on(table.workspaceId, table.id),
    index("knowledge_sources_workspace_status_idx").on(table.workspaceId, table.status, table.freshnessUntil),
    check("knowledge_sources_content_or_document_ck", sql`${table.content} is not null or ${table.researchDocumentId} is not null`),
  ],
);

export const knowledgeClaims = pgTable(
  "knowledge_claims",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    claim: text("claim").notNull(),
    status: knowledgeClaimStatusEnum("status").notNull().default("draft"),
    offerClaimId: uuid("offer_claim_id"),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    validatedBy: uuid("validated_by").references(() => authUsers.id, { onDelete: "set null" }),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.offerClaimId], foreignColumns: [offerClaims.workspaceId, offerClaims.id], name: "knowledge_claims_workspace_offer_claim_fk" }).onDelete("restrict"),
    unique("knowledge_claims_workspace_id_uq").on(table.workspaceId, table.id),
    index("knowledge_claims_workspace_status_idx").on(table.workspaceId, table.status),
  ],
);

export const knowledgeClaimSources = pgTable(
  "knowledge_claim_sources",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    claimId: uuid("claim_id").notNull(),
    sourceId: uuid("source_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.claimId, table.sourceId] }),
    foreignKey({ columns: [table.workspaceId, table.claimId], foreignColumns: [knowledgeClaims.workspaceId, knowledgeClaims.id], name: "knowledge_claim_sources_workspace_claim_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.sourceId], foreignColumns: [knowledgeSources.workspaceId, knowledgeSources.id], name: "knowledge_claim_sources_workspace_source_fk" }).onDelete("restrict"),
    index("knowledge_claim_sources_source_idx").on(table.workspaceId, table.sourceId),
  ],
);

export const crmSourceEnum = pgEnum("crm_source", [
  "manual",
  "csv",
  "icp_research",
  "discovery",
  "provider",
]);

export const contactIdentityTypeEnum = pgEnum("contact_identity_type", [
  "email",
  "linkedin",
  "phone",
  "whatsapp",
]);

export const contactVerificationEnum = pgEnum("contact_verification_status", [
  "unknown",
  "verified",
  "invalid",
]);

export const contactStatusEnum = pgEnum("contact_status", [
  "active",
  "suppressed",
]);

export const enrichmentJobStatusEnum = pgEnum("enrichment_job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
]);

export const enrichmentObservationStatusEnum = pgEnum("enrichment_observation_status", [
  "found",
  "probable",
  "verified",
  "invalid",
]);

export const enrichmentPhoneKindEnum = pgEnum("enrichment_phone_kind", [
  "public_company",
  "personal",
]);

export const signalTypeEnum = pgEnum("signal_type", [
  "hiring",
  "funding",
  "job_change",
  "leadership_change",
  "geographic_expansion",
  "public_activity",
  "technology",
  "competitor",
]);

export const signalCollectionStatusEnum = pgEnum("signal_collection_status", [
  "queued",
  "running",
  "succeeded",
  "partial",
  "failed",
]);

export const suppressionChannelEnum = pgEnum("suppression_channel", [
  "global",
  "email",
  "linkedin",
  "whatsapp",
]);

export const prospectingChannelEnum = pgEnum("prospecting_channel", [
  "linkedin",
  "email",
  "whatsapp",
]);

export const workspaceChannelAccounts = pgTable(
  "workspace_channel_accounts",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    channel: prospectingChannelEnum("channel").notNull(),
    provider: varchar("provider", { length: 40 }).notNull().default("unipile"),
    providerAccountId: text("provider_account_id").notNull(),
    displayName: varchar("display_name", { length: 320 }).notNull(),
    selectedBy: uuid("selected_by")
      .notNull()
      .references(() => authUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.channel] }),
    index("workspace_channel_accounts_provider_idx").on(table.provider, table.providerAccountId),
  ],
);

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    name: varchar("name", { length: 300 }).notNull(),
    normalizedDomain: varchar("normalized_domain", { length: 300 }),
    sector: varchar("sector", { length: 200 }),
    employeeCountMin: integer("employee_count_min"),
    employeeCountMax: integer("employee_count_max"),
    location: varchar("location", { length: 300 }),
    linkedinUrl: varchar("linkedin_url", { length: 600 }),
    externalIds: jsonb("external_ids").notNull().default({}),
    source: crmSourceEnum("source").notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "companies_workspace_fk",
    }).onDelete("cascade"),
    uniqueIndex("companies_workspace_domain_uq")
      .on(table.workspaceId, table.normalizedDomain)
      .where(sql`${table.normalizedDomain} is not null`),
    unique("companies_workspace_id_uq").on(table.workspaceId, table.id),
    index("companies_workspace_name_idx").on(table.workspaceId, table.name),
  ],
);

export const companyFieldProvenance = pgTable(
  "company_field_provenance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    field: varchar("field", { length: 120 }).notNull(),
    source: varchar("source", { length: 200 }).notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("company_field_provenance_company_idx").on(table.workspaceId, table.companyId),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    firstName: varchar("first_name", { length: 200 }).notNull(),
    lastName: varchar("last_name", { length: 200 }).notNull(),
    photoUrl: varchar("photo_url", { length: 600 }),
    preferredChannel: varchar("preferred_channel", { length: 40 }),
    status: contactStatusEnum("status").notNull().default("active"),
    source: crmSourceEnum("source").notNull().default("manual"),
    mergedIntoId: uuid("merged_into_id"),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "contacts_workspace_fk",
    }).onDelete("cascade"),
    unique("contacts_workspace_id_uq").on(table.workspaceId, table.id),
    index("contacts_workspace_name_idx").on(table.workspaceId, table.lastName, table.firstName),
    foreignKey({
      columns: [table.mergedIntoId],
      foreignColumns: [table.id],
      name: "contacts_merged_into_fk",
    }).onDelete("set null"),
  ],
);

export const contactIdentities = pgTable(
  "contact_identities",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    type: contactIdentityTypeEnum("type").notNull(),
    value: varchar("value", { length: 600 }).notNull(),
    normalizedValue: varchar("normalized_value", { length: 600 }).notNull(),
    verificationStatus: contactVerificationEnum("verification_status")
      .notNull()
      .default("unknown"),
    source: crmSourceEnum("source").notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.contactId],
      foreignColumns: [contacts.workspaceId, contacts.id],
      name: "contact_identities_contact_fk",
    }).onDelete("cascade"),
    uniqueIndex("contact_identities_value_uq").on(
      table.workspaceId,
      table.type,
      table.normalizedValue,
    ),
  ],
);

export const contactEmployments = pgTable(
  "contact_employments",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    companyId: uuid("company_id").notNull(),
    title: varchar("title", { length: 300 }).notNull(),
    startedOn: varchar("started_on", { length: 10 }),
    endedOn: varchar("ended_on", { length: 10 }),
    isCurrent: boolean("is_current").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.contactId],
      foreignColumns: [contacts.workspaceId, contacts.id],
      name: "contact_employments_contact_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.companyId],
      foreignColumns: [companies.workspaceId, companies.id],
      name: "contact_employments_company_fk",
    }).onDelete("cascade"),
    uniqueIndex("contact_employments_current_uq")
      .on(table.workspaceId, table.contactId)
      .where(sql`${table.isCurrent}`),
  ],
);

export const contactSuppressions = pgTable(
  "contact_suppressions",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    contactId: uuid("contact_id"),
    channel: suppressionChannelEnum("channel").notNull(),
    identityType: contactIdentityTypeEnum("identity_type"),
    normalizedValue: varchar("normalized_value", { length: 600 }),
    identityFingerprint: varchar("identity_fingerprint", { length: 128 }),
    reason: text("reason"),
    createdBy: uuid("created_by").references(() => authUsers.id),
    liftedAt: timestamp("lifted_at", { withTimezone: true }),
    liftedBy: uuid("lifted_by").references(() => authUsers.id),
    liftJustification: text("lift_justification"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "contact_suppressions_workspace_fk",
    }).onDelete("cascade"),
    uniqueIndex("contact_suppressions_fingerprint_uq")
      .on(table.workspaceId, table.identityType, table.normalizedValue, table.channel)
      .where(sql`${table.normalizedValue} is not null`),
    uniqueIndex("contact_suppressions_hmac_uq")
      .on(table.workspaceId, table.identityType, table.identityFingerprint)
      .where(sql`${table.identityFingerprint} is not null`),
  ],
);

export const enrichmentJobs = pgTable(
  "enrichment_jobs",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    entityType: varchar("entity_type", { length: 30 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    requestKey: varchar("request_key", { length: 500 }).notNull(),
    status: enrichmentJobStatusEnum("status").notNull().default("queued"),
    provider: varchar("provider", { length: 120 }).notNull().default("crawler"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    correlationId: varchar("correlation_id", { length: 200 }).notNull(),
    errorCode: varchar("error_code", { length: 120 }),
    errorMessage: text("error_message"),
    requestedBy: uuid("requested_by").references(() => authUsers.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("enrichment_jobs_workspace_request_key_uq").on(table.workspaceId, table.requestKey),
    index("enrichment_jobs_workspace_status_idx").on(table.workspaceId, table.status, table.createdAt),
    index("enrichment_jobs_entity_idx").on(table.workspaceId, table.entityType, table.entityId),
  ],
);

export const enrichmentObservations = pgTable(
  "enrichment_observations",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => enrichmentJobs.id, { onDelete: "cascade" }),
    entityType: varchar("entity_type", { length: 30 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    field: varchar("field", { length: 160 }).notNull(),
    value: text("value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    status: enrichmentObservationStatusEnum("status").notNull(),
    confidence: varchar("confidence", { length: 20 }).notNull().default("none"),
    source: varchar("source", { length: 200 }).notNull(),
    provider: varchar("provider", { length: 120 }),
    evidenceUrl: text("evidence_url"),
    evidenceSnippet: text("evidence_snippet"),
    phoneKind: enrichmentPhoneKindEnum("phone_kind"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("enrichment_observations_contact_value_uq").on(
      table.workspaceId,
      table.contactId,
      table.field,
      table.normalizedValue,
    ),
    uniqueIndex("enrichment_observations_company_value_uq").on(
      table.workspaceId,
      table.companyId,
      table.field,
      table.normalizedValue,
    ),
    index("enrichment_observations_entity_idx").on(table.workspaceId, table.entityType, table.entityId, table.field),
    index("enrichment_observations_job_idx").on(table.workspaceId, table.jobId),
  ],
);

export const signalCollectionRuns = pgTable(
  "signal_collection_runs",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    requestKey: varchar("request_key", { length: 500 }).notNull(),
    status: signalCollectionStatusEnum("status").notNull().default("queued"),
    source: varchar("source", { length: 200 }).notNull(),
    errorCode: varchar("error_code", { length: 120 }),
    errorMessage: text("error_message"),
    requestedBy: uuid("requested_by").references(() => authUsers.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("signal_collection_runs_workspace_request_uq").on(table.workspaceId, table.requestKey),
    index("signal_collection_runs_workspace_status_idx").on(table.workspaceId, table.status, table.createdAt),
  ],
);

export const workspaceSignalSettings = pgTable("workspace_signal_settings", {
  workspaceId: uuid("workspace_id").primaryKey().references(() => workspaces.id, { onDelete: "cascade" }),
  signalTypes: jsonb("signal_types").notNull().default([]),
  updatedBy: uuid("updated_by").notNull().references(() => authUsers.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const signals = pgTable(
  "signals",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    signalType: signalTypeEnum("signal_type").notNull(),
    entityType: varchar("entity_type", { length: 30 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    source: varchar("source", { length: 200 }).notNull(),
    sources: jsonb("sources").notNull().default([]),
    providerEventId: varchar("provider_event_id", { length: 500 }),
    evidenceUrl: text("evidence_url").notNull(),
    evidenceSnippet: text("evidence_snippet"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    confidence: varchar("confidence", { length: 20 }).notNull(),
    deduplicationKey: varchar("deduplication_key", { length: 700 }).notNull(),
    legalBasis: varchar("legal_basis", { length: 200 }).notNull(),
    sourceAuthorized: boolean("source_authorized").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("signals_workspace_dedup_uq").on(table.workspaceId, table.deduplicationKey),
    index("signals_workspace_entity_expiry_idx").on(table.workspaceId, table.entityType, table.entityId, table.expiresAt),
    index("signals_workspace_type_expiry_idx").on(table.workspaceId, table.signalType, table.expiresAt),
  ],
);

export const mergeCandidates = pgTable(
  "merge_candidates",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    primaryContactId: uuid("primary_contact_id").notNull(),
    secondaryContactId: uuid("secondary_contact_id").notNull(),
    pairKey: varchar("pair_key", { length: 80 }).notNull(),
    matchType: varchar("match_type", { length: 30 }).notNull(),
    signals: jsonb("signals").notNull().default({}),
    status: varchar("status", { length: 30 }).notNull().default("pending"),
    decisionReason: text("decision_reason"),
    decidedBy: uuid("decided_by").references(() => authUsers.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId], foreignColumns: [workspaces.id], name: "merge_candidates_workspace_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.primaryContactId], foreignColumns: [contacts.workspaceId, contacts.id], name: "merge_candidates_primary_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.secondaryContactId], foreignColumns: [contacts.workspaceId, contacts.id], name: "merge_candidates_secondary_fk" }).onDelete("cascade"),
    unique("merge_candidates_workspace_pair_uq").on(table.workspaceId, table.pairKey),
    index("merge_candidates_workspace_status_idx").on(table.workspaceId, table.status, table.createdAt),
  ],
);

export const contactMerges = pgTable(
  "contact_merges",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    survivorContactId: uuid("survivor_contact_id").notNull(),
    mergedContactId: uuid("merged_contact_id").notNull(),
    candidateId: uuid("candidate_id").references(() => mergeCandidates.id, { onDelete: "set null" }),
    snapshot: jsonb("snapshot").notNull(),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    mergedBy: uuid("merged_by").references(() => authUsers.id, { onDelete: "set null" }),
    mergedAt: timestamp("merged_at", { withTimezone: true }).notNull().defaultNow(),
    undoneBy: uuid("undone_by").references(() => authUsers.id, { onDelete: "set null" }),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId], foreignColumns: [workspaces.id], name: "contact_merges_workspace_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.survivorContactId], foreignColumns: [contacts.workspaceId, contacts.id], name: "contact_merges_survivor_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.mergedContactId], foreignColumns: [contacts.workspaceId, contacts.id], name: "contact_merges_merged_fk" }).onDelete("cascade"),
    index("contact_merges_workspace_history_idx").on(table.workspaceId, table.mergedAt),
  ],
);

export const discoveryRunStatusEnum = pgEnum("discovery_run_status", [
  "running",
  "completed",
  "failed",
]);

export const prospectDiscoveryRuns = pgTable(
  "prospect_discovery_runs",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    icpVersionId: uuid("icp_version_id")
      .notNull()
      .references(() => icpVersions.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").references((): AnyPgColumn => campaigns.id, {
      onDelete: "cascade",
    }),
    sourcingCycleId: uuid("sourcing_cycle_id").references(() => dailySourcingCycles.id, {
      onDelete: "set null",
    }),
    sourcingFrontierId: uuid("sourcing_frontier_id").references(() => sourcingFrontiers.id, {
      onDelete: "set null",
    }),
    trigger: varchar("trigger", { length: 40 }).notNull().default("manual"),
    provider: varchar("provider", { length: 80 }).notNull().default("unipile"),
    channel: prospectingChannelEnum("channel").notNull().default("linkedin"),
    filters: jsonb("filters").notNull(),
    status: discoveryRunStatusEnum("status").notNull().default("running"),
    errorCode: varchar("error_code", { length: 120 }),
    errorMessage: text("error_message"),
    candidateCount: integer("candidate_count").notNull().default(0),
    retryCount: integer("retry_count").notNull().default(0),
    createdBy: uuid("created_by").references(() => authUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "prospect_discovery_runs_workspace_fk",
    }).onDelete("cascade"),
    index("prospect_discovery_runs_version_idx").on(table.workspaceId, table.icpVersionId),
    index("prospect_discovery_runs_cycle_idx").on(table.workspaceId, table.sourcingCycleId),
    uniqueIndex("prospect_discovery_runs_active_version_uq")
      .on(table.workspaceId, table.icpVersionId, table.channel)
      .where(sql`${table.status} = 'running'`),
  ],
);

export const prospectDiscoveryCandidates = pgTable(
  "prospect_discovery_candidates",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    runId: uuid("run_id")
      .notNull()
      .references(() => prospectDiscoveryRuns.id, { onDelete: "cascade" }),
    fullName: varchar("full_name", { length: 300 }).notNull(),
    headline: text("headline"),
    linkedinUrl: varchar("linkedin_url", { length: 600 }),
    linkedinNormalized: varchar("linkedin_normalized", { length: 600 }),
    location: varchar("location", { length: 300 }),
    companyName: varchar("company_name", { length: 300 }),
    companyWebsite: varchar("company_website", { length: 600 }),
    companyDomain: varchar("company_domain", { length: 300 }),
    channels: jsonb("channels")
      .$type<ProspectChannels>()
      .notNull()
      .default(emptyProspectChannels()),
    providerData: jsonb("provider_data").notNull().default({}),
    icpFit: jsonb("icp_fit").notNull().default({ matches: [], gaps: [] }),
    importedContactId: uuid("imported_contact_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "prospect_discovery_candidates_workspace_fk",
    }).onDelete("cascade"),
    uniqueIndex("prospect_discovery_candidates_run_linkedin_uq")
      .on(table.workspaceId, table.runId, table.linkedinNormalized)
      .where(sql`${table.linkedinNormalized} is not null`),
  ],
);

export const phoneAttributionStatusEnum = pgEnum("phone_attribution_status", [
  "strong",
  "weak",
  "conflict",
  "rejected",
]);

export const phoneEndpointKindEnum = pgEnum("phone_endpoint_kind", [
  "person",
  "company",
]);

export const whatsappReachabilityStatusEnum = pgEnum("whatsapp_reachability_status", [
  "verified",
  "not_registered",
  "unknown",
]);

export const phoneObservations = pgTable(
  "phone_observations",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => prospectDiscoveryRuns.id, { onDelete: "cascade" }),
    sourcingCycleId: uuid("sourcing_cycle_id").references(() => dailySourcingCycles.id, {
      onDelete: "set null",
    }),
    sourcingFrontierId: uuid("sourcing_frontier_id").references(() => sourcingFrontiers.id, {
      onDelete: "set null",
    }),
    logicalFingerprint: varchar("logical_fingerprint", { length: 128 }).notNull(),
    e164: varchar("e164", { length: 32 }),
    rawValue: varchar("raw_value", { length: 120 }),
    endpointKind: phoneEndpointKindEnum("endpoint_kind").notNull(),
    companyName: varchar("company_name", { length: 300 }).notNull(),
    companyDomain: varchar("company_domain", { length: 300 }),
    companyFingerprint: varchar("company_fingerprint", { length: 128 }).notNull(),
    personName: varchar("person_name", { length: 300 }),
    personRole: varchar("person_role", { length: 300 }),
    attributionStatus: phoneAttributionStatusEnum("attribution_status").notNull(),
    attributionReason: text("attribution_reason").notNull(),
    sourceKind: varchar("source_kind", { length: 80 }).notNull(),
    sourceUrl: varchar("source_url", { length: 1200 }).notNull(),
    evidenceSnippet: text("evidence_snippet").notNull(),
    contentHash: varchar("content_hash", { length: 128 }),
    reachabilityStatus: whatsappReachabilityStatusEnum("reachability_status")
      .notNull()
      .default("unknown"),
    providerAccountId: text("provider_account_id"),
    reachabilityCheckedAt: timestamp("reachability_checked_at", { withTimezone: true }),
    reachabilityExpiresAt: timestamp("reachability_expires_at", { withTimezone: true }),
    rejectionReason: varchar("rejection_reason", { length: 160 }),
    firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull(),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull(),
    contradictedAt: timestamp("contradicted_at", { withTimezone: true }),
    rawRetainUntil: timestamp("raw_retain_until", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("phone_observations_logical_uq").on(
      table.workspaceId,
      table.logicalFingerprint,
    ),
    index("phone_observations_e164_idx").on(
      table.workspaceId,
      table.e164,
      table.attributionStatus,
    ),
    index("phone_observations_cycle_idx").on(table.workspaceId, table.sourcingCycleId),
  ],
);

export const whatsappReachabilityChecks = pgTable(
  "whatsapp_reachability_checks",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    providerAccountId: text("provider_account_id").notNull(),
    e164: varchar("e164", { length: 32 }).notNull(),
    status: whatsappReachabilityStatusEnum("status").notNull(),
    source: varchar("source", { length: 120 }).notNull().default("unipile"),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastErrorCode: varchar("last_error_code", { length: 120 }),
    responseHash: varchar("response_hash", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.providerAccountId, table.e164] }),
    index("whatsapp_reachability_expiry_idx").on(table.workspaceId, table.expiresAt),
  ],
);

export const sequenceStatusEnum = pgEnum("sequence_status", [
  "draft",
  "published",
  "archived",
]);

export const prospectingPlanStatusEnum = pgEnum("prospecting_plan_status", [
  "assessing",
  "ready",
  "archived",
]);

export const channelAssessmentStatusEnum = pgEnum("channel_assessment_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);

export const channelRecommendationEnum = pgEnum("channel_recommendation", [
  "recommended",
  "optional",
  "unsuitable",
]);

export const campaignProspectStateEnum = pgEnum("campaign_prospect_state", [
  "candidate",
  "imported",
  "excluded",
]);
export const sequenceEnrollmentStatusEnum = pgEnum("sequence_enrollment_status", [
  "active",
  "suspended",
  "completed",
  "cancelled",
]);
export const sequenceStepKindEnum = pgEnum("sequence_step_kind", [
  "linkedin_invite",
  "linkedin_message",
  "email",
  "whatsapp",
  "manual_task",
]);

export const sequences = pgTable(
  "sequences",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    name: varchar("name", { length: 300 }).notNull(),
    description: text("description"),
    status: sequenceStatusEnum("status").notNull().default("draft"),
    createdBy: uuid("created_by").references(() => authUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "sequences_workspace_fk",
    }).onDelete("cascade"),
    unique("sequences_workspace_id_uq").on(table.workspaceId, table.id),
    index("sequences_workspace_name_idx").on(table.workspaceId, table.name),
  ],
);

export const sequenceSteps = pgTable(
  "sequence_steps",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    sequenceId: uuid("sequence_id")
      .notNull()
      .references(() => sequences.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    kind: sequenceStepKindEnum("kind").notNull(),
    delayDays: integer("delay_days").notNull().default(0),
    windowStart: varchar("window_start", { length: 5 }),
    windowEnd: varchar("window_end", { length: 5 }),
    subject: varchar("subject", { length: 300 }),
    body: text("body").notNull(),
    fallbackKind: sequenceStepKindEnum("fallback_kind"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "sequence_steps_workspace_fk",
    }).onDelete("cascade"),
    uniqueIndex("sequence_steps_position_uq").on(table.workspaceId, table.sequenceId, table.position),
  ],
);

export const sequenceVersions = pgTable(
  "sequence_versions",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    sequenceId: uuid("sequence_id")
      .notNull()
      .references(() => sequences.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    steps: jsonb("steps").notNull(),
    publishedBy: uuid("published_by").references(() => authUsers.id),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "sequence_versions_workspace_fk",
    }).onDelete("cascade"),
    uniqueIndex("sequence_versions_sequence_version_uq").on(
      table.workspaceId,
      table.sequenceId,
      table.version,
    ),
    unique("sequence_versions_workspace_id_uq").on(table.workspaceId, table.id),
  ],
);

export const campaignStatusEnum = pgEnum("campaign_status", [
  "draft",
  "active",
  "paused",
  "completed",
  "archived",
]);

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    name: varchar("name", { length: 300 }).notNull(),
    objective: text("objective").notNull().default(""),
    status: campaignStatusEnum("status").notNull().default("draft"),
    offerVersionId: uuid("offer_version_id"),
    icpVersionId: uuid("icp_version_id").notNull(),
    messagingStrategyVersionId: uuid("messaging_strategy_version_id"),
    aiPolicyVersionId: uuid("ai_policy_version_id"),
    sequenceVersionId: uuid("sequence_version_id"),
    planId: uuid("plan_id"),
    assessmentId: uuid("assessment_id"),
    channel: prospectingChannelEnum("channel").notNull(),
    // Kept non-null in the application contract; migration 0043 only relaxes the
    // physical column for legacy campaign rows created before channel sequences.
    sequenceId: uuid("sequence_id").notNull(),
    discoveryRunId: uuid("discovery_run_id"),
    legacyReason: varchar("legacy_reason", { length: 120 }),
    prospectCount: integer("prospect_count").notNull().default(0),
    autopilotPolicy: jsonb("autopilot_policy").notNull().default({}),
    automationStage: varchar("automation_stage", { length: 40 }).notNull().default("sourcing"),
    automationErrorCode: varchar("automation_error_code", { length: 120 }),
    automationErrorMessage: text("automation_error_message"),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    activatedBy: uuid("activated_by").references(() => authUsers.id, { onDelete: "set null" }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId], foreignColumns: [workspaces.id], name: "campaigns_workspace_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.offerVersionId], foreignColumns: [offerVersions.workspaceId, offerVersions.id], name: "campaigns_offer_version_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.workspaceId, table.icpVersionId], foreignColumns: [icpVersions.workspaceId, icpVersions.id], name: "campaigns_icp_version_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.workspaceId, table.messagingStrategyVersionId], foreignColumns: [messagingStrategyVersions.workspaceId, messagingStrategyVersions.id], name: "campaigns_messaging_version_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.workspaceId, table.aiPolicyVersionId], foreignColumns: [aiPolicyVersions.workspaceId, aiPolicyVersions.id], name: "campaigns_ai_policy_version_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.workspaceId, table.sequenceVersionId], foreignColumns: [sequenceVersions.workspaceId, sequenceVersions.id], name: "campaigns_sequence_version_fk" }).onDelete("restrict"),
    unique("campaigns_workspace_id_uq").on(table.workspaceId, table.id),
    index("campaigns_workspace_status_idx").on(table.workspaceId, table.status, table.updatedAt),
  ],
);

export const campaignProspectStatusEnum = pgEnum("campaign_prospect_status", [
  "candidate",
  "selected",
  "excluded",
  "enrolled",
]);

export const campaignEnrollmentStatusEnum = pgEnum("campaign_enrollment_status", [
  "active",
  "completed",
  "cancelled",
]);

export const campaignProspects = pgTable(
  "campaign_prospects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    campaignId: uuid("campaign_id").notNull(),
    candidateId: uuid("candidate_id").notNull().defaultRandom(),
    contactId: uuid("contact_id"),
    status: campaignProspectStatusEnum("status").notNull().default("candidate"),
    state: campaignProspectStateEnum("state").notNull().default("candidate"),
    score: numeric("score", { precision: 7, scale: 4, mode: "number" }).default(0),
    explanation: jsonb("explanation").notNull().default({}),
    scoreVersion: varchar("score_version", { length: 80 }),
    scoreExplanation: jsonb("score_explanation").notNull().default([]),
    aiAssessment: jsonb("ai_assessment").notNull().default({}),
    eligible: boolean("eligible").notNull().default(false),
    personalizedSteps: jsonb("personalized_steps").notNull().default([]),
    exclusionReason: text("exclusion_reason"),
    selectedAt: timestamp("selected_at", { withTimezone: true }),
    excludedAt: timestamp("excluded_at", { withTimezone: true }),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId], foreignColumns: [workspaces.id], name: "campaign_prospects_workspace_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.campaignId], foreignColumns: [campaigns.workspaceId, campaigns.id], name: "campaign_prospects_campaign_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.contactId], foreignColumns: [contacts.workspaceId, contacts.id], name: "campaign_prospects_contact_fk" }).onDelete("cascade"),
    unique("campaign_prospects_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("campaign_prospects_campaign_contact_uq").on(table.workspaceId, table.campaignId, table.contactId),
    index("campaign_prospects_campaign_status_idx").on(table.workspaceId, table.campaignId, table.status, table.score),
  ],
);

export const campaignEnrollments = pgTable(
  "campaign_enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    campaignId: uuid("campaign_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    sequenceVersionId: uuid("sequence_version_id").notNull(),
    status: campaignEnrollmentStatusEnum("status").notNull().default("active"),
    enrolledBy: uuid("enrolled_by").references(() => authUsers.id, { onDelete: "set null" }),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId], foreignColumns: [workspaces.id], name: "campaign_enrollments_workspace_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.campaignId], foreignColumns: [campaigns.workspaceId, campaigns.id], name: "campaign_enrollments_campaign_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.contactId], foreignColumns: [contacts.workspaceId, contacts.id], name: "campaign_enrollments_contact_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.sequenceVersionId], foreignColumns: [sequenceVersions.workspaceId, sequenceVersions.id], name: "campaign_enrollments_sequence_version_fk" }).onDelete("restrict"),
    unique("campaign_enrollments_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("campaign_enrollments_campaign_contact_uq").on(table.workspaceId, table.campaignId, table.contactId),
    uniqueIndex("campaign_enrollments_active_contact_uq").on(table.workspaceId, table.contactId).where(sql`${table.status} = 'active'`),
    index("campaign_enrollments_campaign_idx").on(table.workspaceId, table.campaignId, table.createdAt),
  ],
);

export const approvalItemStatusEnum = pgEnum("approval_item_status", [
  "pending",
  "approved",
  "rejected",
  "invalidated",
]);

export const approvalItems = pgTable(
  "approval_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    campaignId: uuid("campaign_id"),
    contactId: uuid("contact_id"),
    enrollmentId: uuid("enrollment_id"),
    itemType: varchar("item_type", { length: 100 }).notNull(),
    channel: varchar("channel", { length: 40 }).notNull(),
    stepPosition: integer("step_position"),
    contentOriginal: jsonb("content_original").notNull(),
    contentEdited: jsonb("content_edited"),
    context: jsonb("context").notNull().default({}),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    status: approvalItemStatusEnum("status").notNull().default("pending"),
    decisionBy: uuid("decision_by").references(() => authUsers.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    rejectionJustification: text("rejection_justification"),
    invalidationReason: text("invalidation_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId], foreignColumns: [workspaces.id], name: "approval_items_workspace_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.campaignId], foreignColumns: [campaigns.workspaceId, campaigns.id], name: "approval_items_campaign_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.contactId], foreignColumns: [contacts.id], name: "approval_items_contact_fk" }).onDelete("set null"),
    foreignKey({ columns: [table.enrollmentId], foreignColumns: [campaignEnrollments.id], name: "approval_items_enrollment_fk" }).onDelete("set null"),
    unique("approval_items_workspace_id_uq").on(table.workspaceId, table.id),
    index("approval_items_workspace_status_idx").on(table.workspaceId, table.status, table.createdAt),
    index("approval_items_campaign_status_idx").on(table.workspaceId, table.campaignId, table.status, table.createdAt),
  ],
);

export const outreachActionStatusEnum = pgEnum("outreach_action_status", [
  "planned",
  "awaiting_approval",
  "due",
  "sending",
  "scheduled",
  "executing",
  "sent",
  "failed",
  "skipped",
  "cancelled",
  "suspended",
]);

export const outreachAttemptStatusEnum = pgEnum("outreach_attempt_status", [
  "sending",
  "executing",
  "sent",
  "failed",
  "rate_limited",
  "retry",
  "unknown",
]);

export const outreachActions = pgTable(
  "outreach_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    campaignId: uuid("campaign_id").notNull(),
    enrollmentId: uuid("enrollment_id").notNull(),
    candidateId: uuid("candidate_id").notNull().defaultRandom(),
    contactId: uuid("contact_id").notNull(),
    sequenceVersionId: uuid("sequence_version_id"),
    approvalItemId: uuid("approval_item_id"),
    connectedAccountId: uuid("connected_account_id"),
    stepPosition: integer("step_position").notNull(),
    stepKind: sequenceStepKindEnum("step_kind").notNull().default("email"),
    provider: varchar("provider", { length: 40 }).notNull().default("unipile"),
    providerAccountId: varchar("provider_account_id", { length: 300 }).notNull().default(""),
    channel: prospectingChannelEnum("channel").notNull(),
    recipient: varchar("recipient", { length: 600 }).notNull().default(""),
    subject: varchar("subject", { length: 300 }),
    body: text("body").notNull().default(""),
    idempotencyKey: varchar("idempotency_key", { length: 500 }).notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull().defaultNow(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull().defaultNow(),
    contentSnapshot: jsonb("content_snapshot").notNull().default({}),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lockedBy: varchar("locked_by", { length: 160 }),
    providerRequestId: varchar("provider_request_id", { length: 300 }),
    status: outreachActionStatusEnum("status").notNull().default("planned"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastErrorCode: varchar("last_error_code", { length: 120 }),
    lastErrorMessage: text("last_error_message"),
    providerMessageId: varchar("provider_message_id", { length: 300 }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    responseReceivedAt: timestamp("response_received_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId], foreignColumns: [workspaces.id], name: "outreach_actions_workspace_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.campaignId], foreignColumns: [campaigns.workspaceId, campaigns.id], name: "outreach_actions_campaign_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.enrollmentId], foreignColumns: [campaignEnrollments.workspaceId, campaignEnrollments.id], name: "outreach_actions_enrollment_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.contactId], foreignColumns: [contacts.workspaceId, contacts.id], name: "outreach_actions_contact_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.sequenceVersionId], foreignColumns: [sequenceVersions.workspaceId, sequenceVersions.id], name: "outreach_actions_sequence_version_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.approvalItemId], foreignColumns: [approvalItems.id], name: "outreach_actions_approval_item_fk" }).onDelete("set null"),
    foreignKey({ columns: [table.connectedAccountId], foreignColumns: [connectedAccounts.id], name: "outreach_actions_account_fk" }).onDelete("set null"),
    unique("outreach_actions_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("outreach_actions_idempotency_uq").on(table.workspaceId, table.idempotencyKey),
    index("outreach_actions_due_idx").on(table.workspaceId, table.status, table.scheduledAt),
    index("outreach_actions_campaign_idx").on(table.workspaceId, table.campaignId, table.createdAt),
  ],
);

export const outreachAttempts = pgTable(
  "outreach_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    actionId: uuid("action_id"),
    outreachActionId: uuid("outreach_action_id"),
    attempt: integer("attempt"),
    attemptNumber: integer("attempt_number"),
    status: outreachAttemptStatusEnum("status").notNull(),
    providerRequestId: varchar("provider_request_id", { length: 300 }),
    providerMessageId: varchar("provider_message_id", { length: 300 }),
    errorCode: varchar("error_code", { length: 120 }),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId], foreignColumns: [workspaces.id], name: "outreach_attempts_workspace_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.actionId], foreignColumns: [outreachActions.workspaceId, outreachActions.id], name: "outreach_attempts_action_fk" }).onDelete("cascade"),
    unique("outreach_attempts_action_attempt_uq").on(table.workspaceId, table.actionId, table.attempt),
  ],
);

export const prospectingPlans = pgTable(
  "prospecting_plans",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    icpVersionId: uuid("icp_version_id")
      .notNull()
      .references(() => icpVersions.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 300 }).notNull(),
    status: prospectingPlanStatusEnum("status").notNull().default("assessing"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "prospecting_plans_workspace_fk",
    }).onDelete("cascade"),
    unique("prospecting_plans_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("prospecting_plans_icp_version_uq").on(table.workspaceId, table.icpVersionId),
    index("prospecting_plans_workspace_status_idx").on(table.workspaceId, table.status),
  ],
);

export const channelAssessments = pgTable(
  "channel_assessments",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => prospectingPlans.id, { onDelete: "cascade" }),
    channel: prospectingChannelEnum("channel").notNull(),
    status: channelAssessmentStatusEnum("status").notNull().default("pending"),
    recommendation: channelRecommendationEnum("recommendation"),
    score: integer("score"),
    strategy: jsonb("strategy").notNull().default({}),
    metrics: jsonb("metrics").notNull().default({}),
    evidence: jsonb("evidence").notNull().default([]),
    rationale: text("rationale"),
    sampleSize: integer("sample_size").notNull().default(0),
    errorCode: varchar("error_code", { length: 120 }),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "channel_assessments_workspace_fk",
    }).onDelete("cascade"),
    unique("channel_assessments_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("channel_assessments_plan_channel_uq").on(
      table.workspaceId,
      table.planId,
      table.channel,
    ),
    index("channel_assessments_workspace_status_idx").on(table.workspaceId, table.status),
  ],
);

export const contactChannelAssignments = pgTable(
  "contact_channel_assignments",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    channel: prospectingChannelEnum("channel").notNull(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => prospectDiscoveryCandidates.id, { onDelete: "cascade" }),
    score: integer("score").notNull(),
    scoreVersion: varchar("score_version", { length: 80 }).notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.contactId, table.channel] }),
    index("contact_channel_assignments_campaign_idx").on(
      table.workspaceId,
      table.campaignId,
      table.assignedAt,
    ),
  ],
);

export const sequenceEnrollments = pgTable(
  "sequence_enrollments",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id").notNull().references(() => prospectDiscoveryCandidates.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    sequenceVersionId: uuid("sequence_version_id").notNull().references(() => sequenceVersions.id),
    status: sequenceEnrollmentStatusEnum("status").notNull().default("active"),
    currentPosition: integer("current_position").notNull().default(1),
    suspensionReason: varchar("suspension_reason", { length: 160 }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "sequence_enrollments_workspace_fk",
    }).onDelete("cascade"),
    uniqueIndex("sequence_enrollments_campaign_contact_uq").on(
      table.workspaceId,
      table.campaignId,
      table.contactId,
    ),
    index("sequence_enrollments_active_idx").on(table.workspaceId, table.status, table.updatedAt),
  ],
);

export const integrationEvents = pgTable(
  "integration_events",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    provider: varchar("provider", { length: 40 }).notNull(),
    providerEventId: varchar("provider_event_id", { length: 500 }).notNull(),
    eventType: varchar("event_type", { length: 120 }).notNull(),
    payload: jsonb("payload").notNull(),
    status: varchar("status", { length: 40 }).notNull().default("pending"),
    errorCode: varchar("error_code", { length: 160 }),
    errorMessage: text("error_message"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "integration_events_workspace_fk",
    }).onDelete("cascade"),
    uniqueIndex("integration_events_provider_event_uq").on(
      table.workspaceId,
      table.provider,
      table.providerEventId,
    ),
    index("integration_events_status_idx").on(table.status, table.receivedAt),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    provider: varchar("provider", { length: 40 }).notNull(),
    providerAccountId: varchar("provider_account_id", { length: 300 }).notNull(),
    providerThreadId: varchar("provider_thread_id", { length: 500 }).notNull(),
    channel: prospectingChannelEnum("channel").notNull(),
    status: varchar("status", { length: 40 }).notNull().default("open"),
    unreadCount: integer("unread_count").notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "conversations_workspace_fk",
    }).onDelete("cascade"),
    uniqueIndex("conversations_provider_thread_uq").on(
      table.workspaceId,
      table.providerAccountId,
      table.providerThreadId,
    ),
    index("conversations_contact_idx").on(table.workspaceId, table.contactId, table.lastMessageAt),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    providerMessageId: varchar("provider_message_id", { length: 500 }).notNull(),
    direction: varchar("direction", { length: 20 }).notNull(),
    senderType: varchar("sender_type", { length: 40 }).notNull(),
    body: text("body").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "messages_workspace_fk",
    }).onDelete("cascade"),
    uniqueIndex("messages_provider_message_uq").on(table.workspaceId, table.providerMessageId),
    index("messages_conversation_idx").on(table.workspaceId, table.conversationId, table.createdAt),
  ],
);

export const replyClassifications = pgTable(
  "reply_classifications",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
    intent: varchar("intent", { length: 80 }).notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
    action: varchar("action", { length: 40 }).notNull(),
    rationale: text("rationale").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "reply_classifications_workspace_fk",
    }).onDelete("cascade"),
    uniqueIndex("reply_classifications_message_uq").on(table.workspaceId, table.messageId),
  ],
);

export const automatedReplies = pgTable(
  "automated_replies",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    inboundMessageId: uuid("inbound_message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
    providerAccountId: varchar("provider_account_id", { length: 300 }).notNull(),
    channel: prospectingChannelEnum("channel").notNull(),
    body: text("body").notNull(),
    status: varchar("status", { length: 40 }).notNull().default("scheduled"),
    idempotencyKey: varchar("idempotency_key", { length: 500 }).notNull(),
    providerRequestId: varchar("provider_request_id", { length: 500 }),
    errorCode: varchar("error_code", { length: 160 }),
    errorMessage: text("error_message"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "automated_replies_workspace_fk",
    }).onDelete("cascade"),
    uniqueIndex("automated_replies_inbound_message_uq").on(table.workspaceId, table.inboundMessageId),
    uniqueIndex("automated_replies_idempotency_uq").on(table.workspaceId, table.idempotencyKey),
  ],
);

export const conversationCommands = pgTable(
  "conversation_commands",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by").references(() => authUsers.id, { onDelete: "set null" }),
    mode: varchar("mode", { length: 20 }).notNull(),
    requestedBody: text("requested_body"),
    generatedBody: text("generated_body"),
    status: varchar("status", { length: 40 }).notNull().default("scheduled"),
    idempotencyKey: varchar("idempotency_key", { length: 500 }).notNull(),
    providerRequestId: varchar("provider_request_id", { length: 500 }),
    errorCode: varchar("error_code", { length: 160 }),
    errorMessage: text("error_message"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "conversation_commands_workspace_fk",
    }).onDelete("cascade"),
    uniqueIndex("conversation_commands_idempotency_uq").on(table.workspaceId, table.idempotencyKey),
    index("conversation_commands_conversation_idx").on(
      table.workspaceId,
      table.conversationId,
      table.createdAt,
    ),
  ],
);

export const opportunities = pgTable(
  "opportunities",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    stage: varchar("stage", { length: 80 }).notNull().default("qualified"),
    amount: numeric("amount", { precision: 19, scale: 6, mode: "number" }),
    currency: varchar("currency", { length: 3 }),
    probability: integer("probability").notNull().default(0),
    ownerUserId: uuid("owner_user_id"),
    nextAction: text("next_action"),
    expectedCloseDate: timestamp("expected_close_date", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    lostReason: varchar("lost_reason", { length: 120 }),
    lostComment: text("lost_comment"),
    offerVersionId: uuid("offer_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "opportunities_workspace_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.ownerUserId],
      foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.userId],
      name: "opportunities_workspace_owner_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.offerVersionId],
      foreignColumns: [offerVersions.workspaceId, offerVersions.id],
      name: "opportunities_workspace_offer_version_fk",
    }).onDelete("restrict"),
    unique("opportunities_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("opportunities_contact_campaign_uq").on(table.workspaceId, table.contactId, table.campaignId),
  ],
);

export const workspaceLostReasons = pgTable(
  "workspace_lost_reasons",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 120 }).notNull(),
    label: varchar("label", { length: 300 }).notNull(),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("workspace_lost_reasons_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("workspace_lost_reasons_key_uq").on(table.workspaceId, table.key),
    index("workspace_lost_reasons_workspace_active_idx").on(table.workspaceId, table.active),
  ],
);

export const opportunityStageHistory = pgTable(
  "opportunity_stage_history",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    opportunityId: uuid("opportunity_id").notNull(),
    fromStage: varchar("from_stage", { length: 80 }),
    toStage: varchar("to_stage", { length: 80 }).notNull(),
    source: varchar("source", { length: 80 }).notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.opportunityId],
      foreignColumns: [opportunities.workspaceId, opportunities.id],
      name: "opportunity_stage_history_opportunity_fk",
    }).onDelete("cascade"),
    index("opportunity_stage_history_timeline_idx").on(
      table.workspaceId,
      table.opportunityId,
      table.createdAt,
    ),
  ],
);

export const calendarConnections = pgTable(
  "calendar_connections",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    provider: varchar("provider", { length: 40 }).notNull(),
    bookingUrl: varchar("booking_url", { length: 2_000 }).notNull(),
    apiKeyCiphertext: text("api_key_ciphertext"),
    eventTypeId: integer("event_type_id"),
    eventTypeSlug: varchar("event_type_slug", { length: 200 }),
    eventTypeTitle: varchar("event_type_title", { length: 300 }),
    username: varchar("username", { length: 200 }),
    timeZone: varchar("time_zone", { length: 100 }),
    webhookId: varchar("webhook_id", { length: 200 }),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    lastErrorCode: varchar("last_error_code", { length: 120 }),
    status: varchar("status", { length: 40 }).notNull().default("active"),
    isDefault: boolean("is_default").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "calendar_connections_workspace_fk",
    }).onDelete("cascade"),
    unique("calendar_connections_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("calendar_connections_workspace_default_uq")
      .on(table.workspaceId)
      .where(sql`${table.isDefault} = true and ${table.status} = 'active'`),
  ],
);

export const calendarMeetingTypes = pgTable(
  "calendar_meeting_types",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    providerEventTypeId: integer("provider_event_type_id").notNull(),
    slug: varchar("slug", { length: 200 }).notNull(),
    title: varchar("title", { length: 300 }).notNull(),
    lengthMinutes: integer("length_minutes").notNull(),
    bookingUrl: varchar("booking_url", { length: 2_000 }).notNull(),
    timeZone: varchar("time_zone", { length: 100 }).notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.connectionId], foreignColumns: [calendarConnections.workspaceId, calendarConnections.id], name: "calendar_meeting_types_connection_fk" }).onDelete("cascade"),
    unique("calendar_meeting_types_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("calendar_meeting_types_provider_uq").on(table.workspaceId, table.connectionId, table.providerEventTypeId),
    uniqueIndex("calendar_meeting_types_default_uq").on(table.workspaceId, table.connectionId).where(sql`${table.isDefault} = true and ${table.active} = true`),
  ],
);

export const calendarBookings = pgTable(
  "calendar_bookings",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    meetingTypeId: uuid("meeting_type_id"),
    providerBookingId: varchar("provider_booking_id", { length: 500 }).notNull(),
    contactId: uuid("contact_id"),
    campaignId: uuid("campaign_id"),
    opportunityId: uuid("opportunity_id"),
    status: varchar("status", { length: 40 }).notNull(),
    attendeeName: varchar("attendee_name", { length: 300 }),
    attendeeEmail: varchar("attendee_email", { length: 320 }),
    attendeePhone: varchar("attendee_phone", { length: 80 }),
    attendeeTimeZone: varchar("attendee_time_zone", { length: 100 }),
    organizerTimeZone: varchar("organizer_time_zone", { length: 100 }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }),
    meetingUrl: text("meeting_url"),
    cancellationReason: text("cancellation_reason"),
    noShowAt: timestamp("no_show_at", { withTimezone: true }),
    rescheduleCount: integer("reschedule_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.connectionId],
      foreignColumns: [calendarConnections.workspaceId, calendarConnections.id],
      name: "calendar_bookings_connection_fk",
    }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.meetingTypeId], foreignColumns: [calendarMeetingTypes.workspaceId, calendarMeetingTypes.id], name: "calendar_bookings_meeting_type_fk" }).onDelete("set null"),
    foreignKey({
      columns: [table.workspaceId, table.contactId],
      foreignColumns: [contacts.workspaceId, contacts.id],
      name: "calendar_bookings_contact_fk",
    }).onDelete("set null"),
    foreignKey({ columns: [table.workspaceId, table.opportunityId], foreignColumns: [opportunities.workspaceId, opportunities.id], name: "calendar_bookings_opportunity_fk" }),
    unique("calendar_bookings_workspace_id_uq").on(table.workspaceId, table.id),
    foreignKey({
      columns: [table.workspaceId, table.campaignId],
      foreignColumns: [campaigns.workspaceId, campaigns.id],
      name: "calendar_bookings_campaign_fk",
    }).onDelete("set null"),
    uniqueIndex("calendar_bookings_provider_uq").on(
      table.workspaceId,
      table.connectionId,
      table.providerBookingId,
    ),
    index("calendar_bookings_contact_idx").on(table.workspaceId, table.contactId, table.startAt),
  ],
);

export const calendarBookingHistory = pgTable(
  "calendar_booking_history",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    bookingId: uuid("booking_id").notNull(),
    action: varchar("action", { length: 40 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 500 }).notNull(),
    fromStatus: varchar("from_status", { length: 40 }),
    toStatus: varchar("to_status", { length: 40 }).notNull(),
    previousProviderBookingId: varchar("previous_provider_booking_id", { length: 500 }),
    newProviderBookingId: varchar("new_provider_booking_id", { length: 500 }),
    previousStartAt: timestamp("previous_start_at", { withTimezone: true }),
    newStartAt: timestamp("new_start_at", { withTimezone: true }),
    reason: text("reason"),
    actorUserId: uuid("actor_user_id").references(() => authUsers.id, { onDelete: "set null" }),
    source: varchar("source", { length: 80 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.bookingId], foreignColumns: [calendarBookings.workspaceId, calendarBookings.id], name: "calendar_booking_history_booking_fk" }).onDelete("cascade"),
    uniqueIndex("calendar_booking_history_idempotency_uq").on(table.workspaceId, table.bookingId, table.idempotencyKey),
    index("calendar_booking_history_timeline_idx").on(table.workspaceId, table.bookingId, table.createdAt),
  ],
);

export const meetingProposals = pgTable(
  "meeting_proposals",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    calendarBookingId: uuid("calendar_booking_id").references(() => calendarBookings.id, {
      onDelete: "set null",
    }),
    status: varchar("status", { length: 40 }).notNull().default("offered"),
    timeZone: varchar("time_zone", { length: 100 }).notNull(),
    slots: jsonb("slots").notNull(),
    selectedSlotStart: timestamp("selected_slot_start", { withTimezone: true }),
    idempotencyKey: varchar("idempotency_key", { length: 500 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "meeting_proposals_workspace_fk",
    }).onDelete("cascade"),
    uniqueIndex("meeting_proposals_idempotency_uq").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    uniqueIndex("meeting_proposals_active_conversation_uq")
      .on(table.workspaceId, table.conversationId)
      .where(sql`${table.status} = 'offered'`),
    index("meeting_proposals_conversation_idx").on(
      table.workspaceId,
      table.conversationId,
      table.createdAt,
    ),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    type: varchar("type", { length: 160 }).notNull(),
    payload: jsonb("payload").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 500 }).notNull(),
    correlationId: varchar("correlation_id", { length: 200 }).notNull(),
    status: jobStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lockedBy: varchar("locked_by", { length: 200 }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastErrorCode: varchar("last_error_code", { length: 120 }),
    lastErrorMessage: text("last_error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("jobs_workspace_type_idempotency_uq").on(
      table.workspaceId,
      table.type,
      table.idempotencyKey,
    ),
    index("jobs_lease_idx").on(table.status, table.availableAt, table.lockedUntil),
    index("jobs_workspace_status_idx").on(table.workspaceId, table.status),
  ],
);

export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    filename: varchar("filename", { length: 500 }).notNull(),
    fileHash: varchar("file_hash", { length: 64 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    mapping: jsonb("mapping").notNull().default({}),
    rawContent: text("raw_content").notNull(),
    rawExpiresAt: timestamp("raw_expires_at", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 40 }).notNull().default("uploaded"),
    previewedAt: timestamp("previewed_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    totals: jsonb("totals").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "import_batches_workspace_fk",
    }).onDelete("cascade"),
    unique("import_batches_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("import_batches_workspace_key_uq").on(table.workspaceId, table.idempotencyKey),
    index("import_batches_workspace_created_idx").on(table.workspaceId, table.createdAt),
  ],
);

export const importRows = pgTable(
  "import_rows",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    lineNumber: integer("line_number").notNull(),
    rawData: jsonb("raw_data").notNull().default({}),
    normalizedData: jsonb("normalized_data").notNull().default({}),
    rowFingerprint: varchar("row_fingerprint", { length: 64 }).notNull(),
    status: varchar("status", { length: 40 }).notNull().default("pending"),
    reason: varchar("reason", { length: 500 }),
    companyId: uuid("company_id"),
    contactId: uuid("contact_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "import_rows_workspace_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.batchId],
      foreignColumns: [importBatches.workspaceId, importBatches.id],
      name: "import_rows_batch_fk",
    }).onDelete("cascade"),
    unique("import_rows_workspace_line_uq").on(table.workspaceId, table.batchId, table.lineNumber),
    index("import_rows_batch_status_idx").on(table.workspaceId, table.batchId, table.status),
  ],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    aggregateType: varchar("aggregate_type", { length: 120 }).notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    eventType: varchar("event_type", { length: 160 }).notNull(),
    payload: jsonb("payload").notNull(),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("outbox_events_publish_idx").on(table.publishedAt, table.availableAt),
    index("outbox_events_workspace_idx").on(table.workspaceId, table.createdAt),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => authUsers.id, { onDelete: "set null" }),
    action: varchar("action", { length: 160 }).notNull(),
    subjectType: varchar("subject_type", { length: 120 }).notNull(),
    subjectId: uuid("subject_id").notNull(),
    changes: jsonb("changes").notNull().default({}),
    correlationId: varchar("correlation_id", { length: 200 }),
    sourceEventId: uuid("source_event_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("audit_logs_source_event_uq").on(table.sourceEventId),
    index("audit_logs_workspace_created_idx").on(table.workspaceId, table.createdAt),
    index("audit_logs_subject_idx").on(table.workspaceId, table.subjectType, table.subjectId),
  ],
);

export const connectedAccounts = pgTable(
  "connected_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 80 }).notNull(),
    providerAccountId: varchar("provider_account_id", { length: 300 }).notNull(),
    displayName: varchar("display_name", { length: 300 }),
    status: connectedAccountStatusEnum("status").notNull().default("pending"),
    capabilities: jsonb("capabilities").notNull().default({}),
    quotas: jsonb("quotas").notNull().default({}),
    encryptedSecret: text("encrypted_secret").notNull(),
    lastErrorCode: varchar("last_error_code", { length: 120 }),
    lastErrorMessage: varchar("last_error_message", { length: 500 }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("connected_accounts_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("connected_accounts_provider_account_uq").on(table.workspaceId, table.provider, table.providerAccountId),
    index("connected_accounts_workspace_status_idx").on(table.workspaceId, table.status),
  ],
);

export const connectedAccountWebhooks = pgTable(
  "connected_account_webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: varchar("provider", { length: 80 }).notNull(),
    eventId: varchar("event_id", { length: 300 }).notNull(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    connectedAccountId: uuid("connected_account_id").references(() => connectedAccounts.id, { onDelete: "set null" }),
    payload: jsonb("payload").notNull().default({}),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("connected_account_webhooks_provider_event_uq").on(table.provider, table.eventId),
    index("connected_account_webhooks_account_idx").on(table.connectedAccountId, table.createdAt),
  ],
);

export const connectionOnboardings = pgTable(
  "connection_onboardings",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 80 }).notNull().default("unipile"),
    channel: varchar("channel", { length: 40 }).notNull(),
    step: connectionOnboardingStepEnum("step").notNull().default("initiation"),
    status: connectionOnboardingStatusEnum("status").notNull().default("initiated"),
    hostedUrl: text("hosted_url"),
    providerAccountId: varchar("provider_account_id", { length: 300 }),
    result: jsonb("result").notNull().default({}),
    errorCode: varchar("error_code", { length: 120 }),
    errorMessage: varchar("error_message", { length: 500 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("connection_onboardings_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("connection_onboardings_active_channel_uq").on(table.workspaceId, table.channel).where(sql`${table.status} in ('initiated', 'awaiting_callback', 'verifying')`),
    index("connection_onboardings_workspace_status_idx").on(table.workspaceId, table.status, table.updatedAt),
  ],
);

export const accountHealthAlerts = pgTable(
  "account_health_alerts",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    connectedAccountId: uuid("connected_account_id").notNull().references(() => connectedAccounts.id, { onDelete: "cascade" }),
    episodeKey: varchar("episode_key", { length: 200 }).notNull(),
    status: accountHealthAlertStatusEnum("status").notNull().default("active"),
    reasonCode: varchar("reason_code", { length: 120 }),
    reasonMessage: varchar("reason_message", { length: 500 }),
    acknowledgedBy: uuid("acknowledged_by").references(() => authUsers.id, { onDelete: "set null" }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("account_health_alerts_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("account_health_alerts_account_episode_uq").on(table.connectedAccountId, table.episodeKey),
    index("account_health_alerts_workspace_status_idx").on(table.workspaceId, table.status, table.createdAt),
  ],
);
