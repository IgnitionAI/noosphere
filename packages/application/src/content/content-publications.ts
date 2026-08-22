import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";
import type { SocialPublishResult, SocialPublisher } from "@outbound/application/content/social-ports";
import { SocialProviderError } from "@outbound/application/content/social-ports";
import type { ContentPublicationReconciliationView } from "@outbound/application/content/content-publication-reconciliation";

export const CONTENT_PUBLICATION_JOB_TYPE = "content.publication.publish";
export const CONTENT_PUBLICATION_JOB_PRIORITY = 70;

export type ContentPublicationStatus =
  | "scheduled"
  | "retry"
  | "publishing"
  | "published"
  | "unknown"
  | "failed"
  | "cancelled";

export interface ContentPublicationAccountSnapshot {
  readonly provider: "unipile";
  readonly providerAccountId: string;
  readonly displayName: string;
  readonly selectionVersion: string;
  readonly observedAt: string;
}

export interface ContentPublicationPolicySnapshot {
  readonly schemaVersion: 1;
  readonly policyVersion: "linkedin-publishing-v1";
  readonly network: "linkedin";
  readonly assetReady: true;
  readonly strategyVersionId: string;
  readonly claimsGate: "passed";
}

export interface ContentPublicationContentSnapshot {
  readonly assetVersionId: string;
  readonly body: string;
  readonly contentHash: string;
}

export interface ContentPublicationView {
  readonly id: string;
  readonly workspaceId: string;
  readonly assetId: string;
  readonly assetVersionId: string;
  readonly network: "linkedin";
  readonly provider: "unipile";
  readonly status: ContentPublicationStatus;
  readonly scheduledFor: Date;
  readonly contentSnapshot: ContentPublicationContentSnapshot;
  readonly policySnapshot: ContentPublicationPolicySnapshot;
  readonly accountSnapshot: ContentPublicationAccountSnapshot;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly providerPostId: string | null;
  readonly providerSocialId: string | null;
  readonly providerUrl: string | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorMessage: string | null;
  readonly publishedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly unknownAt: Date | null;
  readonly reconciliation: ContentPublicationReconciliationView | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ContentPublicationExecution {
  readonly publicationId: string;
  readonly executionToken: string;
  readonly accountId: string;
  readonly text: string;
  readonly requestKey: string;
  readonly attempt: number;
}

export interface SocialPublishingAccountResolver {
  resolveLinkedin(input: { readonly workspaceId: string }): Promise<{
    readonly accountId: string;
    readonly displayName: string;
    readonly selectionVersion: string;
  }>;
}

export interface ContentPublicationRepository {
  findRequest(input: { readonly workspaceId: string; readonly operation: string; readonly requestKey: string }): Promise<ContentPublicationView | null>;
  schedule(input: {
    readonly workspaceId: string;
    readonly userId: string | null;
    readonly assetId: string;
    readonly requestKey: string;
    readonly scheduledFor: Date;
    readonly account: ContentPublicationAccountSnapshot;
    readonly now: Date;
  }): Promise<ContentPublicationView>;
  list(input: { readonly workspaceId: string; readonly cursor?: string; readonly limit: number }): Promise<{ readonly data: readonly ContentPublicationView[]; readonly nextCursor: string | null }>;
  find(input: { readonly workspaceId: string; readonly publicationId: string }): Promise<ContentPublicationView | null>;
  findLatestForAsset(input: { readonly workspaceId: string; readonly assetId: string }): Promise<ContentPublicationView | null>;
  reschedule(input: { readonly workspaceId: string; readonly userId: string; readonly publicationId: string; readonly requestKey: string; readonly scheduledFor: Date; readonly now: Date }): Promise<ContentPublicationView>;
  cancel(input: { readonly workspaceId: string; readonly userId: string; readonly publicationId: string; readonly requestKey: string; readonly now: Date }): Promise<ContentPublicationView>;
  inspectExecution(input: { readonly workspaceId: string; readonly publicationId: string; readonly now: Date }): Promise<"ready" | "terminal" | "unknown">;
  claimExecution(input: { readonly workspaceId: string; readonly publicationId: string; readonly currentAccountId: string; readonly executionToken: string; readonly now: Date }): Promise<ContentPublicationExecution>;
  markPublished(input: { readonly workspaceId: string; readonly publicationId: string; readonly executionToken: string; readonly result: SocialPublishResult; readonly now: Date }): Promise<void>;
  markRetry(input: { readonly workspaceId: string; readonly publicationId: string; readonly executionToken?: string; readonly code: string; readonly message: string; readonly availableAt: Date; readonly now: Date }): Promise<void>;
  markFailed(input: { readonly workspaceId: string; readonly publicationId: string; readonly executionToken?: string; readonly code: string; readonly message: string; readonly now: Date }): Promise<void>;
  markUnknown(input: { readonly workspaceId: string; readonly publicationId: string; readonly executionToken?: string; readonly code: string; readonly message: string; readonly now: Date }): Promise<void>;
}

export class ContentPublicationApplication {
  constructor(
    private readonly repository: ContentPublicationRepository,
    private readonly accounts: SocialPublishingAccountResolver,
    private readonly publisher: SocialPublisher,
  ) {}

  list(input: Parameters<ContentPublicationRepository["list"]>[0]) { return this.repository.list(input); }
  find(input: Parameters<ContentPublicationRepository["find"]>[0]) { return this.repository.find(input); }
  findLatestForAsset(input: Parameters<ContentPublicationRepository["findLatestForAsset"]>[0]) { return this.repository.findLatestForAsset(input); }

  async schedule(input: { readonly workspaceId: string; readonly userId: string | null; readonly assetId: string; readonly requestKey: string; readonly scheduledFor: Date; readonly now?: Date }) {
    const replay = await this.repository.findRequest({ workspaceId: input.workspaceId, operation: "publication.schedule", requestKey: input.requestKey });
    if (replay) return replay;
    const now = input.now ?? new Date();
    if (input.scheduledFor.getTime() < now.getTime() - 30_000) throw new Error("CONTENT_PUBLICATION_SCHEDULE_IN_PAST");
    const selected = await this.accounts.resolveLinkedin({ workspaceId: input.workspaceId });
    const capability = await this.publisher.observeCapabilities({ accountId: selected.accountId, now });
    if (!capability.accountHealthy || capability.textPublishing !== "available") throw new Error("CONTENT_PUBLICATION_ACCOUNT_UNAVAILABLE");
    return this.repository.schedule({
      ...input,
      now,
      account: {
        provider: "unipile",
        providerAccountId: selected.accountId,
        displayName: selected.displayName,
        selectionVersion: selected.selectionVersion,
        observedAt: capability.observedAt.toISOString(),
      },
    });
  }

  async reschedule(input: { readonly workspaceId: string; readonly userId: string; readonly publicationId: string; readonly requestKey: string; readonly scheduledFor: Date; readonly now?: Date }) {
    const replay = await this.repository.findRequest({ workspaceId: input.workspaceId, operation: "publication.reschedule", requestKey: input.requestKey });
    if (replay) return replay;
    const now = input.now ?? new Date();
    if (input.scheduledFor.getTime() < now.getTime()) throw new Error("CONTENT_PUBLICATION_SCHEDULE_IN_PAST");
    return this.repository.reschedule({ ...input, now });
  }

  async cancel(input: { readonly workspaceId: string; readonly userId: string; readonly publicationId: string; readonly requestKey: string; readonly now?: Date }) {
    const replay = await this.repository.findRequest({ workspaceId: input.workspaceId, operation: "publication.cancel", requestKey: input.requestKey });
    if (replay) return replay;
    return this.repository.cancel({ ...input, now: input.now ?? new Date() });
  }
}

export class ContentPublicationJobProcessor {
  constructor(
    private readonly repository: ContentPublicationRepository,
    private readonly accounts: SocialPublishingAccountResolver,
    private readonly publisher: SocialPublisher,
    private readonly queue: JobQueue,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async process(job: LeasedJob): Promise<void> {
    const payload = job.payload as { readonly publicationId?: unknown };
    if (typeof payload.publicationId !== "string") throw new Error("CONTENT_PUBLICATION_JOB_INVALID");
    const publicationId = payload.publicationId;
    const inspected = await this.repository.inspectExecution({ workspaceId: job.workspaceId, publicationId, now: this.now() });
    if (inspected !== "ready") {
      await this.queue.acknowledge(job.id, job.lockedBy, this.now());
      return;
    }

    let selected: Awaited<ReturnType<SocialPublishingAccountResolver["resolveLinkedin"]>>;
    try {
      selected = await this.accounts.resolveLinkedin({ workspaceId: job.workspaceId });
      const capability = await this.publisher.observeCapabilities({ accountId: selected.accountId, now: this.now() });
      if (!capability.accountHealthy || capability.textPublishing !== "available") throw new Error("CONTENT_PUBLICATION_ACCOUNT_UNAVAILABLE");
    } catch (error) {
      await this.#handleBeforeSend(job, publicationId, error);
      return;
    }

    const executionToken = crypto.randomUUID();
    let execution: ContentPublicationExecution;
    try {
      execution = await this.repository.claimExecution({
        workspaceId: job.workspaceId,
        publicationId,
        currentAccountId: selected.accountId,
        executionToken,
        now: this.now(),
      });
    } catch (error) {
      await this.repository.markFailed({ workspaceId: job.workspaceId, publicationId, code: "CONTENT_PUBLICATION_POLICY_REJECTED", message: messageOf(error), now: this.now() });
      await this.queue.acknowledge(job.id, job.lockedBy, this.now());
      return;
    }

    try {
      const result = await this.publisher.publishText({ accountId: execution.accountId, text: execution.text, requestKey: execution.requestKey });
      await this.repository.markPublished({ workspaceId: job.workspaceId, publicationId, executionToken, result, now: this.now() });
      await this.queue.acknowledge(job.id, job.lockedBy, this.now());
    } catch (error) {
      await this.#handleAfterSend(job, publicationId, executionToken, error);
    }
  }

  async #handleBeforeSend(job: LeasedJob, publicationId: string, error: unknown): Promise<void> {
    const retryable = error instanceof SocialProviderError && error.deliveryState === "not_sent" && error.retryable;
    if (retryable && job.attempts < job.maxAttempts) {
      const availableAt = new Date(this.now().getTime() + retryDelay(error.retryAfterMs, job.attempts));
      await this.repository.markRetry({ workspaceId: job.workspaceId, publicationId, code: error.code, message: error.message, availableAt, now: this.now() });
      await this.queue.retry({ jobId: job.id, workerId: job.lockedBy, availableAt, errorCode: error.code, errorMessage: error.message });
      return;
    }
    await this.repository.markFailed({ workspaceId: job.workspaceId, publicationId, code: errorCode(error), message: messageOf(error), now: this.now() });
    await this.queue.acknowledge(job.id, job.lockedBy, this.now());
  }

  async #handleAfterSend(job: LeasedJob, publicationId: string, executionToken: string, error: unknown): Promise<void> {
    if (!(error instanceof SocialProviderError) || error.deliveryState === "unknown") {
      await this.repository.markUnknown({ workspaceId: job.workspaceId, publicationId, executionToken, code: errorCode(error), message: messageOf(error), now: this.now() });
      await this.queue.acknowledge(job.id, job.lockedBy, this.now());
      return;
    }
    if (error.retryable && job.attempts < job.maxAttempts) {
      const availableAt = new Date(this.now().getTime() + retryDelay(error.retryAfterMs, job.attempts));
      await this.repository.markRetry({ workspaceId: job.workspaceId, publicationId, executionToken, code: error.code, message: error.message, availableAt, now: this.now() });
      await this.queue.retry({ jobId: job.id, workerId: job.lockedBy, availableAt, errorCode: error.code, errorMessage: error.message });
      return;
    }
    await this.repository.markFailed({ workspaceId: job.workspaceId, publicationId, executionToken, code: error.code, message: error.message, now: this.now() });
    await this.queue.acknowledge(job.id, job.lockedBy, this.now());
  }
}

function retryDelay(providerDelayMs: number | null, attempts: number): number {
  return providerDelayMs ?? Math.min(15 * 60_000, 30_000 * (2 ** Math.max(0, attempts - 1)));
}

function errorCode(error: unknown): string {
  return error instanceof SocialProviderError ? error.code : error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "CONTENT_PUBLICATION_FAILED";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
