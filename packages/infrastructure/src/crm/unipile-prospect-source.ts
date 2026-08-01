export interface ProspectSearchFilters {
  readonly api: "classic" | "sales_navigator" | "recruiter";
  readonly category: "people";
  readonly keywords: string;
  readonly limit: number;
}

export interface ProspectSourceCandidate {
  readonly fullName: string;
  readonly headline: string | null;
  readonly linkedinUrl: string | null;
  readonly location: string | null;
  readonly companyName: string | null;
  readonly providerData: Readonly<Record<string, unknown>>;
}

export interface ProspectSource {
  searchPeople(filters: ProspectSearchFilters): Promise<readonly ProspectSourceCandidate[]>;
}

export class ProviderUnavailableError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

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
  #accountId: string | null = null;

  constructor(options: {
    dsn: string;
    apiKey: string;
    fetchImpl?: typeof fetch;
    accountId?: string;
  }) {
    this.#dsn = options.dsn.replace(/\/+$/, "");
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#accountId = options.accountId ?? null;
  }

  async searchPeople(filters: ProspectSearchFilters): Promise<readonly ProspectSourceCandidate[]> {
    const accountId = await this.#linkedinAccountId();
    const url =
      `${this.#dsn}/api/v1/linkedin/search` +
      `?account_id=${encodeURIComponent(accountId)}&limit=${filters.limit}`;
    const response = await this.#fetch(url, {
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
    const response = await this.#fetch(`${this.#dsn}/api/v1/accounts`, {
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
}
