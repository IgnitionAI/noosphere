import { sql } from "drizzle-orm";
import {
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
export const offerStatusEnum = pgEnum("offer_status", ["draft", "archived"]);
export const offerClaimValidationStatusEnum = pgEnum("offer_claim_validation_status", [
  "hypothesis",
  "sourced",
  "validated",
  "invalidated",
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("product_research_runs_workspace_id_id_uq").on(table.workspaceId, table.id),
    index("product_research_runs_workspace_status_idx").on(table.workspaceId, table.status),
  ],
);

export const researchStageRuns = pgTable(
  "research_stage_runs",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    runId: uuid("run_id").notNull(),
    stage: researchStageEnum("stage").notNull(),
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
    index("offer_claims_workspace_version_idx").on(table.workspaceId, table.offerVersionId),
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
    provider: varchar("provider", { length: 80 }).notNull().default("unipile"),
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
