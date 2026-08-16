import { ProviderUnavailableError } from "@outbound/infrastructure/crm/unipile-prospect-source";

export type ConnectedAccountStatus = "pending" | "connected" | "degraded" | "disconnected" | "unknown";

export interface UnipileAccountSnapshot {
  readonly providerAccountId: string;
  readonly displayName: string | null;
  readonly status: ConnectedAccountStatus;
  readonly capabilities: Readonly<Record<string, unknown>>;
  readonly quotas: Readonly<Record<string, unknown>>;
}

export interface UnipileClient {
  createHostedAuthLink(input: {
    channel: "email" | "linkedin" | "whatsapp";
    onboardingId: string;
    expiresAt: Date;
    successRedirectUrl: string;
    failureRedirectUrl: string;
  }): Promise<{ url: string }>;
  connect(input: { providerAccountId: string; accessToken: string }): Promise<UnipileAccountSnapshot>;
  check(input: { providerAccountId: string; accessToken: string }): Promise<UnipileAccountSnapshot>;
  send?(input: { providerAccountId: string; accessToken: string; recipient: string; subject: string | null; body: string; idempotencyKey?: string }): Promise<{ providerMessageId: string }>;
}

export class HttpUnipileClient implements UnipileClient {
  constructor(
    private readonly options: { dsn: string; apiKey: string; timeoutMs: number },
  ) {}

  async connect(input: { providerAccountId: string; accessToken: string }): Promise<UnipileAccountSnapshot> {
    return this.request(input.providerAccountId, input.accessToken);
  }

  async createHostedAuthLink(input: {
    channel: "email" | "linkedin" | "whatsapp";
    onboardingId: string;
    expiresAt: Date;
    successRedirectUrl: string;
    failureRedirectUrl: string;
  }): Promise<{ url: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const dsn = this.options.dsn.replace(/\/$/, "");
      const response = await fetch(`${dsn}/api/v1/hosted/accounts/link`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", "X-API-KEY": this.options.apiKey },
        body: JSON.stringify({
          type: "create",
          providers: hostedAuthProviders(input.channel),
          api_url: dsn,
          expiresOn: input.expiresAt.toISOString(),
          success_redirect_url: input.successRedirectUrl,
          failure_redirect_url: input.failureRedirectUrl,
          name: input.onboardingId,
        }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok || typeof body.url !== "string" || !body.url.startsWith("https://")) {
        throw new ProviderUnavailableError(`Unipile hosted authentication failed (${response.status})`, null);
      }
      return { url: body.url };
    } catch (error) {
      if (error instanceof ProviderUnavailableError) throw error;
      throw new ProviderUnavailableError(`Unipile hosted authentication failed: ${error instanceof Error ? error.message : String(error)}`, null);
    } finally {
      clearTimeout(timer);
    }
  }

  async check(input: { providerAccountId: string; accessToken: string }): Promise<UnipileAccountSnapshot> {
    return this.request(input.providerAccountId, input.accessToken);
  }

  async send(input: { providerAccountId: string; accessToken: string; recipient: string; subject: string | null; body: string; idempotencyKey?: string }): Promise<{ providerMessageId: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await fetch(`${this.options.dsn.replace(/\/$/, "")}/api/v1/messages`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", "X-API-KEY": this.options.apiKey },
        body: JSON.stringify({ account_id: input.providerAccountId, provider: "email", to: input.recipient, subject: input.subject, body: input.body, idempotency_key: input.idempotencyKey }),
        signal: controller.signal,
      });
      if (response.status === 429) throw new UnipileSendError("RATE_LIMITED", "Unipile rate limit", retryAfter(response.headers.get("retry-after")));
      if (!response.ok) throw new UnipileSendError("PROVIDER_UNAVAILABLE", `Unipile send failed (${response.status})`);
      const body = await response.json() as Record<string, unknown>;
      const providerMessageId = typeof body.id === "string" ? body.id : typeof body.message_id === "string" ? body.message_id : crypto.randomUUID();
      return { providerMessageId };
    } catch (error) {
      if (error instanceof UnipileSendError) throw error;
      throw new UnipileSendError("PROVIDER_UNAVAILABLE", error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
    }
  }

  private async request(providerAccountId: string, accessToken: string): Promise<UnipileAccountSnapshot> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await fetch(`${this.options.dsn.replace(/\/$/, "")}/api/v1/accounts/${encodeURIComponent(providerAccountId)}`, {
        headers: {
          accept: "application/json",
          "X-API-KEY": this.options.apiKey,
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new ProviderUnavailableError(`Unipile account lookup failed (${response.status})`, null);
      const body = await response.json() as Record<string, unknown>;
      return mapSnapshot(providerAccountId, body);
    } catch (error) {
      if (error instanceof ProviderUnavailableError) throw error;
      throw new ProviderUnavailableError(
        `Unipile account request failed: ${error instanceof Error ? error.message : String(error)}`,
        null,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export class UnavailableUnipileClient implements UnipileClient {
  async createHostedAuthLink(): Promise<{ url: string }> {
    throw new ProviderUnavailableError("Unipile is not configured", null);
  }
  async connect(): Promise<UnipileAccountSnapshot> {
    throw new ProviderUnavailableError("Unipile is not configured", null);
  }
  async check(): Promise<UnipileAccountSnapshot> {
    throw new ProviderUnavailableError("Unipile is not configured", null);
  }
  async send(): Promise<{ providerMessageId: string }> {
    throw new UnipileSendError("PROVIDER_UNAVAILABLE", "Unipile is not configured");
  }
}

export function hostedAuthProviders(channel: "email" | "linkedin" | "whatsapp"): readonly string[] {
  if (channel === "linkedin") return ["LINKEDIN"];
  if (channel === "whatsapp") return ["WHATSAPP"];
  return ["GOOGLE", "OUTLOOK", "MAIL"];
}

export class UnipileSendError extends Error {
  constructor(readonly code: "RATE_LIMITED" | "PROVIDER_UNAVAILABLE" | "SEND_FAILED", message: string, readonly retryAfterMs?: number) { super(message); }
}

function retryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(1_000, seconds * 1_000) : undefined;
}

export function mapSnapshot(providerAccountId: string, body: Record<string, unknown>): UnipileAccountSnapshot {
  const sources = sourceSnapshots(body.sources);
  const providerType = typeof body.type === "string" ? body.type.toUpperCase() : "";
  const declaredCapabilities = objectValue(body.capabilities ?? body.supported_channels ?? body.channels);
  return {
    providerAccountId,
    displayName: typeof body.name === "string" ? body.name : typeof body.username === "string" ? body.username : null,
    status: normalizeStatus(body.status ?? statusFromSources(sources)),
    capabilities: declaredCapabilities ?? derivedCapabilities(providerType, sources),
    quotas: objectValue(body.quotas ?? body.limits) ?? {},
  };
}

export function normalizeStatus(value: unknown): ConnectedAccountStatus {
  const normalized = typeof value === "string" ? value.toLowerCase() : "unknown";
  if (["connected", "active", "ok", "healthy", "ready"].includes(normalized)) return "connected";
  if (["disconnected", "revoked", "removed"].includes(normalized)) return "disconnected";
  if (["degraded", "error", "expired", "down", "invalid"].includes(normalized)) return "degraded";
  return "unknown";
}

function objectValue(value: unknown): Readonly<Record<string, unknown>> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Readonly<Record<string, unknown>>;
}

interface UnipileSourceSnapshot {
  readonly id: string | null;
  readonly status: string;
}

function sourceSnapshots(value: unknown): readonly UnipileSourceSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const source = item as Record<string, unknown>;
    return [{
      id: typeof source.id === "string" ? source.id : null,
      status: typeof source.status === "string" ? source.status.toUpperCase() : "",
    }];
  });
}

function statusFromSources(sources: readonly UnipileSourceSnapshot[]): ConnectedAccountStatus {
  if (sources.some((source) => ["DISCONNECTED", "REVOKED", "REMOVED"].includes(source.status))) return "disconnected";
  if (sources.some((source) => ["ERROR", "FAILED", "KO", "DOWN"].includes(source.status))) return "degraded";
  if (sources.some((source) => ["OK", "CONNECTED", "ACTIVE", "READY"].includes(source.status))) return "connected";
  return "unknown";
}

function derivedCapabilities(providerType: string, sources: readonly UnipileSourceSnapshot[]): Readonly<Record<string, unknown>> {
  const healthy = sources.some((source) => source.status === "OK");
  if (!healthy) return {};
  const hasSource = (suffix: string): boolean => sources.some((source) => source.id?.toUpperCase().endsWith(suffix));
  if (providerType === "LINKEDIN") return { linkedin: { sending: hasSource("_MESSAGING") } };
  if (providerType === "WHATSAPP") return { whatsapp: { sending: true } };
  if (["GOOGLE", "GOOGLE_OAUTH", "MICROSOFT", "OUTLOOK", "IMAP"].includes(providerType)) {
    return {
      email: { sending: hasSource("_MAIL") || hasSource("_MAILS") || providerType === "IMAP" || providerType === "OUTLOOK", receiving: hasSource("_MAIL") || hasSource("_MAILS") },
      ...(hasSource("_CALENDAR") ? { calendar: { booking: true } } : {}),
    };
  }
  return {};
}
