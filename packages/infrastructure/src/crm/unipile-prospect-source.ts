import {
  emptyProspectChannels,
  type ProspectChannel,
  type ProspectChannels,
} from "@outbound/domain/crm/prospect-channels";
import {
  normalizeEmail,
  normalizeLinkedinUrl,
  normalizePhone,
} from "@outbound/domain/crm/normalization";
import type { WhatsappReachabilityResult } from "@outbound/application/crm/whatsapp-sourcing-ports";

export interface ProspectSearchFilters {
  readonly api: "classic" | "sales_navigator" | "recruiter";
  readonly category: "people";
  readonly keywords: string;
  readonly limit: number;
  readonly exhaustive?: boolean;
  readonly enrichContacts?: boolean;
}

export interface ProspectSourceCandidate {
  readonly fullName: string;
  readonly headline: string | null;
  readonly linkedinUrl: string | null;
  readonly location: string | null;
  readonly companyName: string | null;
  readonly channels?: ProspectChannels;
  readonly providerData: Readonly<Record<string, unknown>>;
}

export interface ProspectSource {
  searchPeople(filters: ProspectSearchFilters): Promise<readonly ProspectSourceCandidate[]>;
  enrichLinkedinProfile?(candidate: ProspectSourceCandidate): Promise<ProspectSourceCandidate>;
  verifyWhatsappNumber?(phone: string): Promise<ProspectChannel>;
  verifyWhatsappReachability?(phone: string): Promise<WhatsappReachabilityResult>;
  resolveHealthyAccount?(channel: "linkedin" | "email" | "whatsapp"): Promise<string>;
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
  #linkedinAccountId: string | null = null;
  #whatsappAccountId: string | null = null;
  readonly #resolveWhatsappAccountId: (() => Promise<string | null>) | null;
  #accounts: readonly UnipileAccount[] | null = null;

  constructor(options: {
    dsn: string;
    apiKey: string;
    fetchImpl?: typeof fetch;
    accountId?: string;
    whatsappAccountId?: string;
    resolveWhatsappAccountId?: () => Promise<string | null>;
  }) {
    this.#dsn = options.dsn.replace(/\/+$/, "");
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#linkedinAccountId = options.accountId ?? null;
    this.#whatsappAccountId = options.whatsappAccountId ?? null;
    this.#resolveWhatsappAccountId = options.resolveWhatsappAccountId ?? null;
  }

  async searchPeople(filters: ProspectSearchFilters): Promise<readonly ProspectSourceCandidate[]> {
    const accountId = await this.#resolveLinkedinAccountId();
    const results: ProspectSourceCandidate[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    do {
      const url = new URL(`${this.#dsn}/api/v1/linkedin/search`);
      url.searchParams.set("account_id", accountId);
      url.searchParams.set("limit", String(Math.min(50, Math.max(1, filters.limit))));
      if (cursor) url.searchParams.set("cursor", cursor);
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
          keywords: normalizeUnipileLinkedinKeywords(filters.keywords),
        }),
      });
      if (!response.ok) {
        const providerDetail = await response.text().catch(() => "");
        throw new ProviderUnavailableError(
          `Unipile people search failed (${response.status})${safeProviderDetail(providerDetail)}`,
          response.status,
        );
      }
      const body = (await response.json().catch(() => null)) as {
        cursor?: string | null;
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
      const candidates = (body?.items ?? [])
      .filter((item) => item.name ?? item.full_name)
      .map((item) => ({
        fullName: (item.name ?? item.full_name)!,
        headline: item.headline ?? null,
        linkedinUrl: item.public_profile_url ?? item.profile_url ?? null,
        location: item.location ?? null,
        companyName: item.current_company ?? null,
        channels: channelsFromSearch(item.public_profile_url ?? item.profile_url ?? null),
        providerData: {
          providerId: item.id ?? null,
          accountId,
          publicIdentifier: item.public_identifier ?? null,
          networkDistance: item.network_distance ?? null,
        },
      }));
      results.push(...candidates);
      const nextCursor = body?.cursor?.trim() || null;
      if (!filters.exhaustive || !nextCursor || seenCursors.has(nextCursor)) break;
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    } while (cursor);
    const candidates = deduplicateSearchCandidates(results);
    if (!filters.enrichContacts || candidates.length === 0) return candidates;
    return mapWithConcurrency(candidates, 3, (candidate) =>
      this.#enrichCandidate(candidate, accountId),
    );
  }

  async resolveHealthyAccount(channelType: "linkedin" | "email" | "whatsapp"): Promise<string> {
    if (channelType === "linkedin") return this.#resolveLinkedinAccountId();
    if (channelType === "whatsapp") {
      const accountId = await this.#resolveHealthyWhatsappAccountId();
      if (accountId) return accountId;
      throw new ProviderUnavailableError("No healthy WhatsApp account is connected to Unipile");
    }
    const account = (await this.#accountsList()).find((item) =>
      ["GMAIL", "GOOGLE", "MICROSOFT", "OUTLOOK", "IMAP"].some((type) => healthyAccount(item, type)),
    );
    if (!account?.id) {
      throw new ProviderUnavailableError("No healthy email account is connected to Unipile");
    }
    return account.id;
  }

  async enrichLinkedinProfile(candidate: ProspectSourceCandidate): Promise<ProspectSourceCandidate> {
    const accountId = await this.#resolveLinkedinAccountId();
    const identifier = candidateIdentifier(candidate);
    if (!identifier) return candidate;
    const url = new URL(`${this.#dsn}/api/v1/users/${encodeURIComponent(identifier)}`);
    url.searchParams.set("account_id", accountId);
    const response = await this.#fetch(url, {
      headers: { "X-API-KEY": this.#apiKey, accept: "application/json" },
    });
    if (!response.ok) return candidate;
    const profile = (await response.json().catch(() => null)) as UnipileLinkedinProfile | null;
    if (!profile) return candidate;
    const linkedinUrl = profile.public_profile_url ?? candidate.linkedinUrl;
    const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim();
    return {
      ...candidate,
      fullName: fullName || candidate.fullName,
      headline: profile.headline ?? candidate.headline,
      linkedinUrl,
      location: profile.location ?? candidate.location,
      companyName:
        profile.work_experience?.find((experience) => experience.current)?.company
        ?? candidate.companyName,
      channels: {
        ...emptyProspectChannels(),
        linkedin: linkedinChannel(linkedinUrl, "unipile_linkedin_profile", "verified", "high"),
      },
      providerData: {
        ...candidate.providerData,
        profileProviderId: profile.provider_id ?? null,
        profilePublicIdentifier: profile.public_identifier ?? null,
      },
    };
  }

  async #resolveLinkedinAccountId(): Promise<string> {
    if (this.#linkedinAccountId) return this.#linkedinAccountId;
    const account = (await this.#accountsList()).find(
      (item) => healthyAccount(item, "LINKEDIN"),
    );
    if (!account?.id) {
      throw new ProviderUnavailableError(
        "No healthy LinkedIn account is connected to Unipile",
        null,
      );
    }
    this.#linkedinAccountId = account.id;
    return account.id;
  }

  async #accountsList(): Promise<readonly UnipileAccount[]> {
    if (this.#accounts) return this.#accounts;
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
    this.#accounts = body?.items ?? [];
    return this.#accounts;
  }

  async #enrichCandidate(
    candidate: ProspectSourceCandidate,
    linkedinAccountId: string,
  ): Promise<ProspectSourceCandidate> {
    const identifier = candidateIdentifier(candidate);
    if (!identifier) return candidate;
    const url = new URL(`${this.#dsn}/api/v1/users/${encodeURIComponent(identifier)}`);
    url.searchParams.set("account_id", linkedinAccountId);
    const response = await this.#fetch(url, {
      headers: { "X-API-KEY": this.#apiKey, accept: "application/json" },
    }).catch(() => null);
    if (!response?.ok) {
      return {
        ...candidate,
        providerData: {
          ...candidate.providerData,
          enrichmentError: response ? `linkedin_profile_${response.status}` : "linkedin_profile_network",
        },
      };
    }
    const profile = (await response.json().catch(() => null)) as UnipileLinkedinProfile | null;
    if (!profile) return candidate;
    const linkedinUrl = profile.public_profile_url ?? candidate.linkedinUrl;
    const email = selectProfessionalEmail(profile.contact_info?.emails ?? []);
    const phone = selectPhone(profile.contact_info?.phones ?? []);
    const whatsappCheck = phone
      ? await this.verifyWhatsappNumber(phone)
      : emptyProspectChannels().whatsapp;
    const whatsapp =
      phone && whatsappCheck.status !== "verified"
        ? channel(phone, safePhone(phone)!, "unverified", "low", "linkedin_contact_info")
        : whatsappCheck;
    const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim();
    const companyName =
      profile.work_experience?.find((experience) => experience.current)?.company ??
      candidate.companyName;
    return {
      ...candidate,
      fullName: fullName || candidate.fullName,
      headline: profile.headline ?? candidate.headline,
      linkedinUrl,
      location: profile.location ?? candidate.location,
      companyName,
      channels: {
        linkedin: linkedinChannel(linkedinUrl, "unipile_linkedin_profile", "verified", "high"),
        email: email
          ? channel(email, normalizeEmail(email), "found", "medium", "linkedin_contact_info")
          : emptyProspectChannels().email,
        whatsapp,
      },
      providerData: {
        ...candidate.providerData,
        profileProviderId: profile.provider_id ?? null,
        profilePublicIdentifier: profile.public_identifier ?? null,
      },
    };
  }

  async verifyWhatsappNumber(phone: string): Promise<ProspectChannel> {
    const result = await this.verifyWhatsappReachability(phone);
    const normalized = safePhone(phone);
    if (!normalized) return emptyProspectChannels().whatsapp;
    return result.status === "verified"
      ? channel(phone, normalized, "verified", "high", "unipile_whatsapp_profile")
      : channel(phone, normalized, "unverified", "low", "unipile_whatsapp_check");
  }

  async verifyWhatsappReachability(phone: string): Promise<WhatsappReachabilityResult> {
    const checkedAt = new Date();
    const expiresAt = new Date(checkedAt.getTime() + 30 * 24 * 60 * 60 * 1_000);
    const normalized = safePhone(phone);
    if (!normalized) {
      return {
        status: "unknown",
        providerAccountId: null,
        checkedAt,
        expiresAt: checkedAt,
        source: "live",
        errorCode: "INVALID_PHONE_NUMBER",
      };
    }
    const accountId = await this.#resolveHealthyWhatsappAccountId().catch(() => null);
    if (!accountId) {
      return {
        status: "unknown",
        providerAccountId: null,
        checkedAt,
        expiresAt: checkedAt,
        source: "live",
        errorCode: "WHATSAPP_ACCOUNT_DISCONNECTED",
      };
    }
    const identifier = normalized.replace(/^\+/, "");
    const url = new URL(`${this.#dsn}/api/v1/users/${encodeURIComponent(identifier)}`);
    url.searchParams.set("account_id", accountId);
    const response = await this.#fetch(url, {
      headers: { "X-API-KEY": this.#apiKey, accept: "application/json" },
    }).catch(() => null);
    if (!response?.ok) {
      return {
        status: "unknown",
        providerAccountId: accountId,
        checkedAt,
        expiresAt: checkedAt,
        source: "live",
        errorCode: response ? `UNIPILE_${response.status}` : "UNIPILE_NETWORK_ERROR",
      };
    }
    const body = (await response.json().catch(() => null)) as { provider?: string } | null;
    return {
      status: body?.provider?.toUpperCase() === "WHATSAPP" ? "verified" : "not_registered",
      providerAccountId: accountId,
      checkedAt,
      expiresAt,
      source: "live",
      errorCode: null,
    };
  }

  async #resolveHealthyWhatsappAccountId(): Promise<string | null> {
    const selected = await this.#resolveWhatsappAccountId?.();
    if (selected) {
      const account = (await this.#accountsList()).find(
        (item) => item.id === selected && healthyAccount(item, "WHATSAPP"),
      );
      return account?.id ?? null;
    }
    if (this.#whatsappAccountId) return this.#whatsappAccountId;
    const account = (await this.#accountsList()).find(
      (item) => healthyAccount(item, "WHATSAPP"),
    );
    this.#whatsappAccountId = account?.id ?? null;
    return this.#whatsappAccountId;
  }
}

function deduplicateSearchCandidates(
  candidates: readonly ProspectSourceCandidate[],
): ProspectSourceCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const providerId = typeof candidate.providerData.providerId === "string"
      ? candidate.providerData.providerId
      : null;
    const key = providerId ?? candidate.linkedinUrl ?? `${candidate.fullName}|${candidate.companyName ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeUnipileLinkedinKeywords(value: string, maxLength = 160): string {
  const compact = value
    .replace(/site:\S+/gi, " ")
    .replace(/(?:^|\s)-(?:"[^"]+"|\S+)/g, " ")
    .replace(/\b(?:AND|OR|NOT)\b/gi, " ")
    .replace(/\b(?:location|headcount|company\s+headcount)\s*:/gi, " ")
    .replace(/[()[\]{}"|;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return "B2B";

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const token of compact.split(" ")) {
    const normalized = token.toLocaleLowerCase("fr");
    if (!normalized || seen.has(normalized)) continue;
    const candidate = [...unique, token].join(" ");
    if (candidate.length > maxLength) break;
    seen.add(normalized);
    unique.push(token);
  }
  return unique.join(" ") || compact.slice(0, maxLength).trim();
}

function safeProviderDetail(value: string): string {
  const detail = value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  return detail ? `: ${detail}` : "";
}

type UnipileLinkedinProfile = {
  provider_id?: string;
  public_identifier?: string;
  public_profile_url?: string;
  first_name?: string;
  last_name?: string;
  headline?: string;
  location?: string;
  contact_info?: { emails?: string[]; phones?: string[] };
  work_experience?: { company?: string; current?: boolean }[];
};

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.fr",
  "outlook.com",
  "outlook.fr",
  "live.com",
  "live.fr",
  "yahoo.com",
  "yahoo.fr",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "orange.fr",
  "wanadoo.fr",
  "laposte.net",
]);

export function selectProfessionalEmail(emails: readonly string[]): string | null {
  for (const value of emails) {
    try {
      const normalized = normalizeEmail(value);
      const domain = normalized.split("@")[1];
      if (domain && !PERSONAL_EMAIL_DOMAINS.has(domain)) return value.trim();
    } catch {
      // Ignore malformed provider values.
    }
  }
  return null;
}

function selectPhone(phones: readonly string[]): string | null {
  return phones.find((phone) => safePhone(phone))?.trim() ?? null;
}

function channelsFromSearch(linkedinUrl: string | null): ProspectChannels {
  return {
    ...emptyProspectChannels(),
    linkedin: linkedinChannel(linkedinUrl, "unipile_linkedin_search", "found", "medium"),
  };
}

function linkedinChannel(
  value: string | null,
  source: string,
  status: "verified" | "found",
  confidence: "high" | "medium",
): ProspectChannel {
  if (!value) return emptyProspectChannels().linkedin;
  try {
    return channel(value, normalizeLinkedinUrl(value), status, confidence, source);
  } catch {
    return emptyProspectChannels().linkedin;
  }
}

function channel(
  value: string,
  normalizedValue: string,
  status: ProspectChannel["status"],
  confidence: ProspectChannel["confidence"],
  source: string,
): ProspectChannel {
  return { value, normalizedValue, status, confidence, source };
}

function safePhone(value: string): string | null {
  try {
    return normalizePhone(value);
  } catch {
    return null;
  }
}

function candidateIdentifier(candidate: ProspectSourceCandidate): string | null {
  const publicIdentifier = candidate.providerData.publicIdentifier;
  if (typeof publicIdentifier === "string" && publicIdentifier.trim()) return publicIdentifier;
  const providerId = candidate.providerData.providerId;
  if (typeof providerId === "string" && providerId.trim()) return providerId;
  if (!candidate.linkedinUrl) return null;
  try {
    const pathname = new URL(candidate.linkedinUrl).pathname.replace(/\/+$/, "");
    return pathname.split("/").at(-1) || null;
  } catch {
    return null;
  }
}

function healthyAccount(account: UnipileAccount, type: string): boolean {
  return (
    account.type?.toUpperCase() === type &&
    account.sources?.some((source) => source.status === "OK") === true
  );
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor++;
        results[index] = await mapper(values[index]!);
      }
    }),
  );
  return results;
}
