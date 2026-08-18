import { and, eq } from "drizzle-orm";
import type { ProspectingChannel } from "@outbound/domain/campaigns/prospecting-plan";
import type { Database } from "@outbound/infrastructure/database/client";
import { workspaceChannelAccounts } from "@outbound/infrastructure/database/schema";

type UnipileAccount = {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly type?: unknown;
  readonly sources?: readonly { readonly status?: unknown }[];
};

export interface SelectableUnipileAccount {
  readonly id: string;
  readonly name: string;
  readonly channel: ProspectingChannel;
  readonly healthy: boolean;
  readonly selected: boolean;
}

export class UnipileChannelConnectionError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "UnipileChannelConnectionError";
  }
}

export class PostgresUnipileChannelConnections {
  readonly #dsn: string;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;

  constructor(
    private readonly database: Database,
    options: { readonly dsn: string; readonly apiKey: string; readonly fetchImpl?: typeof fetch },
  ) {
    this.#dsn = options.dsn.replace(/\/+$/, "");
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async list(
    workspaceId: string,
    channel: ProspectingChannel,
  ): Promise<readonly SelectableUnipileAccount[]> {
    const selected = await this.selectedAccount(workspaceId, channel);
    const accounts = await this.#providerAccounts();
    return accounts
      .filter((account) => providerChannel(account.type) === channel)
      .map((account) => ({
        id: account.id,
        name: displayName(account.name, channel),
        channel,
        healthy: account.healthy,
        selected: account.id === selected?.providerAccountId,
      }))
      .sort((left, right) => Number(right.healthy) - Number(left.healthy) || left.name.localeCompare(right.name, "fr"));
  }

  async select(input: {
    readonly workspaceId: string;
    readonly channel: ProspectingChannel;
    readonly providerAccountId: string;
    readonly selectedBy: string;
    readonly now: Date;
  }): Promise<SelectableUnipileAccount> {
    const account = (await this.#providerAccounts()).find(
      (candidate) => candidate.id === input.providerAccountId && providerChannel(candidate.type) === input.channel,
    );
    if (!account) {
      throw new UnipileChannelConnectionError(
        "UNIPILE_ACCOUNT_NOT_FOUND",
        404,
        "The selected Unipile account does not exist for this channel",
      );
    }
    if (!account.healthy) {
      throw new UnipileChannelConnectionError(
        "UNIPILE_ACCOUNT_UNHEALTHY",
        409,
        "The selected Unipile account is not connected",
      );
    }
    const name = displayName(account.name, input.channel);
    await this.database
      .insert(workspaceChannelAccounts)
      .values({
        workspaceId: input.workspaceId,
        channel: input.channel,
        provider: "unipile",
        providerAccountId: account.id,
        displayName: name,
        selectedBy: input.selectedBy,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: [workspaceChannelAccounts.workspaceId, workspaceChannelAccounts.channel],
        set: {
          providerAccountId: account.id,
          displayName: name,
          selectedBy: input.selectedBy,
          updatedAt: input.now,
        },
      });
    return { id: account.id, name, channel: input.channel, healthy: true, selected: true };
  }

  async selectedAccountId(workspaceId: string, channel: ProspectingChannel): Promise<string | null> {
    return (await this.selectedAccount(workspaceId, channel))?.providerAccountId ?? null;
  }

  async resolveHealthyAccount(workspaceId: string, channel: ProspectingChannel): Promise<string> {
    const selected = await this.selectedAccount(workspaceId, channel);
    if (!selected) {
      throw new UnipileChannelConnectionError(
        "UNIPILE_ACCOUNT_NOT_SELECTED",
        409,
        `No Unipile ${channel} account is selected for this workspace`,
      );
    }
    const account = (await this.#providerAccounts()).find(
      (candidate) => candidate.id === selected.providerAccountId && providerChannel(candidate.type) === channel,
    );
    if (!account) {
      throw new UnipileChannelConnectionError(
        "UNIPILE_ACCOUNT_NOT_FOUND",
        404,
        `The selected Unipile ${channel} account no longer exists`,
      );
    }
    if (!account.healthy) {
      throw new UnipileChannelConnectionError(
        "UNIPILE_ACCOUNT_UNHEALTHY",
        409,
        `The selected Unipile ${channel} account is not connected`,
      );
    }
    return account.id;
  }

  async selectedAccount(workspaceId: string, channel: ProspectingChannel) {
    const [row] = await this.database
      .select({
        providerAccountId: workspaceChannelAccounts.providerAccountId,
        displayName: workspaceChannelAccounts.displayName,
        updatedAt: workspaceChannelAccounts.updatedAt,
      })
      .from(workspaceChannelAccounts)
      .where(and(
        eq(workspaceChannelAccounts.workspaceId, workspaceId),
        eq(workspaceChannelAccounts.channel, channel),
      ))
      .limit(1);
    return row ?? null;
  }

  async #providerAccounts(): Promise<readonly {
    readonly id: string;
    readonly name: string;
    readonly type: string;
    readonly healthy: boolean;
  }[]> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#dsn}/api/v1/accounts`, {
        headers: { "X-API-KEY": this.#apiKey, accept: "application/json" },
      });
    } catch {
      throw new UnipileChannelConnectionError(
        "UNIPILE_UNREACHABLE",
        503,
        "Unipile is temporarily unreachable",
      );
    }
    if (!response.ok) {
      throw new UnipileChannelConnectionError(
        response.status === 401 ? "UNIPILE_AUTHENTICATION_FAILED" : "UNIPILE_ACCOUNTS_UNAVAILABLE",
        response.status === 401 ? 502 : 503,
        "Unipile refused the account listing request",
      );
    }
    const body = await response.json().catch(() => null) as unknown;
    const records = Array.isArray(body)
      ? body
      : body && typeof body === "object" && Array.isArray((body as { items?: unknown }).items)
        ? (body as { items: unknown[] }).items
        : [];
    return records.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const account = value as UnipileAccount;
      if (typeof account.id !== "string" || typeof account.type !== "string") return [];
      const name = typeof account.name === "string" ? account.name : account.id;
      const healthy = account.sources?.some(
        (source) => typeof source.status === "string" && source.status.toUpperCase() === "OK",
      ) ?? false;
      return [{ id: account.id, name, type: account.type, healthy }];
    });
  }
}

function providerChannel(type: string): ProspectingChannel | null {
  const normalized = type.toUpperCase();
  if (normalized === "LINKEDIN") return "linkedin";
  if (normalized === "WHATSAPP") return "whatsapp";
  if (["GOOGLE", "GOOGLE_OAUTH", "MICROSOFT", "OUTLOOK", "IMAP"].includes(normalized)) return "email";
  return null;
}

function displayName(value: string, channel: ProspectingChannel): string {
  if (channel !== "whatsapp") return value;
  const digits = value.replace(/\D/g, "");
  return digits ? `+${digits}` : value;
}
