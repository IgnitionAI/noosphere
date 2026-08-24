import type {
  SocialContentReader,
  SocialContentSnapshot,
  SocialMetricsReader,
  SocialMetricsSnapshot,
} from "@outbound/application/content/social-ports";

export interface SocialContentSyncAccount {
  readonly workspaceId: string;
  readonly connectedAccountId: string;
  readonly providerAccountId: string;
}

export interface SocialContentSyncLease extends SocialContentSyncAccount {
  readonly stateId: string;
  readonly leaseToken: string;
  readonly cursor: string | null;
  readonly highWatermark: Date | null;
  readonly backfillComplete: boolean;
}

export interface SocialContentItemView {
  readonly id: string;
  readonly publicationId: string | null;
  readonly origin: "internal" | "external";
  readonly providerPostId: string;
  readonly socialId: string | null;
  readonly text: string;
  readonly url: string | null;
  readonly publishedAt: Date | null;
  readonly status: "observed" | "unavailable";
  readonly impressions: number | null;
  readonly reactions: number | null;
  readonly comments: number | null;
  readonly reposts: number | null;
  readonly metricsObservedAt: Date | null;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
}

export interface SocialContentSyncStatusView {
  readonly status: "not_configured" | "idle" | "syncing" | "error";
  readonly backfillComplete: boolean;
  readonly lastSuccessAt: Date | null;
  readonly nextSyncAt: Date | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorMessage: string | null;
}

export interface SocialContentSyncRepository {
  listDueAccounts(input: { readonly workspaceId?: string; readonly now: Date }): Promise<readonly SocialContentSyncAccount[]>;
  acquire(input: SocialContentSyncAccount & { readonly now: Date; readonly leaseMs: number }): Promise<SocialContentSyncLease | null>;
  persistPage(input: {
    readonly lease: SocialContentSyncLease;
    readonly posts: readonly SocialContentSnapshot[];
    readonly metrics: readonly SocialMetricsSnapshot[];
    readonly nextCursor: string | null;
    readonly now: Date;
    readonly refreshIntervalMs: number;
  }): Promise<number>;
  markFailed(input: { readonly lease: SocialContentSyncLease; readonly code: string; readonly message: string; readonly now: Date; readonly retryAfterMs: number }): Promise<void>;
  list(input: { readonly workspaceId: string; readonly cursor?: string; readonly limit: number }): Promise<{ readonly data: readonly SocialContentItemView[]; readonly nextCursor: string | null }>;
  status(input: { readonly workspaceId: string }): Promise<SocialContentSyncStatusView>;
}

export class SocialContentSyncApplication {
  constructor(private readonly repository: SocialContentSyncRepository) {}
  list(input: Parameters<SocialContentSyncRepository["list"]>[0]) { return this.repository.list(input); }
  status(input: Parameters<SocialContentSyncRepository["status"]>[0]) { return this.repository.status(input); }
}

export class SocialContentSynchronizer {
  constructor(
    private readonly repository: SocialContentSyncRepository,
    private readonly reader: SocialContentReader,
    private readonly metrics: SocialMetricsReader,
    private readonly options: {
      readonly now?: () => Date;
      readonly leaseMs?: number;
      readonly refreshIntervalMs?: number;
      readonly failureRetryMs?: number;
      readonly pageSize?: number;
    } = {},
  ) {}

  async reconcile(workspaceId?: string): Promise<number> {
    const now = this.options.now?.() ?? new Date();
    const accounts = await this.repository.listDueAccounts({ ...(workspaceId ? { workspaceId } : {}), now });
    let observed = 0;
    for (const account of accounts) {
      const lease = await this.repository.acquire({ ...account, now, leaseMs: this.options.leaseMs ?? 2 * 60_000 });
      if (!lease) continue;
      try {
        const page = await this.reader.listOwnContent({
          accountId: lease.providerAccountId,
          cursor: lease.cursor,
          limit: Math.min(100, Math.max(1, this.options.pageSize ?? 25)),
        });
        const snapshots = page.data.length
          ? await this.metrics.readMetrics({
              accountId: lease.providerAccountId,
              providerPostIds: page.data.map((post) => post.providerPostId),
            })
          : [];
        observed += await this.repository.persistPage({
          lease,
          posts: page.data,
          metrics: snapshots,
          nextCursor: nextCursor(lease, page.data, page.nextCursor),
          now,
          refreshIntervalMs: this.options.refreshIntervalMs ?? 15 * 60_000,
        });
      } catch (error) {
        await this.repository.markFailed({
          lease,
          code: syncErrorCode(error),
          message: error instanceof Error ? error.message : String(error),
          now,
          retryAfterMs: syncRetryAfterMs(error, this.options.failureRetryMs ?? 5 * 60_000),
        });
      }
    }
    return observed;
  }
}

function syncRetryAfterMs(error: unknown, fallbackMs: number): number {
  if (error && typeof error === "object" && "retryAfterMs" in error && typeof error.retryAfterMs === "number" && Number.isFinite(error.retryAfterMs) && error.retryAfterMs > 0) {
    return Math.min(24 * 60 * 60_000, Math.ceil(error.retryAfterMs));
  }
  return fallbackMs;
}

function nextCursor(
  lease: SocialContentSyncLease,
  posts: readonly SocialContentSnapshot[],
  providerCursor: string | null,
): string | null {
  if (!providerCursor) return null;
  if (!lease.backfillComplete) return providerCursor;
  if (!lease.highWatermark) return providerCursor;
  const allNewerThanWatermark = posts.length > 0 && posts.every((post) => post.publishedAt && post.publishedAt > lease.highWatermark!);
  return allNewerThanWatermark ? providerCursor : null;
}

function syncErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  const message = error instanceof Error ? error.message : String(error);
  return /^[A-Z0-9_]+$/.test(message) ? message : "SOCIAL_CONTENT_SYNC_FAILED";
}
