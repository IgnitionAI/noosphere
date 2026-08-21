import { describe, expect, test } from "bun:test";
import { ContentAutopilotApplication } from "@outbound/application/content/content-autopilot";
import { createContentAutopilotHttpHandler } from "@outbound/interface/http/content-autopilot-handler";

const workspaceId = crypto.randomUUID();
const userId = crypto.randomUUID();
const view = { configured: true, enabled: true, localTime: "06:00", timezone: "Europe/Paris", lastRunAt: null, nextRunAt: new Date(), nextPublicationAt: null, queuedIdeas: 2, generatingAssets: 1, readyAssets: 0, scheduledPublications: 0, blockedAssets: 0, exceptions: 0 };

describe("AUT-101 content autopilot HTTP", () => {
  test("derives workspace and actor exclusively from the request context", async () => {
    const writes: unknown[] = [];
    const repository = {
      async get() { return view; },
      async configure(input: unknown) { writes.push(input); return view; },
    } as never;
    const handler = createContentAutopilotHttpHandler({
      application: new ContentAutopilotApplication(repository, { now: () => new Date("2026-08-21T04:00:00.000Z") }),
      contextResolver: context("owner"),
    });
    const response = await handler(request("PUT", { requestKey: "autopilot-request-1", enabled: false, localTime: "06:30", timezone: "Europe/Paris", workspaceId: crypto.randomUUID() }));
    expect(response.status).toBe(422);
    expect(writes).toHaveLength(0);
    const accepted = await handler(request("PUT", { requestKey: "autopilot-request-2", enabled: false, localTime: "06:30", timezone: "Europe/Paris" }));
    expect(accepted.status).toBe(200);
    expect(writes).toContainEqual(expect.objectContaining({ workspaceId, userId, enabled: false }));
  });

  test("allows viewers to inspect but not configure", async () => {
    const handler = createContentAutopilotHttpHandler({
      application: new ContentAutopilotApplication({ async get() { return view; } } as never, { now: () => new Date() }),
      contextResolver: context("viewer"),
    });
    expect((await handler(request("GET"))).status).toBe(200);
    expect((await handler(request("PUT", { requestKey: "autopilot-request-3", enabled: true, localTime: "06:00", timezone: "Europe/Paris" }))).status).toBe(403);
  });
});

function request(method: string, body?: unknown) { return new Request("http://localhost/api/v1/content/autopilot", { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
function context(role: "viewer" | "owner") { return { async resolve() { return { userId, workspaceId, role }; } }; }
