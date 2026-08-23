import { describe, expect, test } from "bun:test";
import { createWorkspaceDataHttpHandler } from "@outbound/interface/http/workspace-data-handler";
import { WorkspaceDataLifecycleError } from "@outbound/infrastructure/workspaces/postgres-workspace-data-lifecycle";

const workspaceId = "00000000-0000-4000-8000-000000000101";
const exportId = "00000000-0000-4000-8000-000000000102";
const contactId = "00000000-0000-4000-8000-000000000103";

describe("F-053 workspace data HTTP", () => {
  test("allows operational reads but rejects operator export and anonymization", async () => {
    const handle = handler("operator");
    const limits = await handle(request(`/api/v1/workspaces/${workspaceId}/channel-limits`));
    expect(limits.status).toBe(200);
    const exported = await handle(request(`/api/v1/workspaces/${workspaceId}/actions/export`, "POST", { requestKey: "request-1" }));
    expect(exported.status).toBe(403);
    const anonymized = await handle(request(`/api/v1/contacts/${contactId}/actions/anonymize`, "POST", { confirmation: "ANONYMISER" }));
    expect(anonymized.status).toBe(403);
  });

  test("keeps every workspace route isolated from the authenticated context", async () => {
    const handle = handler("owner");
    const response = await handle(request("/api/v1/workspaces/00000000-0000-4000-8000-000000000999/channel-limits"));
    expect(response.status).toBe(403);
  });

  test("maps destructive confirmation errors and expired exports explicitly", async () => {
    const handle = handler("owner", {
      async updateRetentionPolicy() { throw new WorkspaceDataLifecycleError("TYPED_CONFIRMATION_REQUIRED", 400); },
      async getExport() { return { id: exportId, workspaceId, status: "completed", expiresAt: new Date("2026-08-08T00:00:00.000Z") }; },
    });
    const retention = await handle(request(`/api/v1/workspaces/${workspaceId}/retention-policy`, "PUT", { retention: memoryRetention({ jobsDays: 60 }), confirmation: "" }));
    expect(retention.status).toBe(400);
    expect(await retention.json()).toMatchObject({ code: "TYPED_CONFIRMATION_REQUIRED" });
    const expired = await handle(request(`/api/v1/exports/${exportId}`));
    expect(expired.status).toBe(410);
  });

  test("lets an owner filter audit entries", async () => {
    const calls: unknown[] = [];
    const handle = handler("owner", {
      async listAuditLogs(input: unknown) { calls.push(input); return { data: [] }; },
    });
    const response = await handle(request("/api/v1/audit-logs?action=ContactAnonymized&from=2026-08-01&to=2026-08-09&limit=25"));
    expect(response.status).toBe(200);
    expect(calls).toEqual([expect.objectContaining({
      workspaceId,
      action: "ContactAnonymized",
      from: new Date("2026-08-01T00:00:00.000Z"),
      to: new Date("2026-08-09T23:59:59.999Z"),
      limit: 25,
    })]);
  });
});

function handler(role: "operator" | "owner", overrides: Record<string, unknown> = {}) {
  const service = {
    async getProfile() { return { id: workspaceId, name: "Workspace", slug: "workspace" }; },
    async updateProfile() { return {}; },
    async getPolicy() { return { sending: { timezone: "Europe/Paris", activeDays: [1, 2, 3, 4, 5], windowStart: "09:00", windowEnd: "17:00" }, channelLimits: { linkedin: 20, email: 50, whatsapp: 30 }, retention: memoryRetention() }; },
    async updateSendingPreferences() { return {}; },
    async updateChannelLimits() { return {}; },
    async updateRetentionPolicy() { return {}; },
    async requestExport() { return { id: exportId, status: "pending" }; },
    async getExport() { return null; },
    async anonymizeContact() { return {}; },
    async listAuditLogs() { return { data: [] }; },
    ...overrides,
  };
  return createWorkspaceDataHttpHandler({
    contextResolver: { async resolve() { return { userId: "00000000-0000-4000-8000-000000000100", workspaceId, role }; } },
    service,
    clock: { now: () => new Date("2026-08-09T00:00:00.000Z") },
    downloads: { async createDownloadUrl() { return "https://download.invalid/export"; } },
  });
}

function memoryRetention(overrides: Partial<{ invitationsDays: number; jobsDays: number; auditDays: number; memoryEventsDays: number; memorySnapshotsDays: number; memoryReceiptsDays: number }> = {}) {
  return { invitationsDays: 90, jobsDays: 90, auditDays: 365, memoryEventsDays: 365, memorySnapshotsDays: 90, memoryReceiptsDays: 90, ...overrides };
}

function request(pathname: string, method = "GET", body?: unknown) {
  return new Request(`http://localhost${pathname}`, {
    method,
    headers: { "content-type": "application/json", "x-workspace-slug": "workspace" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
