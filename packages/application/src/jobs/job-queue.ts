export interface NewJob<TPayload = unknown> {
  readonly id: string;
  readonly workspaceId: string;
  readonly type: string;
  readonly payload: TPayload;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly maxAttempts: number;
  readonly availableAt: Date;
}

export interface LeasedJob<TPayload = unknown> extends NewJob<TPayload> {
  readonly attempts: number;
  readonly lockedBy: string;
  readonly lockedUntil: Date;
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

export interface JobQueue {
  enqueue(job: NewJob): Promise<{ inserted: boolean }>;
  lease(request: LeaseJobsRequest): Promise<readonly LeasedJob[]>;
  renewLease(jobId: string, workerId: string, lockedUntil: Date): Promise<boolean>;
  acknowledge(jobId: string, workerId: string, completedAt: Date): Promise<void>;
  retry(request: RetryJobRequest): Promise<"scheduled" | "dead_lettered">;
}
