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
  connect(input: { providerAccountId: string; accessToken: string }): Promise<UnipileAccountSnapshot>;
  check(input: { providerAccountId: string; accessToken: string }): Promise<UnipileAccountSnapshot>;
}

export class HttpUnipileClient implements UnipileClient {
  constructor(
    private readonly options: { dsn: string; apiKey: string; timeoutMs: number },
  ) {}

  async connect(input: { providerAccountId: string; accessToken: string }): Promise<UnipileAccountSnapshot> {
    return this.request(input.providerAccountId, input.accessToken);
  }

  async check(input: { providerAccountId: string; accessToken: string }): Promise<UnipileAccountSnapshot> {
    return this.request(input.providerAccountId, input.accessToken);
  }

  private async request(providerAccountId: string, accessToken: string): Promise<UnipileAccountSnapshot> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await fetch(`${this.options.dsn.replace(/\/$/, "")}/api/v1/accounts/${encodeURIComponent(providerAccountId)}`, {
        headers: {
          accept: "application/json",
          "X-API-KEY": this.options.apiKey,
          "X-ACCOUNT-TOKEN": accessToken,
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
  async connect(): Promise<UnipileAccountSnapshot> {
    throw new ProviderUnavailableError("Unipile is not configured", null);
  }
  async check(): Promise<UnipileAccountSnapshot> {
    throw new ProviderUnavailableError("Unipile is not configured", null);
  }
}

function mapSnapshot(providerAccountId: string, body: Record<string, unknown>): UnipileAccountSnapshot {
  return {
    providerAccountId,
    displayName: typeof body.name === "string" ? body.name : typeof body.username === "string" ? body.username : null,
    status: normalizeStatus(body.status),
    capabilities: objectValue(body.capabilities ?? body.supported_channels ?? body.channels),
    quotas: objectValue(body.quotas ?? body.limits),
  };
}

export function normalizeStatus(value: unknown): ConnectedAccountStatus {
  const normalized = typeof value === "string" ? value.toLowerCase() : "unknown";
  if (["connected", "active", "ok", "healthy", "ready"].includes(normalized)) return "connected";
  if (["disconnected", "revoked", "removed"].includes(normalized)) return "disconnected";
  if (["degraded", "error", "expired", "down", "invalid"].includes(normalized)) return "degraded";
  return "unknown";
}

function objectValue(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Readonly<Record<string, unknown>>;
}
