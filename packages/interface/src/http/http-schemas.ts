import { z } from "zod";

// PostgreSQL accepts the complete 128-bit UUID textual space. This intentionally
// differs from z.uuid(), which additionally rejects non-RFC version/variant bits.
// Durable IDs created by deterministic backfills remain valid database UUIDs.
export const postgresUuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
