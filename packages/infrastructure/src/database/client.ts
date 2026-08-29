import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@outbound/infrastructure/database/schema";

export function createDatabase(databaseUrl: string) {
  const options = {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  } as const;
  const drizzleClient = postgres(databaseUrl, options);
  const client = postgres(databaseUrl, options);
  return {
    client,
    db: drizzle(drizzleClient, { schema }),
    async close(): Promise<void> {
      await Promise.all([client.end({ timeout: 5 }), drizzleClient.end({ timeout: 5 })]);
    },
  };
}

export type Database = ReturnType<typeof createDatabase>["db"];
export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** A root database or nested transaction/savepoint executor. */
export type DatabaseExecutor = Database | DatabaseTransaction;
export type SqlClient = ReturnType<typeof createDatabase>["client"];
