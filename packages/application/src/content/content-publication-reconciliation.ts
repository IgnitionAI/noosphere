import type { SocialContentReader, SocialContentSnapshot } from "@outbound/application/content/social-ports";

export type ContentPublicationReconciliationStatus =
  | "pending"
  | "searching"
  | "matched"
  | "not_found"
  | "ambiguous"
  | "error";

export interface ContentPublicationReconciliationView {
  readonly status: ContentPublicationReconciliationStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly candidatesCount: number;
  readonly nextAttemptAt: Date | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly lastErrorCode: string | null;
  readonly correlationId: string;
}

export interface ContentPublicationReconciliationTarget {
  readonly workspaceId: string;
  readonly reconciliationId: string;
  readonly publicationId: string;
}

export interface ContentPublicationReconciliationLease extends ContentPublicationReconciliationTarget {
  readonly leaseToken: string;
  readonly providerAccountId: string;
  readonly contentFingerprint: string;
  readonly windowStart: Date;
  readonly windowEnd: Date;
  readonly attempt: number;
  readonly maxAttempts: number;
}

export interface ContentPublicationReconciliationRepository {
  listDue(input: { readonly now: Date; readonly workspaceId?: string }): Promise<readonly ContentPublicationReconciliationTarget[]>;
  acquire(input: ContentPublicationReconciliationTarget & { readonly now: Date; readonly leaseMs: number }): Promise<ContentPublicationReconciliationLease | null>;
  markMatched(input: { readonly lease: ContentPublicationReconciliationLease; readonly match: SocialContentSnapshot; readonly now: Date }): Promise<void>;
  markNoMatch(input: { readonly lease: ContentPublicationReconciliationLease; readonly candidatesCount: number; readonly terminal: boolean; readonly nextAttemptAt: Date; readonly now: Date }): Promise<void>;
  markAmbiguous(input: { readonly lease: ContentPublicationReconciliationLease; readonly candidatesCount: number; readonly now: Date }): Promise<void>;
  markProviderError(input: { readonly lease: ContentPublicationReconciliationLease; readonly code: string; readonly terminal: boolean; readonly nextAttemptAt: Date; readonly now: Date }): Promise<void>;
}

export class ContentPublicationOutcomeReconciler {
  constructor(
    private readonly repository: ContentPublicationReconciliationRepository,
    private readonly reader: SocialContentReader,
    private readonly options: {
      readonly now?: () => Date;
      readonly leaseMs?: number;
      readonly retryMs?: number;
      readonly pageSize?: number;
      readonly maxPages?: number;
    } = {},
  ) {}

  async reconcile(workspaceId?: string): Promise<number> {
    const now = this.options.now?.() ?? new Date();
    const targets = await this.repository.listDue({ now, ...(workspaceId ? { workspaceId } : {}) });
    let finalized = 0;
    for (const target of targets) {
      const lease = await this.repository.acquire({ ...target, now, leaseMs: this.options.leaseMs ?? 2 * 60_000 });
      if (!lease) continue;
      try {
        const matches = await this.#findMatches(lease);
        if (matches.length === 1) {
          await this.repository.markMatched({ lease, match: matches[0]!, now });
          finalized += 1;
          continue;
        }
        if (matches.length > 1) {
          await this.repository.markAmbiguous({ lease, candidatesCount: matches.length, now });
          finalized += 1;
          continue;
        }
        const terminal = now >= lease.windowEnd || lease.attempt >= lease.maxAttempts;
        await this.repository.markNoMatch({
          lease,
          candidatesCount: 0,
          terminal,
          nextAttemptAt: new Date(now.getTime() + (this.options.retryMs ?? 5 * 60_000)),
          now,
        });
        if (terminal) finalized += 1;
      } catch (error) {
        const terminal = lease.attempt >= lease.maxAttempts;
        await this.repository.markProviderError({
          lease,
          code: providerErrorCode(error),
          terminal,
          nextAttemptAt: new Date(now.getTime() + (this.options.retryMs ?? 5 * 60_000)),
          now,
        });
        if (terminal) finalized += 1;
      }
    }
    return finalized;
  }

  async #findMatches(lease: ContentPublicationReconciliationLease): Promise<SocialContentSnapshot[]> {
    const matches = new Map<string, SocialContentSnapshot>();
    let cursor: string | null = null;
    for (let pageNumber = 0; pageNumber < (this.options.maxPages ?? 4); pageNumber += 1) {
      const page = await this.reader.listOwnContent({
        accountId: lease.providerAccountId,
        cursor,
        limit: Math.min(100, Math.max(1, this.options.pageSize ?? 50)),
      });
      for (const post of page.data) {
        if (!post.publishedAt || post.publishedAt < lease.windowStart || post.publishedAt > lease.windowEnd) continue;
        if (textFingerprint(post.text) === lease.contentFingerprint) matches.set(post.providerPostId, post);
      }
      if (!page.nextCursor) break;
      const dated = page.data.filter((post): post is SocialContentSnapshot & { publishedAt: Date } => post.publishedAt !== null);
      if (dated.length > 0 && dated.every((post) => post.publishedAt < lease.windowStart)) break;
      cursor = page.nextCursor;
    }
    return [...matches.values()];
  }
}

export function textFingerprint(value: string): string {
  const normalized = value.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd()).join("\n").trim();
  return new Bun.CryptoHasher("sha256").update(normalized).digest("hex");
}

function providerErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z0-9_]+$/.test(error.code)) return error.code;
  return "SOCIAL_PROVIDER_RECONCILIATION_FAILED";
}
