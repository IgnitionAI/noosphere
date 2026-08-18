import type {
  OutboundChannelGateway,
  OutboundSendRequest,
} from "@outbound/application/campaigns/outbound-channel-gateway";
import { OutboundDeliveryError } from "@outbound/application/campaigns/outbound-channel-gateway";

export class UnipileOutboundChannelGateway implements OutboundChannelGateway {
  readonly #dsn: string;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;

  constructor(options: { dsn: string; apiKey: string; fetchImpl?: typeof fetch }) {
    this.#dsn = options.dsn.replace(/\/+$/, "");
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async send(request: OutboundSendRequest) {
    if (request.stepKind === "linkedin_invite") return this.#sendLinkedinInvite(request);
    if (request.channel === "email") return this.#sendEmail(request);
    return this.#startChat(request);
  }

  async #sendLinkedinInvite(request: OutboundSendRequest) {
    if (!request.recipient.providerUserId) {
      throw new OutboundDeliveryError(
        "LINKEDIN_PROVIDER_USER_ID_MISSING",
        "The LinkedIn provider user id is required for an invitation",
        "not_sent",
        false,
      );
    }
    const response = await this.#request("/api/v1/users/invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        account_id: request.accountId,
        provider_id: request.recipient.providerUserId,
        message: request.body,
      }),
    });
    return responseIdentity(response);
  }

  async #startChat(request: OutboundSendRequest) {
    if (request.conversationId) {
      const body = new FormData();
      body.set("account_id", request.accountId);
      body.set("text", request.body);
      if (request.replyToProviderMessageId) body.set("quote_id", request.replyToProviderMessageId);
      const response = await this.#request(
        `/api/v1/chats/${encodeURIComponent(request.conversationId)}/messages`,
        { method: "POST", body },
      );
      return responseIdentity(response);
    }
    if (request.channel === "linkedin" && request.stepKind === "linkedin_message") {
      await this.#requireLinkedinRelationship(request);
    }
    const attendee = request.channel === "whatsapp"
      ? whatsappAttendee(request.recipient.normalizedValue)
      : request.recipient.providerUserId;
    if (!attendee) {
      throw new OutboundDeliveryError(
        "CHAT_RECIPIENT_MISSING",
        `The ${request.channel} provider recipient is missing`,
        "not_sent",
        false,
      );
    }
    const body = new FormData();
    body.set("account_id", request.accountId);
    body.set("text", request.body);
    body.set("attendees_ids", attendee);
    try {
      const response = await this.#request("/api/v1/chats", { method: "POST", body });
      return responseIdentity(response);
    } catch (error) {
      if (request.channel === "linkedin" && isMissingLinkedinRelationship(error)) {
        throw linkedinRelationPending();
      }
      throw error;
    }
  }

  async #requireLinkedinRelationship(request: OutboundSendRequest): Promise<void> {
    if (!request.recipient.providerUserId) {
      throw new OutboundDeliveryError(
        "LINKEDIN_PROVIDER_USER_ID_MISSING",
        "The LinkedIn provider user id is required before checking the relationship",
        "not_sent",
        false,
      );
    }
    const url = new URL(`/api/v1/users/${encodeURIComponent(request.recipient.providerUserId)}`, `${this.#dsn}/`);
    url.searchParams.set("account_id", request.accountId);
    const profile = await this.#request(url.pathname + url.search, { method: "GET" });
    const record = profile && typeof profile === "object" && !Array.isArray(profile)
      ? profile as Record<string, unknown>
      : {};
    const firstDegree = record.is_relationship === true
      || record.is_relationship === 1
      || String(record.network_distance ?? "").toUpperCase() === "FIRST_DEGREE";
    if (!firstDegree) throw linkedinRelationPending();
  }

  async #sendEmail(request: OutboundSendRequest) {
    if (!request.subject) {
      throw new OutboundDeliveryError(
        "EMAIL_SUBJECT_MISSING",
        "An email subject is required",
        "not_sent",
        false,
      );
    }
    const response = await this.#request("/api/v1/emails", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        account_id: request.accountId,
        subject: request.subject,
        body: request.body,
        to: [{ display_name: request.recipient.value, identifier: request.recipient.value }],
        custom_headers: [
          { name: "Content-Type", value: "text/plain; charset=utf-8" },
          { name: "X-Ignition-Outbound-Action", value: request.idempotencyKey },
        ],
        ...(request.replyToProviderMessageId
          ? { reply_to: request.replyToProviderMessageId }
          : {}),
      }),
    });
    return responseIdentity(response);
  }

  async #request(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#dsn}${path}`, {
        ...init,
        headers: {
          "X-API-KEY": this.#apiKey,
          accept: "application/json",
          ...init.headers,
        },
      });
    } catch (error) {
      const notSent = isConnectionEstablishmentFailure(error);
      throw new OutboundDeliveryError(
        notSent ? "UNIPILE_NETWORK_NOT_SENT" : "UNIPILE_NETWORK_UNKNOWN",
        error instanceof Error ? error.message : String(error),
        notSent ? "not_sent" : "unknown",
        notSent,
      );
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 500);
      if (
        response.status === 422
        && /limit_exceeded|usage limit set by the provider|provider.*limit/i.test(detail)
      ) {
        throw new OutboundDeliveryError(
          "UNIPILE_PROVIDER_LIMIT",
          `Unipile provider limit reached${detail ? `: ${detail}` : ""}`,
          "not_sent",
          true,
        );
      }
      throw new OutboundDeliveryError(
        `UNIPILE_${response.status}`,
        `Unipile returned ${response.status}${detail ? `: ${detail}` : ""}`,
        response.status === 429 ? "not_sent" : "unknown",
        response.status === 429,
      );
    }
    return response.json().catch(() => ({}));
  }
}

function isConnectionEstablishmentFailure(error: unknown): boolean {
  const messages = [error instanceof Error ? error.message : String(error)];
  if (error instanceof Error && error.cause && typeof error.cause === "object") {
    const cause = error.cause as { code?: unknown; message?: unknown };
    if (typeof cause.code === "string") messages.push(cause.code);
    if (typeof cause.message === "string") messages.push(cause.message);
  }
  const detail = messages.join(" ").toLowerCase();
  return [
    "unable to connect",
    "typo in the url or port",
    "econnrefused",
    "enotfound",
    "eai_again",
    "connect timeout",
    "connection refused",
  ].some((signal) => detail.includes(signal));
}

function responseIdentity(value: unknown): { providerRequestId: string; conversationId: string | null } {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const requestId = [body.id, body.provider_id, body.message_id, body.chat_id]
    .find((item): item is string => typeof item === "string" && item.length > 0)
    ?? crypto.randomUUID();
  const conversationId = [body.chat_id, body.thread_id]
    .find((item): item is string => typeof item === "string" && item.length > 0)
    ?? null;
  return { providerRequestId: requestId, conversationId };
}

function whatsappAttendee(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  return digits ? `${digits}@s.whatsapp.net` : null;
}

function linkedinRelationPending(): OutboundDeliveryError {
  return new OutboundDeliveryError(
    "LINKEDIN_RELATION_PENDING",
    "The LinkedIn invitation has not been accepted yet",
    "not_sent",
    true,
  );
}

function isMissingLinkedinRelationship(error: unknown): boolean {
  return error instanceof OutboundDeliveryError
    && error.code === "UNIPILE_422"
    && /no_connection_with_recipient|first degree connection/i.test(error.message);
}
