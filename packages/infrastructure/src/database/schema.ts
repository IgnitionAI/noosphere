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
  "segment_synthesis",
  "icp_synthesis",
  "evidence_review",
]);
export const researchStageStatusEnum = pgEnum("research_stage_status", ["running", "completed", "failed"]);
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

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: varchar("slug", { length: 120 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
