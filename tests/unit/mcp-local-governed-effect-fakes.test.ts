import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createLocalGovernedEffectFakes,
  getLocalFakeCounters,
  resetLocalFakeCounters,
  resolveLocalFakeMode,
} from "../../packages/infrastructure/src/mcp/local-governed-effect-fakes";

const options = {
  mode: "local-fake" as const,
  allowNetwork: false as const,
  outcomes: {
    conversation_reply: { kind: "success" as const, safeCode: "FAKE_ACCEPTED", providerReference: "fake-message-1" },
    content_publication: { kind: "failure" as const, safeCode: "FAKE_REJECTED" },
    meeting_proposal: { kind: "ambiguous" as const, safeCode: "FAKE_AMBIGUOUS", providerReference: "fake-booking-1" },
    campaign_activation: { kind: "failure" as const, safeCode: "ADAPTER_UNAVAILABLE" },
  },
  counters: { conversationReply: 0, contentPublication: 0, meetingProposal: 0, campaignActivation: 0 },
};

type LocalFakeOptions = Parameters<typeof createLocalGovernedEffectFakes>[0];
type LocalFakes = ReturnType<typeof createLocalGovernedEffectFakes>;

async function withLocalFakes<T>(
  fakeOptions: LocalFakeOptions,
  callback: (fakes: LocalFakes) => Promise<T> | T,
): Promise<T> {
  resetLocalFakeCounters();
  try {
    return await callback(createLocalGovernedEffectFakes(fakeOptions));
  } finally {
    resetLocalFakeCounters();
  }
}

describe("local governed-effect fakes", () => {
  beforeEach(() => resetLocalFakeCounters());
  afterEach(() => resetLocalFakeCounters());

  test("returns bounded outcomes, counts mutations, and exposes no campaign adapter", async () => {
    const fakes = createLocalGovernedEffectFakes(options);
    expect(fakes.outcomeFor("conversation_reply")).toEqual(options.outcomes.conversation_reply);
    expect(fakes.outcomeFor("campaign_activation")).toEqual(options.outcomes.campaign_activation);
    expect(fakes.adapters.outbound).toBeDefined();
    expect(fakes.adapters.publisher).toBeDefined();
    expect(fakes.adapters.calendar).toBeDefined();
    expect(fakes.adapters.socialContentReader).toBeDefined();
    expect(fakes.adapters).not.toHaveProperty("campaign");

    await fakes.adapters.outbound!.send({
      accountId: "fake-account",
      channel: "linkedin",
      stepKind: "linkedin_message",
      recipient: { value: "recipient@example.test", normalizedValue: "recipient@example.test", providerUserId: null },
      subject: null,
      body: "bounded fake body",
      idempotencyKey: "fake-request-1",
    });
    expect(fakes.counters.conversationReply).toBe(1);
    expect(getLocalFakeCounters()).toMatchObject({ conversationReply: 1, contentPublication: 0, meetingProposal: 0, campaignActivation: 0 });
  });

  test("maps configured failed and ambiguous mutations to existing safe port errors", async () => {
    const fakes = createLocalGovernedEffectFakes(options);
    await expect(fakes.adapters.publisher!.publishText({ accountId: "fake-account", text: "bounded content", requestKey: "fake-content-1" })).rejects.toMatchObject({
      code: "FAKE_REJECTED",
      deliveryState: "not_sent",
    });
    await expect(fakes.adapters.calendar!.book({ workspaceId: "workspace-1", contactId: "contact-1", campaignId: null, start: "2030-01-01T10:00:00.000Z" })).rejects.toMatchObject({
      code: "FAKE_AMBIGUOUS",
    });
    expect(fakes.counters).toMatchObject({ contentPublication: 1, meetingProposal: 1 });
  });

  test("carries the bounded content reference on an ambiguous publisher error", async () => {
    const fakes = createLocalGovernedEffectFakes({
      ...options,
      outcomes: {
        ...options.outcomes,
        content_publication: { kind: "ambiguous", safeCode: "FAKE_AMBIGUOUS", providerReference: "fake-post-1" },
      },
    });
    await expect(fakes.adapters.publisher!.publishText({ accountId: "fake-account", text: "bounded content", requestKey: "fake-content-1" })).rejects.toMatchObject({
      code: "FAKE_AMBIGUOUS", providerReference: "fake-post-1",
    });
  });

  test("provides an authoritative bounded read-only snapshot without network access", async () => {
    const fakes = createLocalGovernedEffectFakes({
      ...options,
      outcomes: {
        ...options.outcomes,
        content_publication: { kind: "success", safeCode: "FAKE_ACCEPTED", providerReference: "fake-post-1" },
      },
    });
    const page = await fakes.adapters.socialContentReader!.listOwnContent({ accountId: "fake-account", cursor: null, limit: 10 });
    expect(page.data).toEqual([expect.objectContaining({ providerPostId: "fake-post-1", text: "local fake content" })]);
    expect(page.data[0]).not.toHaveProperty("providerPayload");
    expect(page.data[0]?.url).toBeNull();
    expect(fakes.counters.contentPublication).toBe(0);
  });

  test("rejects network-enabled or malformed local fake configuration", () => {
    expect(() => createLocalGovernedEffectFakes({ ...options, allowNetwork: true as never })).toThrow("MCP_LOCAL_FAKE_NETWORK_DISABLED");
    expect(() => createLocalGovernedEffectFakes({ ...options, outcomes: { ...options.outcomes, conversation_reply: { kind: "success", safeCode: "bad code" } } })).toThrow("MCP_LOCAL_FAKE_OUTCOME_INVALID");
    expect(() => createLocalGovernedEffectFakes({ ...options, outcomes: undefined as never })).toThrow("MCP_LOCAL_FAKE_OUTCOME_INVALID");
    expect(() => createLocalGovernedEffectFakes({ ...options, outcomes: { ...options.outcomes, conversation_reply: { kind: "success", safeCode: 42 } } as never })).toThrow("MCP_LOCAL_FAKE_OUTCOME_INVALID");
    expect(() => createLocalGovernedEffectFakes({ ...options, outcomes: { ...options.outcomes, conversation_reply: { kind: "success", safeCode: "FAKE_OK", providerReference: null } } as never })).toThrow("MCP_LOCAL_FAKE_OUTCOME_INVALID");
  });

  test("allows local fake mode only outside production and rejects unknown modes", () => {
    expect(resolveLocalFakeMode({ NODE_ENV: "development", MCP_LOCAL_FAKE_EFFECTS: "true" })).toBe(true);
    expect(resolveLocalFakeMode({ NODE_ENV: "development" })).toBe(false);
    expect(() => resolveLocalFakeMode({ NODE_ENV: "production", MCP_LOCAL_FAKE_EFFECTS: "true" })).toThrow("MCP_LOCAL_FAKE_DISABLED_IN_PRODUCTION");
    expect(() => resolveLocalFakeMode({ NODE_ENV: "development", MCP_LOCAL_FAKE_EFFECTS: "yes" })).toThrow("MCP_LOCAL_FAKE_CONFIG_INVALID");
  });

  test("selects local fake mode explicitly for both local services without changing production", async () => {
    const localCompose = await readFile(resolve(import.meta.dir, "../../compose.mcp-local.yml"), "utf8");
    const productionCompose = await readFile(resolve(import.meta.dir, "../../compose.production.yml"), "utf8");
    const serviceSection = (compose: string, service: string): string => {
      const start = compose.indexOf(`  ${service}:`);
      if (start < 0) throw new Error(`MCP_LOCAL_SERVICE_MISSING:${service}`);
      const nextHeading = /\n  [A-Za-z0-9_-]+:/.exec(compose.slice(start + 1));
      const next = nextHeading === null ? -1 : start + 1 + nextHeading.index;
      return compose.slice(start, next < 0 ? compose.length : next);
    };
    for (const service of ["api", "worker"]) {
      const section = serviceSection(localCompose, service);
      expect(section).toContain("NODE_ENV: development");
      expect(section).toContain('MCP_LOCAL_FAKE_EFFECTS: "true"');
      expect(resolveLocalFakeMode({ NODE_ENV: "development", MCP_LOCAL_FAKE_EFFECTS: "true" })).toBe(true);
    }
    expect(productionCompose).not.toContain("MCP_LOCAL_FAKE_EFFECTS: \"true\"");
    expect(() => resolveLocalFakeMode({ NODE_ENV: "production", MCP_LOCAL_FAKE_EFFECTS: "true" })).toThrow("MCP_LOCAL_FAKE_DISABLED_IN_PRODUCTION");
  });

  test("deep-clones and freezes validated outcomes instead of retaining caller state", () => {
    const callerOutcome = { kind: "success" as const, safeCode: "FAKE_ACCEPTED", providerReference: "caller-reference" };
    const fakes = createLocalGovernedEffectFakes({ ...options, outcomes: { ...options.outcomes, conversation_reply: callerOutcome } });
    callerOutcome.safeCode = "MUTATED";
    const returned = fakes.outcomeFor("conversation_reply") as { safeCode: string };
    expect(returned.safeCode).toBe("FAKE_ACCEPTED");
    expect(Object.isFrozen(returned)).toBe(true);
    expect(Reflect.set(returned, "safeCode", "MUTATED_AGAIN")).toBe(false);
    expect(fakes.outcomeFor("conversation_reply").safeCode).toBe("FAKE_ACCEPTED");
  });

  test("rejects counters unless they contain exactly four bounded own numeric keys", () => {
    const counterCases = [
      { ...options.counters, extra: 0 },
      { conversationReply: 0, contentPublication: 0, meetingProposal: 0 },
      { ...options.counters, conversationReply: Number.NaN },
      { ...options.counters, conversationReply: Number.MAX_SAFE_INTEGER + 1 },
    ];
    for (const counters of counterCases) {
      expect(() => createLocalGovernedEffectFakes({ ...options, counters: counters as never })).toThrow("MCP_LOCAL_FAKE_COUNTERS_INVALID");
    }
  });

  test("requires an explicit reset before a second process-local registry instance", () => {
    createLocalGovernedEffectFakes(options);
    expect(() => createLocalGovernedEffectFakes(options)).toThrow("MCP_LOCAL_FAKE_REGISTRY_ALREADY_INITIALIZED");
    expect(getLocalFakeCounters().conversationReply).toBe(0);
    resetLocalFakeCounters();
    expect(() => createLocalGovernedEffectFakes(options)).not.toThrow();
  });

  test("allows two sequential fake runs with the scoped helper", async () => {
    await withLocalFakes(options, async (first) => {
      expect(first.counters.conversationReply).toBe(0);
    });
    await withLocalFakes(options, async (second) => {
      expect(second.counters.conversationReply).toBe(0);
    });
  });

  test("disposes a scoped fake run when its callback throws", async () => {
    const expected = new Error("LOCAL_FAKE_SCOPED_FAILURE");
    await expect(withLocalFakes(options, async () => { throw expected; })).rejects.toBe(expected);
    expect(() => getLocalFakeCounters()).toThrow("MCP_LOCAL_FAKE_COUNTERS_UNAVAILABLE");
    expect(() => createLocalGovernedEffectFakes(options)).not.toThrow();
  });

  test("maps deterministic calendar failures to the existing failed-port code", async () => {
    const fakes = createLocalGovernedEffectFakes({
      ...options,
      outcomes: { ...options.outcomes, meeting_proposal: { kind: "failure", safeCode: "CALCOM_SLOT_UNAVAILABLE" } },
    });
    await expect(fakes.adapters.calendar!.book({ workspaceId: "workspace-1", contactId: "contact-1", campaignId: null, start: "2030-01-01T10:00:00.000Z" })).rejects.toMatchObject({ code: "CALCOM_SLOT_UNAVAILABLE" });
  });
});
