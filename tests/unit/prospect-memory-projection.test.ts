import { describe, expect, test } from "bun:test";
import { DefaultProspectContextAssembler } from "@outbound/application/prospect-memory/prospect-context-assembler";
import {
  DeterministicProspectMemoryProjector,
  StrictProspectMemoryProjectionValidator,
} from "@outbound/application/prospect-memory/prospect-memory-projector";
import { RefreshProspectMemory } from "@outbound/application/prospect-memory/refresh-prospect-memory";
import type {
  ProspectMemoryEventRepository,
  ProspectMemoryPolicy,
  ProspectMemorySnapshotRepository,
  ProspectMemorySourceMaterial,
} from "@outbound/application/prospect-memory/prospect-memory";
import {
  PROSPECT_MEMORY_EVENT_SCHEMA_VERSION,
  type ProspectMemoryEvent,
  type ProspectMemorySnapshot,
} from "@outbound/domain/prospect-memory/prospect-memory";
import { Sha256ContentHasher } from "@outbound/infrastructure/shared/sha256-content-hasher";

const now = new Date("2026-08-23T08:00:00.000Z");
const currentState = {
  displayName: "Marie Martin",
  companyName: "Acme",
  jobTitle: "CTO",
  locale: "fr",
  availableChannels: ["linkedin", "email"] as const,
  suppressed: false,
  anonymized: false,
  activeCampaignIds: ["campaign-1"],
  activeDecisionId: "decision-1",
};

describe("Prospect 360 projection and context", () => {
  test("projects only classifications anchored to resolvable source events", () => {
    const projector = new DeterministicProspectMemoryProjector();
    const validator = new StrictProspectMemoryProjectionValidator();
    const event = memoryEvent(1, "event-1");
    const material = sourceMaterial(event, "Oui, je vous confirme mardi à 10 h.");
    const snapshot = projector.project({
      previousSnapshot: null,
      currentState,
      events: [event],
      materials: [material],
      synthesis: {
        classifications: [{ eventId: event.id, categories: ["commitment", "topic_covered"] }],
        assertions: [{
          nature: "recommendation",
          statement: "Confirmer le créneau sans reposer la même question.",
          confidence: 0.9,
          sourceEventIds: [event.id],
          validUntil: null,
        }],
        relationshipSummary: "Marie a confirmé un créneau mardi à 10 h.",
        recommendedTone: "Direct et cordial",
        contradictions: [],
        missingInformation: [],
        provider: "codex-cli",
        model: "gpt-5.6-luna",
      },
      generatedAt: now,
      privacyEpoch: 0,
      snapshotId: "snapshot-1",
      contentHash: "hash",
    });
    expect(validator.validate({ previousSnapshot: null, snapshot, events: [event], materials: [material] })).toBe(snapshot);
    expect(snapshot.commercialState.commitments[0]?.eventId).toBe(event.id);
    expect(snapshot.commercialState.commitments[0]?.excerpt).toContain("mardi");
    expect(snapshot.assertions[0]?.sources[0]?.eventId).toBe(event.id);
    expect(snapshot.currentState.activeDecisionId).toBe("decision-1");
  });

  test("rejects model classifications that invent a source id", () => {
    const event = memoryEvent(1, "event-1");
    expect(() => new DeterministicProspectMemoryProjector().project({
      previousSnapshot: null,
      currentState,
      events: [event],
      materials: [sourceMaterial(event, "Bonjour")],
      synthesis: {
        classifications: [{ eventId: "invented", categories: ["commitment"] }],
        assertions: [],
        relationshipSummary: "Résumé",
        recommendedTone: null,
        contradictions: [],
        missingInformation: [],
        provider: "codex-cli",
        model: "gpt-5.6-luna",
      },
      generatedAt: now,
      privacyEpoch: 0,
      snapshotId: "snapshot-1",
      contentHash: "hash",
    })).toThrow("PROSPECT_MEMORY_CLASSIFICATION_SOURCE_UNKNOWN");
  });

  test("defers semantic refresh before invoking a model when the workspace budget is exhausted", async () => {
    const event = memoryEvent(1, "event-1");
    let synthesizerCalls = 0;
    const refresh = new RefreshProspectMemory(
      eventRepository([event]),
      snapshotRepository(null),
      { read: async () => ({ currentState, privacyEpoch: 0, anonymizedAt: null }) },
      { read: async () => [sourceMaterial(event, "Question tarifaire")] },
      { find: async () => enabledPolicy() },
      { readUsage: async () => ({ refreshes: 1, costUsd: 0 }) },
      { synthesize: async () => { synthesizerCalls += 1; throw new Error("should not run"); } },
      new DeterministicProspectMemoryProjector(),
      new StrictProspectMemoryProjectionValidator(),
      { now: () => now },
      { generate: () => "snapshot-1" },
      new Sha256ContentHasher(),
    );
    const result = await refresh.execute({
      workspaceId: "workspace-1",
      contactId: "contact-1",
      targetSequenceId: 1,
      privacyEpoch: 0,
      requestKey: "refresh-1",
    });
    expect(result.outcome).toBe("budget_blocked");
    expect(synthesizerCalls).toBe(0);
  });

  test("refuses semantic material when no provider is approved for every enabled capability", async () => {
    const event = memoryEvent(1, "event-profile");
    let synthesizerCalls = 0;
    const policy = enabledPolicy();
    const refresh = new RefreshProspectMemory(
      eventRepository([event]),
      snapshotRepository(null),
      { read: async () => ({ currentState, privacyEpoch: 0, anonymizedAt: null }) },
      { read: async () => [sourceMaterial(event, "Question contractuelle")] },
      {
        find: async () => ({
          ...policy,
          processingProfiles: [{
            ...policy.processingProfiles[0]!,
            allowedCapabilities: ["call_preparation"],
          }],
        }),
      },
      { readUsage: async () => ({ refreshes: 0, costUsd: 0 }) },
      { synthesize: async () => { synthesizerCalls += 1; throw new Error("should not run"); } },
      new DeterministicProspectMemoryProjector(),
      new StrictProspectMemoryProjectionValidator(),
      { now: () => now },
      { generate: () => "snapshot-profile" },
      new Sha256ContentHasher(),
    );

    await expect(refresh.execute({
      workspaceId: "workspace-1",
      contactId: "contact-1",
      targetSequenceId: 1,
      privacyEpoch: 0,
      requestKey: "refresh-profile",
    })).rejects.toThrow("PROSPECT_MEMORY_PROCESSING_PROFILE_REQUIRED");
    expect(synthesizerCalls).toBe(0);
  });

  test("assembles shadow context without exposing private message content to inbound aggregates", async () => {
    const event = memoryEvent(1, "event-1");
    const receipts: unknown[] = [];
    const repository = eventRepository([event]);
    const assembler = new DefaultProspectContextAssembler(
      {
        ...repository,
        aggregateValidEventKinds: async () => ({
          social_interaction: 37,
          message_received: 11,
          message_sent: 7,
        }),
      },
      snapshotRepository(null),
      { read: async () => ({ currentState, privacyEpoch: 0, anonymizedAt: null }) },
      { read: async () => [sourceMaterial(event, "Secret conversation content")] },
      { find: async () => ({ ...enabledPolicy(), flags: { ...enabledPolicy().flags, prospectMemorySetter: false, enabledCapabilities: [] } }) },
      { record: async (receipt) => { receipts.push(receipt); return "persisted-receipt-1"; } },
      { generate: () => "receipt-1" },
      new Sha256ContentHasher(),
    );
    const bundle = await assembler.assemble({
      workspaceId: "workspace-1",
      contactId: "contact-1",
      capability: "inbound_aggregate",
      principalRole: "viewer",
      requestKey: "context-1",
      now,
    });
    expect(bundle.mode).toBe("shadow");
    expect(bundle.automaticActionAllowed).toBe(false);
    expect(bundle.receiptId).toBe("persisted-receipt-1");
    expect(JSON.stringify(bundle.context)).not.toContain("Secret conversation content");
    expect(bundle.context.aggregate).toEqual({
      socialInteractions: 37,
      inboundMessages: 11,
      outboundMessages: 7,
    });
    expect(receipts).toHaveLength(1);
  });

  test("shadow canary keeps an old objection across 120 later messages and three channels without authorizing an action", async () => {
    const oldEvent = memoryEvent(1, "event-1", "linkedin");
    const oldMaterial = sourceMaterial(oldEvent, "Objection confirmée : le budget annuel est déjà engagé. Ne pas redemander le budget.");
    const snapshot = new DeterministicProspectMemoryProjector().project({
      previousSnapshot: null,
      currentState,
      events: [oldEvent],
      materials: [oldMaterial],
      synthesis: {
        classifications: [{ eventId: oldEvent.id, categories: ["objection", "do_not_repeat"] }],
        assertions: [],
        relationshipSummary: "Marie a déjà expliqué que le budget annuel est engagé.",
        recommendedTone: "Factuel et sans répétition",
        contradictions: [],
        missingInformation: [],
        provider: "codex-cli",
        model: "gpt-5.6-luna",
      },
      generatedAt: now,
      privacyEpoch: 0,
      snapshotId: "snapshot-long-thread",
      contentHash: "hash-long-thread",
    });
    const channels = ["linkedin", "email", "whatsapp"] as const;
    const recentEvents = Array.from({ length: 120 }, (_, index) =>
      memoryEvent(index + 2, `event-${index + 2}`, channels[index % channels.length]),
    );
    const allEvents = [oldEvent, ...recentEvents];
    const receipts: unknown[] = [];
    const assembler = new DefaultProspectContextAssembler(
      eventRepository(allEvents),
      snapshotRepository(snapshot),
      { read: async () => ({ currentState, privacyEpoch: 0, anonymizedAt: null }) },
      { read: async ({ events }) => events.map((event) => sourceMaterial(event, `Échange ${event.sequenceId}`)) },
      {
        find: async () => ({
          ...enabledPolicy(),
          flags: {
            prospectMemoryCapture: true,
            prospectMemoryShadow: true,
            prospectMemorySetter: false,
            enabledCapabilities: [],
          },
        }),
      },
      { record: async (receipt) => { receipts.push(receipt); return receipt.id; } },
      { generate: () => "receipt-long-thread" },
      new Sha256ContentHasher(),
    );

    const bundle = await assembler.assemble({
      workspaceId: "workspace-1",
      contactId: "contact-1",
      capability: "setter_campaign",
      principalRole: "worker",
      requestKey: "shadow-canary-long-thread",
      now,
    });

    const rendered = JSON.stringify(bundle.context);
    expect(bundle.mode).toBe("shadow");
    expect(bundle.automaticActionAllowed).toBe(false);
    expect(bundle.waitCode).toBe(null);
    expect(rendered).toContain("budget annuel est déjà engagé");
    expect(rendered).toContain('"channel":"linkedin"');
    expect(rendered).toContain('"channel":"email"');
    expect(rendered).toContain('"channel":"whatsapp"');
    expect(bundle.sourceEventIds).toContain(oldEvent.id);
    expect(bundle.receiptId).toBe("receipt-long-thread");
    expect(receipts).toHaveLength(1);
  });

  test("never authorizes an automatic action for a suppressed prospect", async () => {
    const suppressedState = { ...currentState, suppressed: true };
    const freshSnapshot = new DeterministicProspectMemoryProjector().project({
      previousSnapshot: null,
      currentState: suppressedState,
      events: [memoryEvent(1, "event-suppressed")],
      materials: [sourceMaterial(memoryEvent(1, "event-suppressed"), "Merci")],
      synthesis: {
        classifications: [],
        assertions: [],
        relationshipSummary: "Le prospect est supprimé.",
        recommendedTone: null,
        contradictions: [],
        missingInformation: [],
        provider: null,
        model: null,
      },
      generatedAt: now,
      privacyEpoch: 0,
      snapshotId: "snapshot-suppressed",
      contentHash: "hash-suppressed",
    });
    const assembler = new DefaultProspectContextAssembler(
      eventRepository([memoryEvent(1, "event-suppressed")]),
      snapshotRepository(freshSnapshot),
      { read: async () => ({ currentState: suppressedState, privacyEpoch: 0, anonymizedAt: null }) },
      { read: async () => [] },
      {
        find: async () => ({
          ...enabledPolicy(),
          flags: {
            prospectMemoryCapture: true,
            prospectMemoryShadow: false,
            prospectMemorySetter: true,
            enabledCapabilities: ["setter_campaign"],
          },
        }),
      },
      { record: async (receipt) => receipt.id },
      { generate: () => "receipt-suppressed" },
      new Sha256ContentHasher(),
    );

    const bundle = await assembler.assemble({
      workspaceId: "workspace-1",
      contactId: "contact-1",
      capability: "setter_campaign",
      principalRole: "worker",
      requestKey: "suppressed-context",
      now,
    });

    expect(bundle.mode).toBe("active");
    expect(bundle.currentState.suppressed).toBe(true);
    expect(bundle.automaticActionAllowed).toBe(false);
  });

  test("excludes an assertion as soon as its validity window expires", async () => {
    const generatedAt = new Date(now.getTime() - 60 * 60 * 1_000);
    const event = {
      ...memoryEvent(1, "event-expiring"),
      occurredAt: new Date(generatedAt.getTime() - 1_000),
      validFrom: new Date(generatedAt.getTime() - 1_000),
    };
    const expiredStatement = "Le prospect prévoit de signer avant midi.";
    const snapshot = new DeterministicProspectMemoryProjector().project({
      previousSnapshot: null,
      currentState,
      events: [event],
      materials: [sourceMaterial(event, "Décision attendue ce matin")],
      synthesis: {
        classifications: [],
        assertions: [{
          nature: "hypothesis",
          statement: expiredStatement,
          confidence: 0.7,
          sourceEventIds: [event.id],
          validUntil: new Date(now.getTime() - 1),
        }],
        relationshipSummary: "Échange récent.",
        recommendedTone: null,
        contradictions: [],
        missingInformation: [],
        provider: "codex-cli",
        model: "gpt-5.6-luna",
      },
      generatedAt,
      privacyEpoch: 0,
      snapshotId: "snapshot-expired-assertion",
      contentHash: "hash-expired-assertion",
    });
    const assembler = new DefaultProspectContextAssembler(
      eventRepository([event]),
      snapshotRepository(snapshot),
      { read: async () => ({ currentState, privacyEpoch: 0, anonymizedAt: null }) },
      { read: async () => [] },
      {
        find: async () => ({
          ...enabledPolicy(),
          flags: {
            prospectMemoryCapture: true,
            prospectMemoryShadow: false,
            prospectMemorySetter: true,
            enabledCapabilities: ["setter_campaign"],
          },
        }),
      },
      { record: async (receipt) => receipt.id },
      { generate: () => "receipt-expired-assertion" },
      new Sha256ContentHasher(),
    );

    const bundle = await assembler.assemble({
      workspaceId: "workspace-1",
      contactId: "contact-1",
      capability: "setter_campaign",
      principalRole: "worker",
      requestKey: "expired-assertion-context",
      now,
    });

    expect(JSON.stringify(bundle.context)).not.toContain(expiredStatement);
    expect(bundle.status).toBe("stale");
    expect(bundle.waitCode).toBe("WAIT_MEMORY_STALE");
    expect(bundle.automaticActionAllowed).toBe(false);
  });

  test("removes a superseded fact from the overlay and waits for a rebuilt semantic summary", async () => {
    const oldEvent = memoryEvent(1, "event-old-commitment");
    const correction = {
      ...memoryEvent(2, "event-corrected-commitment"),
      supersedesEventId: oldEvent.id,
    };
    const oldFact = "Le prospect a confirmé mardi à 10 h.";
    const snapshot = new DeterministicProspectMemoryProjector().project({
      previousSnapshot: null,
      currentState,
      events: [oldEvent],
      materials: [sourceMaterial(oldEvent, oldFact)],
      synthesis: {
        classifications: [{ eventId: oldEvent.id, categories: ["commitment"] }],
        assertions: [],
        relationshipSummary: oldFact,
        recommendedTone: null,
        contradictions: [],
        missingInformation: [],
        provider: "codex-cli",
        model: "gpt-5.6-luna",
      },
      generatedAt: now,
      privacyEpoch: 0,
      snapshotId: "snapshot-before-correction",
      contentHash: "hash-before-correction",
    });
    const assembler = new DefaultProspectContextAssembler(
      eventRepository([oldEvent, correction]),
      snapshotRepository(snapshot),
      { read: async () => ({ currentState, privacyEpoch: 0, anonymizedAt: null }) },
      { read: async () => [sourceMaterial(correction, "Correction : aucun créneau confirmé.")] },
      {
        find: async () => ({
          ...enabledPolicy(),
          flags: {
            prospectMemoryCapture: true,
            prospectMemoryShadow: false,
            prospectMemorySetter: true,
            enabledCapabilities: ["setter_campaign"],
          },
        }),
      },
      { record: async (receipt) => receipt.id },
      { generate: () => "receipt-correction" },
      new Sha256ContentHasher(),
    );

    const bundle = await assembler.assemble({
      workspaceId: "workspace-1",
      contactId: "contact-1",
      capability: "setter_campaign",
      principalRole: "worker",
      requestKey: "corrected-context",
      now,
    });

    const rendered = JSON.stringify(bundle.context);
    expect(rendered).not.toContain(`\"commitments\":[{\"eventId\":\"${oldEvent.id}\"`);
    expect(rendered).toContain("Correction : aucun créneau confirmé.");
    expect(bundle.sourceEventIds).not.toContain(oldEvent.id);
    expect(bundle.excludedSourceEventIds).toContain(oldEvent.id);
    expect(rendered).not.toContain(oldFact);
    expect(bundle.waitCode).toBe("WAIT_MEMORY_STALE");
    expect(bundle.automaticActionAllowed).toBe(false);
  });

  test("removes an expired commercial fact from context and receipts without waiting for a refresh", async () => {
    const generatedAt = new Date(now.getTime() - 60 * 60 * 1_000);
    const event = {
      ...memoryEvent(1, "event-expired-fact"),
      occurredAt: new Date(generatedAt.getTime() - 60 * 60 * 1_000),
      validFrom: new Date(generatedAt.getTime() - 60 * 60 * 1_000),
      validTo: new Date(now.getTime() - 30 * 60 * 1_000),
    };
    const expiredFact = "Le prospect accepte un rendez-vous uniquement ce matin.";
    const snapshot = new DeterministicProspectMemoryProjector().project({
      previousSnapshot: null,
      currentState,
      events: [event],
      materials: [sourceMaterial(event, expiredFact)],
      synthesis: {
        classifications: [{ eventId: event.id, categories: ["commitment"] }],
        assertions: [],
        relationshipSummary: "Un créneau temporaire avait été proposé.",
        recommendedTone: null,
        contradictions: [],
        missingInformation: [],
        provider: "codex-cli",
        model: "gpt-5.6-luna",
      },
      generatedAt,
      privacyEpoch: 0,
      snapshotId: "snapshot-expired-fact",
      contentHash: "hash-expired-fact",
    });
    expect(snapshot.commercialState.commitments[0]?.validTo).toBe(event.validTo.toISOString());

    const assembler = new DefaultProspectContextAssembler(
      eventRepository([event]),
      snapshotRepository(snapshot),
      { read: async () => ({ currentState, privacyEpoch: 0, anonymizedAt: null }) },
      { read: async () => [] },
      {
        find: async () => ({
          ...enabledPolicy(),
          flags: {
            prospectMemoryCapture: true,
            prospectMemoryShadow: false,
            prospectMemorySetter: true,
            enabledCapabilities: ["setter_campaign"],
          },
        }),
      },
      { record: async (receipt) => receipt.id },
      { generate: () => "receipt-expired-fact" },
      new Sha256ContentHasher(),
    );

    const bundle = await assembler.assemble({
      workspaceId: "workspace-1",
      contactId: "contact-1",
      capability: "setter_campaign",
      principalRole: "worker",
      requestKey: "expired-fact-context",
      now,
    });

    expect(JSON.stringify(bundle.context)).not.toContain(expiredFact);
    expect(bundle.sourceEventIds).not.toContain(event.id);
    expect(bundle.excludedSourceEventIds).toContain(event.id);
    expect(bundle.status).toBe("stale");
    expect(bundle.waitCode).toBe("WAIT_MEMORY_STALE");
    expect(bundle.automaticActionAllowed).toBe(false);
  });

  test("does not send expired semantic material to the synthesizer", async () => {
    const event = {
      ...memoryEvent(1, "event-expired-semantic"),
      occurredAt: new Date(now.getTime() - 2 * 60 * 60 * 1_000),
      validFrom: new Date(now.getTime() - 2 * 60 * 60 * 1_000),
      validTo: new Date(now.getTime() - 1),
    };
    let synthesizerCalls = 0;
    const refresh = new RefreshProspectMemory(
      eventRepository([event]),
      snapshotRepository(null),
      { read: async () => ({ currentState, privacyEpoch: 0, anonymizedAt: null }) },
      { read: async () => [sourceMaterial(event, "Contrainte commerciale expirée")] },
      { find: async () => enabledPolicy() },
      { readUsage: async () => ({ refreshes: 0, costUsd: 0 }) },
      { synthesize: async () => { synthesizerCalls += 1; throw new Error("should not run"); } },
      new DeterministicProspectMemoryProjector(),
      new StrictProspectMemoryProjectionValidator(),
      { now: () => now },
      { generate: () => "snapshot-expired-semantic" },
      new Sha256ContentHasher(),
    );

    const result = await refresh.execute({
      workspaceId: "workspace-1",
      contactId: "contact-1",
      targetSequenceId: 1,
      privacyEpoch: 0,
      requestKey: "refresh-expired-semantic",
    });

    expect(result.outcome).toBe("published");
    expect(result.outcome === "published" && result.snapshot.modelProvider).toBeNull();
    expect(synthesizerCalls).toBe(0);
  });

  test("fails closed when fitting the context budget would discard an unintegrated event", async () => {
    const baseEvent = memoryEvent(1, "event-budget-base");
    const deltaEvent = memoryEvent(2, "event-budget-delta");
    const snapshot = new DeterministicProspectMemoryProjector().project({
      previousSnapshot: null,
      currentState,
      events: [baseEvent],
      materials: [sourceMaterial(baseEvent, "Échange initial")],
      synthesis: {
        classifications: [],
        assertions: [],
        relationshipSummary: "Relation active.",
        recommendedTone: null,
        contradictions: [],
        missingInformation: [],
        provider: null,
        model: null,
      },
      generatedAt: now,
      privacyEpoch: 0,
      snapshotId: "snapshot-budget",
      contentHash: "hash-budget",
    });
    const assembler = new DefaultProspectContextAssembler(
      eventRepository([baseEvent, deltaEvent]),
      snapshotRepository(snapshot),
      { read: async () => ({ currentState, privacyEpoch: 0, anonymizedAt: null }) },
      { read: async () => [sourceMaterial(deltaEvent, "x".repeat(40_000))] },
      {
        find: async () => ({
          ...enabledPolicy(),
          flags: {
            prospectMemoryCapture: true,
            prospectMemoryShadow: false,
            prospectMemorySetter: true,
            enabledCapabilities: ["setter_campaign"],
          },
        }),
      },
      { record: async (receipt) => receipt.id },
      { generate: () => "receipt-budget" },
      new Sha256ContentHasher(),
    );

    const bundle = await assembler.assemble({
      workspaceId: "workspace-1",
      contactId: "contact-1",
      capability: "setter_campaign",
      principalRole: "worker",
      requestKey: "budget-context",
      now,
    });

    expect(bundle.status).toBe("budget_blocked");
    expect(bundle.waitCode).toBe("WAIT_MEMORY_BUDGET");
    expect(bundle.automaticActionAllowed).toBe(false);
    expect(bundle.excludedSourceEventIds).toContain(deltaEvent.id);
  });

  test("fails closed when source material coverage is incomplete", async () => {
    const event = memoryEvent(1, "event-missing-material");
    const assembler = new DefaultProspectContextAssembler(
      eventRepository([event]),
      snapshotRepository(null),
      { read: async () => ({ currentState, privacyEpoch: 0, anonymizedAt: null }) },
      { read: async () => [] },
      { find: async () => enabledPolicy() },
      { record: async (receipt) => receipt.id },
      { generate: () => "receipt-missing-material" },
      new Sha256ContentHasher(),
    );

    await expect(assembler.assemble({
      workspaceId: "workspace-1",
      contactId: "contact-1",
      capability: "setter_campaign",
      principalRole: "worker",
      requestKey: "missing-material-context",
      now,
    })).rejects.toThrow("PROSPECT_MEMORY_SOURCE_MATERIAL_INCOMPLETE");
  });

  test("reports a snapshot older than 24 hours as stale in the assembled bundle", async () => {
    const event = memoryEvent(1, "event-old-snapshot");
    const snapshot = new DeterministicProspectMemoryProjector().project({
      previousSnapshot: null,
      currentState,
      events: [event],
      materials: [sourceMaterial(event, "Ancien échange")],
      synthesis: {
        classifications: [],
        assertions: [],
        relationshipSummary: "Ancienne synthèse.",
        recommendedTone: null,
        contradictions: [],
        missingInformation: [],
        provider: null,
        model: null,
      },
      generatedAt: new Date(now.getTime() - 24 * 60 * 60 * 1_000 - 1),
      privacyEpoch: 0,
      snapshotId: "snapshot-old",
      contentHash: "hash-old",
    });
    const assembler = new DefaultProspectContextAssembler(
      eventRepository([event]),
      snapshotRepository(snapshot),
      { read: async () => ({ currentState, privacyEpoch: 0, anonymizedAt: null }) },
      { read: async () => [] },
      {
        find: async () => ({
          ...enabledPolicy(),
          flags: {
            prospectMemoryCapture: true,
            prospectMemoryShadow: false,
            prospectMemorySetter: true,
            enabledCapabilities: ["setter_campaign"],
          },
        }),
      },
      { record: async (receipt) => receipt.id },
      { generate: () => "receipt-old" },
      new Sha256ContentHasher(),
    );

    const bundle = await assembler.assemble({
      workspaceId: "workspace-1",
      contactId: "contact-1",
      capability: "setter_campaign",
      principalRole: "worker",
      requestKey: "old-snapshot-context",
      now,
    });

    expect(bundle.status).toBe("stale");
    expect(bundle.waitCode).toBe("WAIT_MEMORY_STALE");
    expect(bundle.automaticActionAllowed).toBe(false);
  });
});

function memoryEvent(
  sequenceId: number,
  id: string,
  channel: "linkedin" | "email" | "whatsapp" = "linkedin",
): ProspectMemoryEvent {
  return {
    id,
    sequenceId,
    workspaceId: "workspace-1",
    sourceContactId: "contact-1",
    canonicalContactId: "contact-1",
    sourceKind: "message",
    sourceId: `message-${sequenceId}`,
    sourceVersion: 1,
    kind: "message_received",
    occurredAt: now,
    observedAt: now,
    validFrom: now,
    validTo: null,
    supersedesEventId: null,
    payload: { channel, direction: "inbound" },
    schemaVersion: PROSPECT_MEMORY_EVENT_SCHEMA_VERSION,
  };
}

function sourceMaterial(event: ProspectMemoryEvent, content: string): ProspectMemorySourceMaterial {
  return { event, content, language: "fr", sourceHash: `hash-${event.id}` };
}

function eventRepository(events: readonly ProspectMemoryEvent[]): ProspectMemoryEventRepository {
  return {
    append: async () => { throw new Error("not used"); },
    listAfter: async (input) => events.filter((event) => event.sequenceId > input.sequenceId),
    latestSequence: async () => events.at(-1)?.sequenceId ?? 0,
  };
}

function snapshotRepository(snapshot: ProspectMemorySnapshot | null): ProspectMemorySnapshotRepository {
  return {
    findCurrent: async () => snapshot,
    publishIfCurrent: async () => true,
  };
}

function enabledPolicy(): ProspectMemoryPolicy {
  return {
    flags: {
      prospectMemoryCapture: true,
      prospectMemoryShadow: true,
      prospectMemorySetter: true,
      enabledCapabilities: ["setter_campaign"],
    },
    processingProfiles: [{
      provider: "codex-cli",
      encryptedInTransit: true,
      trainingUse: "none",
      providerRetentionDays: 0,
      regionOrJurisdiction: "EU",
      operatorAccessPolicy: "Restricted support access with audit logs",
      subprocessorsReviewed: true,
      deletionProcedure: "Provider deletion request followed by contract expiry",
      personalDataAllowed: true,
      allowedCapabilities: ["setter_campaign"],
      reviewedAt: now,
    }],
    maxDailySemanticRefreshes: 1,
    maxDailyCostUsd: 10,
  };
}
