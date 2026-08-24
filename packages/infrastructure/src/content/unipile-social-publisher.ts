import type {
  SocialPublishResult,
  SocialPublishRequest,
  SocialPublishTextRequest,
  SocialPublisher,
  SocialPublisherCapabilities,
} from "@outbound/application/content/social-ports";
import { SocialProviderError } from "@outbound/application/content/social-ports";

export class UnipileSocialPublisher implements SocialPublisher {
  readonly #dsn: string;
  readonly #apiKey: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: {
    readonly dsn: string;
    readonly apiKey: string;
    readonly timeoutMs?: number;
    readonly fetchImpl?: typeof fetch;
  }) {
    this.#dsn = options.dsn.replace(/\/+$/, "");
    this.#apiKey = options.apiKey;
    this.#timeoutMs = options.timeoutMs ?? 20_000;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async observeCapabilities(input: {
    readonly accountId: string;
    readonly now?: Date;
  }): Promise<SocialPublisherCapabilities> {
    requireIdentifier(input.accountId, "accountId");
    const response = await this.#request(
      `/api/v1/accounts/${encodeURIComponent(input.accountId)}`,
      { method: "GET" },
      "read",
    );
    const body = await parseJsonRecord(response, "SOCIAL_PROVIDER_RESPONSE_INVALID");
    const providerType = typeof body.type === "string" ? body.type.toUpperCase() : "";
    if (providerType !== "LINKEDIN") {
      throw new SocialProviderError(
        "SOCIAL_ACCOUNT_UNAVAILABLE",
        "The selected account is not a LinkedIn account",
        "not_sent",
        false,
      );
    }
    const healthy = accountIsHealthy(body);
    return {
      network: "linkedin",
      accountId: input.accountId,
      accountHealthy: healthy,
      textPublishing: healthy ? "available" : "unavailable",
      mediaPublishing: {
        image: healthy ? "available" : "unavailable",
        document: healthy ? "available" : "unavailable",
        video: healthy ? "available" : "unavailable",
      },
      observedAt: input.now ?? new Date(),
    };
  }

  async publishText(input: SocialPublishTextRequest): Promise<SocialPublishResult> {
    return this.publish({ ...input, attachments: [] });
  }

  async publish(input: SocialPublishRequest): Promise<SocialPublishResult> {
    requireIdentifier(input.accountId, "accountId");
    requireIdentifier(input.requestKey, "requestKey");
    if (!input.text.trim()) {
      throw new SocialProviderError(
        "SOCIAL_REQUEST_INVALID",
        "A LinkedIn text publication cannot be empty",
        "not_sent",
        false,
      );
    }
    if (input.attachments.length > 1 && input.attachments.some((attachment) => attachment.kind !== "image")) {
      throw new SocialProviderError("SOCIAL_REQUEST_INVALID", "LinkedIn accepts multiple images or one document/video", "not_sent", false);
    }
    const request = input.attachments.length === 0
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ account_id: input.accountId, text: input.text }),
        }
      : multipartPost(input);
    const response = await this.#request(
      "/api/v1/posts",
      {
        method: "POST",
        ...request,
      },
      "publish",
    );
    const body = await parseJsonRecord(response, "SOCIAL_PROVIDER_RESPONSE_INVALID", "unknown");
    const providerPostId = firstString(body.id, body.post_id, body.provider_id);
    if (!providerPostId) {
      throw new SocialProviderError(
        "SOCIAL_PROVIDER_RESPONSE_INVALID",
        "Unipile accepted the publication but returned no post identifier",
        "unknown",
        false,
      );
    }
    return {
      providerPostId,
      socialId: firstString(body.social_id) ?? null,
      url: firstHttpUrl(body.share_url, body.url) ?? null,
      publishedAt: parseDate(body.parsed_datetime ?? body.published_at ?? body.created_at),
    };
  }

  async #request(
    path: string,
    init: RequestInit,
    operation: "read" | "publish",
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response: Response;
    try {
      response = await this.#fetch(`${this.#dsn}${path}`, {
        ...init,
        headers: {
          accept: "application/json",
          "X-API-KEY": this.#apiKey,
          ...init.headers,
        },
        signal: controller.signal,
      });
    } catch (error) {
      const definitelyNotSent = operation === "read" || isConnectionEstablishmentFailure(error);
      throw new SocialProviderError(
        "SOCIAL_PROVIDER_UNAVAILABLE",
        `Unipile is temporarily unreachable: ${safeErrorMessage(error)}`,
        definitelyNotSent ? "not_sent" : "unknown",
        definitelyNotSent,
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) return response;
    const detail = await safeResponseDetail(response);
    if (response.status === 401 || response.status === 403) {
      throw new SocialProviderError(
        "SOCIAL_AUTHENTICATION_FAILED",
        `Unipile refused the credentials${detail}`,
        "not_sent",
        false,
      );
    }
    if (response.status === 404 && operation === "read") {
      throw new SocialProviderError(
        "SOCIAL_ACCOUNT_UNAVAILABLE",
        `The selected LinkedIn account is unavailable${detail}`,
        "not_sent",
        false,
      );
    }
    if (response.status === 422) {
      throw new SocialProviderError(
        "SOCIAL_CONTENT_REJECTED",
        `Unipile rejected the LinkedIn publication${detail}`,
        "not_sent",
        false,
      );
    }
    if (response.status === 429) {
      throw new SocialProviderError(
        "SOCIAL_RATE_LIMITED",
        `Unipile rate limit reached${detail}`,
        "not_sent",
        true,
        retryAfter(response.headers.get("retry-after")),
      );
    }
    if (response.status >= 500) {
      throw new SocialProviderError(
        "SOCIAL_PROVIDER_UNAVAILABLE",
        `Unipile returned ${response.status}${detail}`,
        operation === "publish" ? "unknown" : "not_sent",
        operation !== "publish",
      );
    }
    throw new SocialProviderError(
      "SOCIAL_ACCOUNT_UNAVAILABLE",
      `Unipile returned ${response.status}${detail}`,
      "not_sent",
      false,
    );
  }
}

function multipartPost(input: SocialPublishRequest): Pick<RequestInit, "body"> {
  const form = new FormData();
  form.append("account_id", input.accountId);
  form.append("text", input.text);
  for (const attachment of input.attachments) {
    const bytes = Uint8Array.from(attachment.content);
    form.append("attachments", new Blob([bytes.buffer], { type: attachment.mimeType }), attachment.filename);
  }
  return { body: form };
}

function requireIdentifier(value: string, field: string): void {
  if (value.trim()) return;
  throw new SocialProviderError(
    "SOCIAL_REQUEST_INVALID",
    `${field} is required`,
    "not_sent",
    false,
  );
}

async function parseJsonRecord(
  response: Response,
  code: "SOCIAL_PROVIDER_RESPONSE_INVALID",
  deliveryState: "not_sent" | "unknown" = "not_sent",
): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => null) as unknown;
  if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  throw new SocialProviderError(code, "Unipile returned an invalid JSON response", deliveryState, false);
}

function accountIsHealthy(body: Record<string, unknown>): boolean {
  const status = typeof body.status === "string" ? body.status.toUpperCase() : "";
  if (["CONNECTED", "ACTIVE", "OK", "HEALTHY", "READY"].includes(status)) return true;
  if (!Array.isArray(body.sources)) return false;
  return body.sources.some((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const source = value as Record<string, unknown>;
    return typeof source.status === "string" && ["CONNECTED", "ACTIVE", "OK", "READY"].includes(source.status.toUpperCase());
  });
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function firstHttpUrl(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    try {
      const url = new URL(value);
      if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
    } catch {
      // Provider URLs are optional; malformed values are discarded.
    }
  }
  return undefined;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function safeResponseDetail(response: Response): Promise<string> {
  const value = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 400);
  return value ? `: ${value}` : "";
}

function retryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(1_000, seconds * 1_000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : Math.max(1_000, date.getTime() - Date.now());
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isConnectionEstablishmentFailure(error: unknown): boolean {
  const messages = [safeErrorMessage(error)];
  if (error instanceof Error && error.cause && typeof error.cause === "object") {
    const cause = error.cause as { readonly code?: unknown; readonly message?: unknown };
    if (typeof cause.code === "string") messages.push(cause.code);
    if (typeof cause.message === "string") messages.push(cause.message);
  }
  const detail = messages.join(" ").toLowerCase();
  return ["econnrefused", "enotfound", "eai_again", "connect timeout", "connection refused", "unable to connect"]
    .some((signal) => detail.includes(signal));
}
