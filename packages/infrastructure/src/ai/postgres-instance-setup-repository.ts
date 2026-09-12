import { and, eq, sql } from "drizzle-orm";
import type { InstanceSetupRepository } from "@outbound/application/ai/instance-setup";
import type { Database } from "@outbound/infrastructure/database/client";
import { authUsers, instanceAdministrators, instanceSetup } from "@outbound/infrastructure/database/schema";

export class PostgresInstanceSetupRepository implements InstanceSetupRepository {
  constructor(private readonly db: Database, private readonly administratorEmail?: string) {}
  async isAdministrator(userId: string) {
    const email = this.administratorEmail?.trim().toLowerCase();
    if (!email) return false;
    const [row] = await this.db.select({ userId: instanceAdministrators.userId })
      .from(instanceAdministrators)
      .innerJoin(authUsers, eq(authUsers.id, instanceAdministrators.userId))
      .where(and(eq(instanceAdministrators.userId, userId), eq(sql<string>`lower(${authUsers.email})`, email))).limit(1);
    return !!row;
  }
  async getState() {
    const [row] = await this.db.select({ skipped: instanceSetup.skipped }).from(instanceSetup).limit(1);
    return row ?? { skipped: false };
  }
  async skip() {
    await this.db.insert(instanceSetup).values({ id: true, skipped: true })
      .onConflictDoUpdate({ target: instanceSetup.id, set: { skipped: true } });
  }
}
