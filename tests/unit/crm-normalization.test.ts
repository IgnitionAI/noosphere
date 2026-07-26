import { describe, expect, test } from "bun:test";
import {
  normalizeDomain,
  normalizeEmail,
  normalizeLinkedinUrl,
  normalizePhone,
} from "@outbound/domain/crm/normalization";

describe("normalizeDomain", () => {
  test("strips scheme, www, path and lowercases", () => {
    expect(normalizeDomain("HTTPS://WWW.Example.com/path?q=1")).toBe("example.com");
    expect(normalizeDomain("example.com")).toBe("example.com");
    expect(normalizeDomain("  www.Sub.Example.FR  ")).toBe("sub.example.fr");
  });

  test("returns null for empty or missing values", () => {
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
    expect(normalizeDomain(undefined)).toBeNull();
  });

  test("rejects malformed domains", () => {
    expect(() => normalizeDomain("not a domain")).toThrow("INVALID_COMPANY_DOMAIN");
    expect(() => normalizeDomain("example")).toThrow("INVALID_COMPANY_DOMAIN");
  });
});

describe("normalizeEmail", () => {
  test("lowercases and trims", () => {
    expect(normalizeEmail("  Jean.Dupont@Example.com ")).toBe("jean.dupont@example.com");
  });

  test("rejects malformed emails", () => {
    expect(() => normalizeEmail("not-an-email")).toThrow("INVALID_CONTACT_EMAIL");
  });
});

describe("normalizeLinkedinUrl", () => {
  test("lowercases, strips query and trailing slash", () => {
    expect(
      normalizeLinkedinUrl("HTTPS://www.Linkedin.com/in/Jean-Dupont/?utm_source=x"),
    ).toBe("linkedin.com/in/jean-dupont");
  });

  test("rejects non-linkedin urls", () => {
    expect(() => normalizeLinkedinUrl("https://example.com/in/jean")).toThrow(
      "INVALID_LINKEDIN_URL",
    );
  });
});

describe("normalizePhone", () => {
  test("keeps digits and leading plus", () => {
    expect(normalizePhone("+33 6 12 34 56 78")).toBe("+33612345678");
    expect(normalizePhone("06.12.34.56.78")).toBe("0612345678");
  });

  test("rejects too short numbers", () => {
    expect(() => normalizePhone("123")).toThrow("INVALID_PHONE_NUMBER");
  });
});
