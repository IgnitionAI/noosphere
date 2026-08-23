import type {
  SocialContentReader,
  SocialContentSnapshot,
  SocialMetricsReader,
  SocialMetricsSnapshot,
} from "@outbound/application/content/social-ports";
import { SocialProviderError } from "@outbound/application/content/social-ports";

export class UnipileSocialContentReader implements SocialContentReader, SocialMetricsReader {
  readonly #dsn: string;
  readonly #apiKey: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: { readonly dsn: string; readonly apiKey: string; readonly timeoutMs?: number; readonly fetchImpl?: typeof fetch }) {
    this.#dsn = options.dsn.replace(/\/+$/, "");
    this.#apiKey = options.apiKey;
    this.#timeoutMs = options.timeoutMs ?? 20_000;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async listOwnContent(input: { readonly accountId: string; readonly cursor: string | null; readonly limit: number }) {
    requireValue(input.accountId, "accountId");
    // Unipile can emit one final opaque cursor whose decoded pagination token
    // is null. Sending that cursor back produces a 400 even though the
    // historical feed is simply exhausted. Treat it as an explicit end marker
    // both for new responses and for durable cursors stored before this guard.
    if (input.cursor && isTerminalPaginationCursor(input.cursor)) {
      return { data: [], nextCursor: null };
    }
    const owner = await this.#read(`/api/v1/users/me?account_id=${encodeURIComponent(input.accountId)}`);
    const ownerId = stringValue(owner.provider_id) ?? stringValue(owner.id);
    if (!ownerId) throw invalidResponse("Unipile returned no provider id for the LinkedIn account owner");
    const query = new URLSearchParams({ account_id: input.accountId, limit: String(Math.min(100, Math.max(1, input.limit))) });
    if (input.cursor) query.set("cursor", input.cursor);
    const page = await this.#read(`/api/v1/users/${encodeURIComponent(ownerId)}/posts?${query}`);
    const items = Array.isArray(page.items) ? page.items : Array.isArray(page.data) ? page.data : [];
    const observedAt = new Date();
    const providerCursor = stringValue(page.cursor) ?? stringValue(recordValue(page.paging)?.cursor) ?? null;
    return {
      data: items.flatMap((item) => {
        const normalized = recordValue(item) ? normalizePost(recordValue(item)!, ownerId, observedAt) : null;
        return normalized ? [normalized] : [];
      }),
      nextCursor: providerCursor && !isTerminalPaginationCursor(providerCursor) ? providerCursor : null,
    };
  }

  async readMetrics(input: { readonly accountId: string; readonly providerPostIds: readonly string[] }): Promise<readonly SocialMetricsSnapshot[]> {
    requireValue(input.accountId, "accountId");
    const results: SocialMetricsSnapshot[] = [];
    for (const providerPostId of [...new Set(input.providerPostIds)].slice(0, 100)) {
      requireValue(providerPostId, "providerPostId");
      let post: Record<string, unknown>;
      try {
        post = await this.#read(`/api/v1/posts/${encodeURIComponent(providerPostId)}?account_id=${encodeURIComponent(input.accountId)}`);
      } catch (error) {
        // A deleted or no-longer-visible post must not invalidate the account
        // nor discard every other post already returned by the provider page.
        if (error instanceof SocialProviderError && error.code === "SOCIAL_ACCOUNT_UNAVAILABLE") continue;
        throw error;
      }
      const canonicalId = providerPostIdentifier(post) ?? providerPostId;
      results.push({
        providerPostId: canonicalId,
        impressions: counter(post.impressions_counter),
        reactions: counter(post.reaction_counter),
        comments: counter(post.comment_counter),
        reposts: counter(post.repost_counter),
        observedAt: new Date(),
      });
    }
    return results;
  }

  async #read(path: string): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(`${this.#dsn}${path}`, {
        headers: { accept: "application/json", "X-API-KEY": this.#apiKey },
        signal: controller.signal,
      });
      if (!response.ok) throw providerReadError(response.status, await safeDetail(response), retryAfterMilliseconds(response.headers.get("retry-after")));
      const body: unknown = await response.json().catch(() => null);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw invalidResponse("Unipile returned invalid social content JSON");
      return body as Record<string, unknown>;
    } catch (error) {
      if (error instanceof SocialProviderError) throw error;
      throw new SocialProviderError("SOCIAL_PROVIDER_UNAVAILABLE", `Unipile social content read failed: ${safeMessage(error)}`, "not_sent", true);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizePost(record: Record<string, unknown>, ownerId: string, observedAt: Date): SocialContentSnapshot | null {
  const providerPostId = providerPostIdentifier(record);
  const text = stringValue(record.text);
  if (!providerPostId || text === null) return null;
  return {
    providerPostId,
    socialId: stringValue(record.social_id),
    authorProviderId: stringValue(recordValue(record.author)?.provider_id) ?? ownerId,
    text,
    url: httpUrl(record.share_url) ?? httpUrl(record.url),
    publishedAt: dateValue(record.parsed_datetime) ?? dateValue(record.published_at) ?? dateValue(record.created_at),
    observedAt,
  };
}

function providerPostIdentifier(record: Record<string, unknown>): string | null {
  return stringValue(record.id)
    ?? stringValue(record.post_id)
    ?? numericActivityId(stringValue(record.social_id))
    ?? stringValue(record.social_id);
}

function numericActivityId(value: string | null): string | null {
  const match = value?.match(/^urn:li:activity:(\d+)$/);
  return match?.[1] ?? null;
}

function providerReadError(status: number, detail: string, retryAfterMs: number | null): SocialProviderError {
  if (status === 401 || status === 403) return new SocialProviderError("SOCIAL_AUTHENTICATION_FAILED", `Unipile refused the LinkedIn read${detail}`, "not_sent", false);
  if (status === 404 || status === 422) return new SocialProviderError("SOCIAL_ACCOUNT_UNAVAILABLE", `Unipile cannot read this LinkedIn resource${detail}`, "not_sent", false);
  if (status === 429) return new SocialProviderError("SOCIAL_RATE_LIMITED", `Unipile rate limit reached${detail}`, "not_sent", true, retryAfterMs);
  return new SocialProviderError("SOCIAL_PROVIDER_UNAVAILABLE", `Unipile returned ${status}${detail}`, "not_sent", status >= 500);
}

function retryAfterMilliseconds(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds)
    ? Math.ceil(seconds * 1_000)
    : new Date(value).getTime() - Date.now();
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return null;
  return Math.min(24 * 60 * 60_000, milliseconds);
}

function isTerminalPaginationCursor(value: string): boolean {
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64").toString("utf8")) as unknown;
    const cursor = recordValue(decoded);
    return cursor?.pagination_token === null
      && typeof cursor.start === "number"
      && Number.isFinite(cursor.start)
      && cursor.start >= 0;
  } catch {
    return false;
  }
}

function invalidResponse(message: string) { return new SocialProviderError("SOCIAL_PROVIDER_RESPONSE_INVALID", message, "not_sent", false); }
function recordValue(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function stringValue(value: unknown): string | null { return typeof value === "string" && value.trim() ? value : null; }
function dateValue(value: unknown): Date | null { if (typeof value !== "string" && typeof value !== "number") return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; }
function counter(value: unknown): number | null { const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN; return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null; }
function httpUrl(value: unknown): string | null { if (typeof value !== "string") return null; try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null; } catch { return null; } }
function requireValue(value: string, field: string) { if (!value.trim()) throw new SocialProviderError("SOCIAL_REQUEST_INVALID", `${field} is required`, "not_sent", false); }
function safeMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
async function safeDetail(response: Response): Promise<string> { const body = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 400); return body ? `: ${body}` : ""; }
