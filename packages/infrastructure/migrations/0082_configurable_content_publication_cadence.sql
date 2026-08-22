ALTER TABLE "content_idea_schedules"
  ADD COLUMN "publication_times" varchar(5)[],
  ADD COLUMN "publication_days" integer[];

ALTER TABLE "content_idea_schedules"
  ADD CONSTRAINT "content_idea_schedules_publication_times_ck"
  CHECK (
    "publication_times" IS NULL
    OR (
      cardinality("publication_times") BETWEEN 1 AND 2
      AND array_to_string("publication_times", ',') ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9](,(?:[01][0-9]|2[0-3]):[0-5][0-9])?$'
    )
  ),
  ADD CONSTRAINT "content_idea_schedules_publication_days_ck"
  CHECK (
    "publication_days" IS NULL
    OR (
      cardinality("publication_days") BETWEEN 1 AND 7
      AND "publication_days" <@ ARRAY[1,2,3,4,5,6,7]
    )
  );
