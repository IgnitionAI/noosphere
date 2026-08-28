import { describe, expect, test } from "bun:test";
import { createNoosphereRuntime } from "@outbound/bootstrap/create-noosphere-runtime";
import type { RuntimeCapabilities } from "@outbound/bootstrap/runtime-capabilities";

function capabilities(): RuntimeCapabilities {
  return {
    crm: { productResearch: { get: async () => ({ status: "ok" }), list: async () => ({ status: "ok" }) } },
    prospectMemory: { operations: { status: async () => ({ status: "ok" }), view: async () => ({ status: "ok" }) } },
    pipeline: { available: false },
    campaigns: { available: false },
    conversations: { available: false },
    content: {
      strategies: { find: async () => ({ status: "ok" }) },
      ideas: { list: async () => ({ status: "ok" }) },
      generation: { findRun: async () => ({ status: "ok" }), findIdea: async () => ({ status: "ok" }), findAssetByIdea: async () => ({ status: "ok" }) },
      publications: { list: async () => ({ status: "ok" }), find: async () => ({ status: "ok" }) },
      socialContent: { list: async () => ({ status: "ok" }), status: async () => ({ status: "ok" }) },
      socialEngagement: { list: async () => ({ status: "ok" }), status: async () => ({ status: "ok" }) },
      attribution: { listJourneys: async () => ({ status: "ok" }) },
    },
    approvals: { available: false },
    operations: { contentPerformance: { get: async () => ({ status: "ok" }) } },
    knowledge: { available: false },
  };
}

describe("Noosphere runtime", () => {
  test("provides a safe empty composition when no process adapters are configured", async () => {
    const runtime = createNoosphereRuntime();
    const response = await runtime.handle(new Request("https://example.test/unknown"));

    expect(response.status).toBe(404);
    expect(Object.keys(runtime.capabilities)).toEqual([
      "crm",
      "prospectMemory",
      "pipeline",
      "campaigns",
      "conversations",
      "content",
      "approvals",
      "operations",
      "knowledge",
    ]);
  });

  test("exposes a read capability without requiring an HTTP request", async () => {
    const runtime = createNoosphereRuntime({
      capabilities: capabilities(),
      dispatch: async () => Response.json({ ok: true }),
    });

    expect(await runtime.capabilities.content.ideas.list({ workspaceId: "workspace", limit: 1 })).toEqual({ status: "ok" });
    expect(runtime.capabilities).not.toHaveProperty("database");
    expect(runtime.capabilities).not.toHaveProperty("provider");
  });

  test("keeps capability and lifecycle references stable across requests", async () => {
    let handled = 0;
    const runtime = createNoosphereRuntime({
      capabilities: capabilities(),
      dispatch: async () => {
        handled += 1;
        return Response.json({ handled });
      },
    });
    const first = runtime.capabilities;

    await runtime.handle(new Request("https://example.test/health/live"));
    await runtime.handle(new Request("https://example.test/health/live"));

    expect(runtime.capabilities).toBe(first);
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(Object.isFrozen(runtime.capabilities)).toBe(true);
    expect(Object.isFrozen(runtime.capabilities.content)).toBe(true);
    expect(Object.isFrozen(runtime.capabilities.content.ideas)).toBe(true);
    expect(handled).toBe(2);
  });

  test("closes the composed runtime at most once", async () => {
    let closed = 0;
    const runtime = createNoosphereRuntime({
      capabilities: capabilities(),
      dispatch: async () => Response.json({ ok: true }),
      close: async () => {
        closed += 1;
      },
    });

    await Promise.all([runtime.close(), runtime.close()]);
    expect(closed).toBe(1);
  });
});
