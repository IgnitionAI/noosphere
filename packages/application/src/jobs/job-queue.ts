export interface NewJob<TPayload = unknown> {
  readonly id: string;
  readonly workspaceId: string;
  readonly type: string;
  readonly payload: TPayload;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly maxAttempts: number;
  readonly availableAt: Date;
  readonly priority?: number;
}

export interface LeasedJob<TPayload = unknown> extends NewJob<TPayload> {
  readonly attempts: number;
  readonly lockedBy: string;
  readonly lockedUntil: Date;
  readonly priority?: number;
}

export interface LeaseJobsRequest {
  readonly workerId: string;
  readonly types: readonly string[];
  readonly limit: number;
  readonly leaseMs: number;
  readonly now: Date;
}

export interface RetryJobRequest {
  readonly jobId: string;
  readonly workerId: string;
  readonly availableAt: Date;
  readonly errorCode: string;
  readonly errorMessage: string;
}

/**
 * Releases a lease because the work is not due yet, without consuming a
 * processing attempt. This is deliberately separate from `retry`: waiting for
 * a business window, a healthy sender or a preceding sequence step is not a
 * failed execution.
 */
export interface DeferJobRequest extends RetryJobRequest {}

export interface JobQueue {
  enqueue(job: NewJob): Promise<{ inserted: boolean }>;
  lease(request: LeaseJobsRequest): Promise<readonly LeasedJob[]>;
  renewLease(jobId: string, workerId: string, lockedUntil: Date): Promise<boolean>;
  acknowledge(jobId: string, workerId: string, completedAt: Date): Promise<void>;
  defer(request: DeferJobRequest): Promise<void>;
  retry(request: RetryJobRequest): Promise<"scheduled" | "dead_lettered">;
}
