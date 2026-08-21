import type {
  SocialEngagementKind,
  SocialEngagementReader,
  SocialEngagementSnapshot,
  SocialEngagementType,
} from "@outbound/application/content/social-ports";

export interface SocialEngagementSyncTarget {
  readonly workspaceId: string;
  readonly socialContentId: string;
  readonly connectedAccountId: string;
  readonly providerAccountId: string;
  readonly providerSocialId: string;
  readonly ownerProviderId: string | null;
  readonly kind: SocialEngagementKind;
  readonly scopeKey: string;
  readonly parentProviderInteractionId: string | null;
}

export interface SocialEngagementSyncLease extends SocialEngagementSyncTarget {
  readonly stateId: string;
  readonly leaseToken: string;
  readonly cursor: string | null;
  readonly scanToken: string;
}

export interface SocialInteractionView {
  readonly id: string;
  readonly socialContentId: string;
  readonly publicationId: string | null;
  readonly postText: string;
  readonly postUrl: string | null;
  readonly type: SocialEngagementType;
  readonly providerInteractionId: string;
  readonly parentProviderInteractionId: string | null;
  readonly direction: "owner" | "incoming" | "unknown";
  readonly actorProviderId: string | null;
  readonly actorName: string | null;
  readonly actorHeadline: string | null;
  readonly actorProfileUrl: string | null;
  readonly body: string | null;
  readonly reaction: string | null;
  readonly mentionedProviderId: string | null;
  readonly mentionedName: string | null;
  readonly status: "observed" | "removed";
  readonly occurredAt: Date | null;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
  readonly removedAt: Date | null;
}

export interface SocialEngagementSyncStatusView {
  readonly status: "not_configured" | "idle" | "syncing" | "error";
  readonly observed: number;
  readonly incoming: number;
  readonly lastSuccessAt: Date | null;
  readonly nextSyncAt: Date | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorMessage: string | null;
}

export interface SocialEngagementSyncRepository {
  listDueTargets(input: { readonly workspaceId?: string; readonly now: Date; readonly limit: number }): Promise<readonly SocialEngagementSyncTarget[]>;
  acquire(input: SocialEngagementSyncTarget & { readonly now: Date; readonly leaseMs: number }): Promise<SocialEngagementSyncLease | null>;
  persistPage(input: {
    readonly lease: SocialEngagementSyncLease;
    readonly engagements: readonly SocialEngagementSnapshot[];
    readonly nextCursor: string | null;
    readonly now: Date;
    readonly refreshIntervalMs: number;
  }): Promise<number>;
  markFailed(input: { readonly lease: SocialEngagementSyncLease; readonly code: string; readonly message: string; readonly now: Date; readonly retryAfterMs: number }): Promise<void>;
  list(input: {
    readonly workspaceId: string;
    readonly cursor?: string;
    readonly limit: number;
    readonly type?: SocialEngagementType;
    readonly socialContentId?: string;
    readonly direction?: "owner" | "incoming" | "unknown";
    readonly status?: "observed" | "removed";
  }): Promise<{ readonly data: readonly SocialInteractionView[]; readonly nextCursor: string | null }>;
  status(input: { readonly workspaceId: string }): Promise<SocialEngagementSyncStatusView>;
}

export class SocialEngagementApplication {
  constructor(private readonly repository: SocialEngagementSyncRepository) {}
  list(input: Parameters<SocialEngagementSyncRepository["list"]>[0]) { return this.repository.list(input); }
  status(input: Parameters<SocialEngagementSyncRepository["status"]>[0]) { return this.repository.status(input); }
}

export class SocialEngagementSynchronizer {
  constructor(
    private readonly repository: SocialEngagementSyncRepository,
    private readonly reader: SocialEngagementReader,
    private readonly options: {
      readonly now?: () => Date;
      readonly leaseMs?: number;
      readonly refreshIntervalMs?: number;
      readonly failureRetryMs?: number;
      readonly pageSize?: number;
      readonly targetLimit?: number;
    } = {},
  ) {}

  async reconcile(workspaceId?: string): Promise<number> {
    const now = this.options.now?.() ?? new Date();
    const targets = await this.repository.listDueTargets({
      ...(workspaceId ? { workspaceId } : {}),
      now,
      limit: Math.min(100, Math.max(1, this.options.targetLimit ?? 20)),
    });
    let observed = 0;
    for (const target of targets) {
      const lease = await this.repository.acquire({ ...target, now, leaseMs: this.options.leaseMs ?? 2 * 60_000 });
      if (!lease) continue;
      try {
        const page = await this.reader.listEngagements({
          accountId: lease.providerAccountId,
          providerSocialId: lease.providerSocialId,
          kind: lease.kind,
          parentProviderInteractionId: lease.parentProviderInteractionId,
          cursor: lease.cursor,
          limit: Math.min(100, Math.max(1, this.options.pageSize ?? 100)),
        });
        observed += await this.repository.persistPage({
          lease,
          engagements: page.data,
          nextCursor: page.nextCursor,
          now,
          refreshIntervalMs: this.options.refreshIntervalMs ?? 15 * 60_000,
        });
      } catch (error) {
        await this.repository.markFailed({
          lease,
          code: syncErrorCode(error),
          message: error instanceof Error ? error.message : String(error),
          now,
          retryAfterMs: this.options.failureRetryMs ?? 5 * 60_000,
        });
      }
    }
    return observed;
  }
}

function syncErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  const message = error instanceof Error ? error.message : String(error);
  return /^[A-Z0-9_]+$/.test(message) ? message : "SOCIAL_ENGAGEMENT_SYNC_FAILED";
}
