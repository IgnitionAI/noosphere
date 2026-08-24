ALTER TABLE "workspace_data_settings"
  ADD COLUMN "memory_events_retention_days" integer DEFAULT 365 NOT NULL,
  ADD COLUMN "memory_snapshots_retention_days" integer DEFAULT 90 NOT NULL,
  ADD COLUMN "memory_receipts_retention_days" integer DEFAULT 90 NOT NULL;

ALTER TABLE "workspace_data_settings"
  ADD CONSTRAINT "workspace_memory_events_retention_ck" CHECK ("memory_events_retention_days" BETWEEN 30 AND 3650),
  ADD CONSTRAINT "workspace_memory_snapshots_retention_ck" CHECK ("memory_snapshots_retention_days" BETWEEN 30 AND 365),
  ADD CONSTRAINT "workspace_memory_receipts_retention_ck" CHECK ("memory_receipts_retention_days" BETWEEN 30 AND 365);
