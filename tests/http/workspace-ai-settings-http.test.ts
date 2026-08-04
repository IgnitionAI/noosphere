import { describe, expect, test } from "bun:test";
import {
  WorkspaceAiSettingsApplication,
  type WorkspaceAiModelPolicy,
  type WorkspaceAiSettingsRepository,
} from "@outbound/application/workspaces/workspace-ai-settings";
import { createWorkspaceAiSettingsHttpHandler } from "@outbound/interface/http/workspace-ai-settings-handler";
import type {
  RequestContext,
  RequestContextResolver,
  WorkspaceRole,
} from "@outbound/interface/http/request-context";

const workspaceId = "00000000-0000-4000-8000-000000000002";
const userId = "00000000-0000-4000-8000-000000000001";

describe("workspace AI settings HTTP route", () => {
  test("returns environment defaults until the workspace saves a policy", async () => {
    const { handle } = fixture("owner");
    const response = await handle(request("GET"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      researchModels: ["k3", "k3-256k"],
      synthesisModels: ["k3-256k", "k3"],
      source: "environment",
      updatedAt: null,
    });
  });

  test("lets an owner persist an ordered, deduplicated model policy", async () => {
    const { handle } = fixture("owner");
    const response = await handle(
      request("PUT", {
        researchModels: ["k3", "k3-256k", "k3"],
        synthesisModels: ["k3-256k", "k3"],
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      researchModels: ["k3", "k3-256k"],
      synthesisModels: ["k3-256k", "k3"],
      source: "workspace",
    });
  });

  test("allows reading but rejects updates from non-admin members", async () => {
    const { handle } = fixture("operator");

    expect((await handle(request("GET"))).status).toBe(200);
    const response = await handle(
      request("PUT", {
        researchModels: ["k3"],
        synthesisModels: ["k3"],
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "WORKSPACE_FORBIDDEN" });
  });

  test("rejects the removed Kimi coding models", async () => {
    const { handle } = fixture("owner");
    const response = await handle(
      request("PUT", {
        researchModels: ["kimi-for-coding"],
        synthesisModels: ["kimi-for-coding-highspeed"],
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_REQUEST" });
  });
});

function fixture(role: WorkspaceRole) {
  const repository = new InMemoryWorkspaceAiSettingsRepository();
  const application = new WorkspaceAiSettingsApplication(
    repository,
    {
      researchModels: ["k3", "k3-256k"],
      synthesisModels: ["k3-256k", "k3"],
    },
    () => new Date("2026-07-25T12:00:00.000Z"),
  );
  return {
    handle: createWorkspaceAiSettingsHttpHandler({
      application,
      contextResolver: new FixedContextResolver({ workspaceId, userId, role }),
    }),
  };
}

class FixedContextResolver implements RequestContextResolver {
  constructor(private readonly context: RequestContext) {}
  async resolve(): Promise<RequestContext> {
    return this.context;
  }
}

class InMemoryWorkspaceAiSettingsRepository
  implements WorkspaceAiSettingsRepository
{
  readonly settings = new Map<string, WorkspaceAiModelPolicy & { updatedAt: Date }>();

  async find(workspace: string) {
    return this.settings.get(workspace) ?? null;
  }

  async upsert(input: {
    workspaceId: string;
    researchModels: readonly string[];
    synthesisModels: readonly string[];
    now: Date;
  }) {
    const settings = {
      researchModels: [...input.researchModels],
      synthesisModels: [...input.synthesisModels],
      updatedAt: input.now,
    };
    this.settings.set(input.workspaceId, settings);
    return settings;
  }
}

function request(method: string, body?: unknown): Request {
  return new Request("http://localhost/api/v1/workspace-ai-settings", {
    method,
    headers: {
      "content-type": "application/json",
      "x-workspace-slug": "ignition-ai",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
