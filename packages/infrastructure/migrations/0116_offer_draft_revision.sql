ALTER TABLE offers ADD COLUMN revision integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE offers ADD CONSTRAINT offers_revision_ck CHECK (revision > 0);
