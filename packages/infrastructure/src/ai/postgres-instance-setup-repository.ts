import { eq } from "drizzle-orm";
import type { InstanceSetupRepository } from "@outbound/application/ai/instance-setup";
import type { Database } from "@outbound/infrastructure/database/client";
import { instanceAdministrators, instanceSetup } from "@outbound/infrastructure/database/schema";

export class PostgresInstanceSetupRepository implements InstanceSetupRepository {
  constructor(private readonly db: Database) {}
  async isAdministrator(userId: string) {
    const [row] = await this.db.select({ userId: instanceAdministrators.userId })
      .from(instanceAdministrators).where(eq(instanceAdministrators.userId, userId)).limit(1);
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
