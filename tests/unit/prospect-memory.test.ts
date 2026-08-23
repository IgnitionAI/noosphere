import { describe, expect, test } from "bun:test";
import {
  assertProspectMemoryCapabilityMatrix,
  assertProspectMemoryCoverageMatrix,
  assertProspectMemoryProcessingAllowed,
  disabledProspectMemoryFeatureFlags,
  isProspectMemoryCapabilityAuthorized,
  isProspectMemoryCapabilityEnabled,
  prospectMemoryCoverageMatrix,
  prospectMemorySourceMutations,
  type ProspectMemoryPolicy,
} from "@outbound/application/prospect-memory/prospect-memory";
import {
  PROSPECT_MEMORY_EVENT_SCHEMA_VERSION,
  assertProspectMemoryAssertion,
  assertProspectMemoryEvent,
  canTransitionProspectMemoryStatus,
  isProspectMemoryUsableForAutomaticAction,
  prospectMemoryCapabilities,
} from "@outbound/domain/prospect-memory/prospect-memory";

const now = new Date("2026-08-23T08:00:00.000Z");

describe("prospect 360 memory contracts", () => {
  test("covers every authoritative mutation exactly once", () => {
    expect(() => assertProspectMemoryCoverageMatrix()).not.toThrow();
    expect(prospectMemoryCoverageMatrix).toHaveLength(prospectMemorySourceMutations.length);
    expect(new Set(prospectMemoryCoverageMatrix.map((rule) => rule.eventKind)).size).toBe(
      prospectMemorySourceMutations.length,
    );
  });

  test("defines a server-side authorization matrix for every capability", () => {
    expect(() => assertProspectMemoryCapabilityMatrix()).not.toThrow();
    expect(prospectMemoryCapabilities).toHaveLength(6);
    expect(isProspectMemoryCapabilityAuthorized("setter_campaign", "viewer")).toBe(false);
    expect(isProspectMemoryCapabilityAuthorized("call_preparation", "viewer")).toBe(true);
    expect(isProspectMemoryCapabilityAuthorized("setter_campaign", "worker")).toBe(true);
  });

  test("keeps all memory behavior disabled by default", () => {
    for (const capability of prospectMemoryCapabilities) {
      expect(isProspectMemoryCapabilityEnabled(disabledProspectMemoryFeatureFlags, capability)).toBe(false);
    }
  });

  test("requires a reviewed provider processing profile before personal context is sent", () => {
    const policy: ProspectMemoryPolicy = {
      flags: {
        prospectMemoryCapture: true,
        prospectMemoryShadow: true,
        prospectMemorySetter: false,
        enabledCapabilities: ["call_preparation"],
      },
      processingProfiles: [{
        provider: "codex-cli",
        encryptedInTransit: true,
        trainingUse: "none",
        providerRetentionDays: 30,
        regionOrJurisdiction: "EU",
        operatorAccessPolicy: "Restricted support access with audit logs",
        subprocessorsReviewed: true,
        deletionProcedure: "Provider deletion request followed by contract expiry",
        personalDataAllowed: true,
        allowedCapabilities: ["call_preparation"],
        reviewedAt: now,
      }],
      maxDailySemanticRefreshes: 1_000,
      maxDailyCostUsd: 10,
    };
    expect(assertProspectMemoryProcessingAllowed({
      policy,
      provider: "codex-cli",
      capability: "call_preparation",
    }).provider).toBe("codex-cli");
    expect(() => assertProspectMemoryProcessingAllowed({
      policy,
      provider: "kimi-code",
      capability: "call_preparation",
    })).toThrow("PROSPECT_MEMORY_PROCESSING_PROFILE_REQUIRED");
  });

  test("validates event versions and sourced semantic assertions", () => {
    expect(() => assertProspectMemoryEvent({
      id: "event-1",
      sequenceId: 1,
      workspaceId: "workspace-1",
      sourceContactId: "contact-1",
      canonicalContactId: "contact-1",
      sourceKind: "message",
      sourceId: "message-1",
      sourceVersion: 1,
      kind: "message_received",
      occurredAt: now,
      observedAt: now,
      validFrom: now,
      validTo: null,
      supersedesEventId: null,
      payload: { direction: "inbound" },
      schemaVersion: PROSPECT_MEMORY_EVENT_SCHEMA_VERSION,
    })).not.toThrow();
    expect(() => assertProspectMemoryEvent({
      id: "event-future",
      sequenceId: 2,
      workspaceId: "workspace-1",
      sourceContactId: "contact-1",
      canonicalContactId: "contact-1",
      sourceKind: "message",
      sourceId: "message-future",
      sourceVersion: 1,
      kind: "message_received",
      occurredAt: now,
      observedAt: now,
      validFrom: new Date(now.getTime() + 1),
      validTo: null,
      supersedesEventId: null,
      payload: {},
      schemaVersion: PROSPECT_MEMORY_EVENT_SCHEMA_VERSION,
    })).toThrow("PROSPECT_MEMORY_FUTURE_VALIDITY_UNSUPPORTED");
    expect(() => assertProspectMemoryAssertion({
      id: "assertion-1",
      nature: "hypothesis",
      statement: "Le prospect semble préférer une démonstration courte.",
      confidence: 0.7,
      sources: [],
      validUntil: null,
      status: "active",
    })).toThrow("PROSPECT_MEMORY_ASSERTION_SOURCE_REQUIRED");
  });

  test("makes anonymization terminal and blocks stale or oversized context", () => {
    expect(canTransitionProspectMemoryStatus("fresh", "anonymized")).toBe(true);
    expect(canTransitionProspectMemoryStatus("anonymized", "fresh")).toBe(false);

    expect(isProspectMemoryUsableForAutomaticAction({
      status: "fresh",
      generatedAt: new Date(now.getTime() - 60_000),
      now,
      deltaEventCount: 201,
      deltaOldestOccurredAt: now,
      contextBudgetExceeded: false,
    })).toEqual({ allowed: false, waitCode: "WAIT_MEMORY_STALE" });

    expect(isProspectMemoryUsableForAutomaticAction({
      status: "fresh",
      generatedAt: new Date(now.getTime() - 60_000),
      now,
      deltaEventCount: 20,
      deltaOldestOccurredAt: now,
      contextBudgetExceeded: true,
    })).toEqual({ allowed: false, waitCode: "WAIT_MEMORY_BUDGET" });
  });
});
