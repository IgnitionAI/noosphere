import { describe, expect, test } from "bun:test";
import { InstanceSetupApplication, type InstanceSetupRepository } from "@outbound/application/ai/instance-setup";
import { createInstanceSetupHttpHandler } from "@outbound/interface/http/instance-setup-handler";

class MemorySetupRepository implements InstanceSetupRepository {
  admins = new Set(["initial-user"]);
  skipped = false;
  async isAdministrator(userId: string) { return this.admins.has(userId); }
  async getState() { return { skipped: this.skipped }; }
  async skip() { this.skipped = true; }
}
function fixture(userId: string | null = "initial-user") {
  const repository = new MemorySetupRepository();
  const application = new InstanceSetupApplication(repository);
  return createInstanceSetupHttpHandler({ application, sessions: {
    async getSession() { return userId ? { userId } : null; },
  }});
}
const request = (method = "GET", path = "") => new Request(`http://localhost/api/v1/instance/setup${path}`, { method });

describe("instance setup", () => {
  test("workspace owners cannot change shared setup and anonymous access is rejected", async () => {
    const owner = fixture("workspace-owner");
    expect(await (await owner(request())).json()).toEqual({ isAdministrator: false, skipped: false });
    expect((await owner(request("POST", "/skip"))).status).toBe(403);
    expect((await fixture(null)(request())).status).toBe(401);
  });
  test("initial administrator can skip AI setup and resume it without a workspace", async () => {
    const handle = fixture();
    expect(await (await handle(request())).json()).toEqual({ isAdministrator: true, skipped: false });
    expect((await handle(request("POST", "/skip"))).status).toBe(200);
    expect(await (await handle(request())).json()).toEqual({ isAdministrator: true, skipped: true });
    expect((await handle(request("POST", "/skip"))).status).toBe(200);
  });
});
