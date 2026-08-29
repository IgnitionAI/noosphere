import { sql } from "drizzle-orm";
import {
  emptyProspectChannels,
  type ProspectChannels,
} from "@outbound/domain/crm/prospect-channels";
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  foreignKey,
  ForeignKeyBuilder,
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
} from "drizzle-orm/pg-core";

const unboundedVector = customType<{ data: number[]; driverData: string }>({
  dataType: () => "vector",
  toDriver: (value) => `[${value.join(",")}]`,
  fromDriver: (value) => value.slice(1, -1).split(",").map(Number),
});

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
export const embeddingModelStatusEnum = pgEnum("embedding_model_status", [
  "registered",
  "backfilling",
  "validating",
  "active",
  "retired",
  "failed",
]);
export const knowledgeDocumentSourceTypeEnum = pgEnum("knowledge_document_source_type", [
  "research_document",
  "knowledge_source",
  "offer",
  "proof",
]);
export const knowledgeIndexStatusEnum = pgEnum("knowledge_index_status", [
  "building",
  "ready",
  "validating",
  "active",
  "failed",
  "retired",
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
  "partial",
  "ocr_required",
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
export const editorialStrategyStatusEnum = pgEnum("editorial_strategy_status", [
  "draft",
  "active",
  "archived",
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
  modelRouting: jsonb("model_routing"),
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
  memoryEventsRetentionDays: integer("memory_events_retention_days").notNull().default(365),
  memorySnapshotsRetentionDays: integer("memory_snapshots_retention_days").notNull().default(90),
  memoryReceiptsRetentionDays: integer("memory_receipts_retention_days").notNull().default(90),
  updatedBy: uuid("updated_by").references(() => authUsers.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workspaceProspectMemorySettings = pgTable(
  "workspace_prospect_memory_settings",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    captureEnabled: boolean("capture_enabled").notNull().default(false),
    shadowEnabled: boolean("shadow_enabled").notNull().default(false),
    setterEnabled: boolean("setter_enabled").notNull().default(false),
    enabledCapabilities: jsonb("enabled_capabilities").notNull().default([]),
    processingProfiles: jsonb("processing_profiles").notNull().default([]),
    maxDailySemanticRefreshes: integer("max_daily_semantic_refreshes").notNull().default(1_000),
    maxDailyCostUsd: numeric("max_daily_cost_usd", { precision: 12, scale: 4 }).notNull().default("10"),
    updatedBy: uuid("updated_by").references(() => authUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("workspace_prospect_memory_refresh_budget_ck", sql`${table.maxDailySemanticRefreshes} >= 0`),
    check("workspace_prospect_memory_cost_budget_ck", sql`${table.maxDailyCostUsd} >= 0`),
  ],
);

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
    contentGenerationRunId: uuid("content_generation_run_id"),
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
    extractionProvider: varchar("extraction_provider", { length: 40 }),
    extractionDurationMs: integer("extraction_duration_ms"),
    extractionMetrics: jsonb("extraction_metrics").notNull().default(sql`'{}'::jsonb`),
    extractionWarnings: jsonb("extraction_warnings").notNull().default(sql`'[]'::jsonb`),
    extractedAt: timestamp("extracted_at", { withTimezone: true }),
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

export const embeddingModelRevisions = pgTable(
  "embedding_model_revisions",
  {
    id: uuid("id").primaryKey(),
    provider: varchar("provider", { length: 40 }).notNull(),
    modelId: varchar("model_id", { length: 300 }).notNull(),
    modelSha: varchar("model_sha", { length: 64 }).notNull(),
    runtimeArtifactModelId: varchar("runtime_artifact_model_id", { length: 300 }).notNull(),
    runtimeArtifactSha: varchar("runtime_artifact_sha", { length: 64 }).notNull(),
    dimension: integer("dimension").notNull(),
    distanceMetric: varchar("distance_metric", { length: 40 }).notNull().default("cosine"),
    normalized: boolean("normalized").notNull().default(true),
    queryInstruction: text("query_instruction").notNull(),
    configuration: jsonb("configuration").notNull().default(sql`'{}'::jsonb`),
    configurationHash: varchar("configuration_hash", { length: 64 }).notNull(),
    vectorIndexName: varchar("vector_index_name", { length: 63 }),
    status: embeddingModelStatusEnum("status").notNull().default("registered"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    retireAfter: timestamp("retire_after", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("embedding_model_revisions_identity_uq").on(table.provider, table.modelId, table.modelSha, table.configurationHash),
    check("embedding_model_revisions_dimension_ck", sql`${table.dimension} between 1 and 4096`),
    check("embedding_model_revisions_metric_ck", sql`${table.distanceMetric} = 'cosine'`),
  ],
);

export const knowledgeSearchRuntime = pgTable("knowledge_search_runtime", {
  singleton: boolean("singleton").primaryKey().default(true),
  activeModelRevisionId: uuid("active_model_revision_id").notNull().references(() => embeddingModelRevisions.id, { onDelete: "restrict" }),
  rerankerModelId: varchar("reranker_model_id", { length: 300 }).notNull(),
  rerankerModelSha: varchar("reranker_model_sha", { length: 64 }).notNull(),
  rerankerRuntimeArtifactModelId: varchar("reranker_runtime_artifact_model_id", { length: 300 }).notNull(),
  rerankerRuntimeArtifactSha: varchar("reranker_runtime_artifact_sha", { length: 64 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [check("knowledge_search_runtime_singleton_ck", sql`${table.singleton} = true`)]);

export const knowledgeDocuments = pgTable(
  "knowledge_documents",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    sourceType: knowledgeDocumentSourceTypeEnum("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    format: varchar("format", { length: 100 }).notNull(),
    language: varchar("language", { length: 20 }),
    validationStatus: varchar("validation_status", { length: 40 }).notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    offerId: uuid("offer_id"),
    icpId: uuid("icp_id"),
    runId: uuid("run_id"),
    tags: jsonb("tags").notNull().default(sql`'[]'::jsonb`),
    sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("knowledge_documents_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("knowledge_documents_source_uq").on(table.workspaceId, table.sourceType, table.sourceId),
    index("knowledge_documents_filters_idx").on(table.workspaceId, table.validationStatus, table.sourceType, table.format),
    index("knowledge_documents_offer_icp_run_idx").on(table.workspaceId, table.offerId, table.icpId, table.runId),
  ],
);

export const knowledgeChunkSets = pgTable(
  "knowledge_chunk_sets",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    documentId: uuid("document_id").notNull(),
    chunkerId: varchar("chunker_id", { length: 100 }).notNull(),
    chunkerVersion: varchar("chunker_version", { length: 40 }).notNull(),
    configuration: jsonb("configuration").notNull(),
    configurationHash: varchar("configuration_hash", { length: 64 }).notNull(),
    sourceContentHash: varchar("source_content_hash", { length: 64 }).notNull(),
    status: knowledgeIndexStatusEnum("status").notNull().default("building"),
    chunkCount: integer("chunk_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.documentId], foreignColumns: [knowledgeDocuments.workspaceId, knowledgeDocuments.id], name: "knowledge_chunk_sets_workspace_document_fk" }).onDelete("cascade"),
    unique("knowledge_chunk_sets_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("knowledge_chunk_sets_revision_uq").on(table.workspaceId, table.documentId, table.chunkerId, table.chunkerVersion, table.configurationHash, table.sourceContentHash),
    index("knowledge_chunk_sets_active_idx").on(table.workspaceId, table.documentId, table.status),
  ],
);

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    documentId: uuid("document_id").notNull(),
    chunkSetId: uuid("chunk_set_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    locator: varchar("locator", { length: 500 }),
    title: varchar("title", { length: 500 }),
    content: text("content").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    tokenCount: integer("token_count").notNull(),
    language: varchar("language", { length: 20 }),
    sourceType: knowledgeDocumentSourceTypeEnum("source_type").notNull(),
    format: varchar("format", { length: 100 }).notNull(),
    validationStatus: varchar("validation_status", { length: 40 }).notNull(),
    offerId: uuid("offer_id"),
    icpId: uuid("icp_id"),
    runId: uuid("run_id"),
    tags: jsonb("tags").notNull().default(sql`'[]'::jsonb`),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.documentId], foreignColumns: [knowledgeDocuments.workspaceId, knowledgeDocuments.id], name: "knowledge_chunks_workspace_document_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.chunkSetId], foreignColumns: [knowledgeChunkSets.workspaceId, knowledgeChunkSets.id], name: "knowledge_chunks_workspace_set_fk" }).onDelete("cascade"),
    unique("knowledge_chunks_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("knowledge_chunks_ordinal_uq").on(table.workspaceId, table.chunkSetId, table.ordinal),
    index("knowledge_chunks_filters_idx").on(table.workspaceId, table.validationStatus, table.sourceType, table.format),
    index("knowledge_chunks_document_idx").on(table.workspaceId, table.documentId, table.chunkSetId),
  ],
);

export const knowledgeChunkEmbeddings = pgTable(
  "knowledge_chunk_embeddings",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    chunkId: uuid("chunk_id").notNull(),
    modelRevisionId: uuid("model_revision_id").notNull().references(() => embeddingModelRevisions.id, { onDelete: "cascade" }),
    embedding: unboundedVector("embedding").notNull(),
    dimension: integer("dimension").notNull(),
    inputHash: varchar("input_hash", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.chunkId], foreignColumns: [knowledgeChunks.workspaceId, knowledgeChunks.id], name: "knowledge_chunk_embeddings_workspace_chunk_fk" }).onDelete("cascade"),
    uniqueIndex("knowledge_chunk_embeddings_revision_uq").on(table.workspaceId, table.chunkId, table.modelRevisionId),
    index("knowledge_chunk_embeddings_workspace_revision_idx").on(table.workspaceId, table.modelRevisionId),
    check("knowledge_chunk_embeddings_dimension_ck", sql`vector_dims(${table.embedding}) = ${table.dimension}`),
  ],
);

export const embeddingReindexRuns = pgTable("embedding_reindex_runs", {
  id: uuid("id").primaryKey(),
  modelRevisionId: uuid("model_revision_id").notNull().references(() => embeddingModelRevisions.id, { onDelete: "restrict" }),
  status: knowledgeIndexStatusEnum("status").notNull().default("building"),
  eligibleChunks: integer("eligible_chunks").notNull().default(0),
  embeddedChunks: integer("embedded_chunks").notNull().default(0),
  failedChunks: integer("failed_chunks").notNull().default(0),
  checkpoint: jsonb("checkpoint").notNull().default(sql`'{}'::jsonb`),
  qualityMetrics: jsonb("quality_metrics").notNull().default(sql`'{}'::jsonb`),
  capacityMetrics: jsonb("capacity_metrics").notNull().default(sql`'{}'::jsonb`),
  correlationId: varchar("correlation_id", { length: 200 }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
});

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

export const editorialStrategies = pgTable(
  "editorial_strategies",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    name: varchar("name", { length: 500 }).notNull(),
    offerId: uuid("offer_id").notNull(),
    offerVersionId: uuid("offer_version_id").notNull(),
    icpId: uuid("icp_id").notNull(),
    icpVersionId: uuid("icp_version_id").notNull(),
    status: editorialStrategyStatusEnum("status").notNull().default("draft"),
    currentVersion: integer("current_version").notNull().default(0),
    draft: jsonb("draft").notNull(),
    provider: varchar("provider", { length: 120 }).notNull(),
    model: varchar("model", { length: 200 }).notNull(),
    promptVersion: varchar("prompt_version", { length: 120 }).notNull(),
    aiRunId: uuid("ai_run_id"),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.offerId], foreignColumns: [offers.workspaceId, offers.id], name: "editorial_strategies_workspace_offer_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.workspaceId, table.offerVersionId], foreignColumns: [offerVersions.workspaceId, offerVersions.id], name: "editorial_strategies_workspace_offer_version_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.workspaceId, table.icpId], foreignColumns: [icps.workspaceId, icps.id], name: "editorial_strategies_workspace_icp_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.workspaceId, table.icpVersionId], foreignColumns: [icpVersions.workspaceId, icpVersions.id], name: "editorial_strategies_workspace_icp_version_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.workspaceId, table.aiRunId], foreignColumns: [aiRuns.workspaceId, aiRuns.id], name: "editorial_strategies_workspace_ai_run_fk" }).onDelete("set null"),
    unique("editorial_strategies_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("editorial_strategies_workspace_grounding_uq")
      .on(table.workspaceId, table.offerId, table.icpId)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export const editorialStrategyVersions = pgTable(
  "editorial_strategy_versions",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    strategyId: uuid("strategy_id").notNull(),
    version: integer("version").notNull(),
    offerVersionId: uuid("offer_version_id").notNull(),
    icpVersionId: uuid("icp_version_id").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    provider: varchar("provider", { length: 120 }).notNull(),
    model: varchar("model", { length: 200 }).notNull(),
    promptVersion: varchar("prompt_version", { length: 120 }).notNull(),
    aiRunId: uuid("ai_run_id"),
    publishedBy: uuid("published_by").references(() => authUsers.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.strategyId], foreignColumns: [editorialStrategies.workspaceId, editorialStrategies.id], name: "editorial_strategy_versions_workspace_strategy_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.workspaceId, table.offerVersionId], foreignColumns: [offerVersions.workspaceId, offerVersions.id], name: "editorial_strategy_versions_workspace_offer_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.workspaceId, table.icpVersionId], foreignColumns: [icpVersions.workspaceId, icpVersions.id], name: "editorial_strategy_versions_workspace_icp_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.workspaceId, table.aiRunId], foreignColumns: [aiRuns.workspaceId, aiRuns.id], name: "editorial_strategy_versions_workspace_ai_run_fk" }).onDelete("set null"),
    unique("editorial_strategy_versions_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("editorial_strategy_versions_strategy_version_uq").on(table.workspaceId, table.strategyId, table.version),
  ],
);

export const editorialLearningVersions = pgTable(
  "editorial_learning_versions",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    strategyId: uuid("strategy_id").notNull(),
    strategyVersionId: uuid("strategy_version_id").notNull(),
    version: integer("version").notNull(),
    inputHash: varchar("input_hash", { length: 64 }).notNull(),
    facts: jsonb("facts").notNull(),
    inferences: jsonb("inferences").notNull(),
    recommendations: jsonb("recommendations").notNull(),
    bounds: jsonb("bounds").notNull(),
    modelVersion: varchar("model_version", { length: 120 }).notNull(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
    windowEndedAt: timestamp("window_ended_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.strategyId], foreignColumns: [editorialStrategies.workspaceId, editorialStrategies.id], name: "editorial_learning_versions_workspace_strategy_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.strategyVersionId], foreignColumns: [editorialStrategyVersions.workspaceId, editorialStrategyVersions.id], name: "editorial_learning_versions_workspace_strategy_version_fk" }).onDelete("restrict"),
    unique("editorial_learning_versions_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("editorial_learning_versions_strategy_version_uq").on(table.workspaceId, table.strategyId, table.version),
    uniqueIndex("editorial_learning_versions_input_uq").on(table.workspaceId, table.strategyVersionId, table.inputHash),
    index("editorial_learning_versions_latest_idx").on(table.workspaceId, table.strategyId, table.version),
    check("editorial_learning_versions_window_ck", sql`${table.windowEndedAt} >= ${table.windowStartedAt}`),
  ],
);

export const contentOperationRequests = pgTable(
  "content_operation_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    operation: varchar("operation", { length: 120 }).notNull(),
    requestKey: varchar("request_key", { length: 300 }).notNull(),
    resourceType: varchar("resource_type", { length: 120 }).notNull(),
    resourceId: uuid("resource_id").notNull(),
    response: jsonb("response").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("content_operation_requests_workspace_key_uq").on(table.workspaceId, table.operation, table.requestKey),
  ],
);

export const contentIdeaDiscoveryRuns = pgTable(
  "content_idea_discovery_runs",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    strategyVersionId: uuid("strategy_version_id").notNull(),
    trigger: varchar("trigger", { length: 20 }).notNull(),
    status: varchar("status", { length: 40 }).notNull().default("queued"),
    queryPlan: jsonb("query_plan").notNull(),
    cursor: integer("cursor").notNull().default(0),
    queryCount: integer("query_count").notNull().default(0),
    sourceCount: integer("source_count").notNull().default(0),
    ideaCount: integer("idea_count").notNull().default(0),
    queryLimit: integer("query_limit").notNull(),
    sourceLimit: integer("source_limit").notNull(),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    lastErrorCode: varchar("last_error_code", { length: 160 }),
    lastErrorMessage: text("last_error_message"),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.strategyVersionId], foreignColumns: [editorialStrategyVersions.workspaceId, editorialStrategyVersions.id], name: "content_idea_runs_workspace_strategy_version_fk" }).onDelete("restrict"),
    unique("content_idea_runs_workspace_id_uq").on(table.workspaceId, table.id),
    check("content_idea_runs_trigger_ck", sql`${table.trigger} in ('manual', 'daily')`),
    check("content_idea_runs_status_ck", sql`${table.status} in ('queued', 'running', 'completed', 'partial', 'failed')`),
    check("content_idea_runs_budget_ck", sql`${table.queryLimit} > 0 and ${table.sourceLimit} > 0`),
  ],
);

export const contentIdeas = pgTable(
  "content_ideas",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    strategyVersionId: uuid("strategy_version_id").notNull(),
    status: varchar("status", { length: 40 }).notNull().default("discovered"),
    angle: varchar("angle", { length: 500 }).notNull(),
    rationale: text("rationale").notNull(),
    audience: varchar("audience", { length: 500 }).notNull(),
    pillar: varchar("pillar", { length: 300 }).notNull(),
    priority: integer("priority").notNull(),
    fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
    freshnessUntil: timestamp("freshness_until", { withTimezone: true }).notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.strategyVersionId], foreignColumns: [editorialStrategyVersions.workspaceId, editorialStrategyVersions.id], name: "content_ideas_workspace_strategy_version_fk" }).onDelete("restrict"),
    unique("content_ideas_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("content_ideas_workspace_fingerprint_uq").on(table.workspaceId, table.fingerprint),
    check("content_ideas_status_ck", sql`${table.status} in ('discovered', 'shortlisted', 'briefed', 'discarded', 'expired')`),
    check("content_ideas_priority_ck", sql`${table.priority} between 0 and 100`),
  ],
);

export const contentIdeaSources = pgTable(
  "content_idea_sources",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    ideaId: uuid("idea_id").notNull(),
    runId: uuid("run_id").notNull(),
    type: varchar("type", { length: 40 }).notNull(),
    sourceRef: varchar("source_ref", { length: 500 }).notNull(),
    canonicalUrl: text("canonical_url"),
    title: varchar("title", { length: 500 }).notNull(),
    excerpt: text("excerpt").notNull(),
    contentHash: varchar("content_hash", { length: 128 }).notNull(),
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.ideaId], foreignColumns: [contentIdeas.workspaceId, contentIdeas.id], name: "content_idea_sources_workspace_idea_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.runId], foreignColumns: [contentIdeaDiscoveryRuns.workspaceId, contentIdeaDiscoveryRuns.id], name: "content_idea_sources_workspace_run_fk" }).onDelete("restrict"),
    uniqueIndex("content_idea_sources_idea_hash_uq").on(table.workspaceId, table.ideaId, table.contentHash),
    check("content_idea_sources_type_ck", sql`${table.type} in ('offer_claim', 'knowledge_claim', 'conversation_message', 'public_web')`),
  ],
);

export const contentIdeaSchedules = pgTable(
  "content_idea_schedules",
  {
    workspaceId: uuid("workspace_id").primaryKey().references(() => workspaces.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    localTime: varchar("local_time", { length: 5 }).notNull().default("06:00"),
    timezone: varchar("timezone", { length: 120 }).notNull().default("Europe/Paris"),
    publicationTimes: varchar("publication_times", { length: 5 }).array(),
    publicationDays: integer("publication_days").array(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("content_idea_schedules_local_time_ck", sql`${table.localTime} ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'`),
    check("content_idea_schedules_publication_times_ck", sql`${table.publicationTimes} is null or (cardinality(${table.publicationTimes}) between 1 and 2 and array_to_string(${table.publicationTimes}, ',') ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9](,(?:[01][0-9]|2[0-3]):[0-5][0-9])?$')`),
    check("content_idea_schedules_publication_days_ck", sql`${table.publicationDays} is null or (cardinality(${table.publicationDays}) between 1 and 7 and ${table.publicationDays} <@ array[1,2,3,4,5,6,7])`),
  ],
);

export const contentBrandKits = pgTable(
  "content_brand_kits",
  {
    workspaceId: uuid("workspace_id").primaryKey().references(() => workspaces.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    snapshot: jsonb("snapshot").notNull(),
    updatedBy: uuid("updated_by").references(() => authUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("content_brand_kits_version_ck", sql`${table.version} > 0`),
  ],
);

export const contentAssets = pgTable(
  "content_assets",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    ideaId: uuid("idea_id").notNull(),
    type: varchar("type", { length: 40 }).notNull().default("linkedin_text"),
    status: varchar("status", { length: 40 }).notNull().default("draft"),
    latestVersion: integer("latest_version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.ideaId], foreignColumns: [contentIdeas.workspaceId, contentIdeas.id], name: "content_assets_workspace_idea_fk" }).onDelete("restrict"),
    unique("content_assets_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("content_assets_workspace_idea_type_uq").on(table.workspaceId, table.ideaId, table.type),
    check("content_assets_type_ck", sql`${table.type} in ('linkedin_text', 'linkedin_image', 'linkedin_document', 'linkedin_video')`),
    check("content_assets_status_ck", sql`${table.status} in ('draft', 'ready', 'blocked')`),
  ],
);

export const contentGenerationRuns = pgTable(
  "content_generation_runs",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    ideaId: uuid("idea_id").notNull(),
    assetId: uuid("asset_id").notNull(),
    strategyVersionId: uuid("strategy_version_id").notNull(),
    assetVersionId: uuid("asset_version_id"),
    status: varchar("status", { length: 40 }).notNull().default("queued"),
    stage: varchar("stage", { length: 40 }).notNull().default("brief"),
    instruction: text("instruction"),
    briefSnapshot: jsonb("brief_snapshot"),
    draftSnapshot: jsonb("draft_snapshot"),
    auditSnapshot: jsonb("audit_snapshot"),
    critiqueSnapshot: jsonb("critique_snapshot"),
    lastErrorCode: varchar("last_error_code", { length: 160 }),
    lastErrorMessage: text("last_error_message"),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.ideaId], foreignColumns: [contentIdeas.workspaceId, contentIdeas.id], name: "content_generation_runs_workspace_idea_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.workspaceId, table.assetId], foreignColumns: [contentAssets.workspaceId, contentAssets.id], name: "content_generation_runs_workspace_asset_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.workspaceId, table.strategyVersionId], foreignColumns: [editorialStrategyVersions.workspaceId, editorialStrategyVersions.id], name: "content_generation_runs_workspace_strategy_fk" }).onDelete("restrict"),
    unique("content_generation_runs_workspace_id_uq").on(table.workspaceId, table.id),
    check("content_generation_runs_status_ck", sql`${table.status} in ('queued', 'running', 'ready', 'blocked', 'failed')`),
    check("content_generation_runs_stage_ck", sql`${table.stage} in ('brief', 'writer', 'audit', 'critic', 'completed')`),
  ],
);

export const contentBriefs = pgTable(
  "content_briefs",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull(),
    ideaId: uuid("idea_id").notNull(),
    strategyVersionId: uuid("strategy_version_id").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    evidenceSnapshot: jsonb("evidence_snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.runId], foreignColumns: [contentGenerationRuns.workspaceId, contentGenerationRuns.id], name: "content_briefs_workspace_run_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.workspaceId, table.ideaId], foreignColumns: [contentIdeas.workspaceId, contentIdeas.id], name: "content_briefs_workspace_idea_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.workspaceId, table.strategyVersionId], foreignColumns: [editorialStrategyVersions.workspaceId, editorialStrategyVersions.id], name: "content_briefs_workspace_strategy_fk" }).onDelete("restrict"),
    unique("content_briefs_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("content_briefs_workspace_run_uq").on(table.workspaceId, table.runId),
  ],
);

export const contentAssetVersions = pgTable(
  "content_asset_versions",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").notNull(),
    briefId: uuid("brief_id").notNull(),
    generationRunId: uuid("generation_run_id").notNull(),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    draft: jsonb("draft").notNull(),
    audit: jsonb("audit").notNull(),
    critique: jsonb("critique").notNull(),
    readiness: jsonb("readiness").notNull(),
    ready: boolean("ready").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.assetId], foreignColumns: [contentAssets.workspaceId, contentAssets.id], name: "content_asset_versions_workspace_asset_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.workspaceId, table.briefId], foreignColumns: [contentBriefs.workspaceId, contentBriefs.id], name: "content_asset_versions_workspace_brief_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.workspaceId, table.generationRunId], foreignColumns: [contentGenerationRuns.workspaceId, contentGenerationRuns.id], name: "content_asset_versions_workspace_run_fk" }).onDelete("restrict"),
    unique("content_asset_versions_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("content_asset_versions_workspace_asset_version_uq").on(table.workspaceId, table.assetId, table.version),
    uniqueIndex("content_asset_versions_workspace_run_uq").on(table.workspaceId, table.generationRunId),
    check("content_asset_versions_version_ck", sql`${table.version} > 0`),
  ],
);

export const contentMediaAssets = pgTable(
  "content_media_assets",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    assetVersionId: uuid("asset_version_id").notNull(),
    kind: varchar("kind", { length: 40 }).notNull(),
    objectKey: text("object_key").notNull(),
    mimeType: varchar("mime_type", { length: 120 }).notNull(),
    filename: varchar("filename", { length: 300 }).notNull(),
    checksumSha256: varchar("checksum_sha256", { length: 64 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    pageCount: integer("page_count"),
    durationSeconds: integer("duration_seconds"),
    altText: varchar("alt_text", { length: 500 }).notNull(),
    renderManifest: jsonb("render_manifest").notNull(),
    provenance: jsonb("provenance").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.assetVersionId], foreignColumns: [contentAssetVersions.workspaceId, contentAssetVersions.id], name: "content_media_assets_workspace_version_fk" }).onDelete("cascade"),
    unique("content_media_assets_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("content_media_assets_workspace_version_uq").on(table.workspaceId, table.assetVersionId),
    uniqueIndex("content_media_assets_workspace_checksum_uq").on(table.workspaceId, table.assetVersionId, table.checksumSha256),
    check("content_media_assets_kind_ck", sql`${table.kind} in ('image', 'document', 'video')`),
    check("content_media_assets_mime_ck", sql`${table.mimeType} in ('image/png', 'application/pdf', 'video/mp4')`),
    check("content_media_assets_size_ck", sql`${table.sizeBytes} > 0 and ${table.sizeBytes} <= 104857600`),
    check("content_media_assets_dimensions_ck", sql`(${table.width} is null or ${table.width} > 0) and (${table.height} is null or ${table.height} > 0) and (${table.pageCount} is null or ${table.pageCount} > 0) and (${table.durationSeconds} is null or ${table.durationSeconds} > 0)`),
  ],
);

export const contentPublications = pgTable(
  "content_publications",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").notNull(),
    assetVersionId: uuid("asset_version_id").notNull(),
    network: varchar("network", { length: 40 }).notNull().default("linkedin"),
    provider: varchar("provider", { length: 80 }).notNull().default("unipile"),
    status: varchar("status", { length: 40 }).notNull().default("scheduled"),
    requestKey: varchar("request_key", { length: 300 }).notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    contentSnapshot: jsonb("content_snapshot").notNull(),
    policySnapshot: jsonb("policy_snapshot").notNull(),
    accountSnapshot: jsonb("account_snapshot").notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(4),
    providerPostId: text("provider_post_id"),
    providerSocialId: text("provider_social_id"),
    providerUrl: text("provider_url"),
    lastErrorCode: varchar("last_error_code", { length: 160 }),
    lastErrorMessage: text("last_error_message"),
    executionToken: uuid("execution_token"),
    publishStartedAt: timestamp("publish_started_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    unknownAt: timestamp("unknown_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.assetId], foreignColumns: [contentAssets.workspaceId, contentAssets.id], name: "content_publications_workspace_asset_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.workspaceId, table.assetVersionId], foreignColumns: [contentAssetVersions.workspaceId, contentAssetVersions.id], name: "content_publications_workspace_asset_version_fk" }).onDelete("restrict"),
    unique("content_publications_workspace_id_uq").on(table.workspaceId, table.id),
    unique("content_publications_workspace_request_uq").on(table.workspaceId, table.requestKey),
    check("content_publications_network_ck", sql`${table.network} in ('linkedin')`),
    check("content_publications_status_ck", sql`${table.status} in ('scheduled', 'retry', 'publishing', 'published', 'unknown', 'failed', 'cancelled')`),
    check("content_publications_attempts_ck", sql`${table.attempts} >= 0 and ${table.maxAttempts} > 0 and ${table.attempts} <= ${table.maxAttempts}`),
  ],
);

export const contentPublicationAttempts = pgTable(
  "content_publication_attempts",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    publicationId: uuid("publication_id").notNull(),
    attempt: integer("attempt").notNull(),
    executionToken: uuid("execution_token").notNull(),
    status: varchar("status", { length: 40 }).notNull().default("started"),
    requestSnapshot: jsonb("request_snapshot").notNull(),
    providerPostId: text("provider_post_id"),
    providerSocialId: text("provider_social_id"),
    providerUrl: text("provider_url"),
    errorCode: varchar("error_code", { length: 160 }),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.publicationId], foreignColumns: [contentPublications.workspaceId, contentPublications.id], name: "content_publication_attempts_workspace_publication_fk" }).onDelete("cascade"),
    unique("content_publication_attempts_workspace_token_uq").on(table.workspaceId, table.executionToken),
    unique("content_publication_attempts_workspace_number_uq").on(table.workspaceId, table.publicationId, table.attempt),
    check("content_publication_attempts_status_ck", sql`${table.status} in ('started', 'published', 'not_sent', 'unknown', 'failed')`),
    check("content_publication_attempts_attempt_ck", sql`${table.attempt} > 0`),
  ],
);

export const contentPublicationReconciliations = pgTable(
  "content_publication_reconciliations",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    publicationId: uuid("publication_id").notNull(),
    status: varchar("status", { length: 40 }).notNull().default("pending"),
    criteriaSnapshot: jsonb("criteria_snapshot").notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(18),
    leaseToken: uuid("lease_token"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    candidatesCount: integer("candidates_count").notNull().default(0),
    matchedProviderPostId: text("matched_provider_post_id"),
    matchedProviderSocialId: text("matched_provider_social_id"),
    matchedProviderUrl: text("matched_provider_url"),
    matchedPublishedAt: timestamp("matched_published_at", { withTimezone: true }),
    lastErrorCode: varchar("last_error_code", { length: 160 }),
    lastErrorMessage: text("last_error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.publicationId], foreignColumns: [contentPublications.workspaceId, contentPublications.id], name: "content_publication_reconciliations_workspace_publication_fk" }).onDelete("cascade"),
    unique("content_publication_reconciliations_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("content_publication_reconciliations_publication_uq").on(table.workspaceId, table.publicationId),
    index("content_publication_reconciliations_due_idx").on(table.status, table.nextAttemptAt),
    check("content_publication_reconciliations_status_ck", sql`${table.status} in ('pending', 'searching', 'matched', 'not_found', 'ambiguous', 'error')`),
    check("content_publication_reconciliations_attempts_ck", sql`${table.attempts} >= 0 and ${table.maxAttempts} > 0 and ${table.attempts} <= ${table.maxAttempts}`),
    check("content_publication_reconciliations_candidates_ck", sql`${table.candidatesCount} >= 0`),
  ],
);

export const socialContentSyncStates = pgTable(
  "social_content_sync_states",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    connectedAccountId: uuid("connected_account_id").notNull().references(() => connectedAccounts.id, { onDelete: "cascade" }),
    providerAccountId: varchar("provider_account_id", { length: 300 }).notNull(),
    cursor: text("cursor"),
    highWatermark: timestamp("high_watermark", { withTimezone: true }),
    backfillComplete: boolean("backfill_complete").notNull().default(false),
    status: varchar("status", { length: 40 }).notNull().default("idle"),
    leaseToken: uuid("lease_token"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    nextSyncAt: timestamp("next_sync_at", { withTimezone: true }).notNull(),
    lastErrorCode: varchar("last_error_code", { length: 160 }),
    lastErrorMessage: text("last_error_message"),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("social_content_sync_states_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("social_content_sync_states_account_uq").on(table.workspaceId, table.connectedAccountId),
    check("social_content_sync_states_status_ck", sql`${table.status} in ('idle', 'syncing', 'error')`),
  ],
);

export const socialContentItems = pgTable(
  "social_content_items",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    connectedAccountId: uuid("connected_account_id").notNull().references(() => connectedAccounts.id, { onDelete: "cascade" }),
    providerAccountId: varchar("provider_account_id", { length: 300 }).notNull(),
    publicationId: uuid("publication_id"),
    network: varchar("network", { length: 40 }).notNull().default("linkedin"),
    provider: varchar("provider", { length: 80 }).notNull().default("unipile"),
    origin: varchar("origin", { length: 40 }).notNull(),
    providerPostId: text("provider_post_id").notNull(),
    socialId: text("social_id"),
    authorProviderId: text("author_provider_id"),
    text: text("text").notNull(),
    url: text("url"),
    status: varchar("status", { length: 40 }).notNull().default("observed"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    impressions: integer("impressions"),
    reactions: integer("reactions"),
    comments: integer("comments"),
    reposts: integer("reposts"),
    metricsObservedAt: timestamp("metrics_observed_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.publicationId], foreignColumns: [contentPublications.workspaceId, contentPublications.id], name: "social_content_items_workspace_publication_fk" }).onDelete("cascade"),
    unique("social_content_items_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("social_content_items_account_post_uq").on(table.workspaceId, table.connectedAccountId, table.providerPostId),
    check("social_content_items_network_ck", sql`${table.network} in ('linkedin')`),
    check("social_content_items_origin_ck", sql`${table.origin} in ('internal', 'external')`),
    check("social_content_items_status_ck", sql`${table.status} in ('observed', 'unavailable')`),
    check("social_content_items_metrics_ck", sql`(${table.impressions} is null or ${table.impressions} >= 0) and (${table.reactions} is null or ${table.reactions} >= 0) and (${table.comments} is null or ${table.comments} >= 0) and (${table.reposts} is null or ${table.reposts} >= 0)`),
  ],
);

export const contentMetricSnapshots = pgTable(
  "content_metric_snapshots",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    socialContentId: uuid("social_content_id").notNull(),
    providerPostId: text("provider_post_id").notNull(),
    impressions: integer("impressions"),
    reactions: integer("reactions"),
    comments: integer("comments"),
    reposts: integer("reposts"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.socialContentId], foreignColumns: [socialContentItems.workspaceId, socialContentItems.id], name: "content_metric_snapshots_workspace_content_fk" }).onDelete("cascade"),
    uniqueIndex("content_metric_snapshots_content_observed_uq").on(table.workspaceId, table.socialContentId, table.observedAt),
    check("content_metric_snapshots_metrics_ck", sql`(${table.impressions} is null or ${table.impressions} >= 0) and (${table.reactions} is null or ${table.reactions} >= 0) and (${table.comments} is null or ${table.comments} >= 0) and (${table.reposts} is null or ${table.reposts} >= 0)`),
  ],
);

export const socialInteractionSyncStates = pgTable(
  "social_interaction_sync_states",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    socialContentId: uuid("social_content_id").notNull(),
    connectedAccountId: uuid("connected_account_id").notNull().references(() => connectedAccounts.id, { onDelete: "cascade" }),
    providerAccountId: varchar("provider_account_id", { length: 300 }).notNull(),
    providerSocialId: text("provider_social_id").notNull(),
    ownerProviderId: text("owner_provider_id"),
    kind: varchar("kind", { length: 40 }).notNull(),
    scopeKey: text("scope_key").notNull(),
    parentProviderInteractionId: text("parent_provider_interaction_id"),
    cursor: text("cursor"),
    scanToken: uuid("scan_token"),
    status: varchar("status", { length: 40 }).notNull().default("idle"),
    leaseToken: uuid("lease_token"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    nextSyncAt: timestamp("next_sync_at", { withTimezone: true }).notNull(),
    lastErrorCode: varchar("last_error_code", { length: 160 }),
    lastErrorMessage: text("last_error_message"),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.socialContentId], foreignColumns: [socialContentItems.workspaceId, socialContentItems.id], name: "social_interaction_sync_states_workspace_content_fk" }).onDelete("cascade"),
    unique("social_interaction_sync_states_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("social_interaction_sync_states_scope_uq").on(table.workspaceId, table.socialContentId, table.kind, table.scopeKey),
    check("social_interaction_sync_states_kind_ck", sql`${table.kind} in ('comments', 'reactions')`),
    check("social_interaction_sync_states_status_ck", sql`${table.status} in ('idle', 'syncing', 'error')`),
  ],
);

export const socialInteractions = pgTable(
  "social_interactions",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    socialContentId: uuid("social_content_id").notNull(),
    connectedAccountId: uuid("connected_account_id").notNull().references(() => connectedAccounts.id, { onDelete: "cascade" }),
    providerAccountId: varchar("provider_account_id", { length: 300 }).notNull(),
    network: varchar("network", { length: 40 }).notNull().default("linkedin"),
    provider: varchar("provider", { length: 80 }).notNull().default("unipile"),
    syncKind: varchar("sync_kind", { length: 40 }).notNull(),
    scopeKey: text("scope_key").notNull(),
    type: varchar("type", { length: 40 }).notNull(),
    providerInteractionId: text("provider_interaction_id").notNull(),
    parentProviderInteractionId: text("parent_provider_interaction_id"),
    direction: varchar("direction", { length: 40 }).notNull(),
    actorProviderId: text("actor_provider_id"),
    actorName: text("actor_name"),
    actorHeadline: text("actor_headline"),
    actorProfileUrl: text("actor_profile_url"),
    body: text("body"),
    reaction: varchar("reaction", { length: 80 }),
    mentionedProviderId: text("mentioned_provider_id"),
    mentionedName: text("mentioned_name"),
    status: varchar("status", { length: 40 }).notNull().default("observed"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    lastScanToken: uuid("last_scan_token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.socialContentId], foreignColumns: [socialContentItems.workspaceId, socialContentItems.id], name: "social_interactions_workspace_content_fk" }).onDelete("cascade"),
    unique("social_interactions_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("social_interactions_provider_event_uq").on(table.workspaceId, table.socialContentId, table.type, table.providerInteractionId),
    index("social_interactions_workspace_activity_idx").on(table.workspaceId, table.status, table.lastSeenAt, table.id),
    check("social_interactions_network_ck", sql`${table.network} in ('linkedin')`),
    check("social_interactions_sync_kind_ck", sql`${table.syncKind} in ('comments', 'reactions')`),
    check("social_interactions_type_ck", sql`${table.type} in ('comment', 'reply', 'reaction', 'mention')`),
    check("social_interactions_direction_ck", sql`${table.direction} in ('owner', 'incoming', 'unknown')`),
    check("social_interactions_status_ck", sql`${table.status} in ('observed', 'removed')`),
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
    revision: integer("revision").notNull().default(1),
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
    privacyEpoch: integer("privacy_epoch").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    revision: integer("revision").notNull().default(1),
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

export const prospectMemoryEvents = pgTable(
  "prospect_memory_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sequenceId: bigserial("sequence_id", { mode: "number" }).unique(),
    workspaceId: uuid("workspace_id").notNull(),
    sourceContactId: uuid("source_contact_id").notNull(),
    canonicalContactId: uuid("canonical_contact_id").notNull(),
    sourceKind: varchar("source_kind", { length: 80 }).notNull(),
    sourceId: varchar("source_id", { length: 300 }).notNull(),
    sourceVersion: bigint("source_version", { mode: "number" }).notNull().default(1),
    kind: varchar("kind", { length: 80 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    validTo: timestamp("valid_to", { withTimezone: true }),
    supersedesEventId: uuid("supersedes_event_id"),
    payload: jsonb("payload").notNull().default({}),
    schemaVersion: integer("schema_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.sourceContactId],
      foreignColumns: [contacts.workspaceId, contacts.id],
      name: "prospect_memory_events_source_contact_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.canonicalContactId],
      foreignColumns: [contacts.workspaceId, contacts.id],
      name: "prospect_memory_events_canonical_contact_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.supersedesEventId],
      foreignColumns: [table.id],
      name: "prospect_memory_events_supersedes_fk",
    }).onDelete("set null"),
    uniqueIndex("prospect_memory_events_source_uq").on(
      table.workspaceId,
      table.sourceKind,
      table.sourceId,
      table.sourceVersion,
    ),
    index("prospect_memory_events_contact_sequence_idx").on(
      table.workspaceId,
      table.canonicalContactId,
      table.sequenceId,
    ),
    index("prospect_memory_events_source_contact_sequence_idx").on(
      table.workspaceId,
      table.sourceContactId,
      table.sequenceId,
    ),
    check("prospect_memory_events_source_version_ck", sql`${table.sourceVersion} > 0`),
    check("prospect_memory_events_schema_version_ck", sql`${table.schemaVersion} > 0`),
    check("prospect_memory_events_validity_ck", sql`${table.validTo} is null or ${table.validTo} > ${table.validFrom}`),
  ],
);

export const prospectMemorySnapshots = pgTable(
  "prospect_memory_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    version: integer("version").notNull(),
    watermark: bigint("watermark", { mode: "number" }).notNull(),
    firstSequenceId: bigint("first_sequence_id", { mode: "number" }).notNull(),
    privacyEpoch: integer("privacy_epoch").notNull(),
    status: varchar("status", { length: 40 }).notNull(),
    currentState: jsonb("current_state").notNull(),
    commercialState: jsonb("commercial_state").notNull(),
    assertions: jsonb("assertions").notNull().default([]),
    relationshipSummary: text("relationship_summary").notNull().default(""),
    recommendedTone: varchar("recommended_tone", { length: 300 }),
    contradictions: jsonb("contradictions").notNull().default([]),
    missingInformation: jsonb("missing_information").notNull().default([]),
    modelProvider: varchar("model_provider", { length: 120 }),
    model: varchar("model", { length: 200 }),
    promptVersion: varchar("prompt_version", { length: 120 }).notNull(),
    policyVersion: varchar("policy_version", { length: 120 }).notNull(),
    schemaVersion: integer("schema_version").notNull(),
    rendererVersion: integer("renderer_version").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.contactId],
      foreignColumns: [contacts.workspaceId, contacts.id],
      name: "prospect_memory_snapshots_contact_fk",
    }).onDelete("cascade"),
    unique("prospect_memory_snapshots_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("prospect_memory_snapshots_version_uq").on(table.workspaceId, table.contactId, table.version),
    uniqueIndex("prospect_memory_snapshots_current_uq")
      .on(table.workspaceId, table.contactId)
      .where(sql`${table.supersededAt} is null and ${table.invalidatedAt} is null`),
    index("prospect_memory_snapshots_contact_generated_idx").on(
      table.workspaceId,
      table.contactId,
      table.generatedAt,
    ),
    check("prospect_memory_snapshots_version_ck", sql`${table.version} > 0`),
    check("prospect_memory_snapshots_watermark_ck", sql`${table.watermark} >= ${table.firstSequenceId}`),
    check("prospect_memory_snapshots_privacy_epoch_ck", sql`${table.privacyEpoch} >= 0`),
  ],
);

export const prospectMemoryContextReceipts = pgTable(
  "prospect_memory_context_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    requestKey: varchar("request_key", { length: 300 }).notNull(),
    capability: varchar("capability", { length: 80 }).notNull(),
    snapshotId: uuid("snapshot_id"),
    snapshotVersion: integer("snapshot_version"),
    watermark: bigint("watermark", { mode: "number" }).notNull(),
    privacyEpoch: integer("privacy_epoch").notNull(),
    rendererVersion: integer("renderer_version").notNull(),
    sourceEventIds: jsonb("source_event_ids").notNull().default([]),
    sourceHashes: jsonb("source_hashes").notNull().default([]),
    excludedSourceEventIds: jsonb("excluded_source_event_ids").notNull().default([]),
    normalizedRetrievalQueries: jsonb("normalized_retrieval_queries").notNull().default([]),
    estimatedInputTokens: integer("estimated_input_tokens").notNull(),
    contextHash: varchar("context_hash", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.contactId],
      foreignColumns: [contacts.workspaceId, contacts.id],
      name: "prospect_memory_context_receipts_contact_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.snapshotId],
      foreignColumns: [prospectMemorySnapshots.id],
      name: "prospect_memory_context_receipts_snapshot_fk",
    }).onDelete("set null"),
    uniqueIndex("prospect_memory_context_receipts_request_uq").on(table.workspaceId, table.requestKey),
    index("prospect_memory_context_receipts_contact_created_idx").on(
      table.workspaceId,
      table.contactId,
      table.createdAt,
    ),
    check("prospect_memory_context_receipts_tokens_ck", sql`${table.estimatedInputTokens} >= 0`),
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

type McpEffectTableRef = {
  workspaceId: AnyPgColumn;
  id: AnyPgColumn;
};

// ForeignKeyBuilder evaluates these callbacks after module initialization,
// which allows the circular proposal/approval/reconciliation references to
// retain the concrete pgTable inference without widening either table.
const mcpEffectProposalsRef = {} as McpEffectTableRef;
const approvalItemsRef = {} as McpEffectTableRef;
const mcpEffectReconciliationsRef = {} as McpEffectTableRef;

/** Workspace-scoped, redacted proposal snapshots for governed external effects. */
export const mcpEffectProposals = pgTable(
  "mcp_effect_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: varchar("client_id", { length: 180 }).notNull(),
    kind: varchar("kind", { length: 40 }).notNull(),
    requestKey: uuid("request_key").notNull(),
    inputHash: varchar("input_hash", { length: 64 }).notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    intentSnapshot: jsonb("intent_snapshot").notNull(),
    sourceSnapshot: jsonb("source_snapshot").notNull(),
    revision: integer("revision").notNull().default(1),
    sourceVersion: integer("source_version").notNull().default(1),
    policyPreview: jsonb("policy_preview"),
    policyFinal: jsonb("policy_final"),
    status: varchar("status", { length: 32 }).notNull().default("approval_required"),
    version: integer("version").notNull().default(1),
    approvalItemId: uuid("approval_item_id"),
    operationId: uuid("operation_id"),
    jobId: uuid("job_id"),
    reconciliationId: uuid("reconciliation_id"),
    correlationId: uuid("correlation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("mcp_effect_proposals_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("mcp_effect_proposals_idempotency_uq").on(table.workspaceId, table.clientId, table.kind, table.requestKey),
    index("mcp_effect_proposals_workspace_status_idx").on(table.workspaceId, table.status, table.updatedAt),
    index("mcp_effect_proposals_aggregate_idx").on(table.workspaceId, table.kind, table.aggregateId),
    index("mcp_effect_proposals_correlation_idx").on(table.workspaceId, table.correlationId),
    check("mcp_effect_proposals_kind_ck", sql`${table.kind} in ('conversation_reply', 'content_publication', 'meeting_proposal', 'campaign_activation')`),
    check("mcp_effect_proposals_status_ck", sql`${table.status} in ('approval_required', 'policy_denied', 'queued', 'accepted', 'unknown', 'reconciling', 'delivered', 'failed', 'rejected', 'invalidated')`),
    check("mcp_effect_proposals_input_hash_ck", sql`length(${table.inputHash}) = 64`),
    check("mcp_effect_proposals_snapshot_ck", sql`jsonb_typeof(${table.intentSnapshot}) = 'object' and jsonb_typeof(${table.sourceSnapshot}) = 'object' and octet_length(${table.intentSnapshot}::text) <= 32768 and octet_length(${table.sourceSnapshot}::text) <= 32768`),
    check("mcp_effect_proposals_policy_preview_ck", sql`${table.policyPreview} is null or (jsonb_typeof(${table.policyPreview}) = 'object' and octet_length(${table.policyPreview}::text) <= 32768)`),
    check("mcp_effect_proposals_policy_final_ck", sql`${table.policyFinal} is null or (jsonb_typeof(${table.policyFinal}) = 'object' and octet_length(${table.policyFinal}::text) <= 32768)`),
    check("mcp_effect_proposals_versions_ck", sql`${table.revision} > 0 and ${table.sourceVersion} > 0 and ${table.version} > 0`),
    new ForeignKeyBuilder((): { columns: [AnyPgColumn, AnyPgColumn]; foreignColumns: [AnyPgColumn, AnyPgColumn]; name: string } => ({
      columns: [table.workspaceId, table.approvalItemId],
      foreignColumns: [approvalItemsRef.workspaceId, approvalItemsRef.id],
      name: "mcp_effect_proposals_approval_item_fk",
    })).onDelete("restrict"),
    new ForeignKeyBuilder((): { columns: [AnyPgColumn, AnyPgColumn]; foreignColumns: [AnyPgColumn, AnyPgColumn]; name: string } => ({
      columns: [table.workspaceId, table.operationId],
      foreignColumns: [mcpOperations.workspaceId, mcpOperations.operationId],
      name: "mcp_effect_proposals_operation_fk",
    })).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.jobId],
      foreignColumns: [jobs.workspaceId, jobs.id],
      name: "mcp_effect_proposals_job_fk",
    }).onDelete("restrict"),
    new ForeignKeyBuilder((): { columns: [AnyPgColumn, AnyPgColumn]; foreignColumns: [AnyPgColumn, AnyPgColumn]; name: string } => ({
      columns: [table.workspaceId, table.reconciliationId],
      foreignColumns: [mcpEffectReconciliationsRef.workspaceId, mcpEffectReconciliationsRef.id],
      name: "mcp_effect_proposals_reconciliation_fk",
    })).onDelete("restrict"),
  ],
);

export const approvalItems = pgTable(
  "approval_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    campaignId: uuid("campaign_id"),
    contactId: uuid("contact_id"),
    enrollmentId: uuid("enrollment_id"),
    proposalId: uuid("proposal_id"),
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
    new ForeignKeyBuilder((): { columns: [AnyPgColumn, AnyPgColumn]; foreignColumns: [AnyPgColumn, AnyPgColumn]; name: string } => ({
      columns: [table.workspaceId, table.proposalId],
      foreignColumns: [mcpEffectProposalsRef.workspaceId, mcpEffectProposalsRef.id],
      name: "approval_items_proposal_fk",
    })).onDelete("cascade"),
    foreignKey({ columns: [table.contactId], foreignColumns: [contacts.id], name: "approval_items_contact_fk" }).onDelete("set null"),
    foreignKey({ columns: [table.enrollmentId], foreignColumns: [campaignEnrollments.id], name: "approval_items_enrollment_fk" }).onDelete("set null"),
    unique("approval_items_workspace_id_uq").on(table.workspaceId, table.id),
    index("approval_items_workspace_status_idx").on(table.workspaceId, table.status, table.createdAt),
    index("approval_items_campaign_status_idx").on(table.workspaceId, table.campaignId, table.status, table.createdAt),
    unique("approval_items_workspace_proposal_uq").on(table.workspaceId, table.proposalId),
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
    connectedAccountId: uuid("connected_account_id").references(() => connectedAccounts.id, { onDelete: "set null" }),
    provider: varchar("provider", { length: 40 }).notNull(),
    providerAccountId: varchar("provider_account_id", { length: 300 }).notNull(),
    providerThreadId: varchar("provider_thread_id", { length: 500 }).notNull(),
    channel: prospectingChannelEnum("channel").notNull(),
    origin: varchar("origin", { length: 40 }).notNull().default("outside_campaign"),
    automationMode: varchar("automation_mode", { length: 40 }).notNull().default("human"),
    subject: varchar("subject", { length: 500 }),
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
    index("conversations_account_activity_idx").on(
      table.workspaceId,
      table.connectedAccountId,
      table.lastMessageAt,
    ),
    index("conversations_contact_idx").on(table.workspaceId, table.contactId, table.lastMessageAt),
    check("conversations_origin_check", sql`${table.origin} in ('campaign', 'outside_campaign')`),
    check("conversations_automation_mode_check", sql`${table.automationMode} in ('setter', 'human', 'disabled')`),
  ],
);

export const inboxSyncStates = pgTable(
  "inbox_sync_states",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    connectedAccountId: uuid("connected_account_id").notNull().references(() => connectedAccounts.id, { onDelete: "cascade" }),
    providerAccountId: varchar("provider_account_id", { length: 300 }).notNull(),
    channel: prospectingChannelEnum("channel").notNull(),
    resource: varchar("resource", { length: 40 }).notNull(),
    cursor: text("cursor"),
    highWatermark: timestamp("high_watermark", { withTimezone: true }),
    backfillComplete: boolean("backfill_complete").notNull().default(false),
    status: varchar("status", { length: 40 }).notNull().default("idle"),
    lastErrorCode: varchar("last_error_code", { length: 160 }),
    lastErrorMessage: text("last_error_message"),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("inbox_sync_states_account_resource_uq").on(
      table.workspaceId,
      table.connectedAccountId,
      table.resource,
    ),
    index("inbox_sync_states_due_idx").on(table.status, table.updatedAt),
    check("inbox_sync_states_resource_check", sql`${table.resource} in ('messages', 'emails')`),
    check("inbox_sync_states_status_check", sql`${table.status} in ('idle', 'syncing', 'error')`),
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
    executionMode: varchar("execution_mode", { length: 20 }).notNull().default("live"),
    requestedBody: text("requested_body"),
    generatedBody: text("generated_body"),
    generationMetadata: jsonb("generation_metadata").notNull().default(sql`'{}'::jsonb`),
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
    check("conversation_commands_execution_mode_ck", sql`${table.executionMode} in ('live', 'dry_run')`),
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
    revision: integer("revision").notNull().default(1),
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

export const attributionTouches = pgTable(
  "attribution_touches",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    socialContentId: uuid("social_content_id").notNull(),
    socialInteractionId: uuid("social_interaction_id").notNull(),
    publicationId: uuid("publication_id"),
    contactId: uuid("contact_id"),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id"),
    bookingId: uuid("booking_id"),
    opportunityId: uuid("opportunity_id"),
    kind: varchar("kind", { length: 40 }).notNull(),
    certainty: varchar("certainty", { length: 40 }).notNull(),
    rule: varchar("rule", { length: 160 }).notNull(),
    modelVersion: varchar("model_version", { length: 80 }).notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
    proofType: varchar("proof_type", { length: 80 }).notNull(),
    proofRef: text("proof_ref"),
    proofHref: text("proof_href"),
    logicalKey: text("logical_key").notNull(),
    status: varchar("status", { length: 40 }).notNull().default("active"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    nextResolutionAt: timestamp("next_resolution_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.socialContentId], foreignColumns: [socialContentItems.workspaceId, socialContentItems.id], name: "attribution_touches_workspace_content_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.socialInteractionId], foreignColumns: [socialInteractions.workspaceId, socialInteractions.id], name: "attribution_touches_workspace_interaction_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.publicationId], foreignColumns: [contentPublications.workspaceId, contentPublications.id], name: "attribution_touches_workspace_publication_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.contactId], foreignColumns: [contacts.workspaceId, contacts.id], name: "attribution_touches_workspace_contact_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.campaignId], foreignColumns: [campaigns.workspaceId, campaigns.id], name: "attribution_touches_workspace_campaign_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.bookingId], foreignColumns: [calendarBookings.workspaceId, calendarBookings.id], name: "attribution_touches_workspace_booking_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.opportunityId], foreignColumns: [opportunities.workspaceId, opportunities.id], name: "attribution_touches_workspace_opportunity_fk" }).onDelete("cascade"),
    unique("attribution_touches_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("attribution_touches_logical_uq").on(table.workspaceId, table.socialInteractionId, table.logicalKey),
    index("attribution_touches_booking_idx").on(table.workspaceId, table.bookingId, table.status, table.kind, table.occurredAt, table.socialInteractionId),
    index("attribution_touches_contact_identity_idx")
      .on(table.workspaceId, table.contactId, table.occurredAt, table.socialInteractionId)
      .where(sql`${table.status} = 'active' and ${table.kind} = 'identity' and ${table.contactId} is not null`),
    check("attribution_touches_kind_ck", sql`${table.kind} in ('identity', 'conversation', 'campaign', 'booking', 'opportunity')`),
    check("attribution_touches_certainty_ck", sql`${table.certainty} in ('evidence', 'inference', 'unknown')`),
    check("attribution_touches_status_ck", sql`${table.status} in ('active', 'superseded')`),
    check("attribution_touches_confidence_ck", sql`${table.confidence} >= 0 and ${table.confidence} <= 1 and (${table.certainty} <> 'unknown' or ${table.confidence} = 0)`),
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
    revision: integer("revision").notNull().default(1),
    sourceVersion: integer("source_version").notNull().default(1),
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
    check("meeting_proposals_revision_ck", sql`${table.revision} > 0`),
    check("meeting_proposals_source_version_ck", sql`${table.sourceVersion} > 0`),
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
    priority: integer("priority").notNull().default(0),
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
    unique("jobs_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("jobs_workspace_type_idempotency_uq").on(
      table.workspaceId,
      table.type,
      table.idempotencyKey,
    ),
    index("jobs_lease_idx").on(table.status, table.availableAt, table.lockedUntil),
    index("jobs_workspace_status_idx").on(table.workspaceId, table.status),
  ],
);

export const prospectDecisions = pgTable(
  "prospect_decisions",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    campaignId: uuid("campaign_id"),
    outreachActionId: uuid("outreach_action_id"),
    jobId: uuid("job_id").notNull(),
    kind: varchar("kind", { length: 120 }).notNull(),
    reason: text("reason").notNull(),
    observation: jsonb("observation").notNull().default({}),
    proposedAction: varchar("proposed_action", { length: 40 }),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    priority: integer("priority").notNull().default(0),
    status: varchar("status", { length: 40 }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    idempotencyKey: varchar("idempotency_key", { length: 500 }).notNull(),
    correlationId: varchar("correlation_id", { length: 200 }).notNull(),
    payload: jsonb("payload").notNull().default({}),
    result: jsonb("result"),
    policyDecision: jsonb("policy_decision"),
    lastErrorCode: varchar("last_error_code", { length: 160 }),
    lastErrorMessage: text("last_error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.contactId],
      foreignColumns: [contacts.workspaceId, contacts.id],
      name: "prospect_decisions_contact_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.campaignId],
      foreignColumns: [campaigns.workspaceId, campaigns.id],
      name: "prospect_decisions_campaign_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.outreachActionId],
      foreignColumns: [outreachActions.workspaceId, outreachActions.id],
      name: "prospect_decisions_outreach_action_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.jobId],
      foreignColumns: [jobs.workspaceId, jobs.id],
      name: "prospect_decisions_job_fk",
    }).onDelete("cascade"),
    unique("prospect_decisions_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("prospect_decisions_workspace_key_uq").on(table.workspaceId, table.idempotencyKey),
    uniqueIndex("prospect_decisions_workspace_job_uq").on(table.workspaceId, table.jobId),
    index("prospect_decisions_due_idx").on(table.workspaceId, table.status, table.priority, table.dueAt),
    index("prospect_decisions_contact_idx").on(table.workspaceId, table.contactId, table.createdAt),
    index("prospect_decisions_campaign_idx").on(table.workspaceId, table.campaignId, table.createdAt),
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

/** OAuth clients and grants for the stateless MCP resource server. Secrets are
 * stored as SHA-256 digests only; token payloads never contain workspace ids. */
export const mcpOauthClients = pgTable(
  "mcp_oauth_clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: varchar("client_id", { length: 180 }).notNull().unique(),
    clientName: varchar("client_name", { length: 200 }).notNull(),
    redirectUris: jsonb("redirect_uris").notNull(),
    userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    workspaceSlug: varchar("workspace_slug", { length: 120 }).notNull(),
    allowedScopes: jsonb("allowed_scopes").notNull().default(sql`'["mcp:read"]'::jsonb`),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("mcp_oauth_clients_client_id_uq").on(table.clientId),
    index("mcp_oauth_clients_workspace_idx").on(table.workspaceId, table.createdAt),
    index("mcp_oauth_clients_user_idx").on(table.userId, table.createdAt),
  ],
);

export const mcpOauthAuthorizationCodes = pgTable(
  "mcp_oauth_authorization_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    codeHash: varchar("code_hash", { length: 128 }).notNull().unique(),
    clientId: varchar("client_id", { length: 180 }).notNull().references(() => mcpOauthClients.clientId, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: varchar("code_challenge", { length: 128 }).notNull(),
    codeChallengeMethod: varchar("code_challenge_method", { length: 16 }).notNull().default("S256"),
    scopes: jsonb("scopes").notNull(),
    resource: text("resource").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("mcp_oauth_codes_hash_uq").on(table.codeHash),
    index("mcp_oauth_codes_client_expiry_idx").on(table.clientId, table.expiresAt),
    index("mcp_oauth_codes_workspace_idx").on(table.workspaceId, table.createdAt),
  ],
);

export const mcpOauthAccessTokens = pgTable(
  "mcp_oauth_access_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: varchar("token_hash", { length: 128 }).notNull().unique(),
    familyId: uuid("family_id").notNull(),
    clientId: varchar("client_id", { length: 180 }).notNull().references(() => mcpOauthClients.clientId, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    scopes: jsonb("scopes").notNull(),
    audience: text("audience").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("mcp_oauth_access_hash_uq").on(table.tokenHash),
    index("mcp_oauth_access_client_idx").on(table.clientId, table.expiresAt),
    index("mcp_oauth_access_workspace_idx").on(table.workspaceId, table.createdAt),
  ],
);

export const mcpOauthRefreshTokens = pgTable(
  "mcp_oauth_refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: varchar("token_hash", { length: 128 }).notNull().unique(),
    familyId: uuid("family_id").notNull(),
    clientId: varchar("client_id", { length: 180 }).notNull().references(() => mcpOauthClients.clientId, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    scopes: jsonb("scopes").notNull(),
    audience: text("audience").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("mcp_oauth_refresh_hash_uq").on(table.tokenHash),
    index("mcp_oauth_refresh_family_idx").on(table.familyId, table.createdAt),
    index("mcp_oauth_refresh_client_idx").on(table.clientId, table.expiresAt),
    index("mcp_oauth_refresh_workspace_idx").on(table.workspaceId, table.createdAt),
  ],
);

export const mcpOauthTokenRevocations = pgTable(
  "mcp_oauth_token_revocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: varchar("token_hash", { length: 128 }).notNull().unique(),
    tokenType: varchar("token_type", { length: 32 }).notNull(),
    clientId: varchar("client_id", { length: 180 }).references(() => mcpOauthClients.clientId, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => authUsers.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    reason: varchar("reason", { length: 200 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("mcp_oauth_revocations_hash_uq").on(table.tokenHash),
    index("mcp_oauth_revocations_workspace_idx").on(table.workspaceId, table.createdAt),
    index("mcp_oauth_revocations_expiry_idx").on(table.expiresAt),
  ],
);

export const mcpOauthAuditEvents = pgTable(
  "mcp_oauth_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    action: varchar("action", { length: 160 }).notNull(),
    clientId: varchar("client_id", { length: 180 }),
    userId: uuid("user_id").references(() => authUsers.id, { onDelete: "set null" }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    subjectId: varchar("subject_id", { length: 180 }),
    actorType: varchar("actor_type", { length: 40 }).notNull().default("oauth"),
    tool: varchar("tool", { length: 100 }),
    correlationId: uuid("correlation_id"),
    outcome: varchar("outcome", { length: 40 }).notNull().default("accepted"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("mcp_oauth_audit_workspace_idx").on(table.workspaceId, table.createdAt),
    index("mcp_oauth_audit_client_idx").on(table.clientId, table.createdAt),
    index("mcp_oauth_audit_rate_limit_idx").on(table.action, table.subjectId, table.createdAt),
    check("mcp_oauth_audit_outcome_ck", sql`${table.outcome} in ('accepted', 'denied', 'replayed', 'stale', 'failed', 'in_progress')`),
  ],
);

/** Idempotency ledger for internal MCP writes; request payloads are represented
 * only by a canonical hash and bounded result metadata. */
export const mcpWriteOperations = pgTable(
  "mcp_write_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: varchar("client_id", { length: 180 }).notNull().references(() => mcpOauthClients.clientId, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    tool: varchar("tool", { length: 100 }).notNull(),
    requestKey: uuid("request_key").notNull(),
    inputHash: varchar("input_hash", { length: 64 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    result: jsonb("result"),
    correlationId: uuid("correlation_id").notNull(),
    leaseOwner: varchar("lease_owner", { length: 180 }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("mcp_write_operations_idempotency_uq").on(table.workspaceId, table.clientId, table.tool, table.requestKey),
    index("mcp_write_operations_workspace_idx").on(table.workspaceId, table.createdAt),
    index("mcp_write_operations_correlation_idx").on(table.correlationId),
    index("mcp_write_operations_lease_idx").on(table.status, table.leaseExpiresAt),
  ],
);

/** Durable, tenant-bound handles for queued MCP operations. The payload itself
 * stays in the job queue; this read model persists only bounded references and
 * safe error codes. */
export const mcpOperations = pgTable(
  "mcp_operations",
  {
    operationId: uuid("operation_id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: varchar("client_id", { length: 180 }).notNull().references(() => mcpOauthClients.clientId, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    tool: varchar("tool", { length: 100 }).notNull(),
    requestKey: uuid("request_key").notNull(),
    inputHash: varchar("input_hash", { length: 64 }).notNull(),
    jobId: uuid("job_id").notNull(),
    correlationId: varchar("correlation_id", { length: 200 }).notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    resultRefs: jsonb("result_refs").$type<Array<{ type: string; id: string }>>().notNull().default([]),
    errorCode: varchar("error_code", { length: 120 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("mcp_operations_request_uq").on(table.workspaceId, table.clientId, table.tool, table.requestKey),
    unique("mcp_operations_workspace_id_uq").on(table.workspaceId, table.operationId),
    index("mcp_operations_workspace_status_idx").on(table.workspaceId, table.status, table.updatedAt),
    index("mcp_operations_job_idx").on(table.workspaceId, table.jobId),
    check("mcp_operations_status_ck", sql`${table.status} in ('queued', 'running', 'completed', 'failed', 'cancelled')`),
  ],
);

/** Immutable, lease-aware execution claim created with the governed job. */
export const mcpEffectIntentions = pgTable(
  "mcp_effect_intentions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    proposalId: uuid("proposal_id").notNull(),
    kind: varchar("kind", { length: 40 }).notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    state: varchar("state", { length: 16 }).notNull().default("queued"),
    idempotencyKey: varchar("idempotency_key", { length: 500 }).notNull(),
    jobId: uuid("job_id").notNull(),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    correlationId: uuid("correlation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.proposalId], foreignColumns: [mcpEffectProposals.workspaceId, mcpEffectProposals.id], name: "mcp_effect_intentions_proposal_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.jobId], foreignColumns: [jobs.workspaceId, jobs.id], name: "mcp_effect_intentions_job_fk" }).onDelete("cascade"),
    unique("mcp_effect_intentions_workspace_proposal_uq").on(table.workspaceId, table.proposalId),
    unique("mcp_effect_intentions_workspace_identity_uq").on(table.workspaceId, table.kind, table.aggregateId, table.idempotencyKey),
    index("mcp_effect_intentions_expiration_idx").on(table.workspaceId, table.state, table.leaseExpiresAt),
    index("mcp_effect_intentions_job_idx").on(table.workspaceId, table.jobId),
    check("mcp_effect_intentions_kind_ck", sql`${table.kind} in ('conversation_reply', 'content_publication', 'meeting_proposal', 'campaign_activation')`),
    check("mcp_effect_intentions_state_ck", sql`${table.state} in ('queued', 'started', 'unknown', 'completed')`),
    check("mcp_effect_intentions_idempotency_ck", sql`length(${table.idempotencyKey}) between 1 and 500`),
    check("mcp_effect_intentions_lease_ck", sql`(${table.state} = 'started' and ${table.leaseToken} is not null and ${table.leaseExpiresAt} is not null) or (${table.state} <> 'started' and ${table.leaseToken} is null and ${table.leaseExpiresAt} is null)`),
  ],
);

/** Append-only, redacted correlation facts across the governed effect lifecycle. */
export const mcpEffectTraces = pgTable(
  "mcp_effect_traces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    proposalId: uuid("proposal_id").notNull(),
    stage: varchar("stage", { length: 24 }).notNull(),
    sequence: integer("sequence").notNull(),
    sourceEventId: uuid("source_event_id").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 500 }).notNull(),
    eventType: varchar("event_type", { length: 160 }).notNull(),
    redactedPayload: jsonb("redacted_payload").notNull().default({}),
    actor: varchar("actor", { length: 120 }),
    correlationId: uuid("correlation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.proposalId], foreignColumns: [mcpEffectProposals.workspaceId, mcpEffectProposals.id], name: "mcp_effect_traces_proposal_fk" }).onDelete("cascade"),
    unique("mcp_effect_traces_workspace_id_uq").on(table.workspaceId, table.id),
    unique("mcp_effect_traces_stage_sequence_uq").on(table.workspaceId, table.proposalId, table.stage, table.sequence),
    uniqueIndex("mcp_effect_traces_source_event_uq").on(table.workspaceId, table.sourceEventId),
    uniqueIndex("mcp_effect_traces_idempotency_uq").on(table.workspaceId, table.proposalId, table.idempotencyKey),
    index("mcp_effect_traces_proposal_sequence_idx").on(table.workspaceId, table.proposalId, table.sequence),
    index("mcp_effect_traces_correlation_idx").on(table.workspaceId, table.correlationId),
    index("mcp_effect_traces_stage_idx").on(table.workspaceId, table.stage, table.createdAt),
    check("mcp_effect_traces_stage_ck", sql`${table.stage} in ('proposal', 'approval', 'policy', 'outbox', 'attempt', 'result')`),
    check("mcp_effect_traces_sequence_ck", sql`${table.sequence} > 0`),
    check("mcp_effect_traces_payload_ck", sql`jsonb_typeof(${table.redactedPayload}) = 'object' and octet_length(${table.redactedPayload}::text) <= 32768`),
  ],
);

/** Read-only reconciliation state for unknown provider outcomes. */
export const mcpEffectReconciliations = pgTable(
  "mcp_effect_reconciliations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    proposalId: uuid("proposal_id").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    criteriaSnapshot: jsonb("criteria_snapshot").notNull().default({}),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    candidateCount: integer("candidate_count").notNull().default(0),
    errorCode: varchar("error_code", { length: 120 }),
    errorMessage: varchar("error_message", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ columns: [table.workspaceId, table.proposalId], foreignColumns: [mcpEffectProposals.workspaceId, mcpEffectProposals.id], name: "mcp_effect_reconciliations_proposal_fk" }).onDelete("cascade"),
    unique("mcp_effect_reconciliations_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("mcp_effect_reconciliations_proposal_uq").on(table.workspaceId, table.proposalId),
    index("mcp_effect_reconciliations_due_idx").on(table.workspaceId, table.status, table.nextAttemptAt),
    index("mcp_effect_reconciliations_expiration_idx").on(table.workspaceId, table.status, table.leaseExpiresAt),
    check("mcp_effect_reconciliations_status_ck", sql`${table.status} in ('pending', 'searching', 'matched', 'not_found', 'ambiguous', 'error')`),
    check("mcp_effect_reconciliations_attempts_ck", sql`${table.attempts} >= 0 and ${table.maxAttempts} > 0 and ${table.attempts} <= ${table.maxAttempts}`),
    check("mcp_effect_reconciliations_candidates_ck", sql`${table.candidateCount} >= 0`),
    check("mcp_effect_reconciliations_snapshot_ck", sql`jsonb_typeof(${table.criteriaSnapshot}) = 'object' and octet_length(${table.criteriaSnapshot}::text) <= 32768`),
    check("mcp_effect_reconciliations_terminal_ck", sql`${table.completedAt} is null or ${table.status} in ('matched', 'not_found', 'ambiguous', 'error')`),
  ],
);

Object.assign(mcpEffectProposalsRef, {
  workspaceId: mcpEffectProposals.workspaceId,
  id: mcpEffectProposals.id,
});
Object.assign(approvalItemsRef, {
  workspaceId: approvalItems.workspaceId,
  id: approvalItems.id,
});
Object.assign(mcpEffectReconciliationsRef, {
  workspaceId: mcpEffectReconciliations.workspaceId,
  id: mcpEffectReconciliations.id,
});
