import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const database = createDatabase(databaseUrl);
try {
  await migrate(database.db, {
    migrationsFolder: new URL("../../migrations", import.meta.url).pathname,
  });
} finally {
  await database.close();
}
