import { describe, expect, test } from "bun:test";
import {
  buildFilters,
  computeIcpFit,
} from "@outbound/interface/http/discovery-handler";

describe("buildFilters", () => {
  test("prefers industries from the published criteria, then the first committee title", () => {
    const filters = buildFilters(
      {
        criteria: { industries: ["conseil juridique", "M&A", "audit"], geography: "France" },
        buyingCommittee: ["Associé / Directeur de cabinet", "Directeur de cabinet"],
      },
      25,
    );
    expect(filters).toEqual({
      api: "classic",
      category: "people",
      keywords: "conseil juridique Associé",
      limit: 25,
      enrichContacts: false,
    });
  });

  test("falls back to sectors when industries are absent", () => {
    const filters = buildFilters(
      { criteria: { sectors: ["legal"] }, buyingCommittee: ["CTO"] },
      10,
    );
    expect(filters.keywords).toBe("legal CTO");
  });
});

describe("computeIcpFit", () => {
  const version = {
    criteria: { industries: ["legal", "avocat"], geography: "France" },
    buyingCommittee: ["Associé"],
  };

  test("matches geography, industry and role on an aligned profile", () => {
    const fit = computeIcpFit(version, {
      fullName: "Marion Delacroix",
      headline: "Associée · cabinet d'avocats",
      linkedinUrl: null,
      location: "Paris, France",
      companyName: "Cabinet legal",
      providerData: {},
    });
    expect(fit.gaps).toEqual([]);
    expect(fit.matches.join(" ")).toContain("France");
    expect(fit.matches.join(" ")).toContain("Associé");
  });

  test("marks geography and industry gaps on a misaligned profile", () => {
    const fit = computeIcpFit(version, {
      fullName: "John Smith",
      headline: "Accountant",
      linkedinUrl: null,
      location: "London, UK",
      companyName: "Smith & Co",
      providerData: {},
    });
    expect(fit.gaps.join(" ")).toContain("Géographie à vérifier");
    expect(fit.gaps.join(" ")).toContain("Secteur non confirmé");
  });

  test("matches a committee role written with slashes", () => {
    const fit = computeIcpFit(
      { criteria: { industries: ["avocat"], geography: "France" }, buyingCommittee: ["Associé / Directeur de cabinet"] },
      {
        fullName: "Marc Delassus",
        headline: "Avocat associé - Conseil juridique et fiscal",
        linkedinUrl: null,
        location: "Paris, France",
        companyName: null,
        providerData: {},
      },
    );
    expect(fit.matches.join(" ")).toContain("Rôle : Associé");
  });
});
