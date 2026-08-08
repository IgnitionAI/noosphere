import type {
  JobQueue,
  LeaseJobsRequest,
  LeasedJob,
  NewJob,
  RetryJobRequest,
} from "@outbound/application/jobs/job-queue";
import type { SqlClient } from "@outbound/infrastructure/database/client";

interface JobRow {
  id: string;
  workspace_id: string;
  type: string;
  payload: unknown;
  idempotency_key: string;
  correlation_id: string;
  attempts: number;
  max_attempts: number;
  available_at: Date;
  locked_by: string;
  locked_until: Date;
}

export class PostgresJobQueue implements JobQueue {
  constructor(private readonly sql: SqlClient) {}

  async enqueue(job: NewJob): Promise<{ inserted: boolean }> {
    const payload = this.sql.json(job.payload as never);
    const rows = await this.sql`
      insert into jobs (
        id, workspace_id, type, payload, idempotency_key, correlation_id,
        max_attempts, available_at
      ) values (
        ${job.id}, ${job.workspaceId}, ${job.type}, ${payload},
        ${job.idempotencyKey}, ${job.correlationId}, ${job.maxAttempts}, ${job.availableAt}
      )
      on conflict (workspace_id, type, idempotency_key) do nothing
      returning id
    `;
    return { inserted: rows.length === 1 };
  }

  async lease(request: LeaseJobsRequest): Promise<readonly LeasedJob[]> {
    if (request.limit < 1) return [];
    if (!request.types.length || request.types.some((type) => !/^[a-z0-9._-]+$/.test(type))) {
      throw new Error("INVALID_JOB_TYPE_FILTER");
    }
    const typeArrayLiteral = `{${request.types.join(",")}}`;
    const lockedUntil = new Date(request.now.getTime() + request.leaseMs);
    const rows = await this.sql.begin(async (transaction) => {
      return transaction<JobRow[]>`
        with ranked as (
          select id,
                 workspace_id,
                 available_at,
                 created_at,
                 row_number() over (
                   partition by workspace_id
                   order by available_at asc, created_at asc, id asc
                 ) as workspace_rank
          from jobs
          where type = any(${typeArrayLiteral}::text[])
            and attempts < max_attempts
            and (
              (status in ('pending', 'retry') and available_at <= ${request.now})
              or (status = 'running' and locked_until <= ${request.now})
            )
        ), candidates as (
          select jobs.id
          from jobs
          join ranked on ranked.id = jobs.id
          order by ranked.workspace_rank asc,
                   ranked.available_at asc,
                   ranked.created_at asc,
                   jobs.id asc
          for update of jobs skip locked
          limit ${request.limit}
        )
        update jobs
        set status = 'running',
            attempts = attempts + 1,
            locked_at = ${request.now},
            locked_until = ${lockedUntil},
            locked_by = ${request.workerId},
            updated_at = ${request.now}
        from candidates
        where jobs.id = candidates.id
        returning jobs.*
      `;
    });
    return rows.map(toLeasedJob);
  }

  async acknowledge(jobId: string, workerId: string, completedAt: Date): Promise<void> {
    const rows = await this.sql`
      update jobs
      set status = 'completed',
          completed_at = ${completedAt},
          locked_at = null,
          locked_until = null,
          locked_by = null,
          updated_at = ${completedAt}
      where id = ${jobId}
        and status = 'running'
        and locked_by = ${workerId}
      returning id
    `;
    if (rows.length !== 1) throw new Error("JOB_LEASE_LOST");
  }

  async renewLease(jobId: string, workerId: string, lockedUntil: Date): Promise<boolean> {
    const rows = await this.sql`
      update jobs
      set locked_until = ${lockedUntil},
          updated_at = now()
      where id = ${jobId}
        and status = 'running'
        and locked_by = ${workerId}
      returning id
    `;
    return rows.length === 1;
  }

  async retry(request: RetryJobRequest): Promise<"scheduled" | "dead_lettered"> {
    const rows = await this.sql<{ status: "retry" | "dead_lettered" }[]>`
      update jobs
      set status = case when attempts >= max_attempts then 'dead_lettered'::job_status else 'retry'::job_status end,
          available_at = ${request.availableAt},
          locked_at = null,
          locked_until = null,
          locked_by = null,
          last_error_code = ${request.errorCode},
          last_error_message = ${request.errorMessage.slice(0, 4_000)},
          updated_at = now()
      where id = ${request.jobId}
        and status = 'running'
        and locked_by = ${request.workerId}
      returning status
    `;
    const row = rows[0];
    if (!row) throw new Error("JOB_LEASE_LOST");
    return row.status === "retry" ? "scheduled" : "dead_lettered";
  }
}

function toLeasedJob(row: JobRow): LeasedJob {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.type,
    payload: row.payload,
    idempotencyKey: row.idempotency_key,
    correlationId: row.correlation_id,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    availableAt: row.available_at,
    lockedBy: row.locked_by,
    lockedUntil: row.locked_until,
  };
}
