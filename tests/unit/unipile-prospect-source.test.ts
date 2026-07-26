import { describe, expect, test } from "bun:test";
import {
  ProviderUnavailableError,
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
  ],
};

describe("UnipileProspectSource", () => {
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
              full_name: "Marion Delacroix",
              headline: "Associée · Cabinet Delacroix",
              public_profile_url: "https://www.linkedin.com/in/marion-delacroix/",
              location: "Paris, France",
              current_company: "Cabinet Delacroix",
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
        linkedinUrl: "https://www.linkedin.com/in/marion-delacroix/",
        location: "Paris, France",
        companyName: "Cabinet Delacroix",
        providerData: {
          providerId: "li_1",
          accountId: "acc_li_1",
        },
      },
    ]);
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
