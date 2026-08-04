import { describe, expect, test } from "bun:test";
import {
  normalizeUnipileLinkedinKeywords,
  ProviderUnavailableError,
  selectProfessionalEmail,
  UnipileProspectSource,
} from "@outbound/infrastructure/crm/unipile-prospect-source";

function fakeFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) =>
    handler(String(url), init)) as typeof fetch;
}

const accountsResponse = {
  object: "AccountList",
  items: [
    { id: "acc_li_1", type: "LINKEDIN", name: "Jean", sources: [{ status: "OK" }] },
    { id: "acc_wa_1", type: "WHATSAPP", name: "WA", sources: [{ status: "OK" }] },
    { id: "acc_mail_1", type: "GMAIL", name: "Sales", sources: [{ status: "OK" }] },
  ],
};

describe("UnipileProspectSource", () => {
  test("normalizes agent-generated Boolean expressions into a bounded provider query", () => {
    const raw = `site:linkedin.com/in ("Directeur juridique" OR "Responsable legal operations" OR "General Counsel") AND ("IA juridique" OR CLM) location:France -ESN -cabinet`;
    const normalized = normalizeUnipileLinkedinKeywords(raw);

    expect(normalized.length).toBeLessThanOrEqual(160);
    expect(normalized).not.toContain("site:");
    expect(normalized).not.toMatch(/\b(?:AND|OR|NOT)\b/);
    expect(normalized).not.toContain("(");
    expect(normalized).not.toContain("-");
    expect(normalized).toContain("Directeur juridique");
  });

  test("resolves the first healthy LinkedIn account and posts a people search", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const source = new UnipileProspectSource({
      dsn: "https://api37.unipile.com:16796",
      apiKey: "secret-key",
      fetchImpl: fakeFetch((url, init) => {
        calls.push({ url, init });
        if (url.endsWith("/api/v1/accounts")) {
          return Response.json(accountsResponse);
        }
        return Response.json({
          object: "LinkedinSearch",
          cursor: null,
          items: [
            {
              id: "li_1",
              name: "Marion Delacroix",
              headline: "Associée · Cabinet Delacroix",
              public_profile_url:
                "https://www.linkedin.com/in/marion-delacroix?miniProfileUrn=urn%3Ali%3Aabc",
              location: "Paris, France",
              public_identifier: "marion-delacroix",
              network_distance: "DISTANCE_2",
            },
          ],
        });
      }),
    });

    const candidates = await source.searchPeople({
      api: "classic",
      category: "people",
      keywords: "managing partner legaltech",
      limit: 25,
    });

    expect(calls[0]!.url).toBe("https://api37.unipile.com:16796/api/v1/accounts");
    expect(calls[0]!.init?.headers).toMatchObject({ "X-API-KEY": "secret-key" });
    expect(calls[1]!.url).toBe(
      "https://api37.unipile.com:16796/api/v1/linkedin/search?account_id=acc_li_1&limit=25",
    );
    expect(calls[1]!.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({
      api: "classic",
      category: "people",
      keywords: "managing partner legaltech",
    });
    expect(candidates).toEqual([
      {
        fullName: "Marion Delacroix",
        headline: "Associée · Cabinet Delacroix",
        linkedinUrl:
          "https://www.linkedin.com/in/marion-delacroix?miniProfileUrn=urn%3Ali%3Aabc",
        location: "Paris, France",
        companyName: null,
        channels: {
          linkedin: {
            value:
              "https://www.linkedin.com/in/marion-delacroix?miniProfileUrn=urn%3Ali%3Aabc",
            normalizedValue: "linkedin.com/in/marion-delacroix",
            status: "found",
            confidence: "medium",
            source: "unipile_linkedin_search",
          },
          email: {
            value: null,
            normalizedValue: null,
            status: "unavailable",
            confidence: "none",
            source: null,
          },
          whatsapp: {
            value: null,
            normalizedValue: null,
            status: "unavailable",
            confidence: "none",
            source: null,
          },
        },
        providerData: {
          providerId: "li_1",
          accountId: "acc_li_1",
          publicIdentifier: "marion-delacroix",
          networkDistance: "DISTANCE_2",
        },
      },
    ]);
  });

  test("follows every LinkedIn cursor when autonomous sourcing is exhaustive", async () => {
    const searchUrls: string[] = [];
    const source = new UnipileProspectSource({
      dsn: "https://api37.unipile.com:16796",
      apiKey: "secret-key",
      fetchImpl: fakeFetch((url) => {
        if (url.endsWith("/api/v1/accounts")) return Response.json(accountsResponse);
        searchUrls.push(url);
        const cursor = new URL(url).searchParams.get("cursor");
        return Response.json(cursor
          ? { cursor: null, items: [{ id: "li_2", name: "Second Prospect" }] }
          : { cursor: "next-page", items: [{ id: "li_1", name: "First Prospect" }] });
      }),
    });

    const candidates = await source.searchPeople({
      api: "classic",
      category: "people",
      keywords: "direction juridique",
      limit: 50,
      exhaustive: true,
    });

    expect(candidates.map((candidate) => candidate.fullName)).toEqual([
      "First Prospect",
      "Second Prospect",
    ]);
    expect(searchUrls).toHaveLength(2);
    expect(new URL(searchUrls[1]!).searchParams.get("cursor")).toBe("next-page");
  });

  test("enriches a LinkedIn result with a professional email and verified WhatsApp", async () => {
    const calls: string[] = [];
    const source = new UnipileProspectSource({
      dsn: "https://api37.unipile.com:16796",
      apiKey: "secret-key",
      fetchImpl: fakeFetch((url) => {
        calls.push(url);
        if (url.endsWith("/api/v1/accounts")) return Response.json(accountsResponse);
        if (url.includes("/api/v1/linkedin/search")) {
          return Response.json({
            items: [{
              id: "li_1",
              name: "Marion D.",
              headline: "Associée",
              public_profile_url: "https://www.linkedin.com/in/marion-delacroix/",
              public_identifier: "marion-delacroix",
            }],
          });
        }
        if (url.includes("/api/v1/users/marion-delacroix?account_id=acc_li_1")) {
          return Response.json({
            provider: "LINKEDIN",
            provider_id: "li_1",
            public_identifier: "marion-delacroix",
            public_profile_url: "https://www.linkedin.com/in/marion-delacroix/",
            first_name: "Marion",
            last_name: "Delacroix",
            headline: "Associée · Cabinet Delacroix",
            location: "Paris, France",
            contact_info: {
              emails: ["marion@gmail.com", "marion.delacroix@cabinet-delacroix.fr"],
              phones: ["+33 6 12 34 56 78"],
            },
            work_experience: [{ company: "Cabinet Delacroix", current: true }],
          });
        }
        if (url.includes("/api/v1/users/33612345678?account_id=acc_wa_1")) {
          return Response.json({ provider: "WHATSAPP" });
        }
        return Response.json({ title: "Not found" }, { status: 404 });
      }),
    });

    const [candidate] = await source.searchPeople({
      api: "classic",
      category: "people",
      keywords: "associé legal",
      limit: 1,
      enrichContacts: true,
    });

    expect(candidate).toMatchObject({
      fullName: "Marion Delacroix",
      companyName: "Cabinet Delacroix",
      channels: {
        linkedin: { status: "verified", confidence: "high" },
        email: {
          value: "marion.delacroix@cabinet-delacroix.fr",
          normalizedValue: "marion.delacroix@cabinet-delacroix.fr",
          status: "found",
          source: "linkedin_contact_info",
        },
        whatsapp: {
          value: "+33 6 12 34 56 78",
          normalizedValue: "+33612345678",
          status: "verified",
          source: "unipile_whatsapp_profile",
        },
      },
    });
    expect(calls).toHaveLength(4);
  });

  test("keeps personal inboxes out of the professional email field", () => {
    expect(selectProfessionalEmail(["person@gmail.com", "person@outlook.fr"])).toBeNull();
    expect(selectProfessionalEmail(["bad", "person@company.fr"])).toBe("person@company.fr");
  });

  test("enriches an autonomous LinkedIn profile without leaking email or WhatsApp into the campaign", async () => {
    const source = new UnipileProspectSource({
      dsn: "https://api37.unipile.com:16796",
      apiKey: "secret-key",
      fetchImpl: fakeFetch((url) => {
        if (url.endsWith("/api/v1/accounts")) return Response.json(accountsResponse);
        return Response.json({
          provider: "LINKEDIN",
          provider_id: "li_1",
          public_identifier: "marion-delacroix",
          public_profile_url: "https://www.linkedin.com/in/marion-delacroix/",
          first_name: "Marion",
          last_name: "Delacroix",
          headline: "Associée · Cabinet Delacroix",
          contact_info: { emails: ["marion@cabinet.fr"], phones: ["+33612345678"] },
          work_experience: [{ company: "Cabinet Delacroix", current: true }],
        });
      }),
    });
    const enriched = await source.enrichLinkedinProfile({
      fullName: "Marion D.",
      headline: null,
      linkedinUrl: "https://www.linkedin.com/in/marion-delacroix/",
      location: null,
      companyName: null,
      providerData: { publicIdentifier: "marion-delacroix" },
    });
    expect(enriched).toMatchObject({
      fullName: "Marion Delacroix",
      companyName: "Cabinet Delacroix",
      channels: {
        linkedin: { status: "verified" },
        email: { status: "unavailable" },
        whatsapp: { status: "unavailable" },
      },
    });
  });

  test("resolves healthy sending accounts for every autonomous channel", async () => {
    const source = new UnipileProspectSource({
      dsn: "https://api37.unipile.com:16796",
      apiKey: "secret-key",
      fetchImpl: fakeFetch(() => Response.json(accountsResponse)),
    });
    expect(await source.resolveHealthyAccount("linkedin")).toBe("acc_li_1");
    expect(await source.resolveHealthyAccount("whatsapp")).toBe("acc_wa_1");
    expect(await source.resolveHealthyAccount("email")).toBe("acc_mail_1");
  });

  test("prefers the workspace-selected WhatsApp account over a global fallback", async () => {
    const source = new UnipileProspectSource({
      dsn: "https://api37.unipile.com:16796",
      apiKey: "secret-key",
      whatsappAccountId: "acc_wa_global",
      resolveWhatsappAccountId: async () => "acc_wa_workspace",
      fetchImpl: fakeFetch(() => Response.json({
        items: [
          { id: "acc_wa_global", type: "WHATSAPP", sources: [{ status: "OK" }] },
          { id: "acc_wa_workspace", type: "WHATSAPP", sources: [{ status: "OK" }] },
        ],
      })),
    });
    expect(await source.resolveHealthyAccount("whatsapp")).toBe("acc_wa_workspace");
  });

  test("fails recoverably when no healthy LinkedIn account exists", async () => {
    const source = new UnipileProspectSource({
      dsn: "https://api37.unipile.com:16796",
      apiKey: "secret-key",
      fetchImpl: fakeFetch(() =>
        Response.json({
          items: [
            { id: "acc_li_2", type: "LINKEDIN", sources: [{ status: "CREDENTIALS" }] },
          ],
        }),
      ),
    });
    await expect(
      source.searchPeople({ api: "classic", category: "people", keywords: "cto", limit: 10 }),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  test("maps provider HTTP errors to a recoverable error with its status", async () => {
    const source = new UnipileProspectSource({
      dsn: "https://api37.unipile.com:16796",
      apiKey: "secret-key",
      fetchImpl: fakeFetch((url) => {
        if (url.endsWith("/api/v1/accounts")) return Response.json(accountsResponse);
        return Response.json({ title: "Too many requests" }, { status: 429 });
      }),
    });
    const error = await source
      .searchPeople({ api: "classic", category: "people", keywords: "cto", limit: 10 })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect((error as ProviderUnavailableError).status).toBe(429);
  });
});
