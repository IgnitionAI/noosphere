import type {
  ProspectMemoryOperationsReader,
  ProspectMemoryRefreshJobStatus,
  ProspectMemoryRefreshJobView,
} from "@outbound/application/prospect-memory/prospect-memory";
import { PROSPECT_MEMORY_REFRESH_JOB_TYPE } from "@outbound/application/prospect-memory/prospect-memory";
import type { SqlClient } from "@outbound/infrastructure/database/client";

interface RefreshJobRow {
  id: string;
  status: string;
  attempts: number;
  max_attempts: number;
  available_at: Date;
  locked_until: Date | null;
  completed_at: Date | null;
  last_error_code: string | null;
  created_at: Date;
  updated_at: Date;
}

export class PostgresProspectMemoryOperationsReader implements ProspectMemoryOperationsReader {
  constructor(private readonly sql: SqlClient) {}

  async countEventsAfter(input: {
    readonly workspaceId: string;
    readonly contactId: string;
    readonly sequenceId: number;
  }): Promise<number> {
    const rows = await this.sql<{ count: string | number }[]>`
      select count(*) as count
      from prospect_memory_events event
      where event.workspace_id = ${input.workspaceId}
        and event.sequence_id > ${input.sequenceId}
        and (
          event.canonical_contact_id = ${input.contactId}
          or event.source_contact_id = ${input.contactId}
          or event.source_contact_id in (
            select contact.id
            from contacts contact
            where contact.workspace_id = ${input.workspaceId}
              and contact.merged_into_id = ${input.contactId}
          )
        )
    `;
    return safeInteger(rows[0]?.count ?? 0, "PROSPECT_MEMORY_EVENT_COUNT_UNSAFE");
  }

  async findLatestRefreshJob(input: {
    readonly workspaceId: string;
    readonly contactId: string;
  }): Promise<ProspectMemoryRefreshJobView | null> {
    const rows = await this.sql<RefreshJobRow[]>`
      select id, status, attempts, max_attempts, available_at, locked_until,
             completed_at, last_error_code, created_at, updated_at
      from jobs
      where workspace_id = ${input.workspaceId}
        and type = ${PROSPECT_MEMORY_REFRESH_JOB_TYPE}
        and payload ->> 'contactId' = ${input.contactId}
      order by created_at desc, id desc
      limit 1
    `;
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async findRefreshJobByIdempotencyKey(input: {
    readonly workspaceId: string;
    readonly idempotencyKey: string;
  }): Promise<ProspectMemoryRefreshJobView | null> {
    const rows = await this.sql<RefreshJobRow[]>`
      select id, status, attempts, max_attempts, available_at, locked_until,
             completed_at, last_error_code, created_at, updated_at
      from jobs
      where workspace_id = ${input.workspaceId}
        and type = ${PROSPECT_MEMORY_REFRESH_JOB_TYPE}
        and idempotency_key = ${input.idempotencyKey}
      limit 1
    `;
    return rows[0] ? fromRow(rows[0]) : null;
  }
}

function fromRow(row: RefreshJobRow): ProspectMemoryRefreshJobView {
  return {
    id: row.id,
    status: parseStatus(row.status),
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    availableAt: row.available_at,
    lockedUntil: row.locked_until,
    completedAt: row.completed_at,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseStatus(value: string): ProspectMemoryRefreshJobStatus {
  if (!["pending", "running", "retry", "completed", "dead_lettered"].includes(value)) {
    throw new Error("PROSPECT_MEMORY_JOB_STATUS_UNSUPPORTED");
  }
  return value as ProspectMemoryRefreshJobStatus;
}

function safeInteger(value: string | number, code: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(code);
  return parsed;
}
