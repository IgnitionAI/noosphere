import { sql } from "drizzle-orm";
import {
  emptyProspectChannels,
  type ProspectChannels,
} from "@outbound/domain/crm/prospect-channels";
import {
  type AnyPgColumn,
  boolean,
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
    index("ai_runs_workspace_research_idx").on(table.workspaceId, table.productResearchRunId),
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

export const icpVersions = pgTable(
  "icp_versions",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    runId: uuid("run_id").notNull(),
    proposalId: uuid("proposal_id").notNull(),
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
      columns: [table.workspaceId, table.runId],
      foreignColumns: [productResearchRuns.workspaceId, productResearchRuns.id],
      name: "icp_versions_workspace_run_fk",
    }).onDelete("cascade"),
    uniqueIndex("icp_versions_proposal_uq").on(table.workspaceId, table.proposalId),
    uniqueIndex("icp_versions_workspace_version_uq").on(table.workspaceId, table.version),
    index("icp_versions_workspace_idx").on(table.workspaceId, table.publishedAt),
  ],
);

export const crmSourceEnum = pgEnum("crm_source", [
  "manual",
  "csv",
  "icp_research",
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
    reason: text("reason"),
    createdBy: uuid("created_by").references(() => authUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "contact_suppressions_workspace_fk",
    }).onDelete("cascade"),
    uniqueIndex("contact_suppressions_fingerprint_uq")
      .on(table.workspaceId, table.identityType, table.normalizedValue)
      .where(sql`${table.normalizedValue} is not null`),
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
    trigger: varchar("trigger", { length: 40 }).notNull().default("manual"),
    provider: varchar("provider", { length: 80 }).notNull().default("unipile"),
    channel: prospectingChannelEnum("channel").notNull().default("linkedin"),
    filters: jsonb("filters").notNull(),
    status: discoveryRunStatusEnum("status").notNull().default("running"),
    errorCode: varchar("error_code", { length: 120 }),
    errorMessage: text("error_message"),
    candidateCount: integer("candidate_count").notNull().default(0),
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

export const campaignStatusEnum = pgEnum("campaign_status", [
  "draft",
  "active",
  "paused",
  "completed",
  "archived",
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
export const outreachActionStatusEnum = pgEnum("outreach_action_status", [
  "scheduled",
  "executing",
  "sent",
  "failed",
  "skipped",
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
      .references(() => sequences.id, { onDelete: "cascade" }),
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

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    icpVersionId: uuid("icp_version_id")
      .notNull()
      .references(() => icpVersions.id, { onDelete: "cascade" }),
    planId: uuid("plan_id").references(() => prospectingPlans.id, { onDelete: "cascade" }),
    assessmentId: uuid("assessment_id").references(() => channelAssessments.id, {
      onDelete: "set null",
    }),
    channel: prospectingChannelEnum("channel"),
    name: varchar("name", { length: 300 }).notNull(),
    status: campaignStatusEnum("status").notNull().default("draft"),
    sequenceId: uuid("sequence_id")
      .notNull()
      .references(() => sequences.id),
    sequenceVersionId: uuid("sequence_version_id")
      .references(() => sequenceVersions.id),
    discoveryRunId: uuid("discovery_run_id")
      .references(() => prospectDiscoveryRuns.id),
    legacyReason: varchar("legacy_reason", { length: 120 }),
    prospectCount: integer("prospect_count").notNull().default(0),
    autopilotPolicy: jsonb("autopilot_policy").notNull().default({
      version: 1,
      enabled: true,
      schedule: {
        activeDays: [1, 2, 3, 4, 5],
        windowStart: "09:00",
        windowEnd: "17:00",
        timezoneMode: "recipient",
        fallbackTimezone: "Europe/Paris",
      },
      email: {
        language: "auto",
        firstMessageInstructions: null,
        followUpInstructions: null,
        followUpDelaysBusinessDays: [4, 10],
        autoReplyEnabled: true,
        replyDelayMinutes: 2,
        replyInstructions: null,
        bookingUrl: null,
        stopOnHumanActivity: true,
      },
    }),
    automationStage: varchar("automation_stage", { length: 40 }).notNull().default("sourcing"),
    automationErrorCode: varchar("automation_error_code", { length: 120 }),
    automationErrorMessage: text("automation_error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "campaigns_workspace_fk",
    }).onDelete("cascade"),
    unique("campaigns_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("campaigns_plan_channel_uq")
      .on(table.workspaceId, table.planId, table.channel)
      .where(sql`${table.planId} is not null and ${table.channel} is not null`),
    uniqueIndex("campaigns_sequence_uq").on(table.workspaceId, table.sequenceId),
    uniqueIndex("campaigns_discovery_run_uq").on(table.workspaceId, table.discoveryRunId),
    index("campaigns_workspace_status_idx").on(table.workspaceId, table.status, table.updatedAt),
  ],
);

export const campaignProspects = pgTable(
  "campaign_prospects",
  {
    workspaceId: uuid("workspace_id").notNull(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => prospectDiscoveryCandidates.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    state: campaignProspectStateEnum("state").notNull().default("candidate"),
    score: integer("score"),
    scoreVersion: varchar("score_version", { length: 80 }),
    scoreExplanation: jsonb("score_explanation").notNull().default([]),
    aiAssessment: jsonb("ai_assessment").notNull().default({}),
    eligible: boolean("eligible").notNull().default(false),
    exclusionReason: varchar("exclusion_reason", { length: 160 }),
    personalizedSteps: jsonb("personalized_steps").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "campaign_prospects_workspace_fk",
    }).onDelete("cascade"),
    primaryKey({ columns: [table.workspaceId, table.campaignId, table.candidateId] }),
    index("campaign_prospects_campaign_state_idx").on(
      table.workspaceId,
      table.campaignId,
      table.state,
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

export const outreachActions = pgTable(
  "outreach_actions",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    enrollmentId: uuid("enrollment_id").notNull().references(() => sequenceEnrollments.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id").notNull().references(() => prospectDiscoveryCandidates.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 40 }).notNull(),
    providerAccountId: varchar("provider_account_id", { length: 300 }).notNull(),
    channel: prospectingChannelEnum("channel").notNull(),
    stepPosition: integer("step_position").notNull(),
    stepKind: sequenceStepKindEnum("step_kind").notNull(),
    status: outreachActionStatusEnum("status").notNull().default("scheduled"),
    idempotencyKey: varchar("idempotency_key", { length: 500 }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    contentSnapshot: jsonb("content_snapshot").notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lockedBy: varchar("locked_by", { length: 160 }),
    providerRequestId: varchar("provider_request_id", { length: 300 }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    lastErrorCode: varchar("last_error_code", { length: 160 }),
    lastErrorMessage: text("last_error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "outreach_actions_workspace_fk",
    }).onDelete("cascade"),
    uniqueIndex("outreach_actions_idempotency_uq").on(table.workspaceId, table.idempotencyKey),
    index("outreach_actions_due_idx").on(table.status, table.dueAt),
  ],
);

export const outreachAttempts = pgTable(
  "outreach_attempts",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    outreachActionId: uuid("outreach_action_id").notNull().references(() => outreachActions.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    providerRequestId: varchar("provider_request_id", { length: 300 }),
    status: varchar("status", { length: 40 }).notNull(),
    errorCode: varchar("error_code", { length: 160 }),
    errorMessage: text("error_message"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "outreach_attempts_workspace_fk",
    }).onDelete("cascade"),
    uniqueIndex("outreach_attempts_number_uq").on(
      table.workspaceId,
      table.outreachActionId,
      table.attemptNumber,
    ),
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
    nextAction: text("next_action"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "opportunities_workspace_fk",
    }).onDelete("cascade"),
    unique("opportunities_workspace_id_uq").on(table.workspaceId, table.id),
    uniqueIndex("opportunities_contact_campaign_uq").on(table.workspaceId, table.contactId, table.campaignId),
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

export const calendarBookings = pgTable(
  "calendar_bookings",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    providerBookingId: varchar("provider_booking_id", { length: 500 }).notNull(),
    contactId: uuid("contact_id"),
    campaignId: uuid("campaign_id"),
    status: varchar("status", { length: 40 }).notNull(),
    attendeeName: varchar("attendee_name", { length: 300 }),
    attendeeEmail: varchar("attendee_email", { length: 320 }),
    attendeePhone: varchar("attendee_phone", { length: 80 }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }),
    meetingUrl: text("meeting_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.connectionId],
      foreignColumns: [calendarConnections.workspaceId, calendarConnections.id],
      name: "calendar_bookings_connection_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.contactId],
      foreignColumns: [contacts.workspaceId, contacts.id],
      name: "calendar_bookings_contact_fk",
    }).onDelete("set null"),
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
