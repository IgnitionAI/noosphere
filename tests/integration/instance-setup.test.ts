import { afterAll, describe, expect, test } from "bun:test";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { PostgresInstanceSetupRepository } from "@outbound/infrastructure/ai/postgres-instance-setup-repository";
import { InstanceSetupApplication } from "@outbound/application/ai/instance-setup";
import { bootstrapInstanceAdministrator } from "../../scripts/bootstrap-owner";
import { PostgresWorkspaceRepository } from "@outbound/infrastructure/workspaces/postgres-workspace-repository";
import { authUsers } from "@outbound/infrastructure/database/schema";

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("persistent instance setup", () => {
  if (!url) return;
  const database = createDatabase(url);
  afterAll(() => database.close());
  test("only the designated bootstrap account administers the instance and skip survives reconnection", async () => {
    const input = {
      baseUrl: "http://localhost:3000", secret: "instance-setup-test-secret-01234567890123456789",
      email: `instance-${crypto.randomUUID()}@example.com`, name: "Instance owner",
      password: "test-password-0123456789", workspaceSlug: "unused", workspaceName: "Unused",
    };
    const first = await bootstrapInstanceAdministrator(database.db, input);
    const again = await bootstrapInstanceAdministrator(database.db, input);
    expect(again.userId).toBe(first.userId);
    const app = new InstanceSetupApplication(new PostgresInstanceSetupRepository(database.db));
    expect((await app.get(first.userId)).isAdministrator).toBe(true);
    const otherId = crypto.randomUUID();
    await database.db.insert(authUsers).values({ id: otherId, name: "Workspace owner", email: `${otherId}@example.com` });
    await new PostgresWorkspaceRepository(database.db).createWorkspace({ userId: otherId, name: `Own workspace ${otherId}` });
    expect((await app.get(otherId)).isAdministrator).toBe(false);
    await app.skip(first.userId);
    const reopened = createDatabase(url);
    try {
      const resumed = new InstanceSetupApplication(new PostgresInstanceSetupRepository(reopened.db));
      expect(await resumed.get(first.userId)).toEqual({ isAdministrator: true, skipped: true });
    } finally { await reopened.close(); }
  });
});
