import { expect, test } from "bun:test";
import { assertEnrichmentObservation, canReplaceObservation } from "@outbound/domain/crm/enrichment-observation";

test("enrichment observations never silently downgrade confidence", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  expect(canReplaceObservation({ status: "verified", observedAt: now }, { status: "probable", observedAt: new Date("2026-01-02T00:00:00Z") })).toBe(false);
  expect(canReplaceObservation({ status: "probable", observedAt: now }, { status: "verified", observedAt: new Date("2025-01-01T00:00:00Z") })).toBe(true);
  expect(canReplaceObservation({ status: "verified", observedAt: now }, { status: "verified", observedAt: new Date("2026-01-02T00:00:00Z") })).toBe(true);
});

test("phone observations require explicit public/personal classification", () => {
  expect(() => assertEnrichmentObservation({ field: "phone", status: "found" })).toThrow("ENRICHMENT_PHONE_KIND_REQUIRED");
  expect(() => assertEnrichmentObservation({ field: "phone", status: "found", phoneKind: "public_company" })).not.toThrow();
  expect(() => assertEnrichmentObservation({ field: "email", status: "probable", phoneKind: "personal" })).toThrow("ENRICHMENT_PHONE_KIND_INVALID");
});

