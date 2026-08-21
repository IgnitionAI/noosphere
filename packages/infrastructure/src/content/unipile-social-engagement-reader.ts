import type {
  SocialEngagementActorSnapshot,
  SocialEngagementReader,
  SocialEngagementSnapshot,
} from "@outbound/application/content/social-ports";
import { SocialProviderError } from "@outbound/application/content/social-ports";

export class UnipileSocialEngagementReader implements SocialEngagementReader {
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

  async listEngagements(input: Parameters<SocialEngagementReader["listEngagements"]>[0]) {
    requireValue(input.accountId, "accountId");
    requireValue(input.providerSocialId, "providerSocialId");
    const query = new URLSearchParams({
      account_id: input.accountId,
      limit: String(Math.min(100, Math.max(1, input.limit))),
    });
    if (input.cursor) query.set("cursor", input.cursor);
    if (input.parentProviderInteractionId) query.set("comment_id", input.parentProviderInteractionId);
    if (input.kind === "comments") query.set("sort_by", "MOST_RECENT");
    const page = await this.#read(`/api/v1/posts/${encodeURIComponent(input.providerSocialId)}/${input.kind}?${query}`);
    const items = Array.isArray(page.items) ? page.items : Array.isArray(page.data) ? page.data : [];
    const observedAt = new Date();
    const data = items.flatMap((value) => {
      const record = recordValue(value);
      if (!record) return [];
      return input.kind === "comments"
        ? normalizeComment(record, input.parentProviderInteractionId, observedAt)
        : normalizeReaction(record, input.providerSocialId, input.parentProviderInteractionId, observedAt);
    });
    return {
      data,
      nextCursor: stringValue(page.cursor) ?? stringValue(recordValue(page.paging)?.cursor) ?? null,
    };
  }

  async #read(path: string): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(`${this.#dsn}${path}`, {
        headers: { accept: "application/json", "X-API-KEY": this.#apiKey },
        signal: controller.signal,
      });
      if (!response.ok) throw providerReadError(response.status, await safeDetail(response));
      const body: unknown = await response.json().catch(() => null);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw invalidResponse("Unipile returned invalid social engagement JSON");
      return body as Record<string, unknown>;
    } catch (error) {
      if (error instanceof SocialProviderError) throw error;
      throw new SocialProviderError("SOCIAL_PROVIDER_UNAVAILABLE", `Unipile social engagement read failed: ${safeMessage(error)}`, "not_sent", true);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizeComment(record: Record<string, unknown>, parentId: string | null, observedAt: Date): SocialEngagementSnapshot[] {
  const id = stringValue(record.id) ?? stringValue(record.provider_id);
  if (!id) return [];
  const actor = commentActor(record);
  const body = stringValue(record.text) ?? "";
  const comment: SocialEngagementSnapshot = {
    providerInteractionId: id,
    type: parentId ? "reply" : "comment",
    parentProviderInteractionId: parentId ?? stringValue(record.parent_comment_id),
    actor,
    body,
    reaction: null,
    mentionedProviderId: null,
    mentionedName: null,
    occurredAt: dateValue(record.parsed_datetime) ?? dateValue(record.created_at) ?? dateValue(record.date),
    observedAt,
    replyCount: counter(record.reply_counter) ?? counter(record.child_comment_count) ?? 0,
    reactionCount: counter(record.reaction_counter) ?? counter(record.comment_like_count) ?? 0,
  };
  const mentions = Array.isArray(record.mentions) ? record.mentions : [];
  return [comment, ...mentions.flatMap((value) => {
    const mention = recordValue(value);
    const mentionedProviderId = mention ? stringValue(mention.profile_id) ?? stringValue(mention.id) ?? stringValue(mention.provider_id) : null;
    if (!mentionedProviderId) return [];
    return [{
      providerInteractionId: `${id}:mention:${mentionedProviderId}`,
      type: "mention" as const,
      parentProviderInteractionId: id,
      actor,
      body,
      reaction: null,
      mentionedProviderId,
      mentionedName: stringValue(mention?.name),
      occurredAt: comment.occurredAt,
      observedAt,
      replyCount: 0,
      reactionCount: 0,
    }];
  })];
}

function normalizeReaction(
  record: Record<string, unknown>,
  providerSocialId: string,
  parentId: string | null,
  observedAt: Date,
): SocialEngagementSnapshot[] {
  const author = recordValue(record.author);
  const actor: SocialEngagementActorSnapshot = {
    providerId: stringValue(author?.id) ?? stringValue(author?.provider_id),
    name: stringValue(author?.name) ?? stringValue(author?.public_identifier),
    headline: stringValue(author?.headline),
    profileUrl: httpUrl(author?.profile_url),
  };
  const reaction = stringValue(record.value);
  if (!reaction) return [];
  const providerActorKey = actor.providerId ?? actor.profileUrl ?? actor.name ?? "unknown";
  const scope = parentId ?? stringValue(record.comment_id) ?? "post";
  return [{
    providerInteractionId: `reaction:${providerSocialId}:${scope}:${providerActorKey}:${reaction}`,
    type: "reaction",
    parentProviderInteractionId: parentId ?? stringValue(record.comment_id),
    actor,
    body: null,
    reaction,
    mentionedProviderId: null,
    mentionedName: null,
    occurredAt: dateValue(record.parsed_datetime) ?? dateValue(record.created_at) ?? dateValue(record.date),
    observedAt,
    replyCount: 0,
    reactionCount: 0,
  }];
}

function commentActor(record: Record<string, unknown>): SocialEngagementActorSnapshot {
  const details = recordValue(record.author_details);
  const instagram = recordValue(record.author);
  return {
    providerId: stringValue(details?.id) ?? stringValue(instagram?.provider_id),
    name: stringValue(record.author) ?? stringValue(instagram?.public_identifier),
    headline: stringValue(details?.headline),
    profileUrl: httpUrl(details?.profile_url),
  };
}

function providerReadError(status: number, detail: string): SocialProviderError {
  if (status === 401 || status === 403) return new SocialProviderError("SOCIAL_AUTHENTICATION_FAILED", `Unipile refused the LinkedIn engagement read${detail}`, "not_sent", false);
  if (status === 404 || status === 422) return new SocialProviderError("SOCIAL_ACCOUNT_UNAVAILABLE", `Unipile cannot read this LinkedIn engagement${detail}`, "not_sent", false);
  if (status === 429) return new SocialProviderError("SOCIAL_RATE_LIMITED", `Unipile rate limit reached${detail}`, "not_sent", true);
  return new SocialProviderError("SOCIAL_PROVIDER_UNAVAILABLE", `Unipile returned ${status}${detail}`, "not_sent", status >= 500);
}

function invalidResponse(message: string) { return new SocialProviderError("SOCIAL_PROVIDER_RESPONSE_INVALID", message, "not_sent", false); }
function recordValue(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function stringValue(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function counter(value: unknown): number | null { const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN; return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null; }
function dateValue(value: unknown): Date | null { if (typeof value !== "string" && typeof value !== "number") return null; const numeric = typeof value === "number" ? (value < 10_000_000_000 ? value * 1_000 : value) : value; const date = new Date(numeric); return Number.isNaN(date.getTime()) ? null : date; }
function httpUrl(value: unknown): string | null { if (typeof value !== "string") return null; try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null; } catch { return null; } }
function requireValue(value: string, field: string) { if (!value.trim()) throw new SocialProviderError("SOCIAL_REQUEST_INVALID", `${field} is required`, "not_sent", false); }
function safeMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
async function safeDetail(response: Response): Promise<string> { const body = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 400); return body ? `: ${body}` : ""; }
