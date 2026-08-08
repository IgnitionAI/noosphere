export type { ProspectSearchFilters, ProspectSource, ProspectSourceCandidate } from "@outbound/application/crm/prospect-source";
export { ProviderUnavailableError } from "@outbound/application/crm/prospect-source";
import type { ProspectSearchFilters, ProspectSource, ProspectSourceCandidate } from "@outbound/application/crm/prospect-source";
import { ProviderUnavailableError } from "@outbound/application/crm/prospect-source";

type UnipileAccount = {
  id?: string;
  type?: string;
  name?: string;
  sources?: { status?: string }[];
};

/**
 * Unipile V1 prospect source. V1 uses a dedicated DSN ({subdomain}.unipile.com:{port}),
 * X-API-KEY auth and /api/v1 routes — it is NOT compatible with the global v2 API.
 */
export class UnipileProspectSource implements ProspectSource {
  readonly #dsn: string;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  #accountId: string | null = null;

  constructor(options: {
    dsn: string;
    apiKey: string;
    fetchImpl?: typeof fetch;
    accountId?: string;
    timeoutMs?: number;
  }) {
    this.#dsn = options.dsn.replace(/\/+$/, "");
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#timeoutMs = Math.max(1_000, options.timeoutMs ?? 10_000);
    this.#accountId = options.accountId ?? null;
  }

  async searchPeople(filters: ProspectSearchFilters): Promise<readonly ProspectSourceCandidate[]> {
    const accountId = await this.#linkedinAccountId();
    const url =
      `${this.#dsn}/api/v1/linkedin/search` +
      `?account_id=${encodeURIComponent(accountId)}&limit=${filters.limit}`;
    const response = await this.#request(url, {
      method: "POST",
      headers: {
        "X-API-KEY": this.#apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        api: filters.api,
        category: filters.category,
        keywords: filters.keywords,
      }),
    });
    if (!response.ok) {
      throw new ProviderUnavailableError(
        `Unipile people search failed (${response.status})`,
        response.status,
      );
    }
    const body = (await response.json().catch(() => null)) as {
      items?: {
        id?: string;
        name?: string;
        full_name?: string;
        headline?: string;
        public_profile_url?: string;
        profile_url?: string;
        location?: string;
        current_company?: string;
        public_identifier?: string;
        network_distance?: string;
      }[];
    } | null;
    return (body?.items ?? [])
      .filter((item) => item.name ?? item.full_name)
      .map((item) => ({
        fullName: (item.name ?? item.full_name)!,
        headline: item.headline ?? null,
        linkedinUrl: item.public_profile_url ?? item.profile_url ?? null,
        location: item.location ?? null,
        companyName: item.current_company ?? null,
        providerData: {
          providerId: item.id ?? null,
          accountId,
          publicIdentifier: item.public_identifier ?? null,
          networkDistance: item.network_distance ?? null,
        },
      }));
  }

  async #linkedinAccountId(): Promise<string> {
    if (this.#accountId) return this.#accountId;
    const response = await this.#request(`${this.#dsn}/api/v1/accounts`, {
      headers: { "X-API-KEY": this.#apiKey, accept: "application/json" },
    });
    if (!response.ok) {
      throw new ProviderUnavailableError(
        `Unipile accounts lookup failed (${response.status})`,
        response.status,
      );
    }
    const body = (await response.json().catch(() => null)) as {
      items?: UnipileAccount[];
    } | null;
    const account = (body?.items ?? []).find(
      (item) =>
        item.type?.toUpperCase() === "LINKEDIN" &&
        item.sources?.some((source) => source.status === "OK"),
    );
    if (!account?.id) {
      throw new ProviderUnavailableError(
        "No healthy LinkedIn account is connected to Unipile",
        null,
      );
    }
    this.#accountId = account.id;
    return account.id;
  }

  async #request(input: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      return await this.#fetch(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ProviderUnavailableError(`Unipile request timed out after ${this.#timeoutMs}ms`);
      }
      throw new ProviderUnavailableError(
        `Unipile request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
