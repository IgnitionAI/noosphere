import { describe, expect, test } from "bun:test";
import {
  extractPublicWhatsappObservations,
  normalizeMetropolitanFrenchMobile,
} from "@outbound/domain/crm/whatsapp-sourcing";

describe("WhatsApp sourcing qualification", () => {
  test("normalizes only metropolitan French mobile numbers", () => {
    expect(normalizeMetropolitanFrenchMobile("06 12 34 56 78")).toBe("+33612345678");
    expect(normalizeMetropolitanFrenchMobile("+33 7 49 62 84 70")).toBe("+33749628470");
    expect(normalizeMetropolitanFrenchMobile("01 42 00 00 00")).toBeNull();
    expect(normalizeMetropolitanFrenchMobile("+590 690 12 34 56")).toBeNull();
    expect(normalizeMetropolitanFrenchMobile("+32 470 12 34 56")).toBeNull();
  });

  test("accepts a public professional mobile on the official domain", () => {
    const [observation] = extractPublicWhatsappObservations({
      markdown: "Cabinet Durand — Contact professionnel — Portable : +33 6 12 34 56 78",
      sourceUrl: "https://cabinet-durand.fr/contact",
      sourceTitle: "Contact",
      companyName: "Cabinet Durand",
      companyDomain: "cabinet-durand.fr",
      sourceKind: "web",
    });
    expect(observation).toMatchObject({
      e164: "+33612345678",
      endpointKind: "company",
      attributionStatus: "strong",
      rejectionReason: null,
    });
  });

  test("rejects an ambiguous mobile without professional context", () => {
    const [observation] = extractPublicWhatsappObservations({
      markdown: "Pour le week-end : 06 12 34 56 78",
      sourceUrl: "https://cabinet-durand.fr/blog",
      sourceTitle: "Blog",
      companyName: "Cabinet Durand",
      companyDomain: "cabinet-durand.fr",
      sourceKind: "web",
    });
    expect(observation).toMatchObject({
      e164: "+33612345678",
      attributionStatus: "rejected",
      rejectionReason: "PROFESSIONAL_CONTEXT_MISSING",
    });
  });

  test("keeps non-official web attribution weak", () => {
    const [observation] = extractPublicWhatsappObservations({
      markdown: "Cabinet Durand — Portable : 06 12 34 56 78",
      sourceUrl: "https://directory.example/cabinet-durand",
      sourceTitle: "Cabinet Durand",
      companyName: "Cabinet Durand",
      companyDomain: "cabinet-durand.fr",
      sourceKind: "web",
    });
    expect(observation).toMatchObject({
      attributionStatus: "weak",
      rejectionReason: "COMPANY_ATTRIBUTION_WEAK",
    });
  });
});
