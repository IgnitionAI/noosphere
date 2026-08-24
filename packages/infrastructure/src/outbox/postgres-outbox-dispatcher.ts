import type { SqlClient } from "@outbound/infrastructure/database/client";

export interface OutboxEventRow {
  id: string;
  workspace_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: unknown;
}

export interface OutboxDispatcherOptions {
  readonly batchSize?: number;
  readonly leaseMs?: number;
  readonly handler?: (event: OutboxEventRow) => Promise<void>;
}

/**
 * Delivers transactional outbox rows with PostgreSQL row locks. The audit
 * handler is idempotent on source_event_id, so a crash between delivery and
 * published_at marking is safely replayable.
 */
export class PostgresOutboxDispatcher {
  readonly #batchSize: number;
  readonly #leaseMs: number;
  readonly #handler: (event: OutboxEventRow) => Promise<void>;

  constructor(
    private readonly sql: SqlClient,
    options: OutboxDispatcherOptions = {},
  ) {
    this.#batchSize = Math.max(1, Math.min(options.batchSize ?? 50, 500));
    this.#leaseMs = Math.max(1_000, options.leaseMs ?? 300_000);
    this.#handler = options.handler ?? ((event) => this.#writeAudit(event));
  }

  async dispatchBatch(): Promise<number> {
    const leaseUntil = new Date(Date.now() + this.#leaseMs);
    const events = await this.sql.begin(async (transaction) => transaction<OutboxEventRow[]>`
      with candidates as (
        select id
        from outbox_events
        where published_at is null and available_at <= now()
        order by created_at asc, id asc
        for update skip locked
        limit ${this.#batchSize}
      )
      update outbox_events
      set attempts = attempts + 1, available_at = ${leaseUntil}
      from candidates
      where outbox_events.id = candidates.id
      returning outbox_events.id, outbox_events.workspace_id, outbox_events.aggregate_type,
        outbox_events.aggregate_id, outbox_events.event_type, outbox_events.payload
    `);

    let delivered = 0;
    for (const event of events) {
      try {
        await this.#handler(event);
        const marked = await this.sql`
          update outbox_events
          set published_at = now(), available_at = now()
          where id = ${event.id} and published_at is null
          returning id
        `;
        if (marked.length === 1) delivered += 1;
      } catch (error) {
        await this.sql`
          update outbox_events
          set available_at = now() + interval '30 seconds'
          where id = ${event.id} and published_at is null
        `;
        console.error(JSON.stringify({
          event: "outbox_delivery_error",
          outboxEventId: event.id,
          eventType: event.event_type,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }
    return delivered;
  }

  async #writeAudit(event: OutboxEventRow): Promise<void> {
    const payload = (event.payload && typeof event.payload === "object")
      ? event.payload as Record<string, unknown>
      : {};
    const actor = payload.actorUserId ?? payload.userId ?? payload.publishedBy ?? null;
    const correlation = payload.correlationId ?? null;
    await this.sql`
      insert into audit_logs (
        workspace_id, actor_user_id, action, subject_type, subject_id,
        changes, correlation_id, source_event_id
      ) values (
        ${event.workspace_id}, ${typeof actor === "string" ? actor : null}, ${event.event_type},
        ${event.aggregate_type}, ${event.aggregate_id}, ${JSON.stringify(event.payload)}::jsonb,
        ${typeof correlation === "string" ? correlation : null}, ${event.id}
      ) on conflict (source_event_id) do nothing
    `;
    console.info(JSON.stringify({
      event: "outbox_event_delivered",
      outboxEventId: event.id,
      eventType: event.event_type,
    }));
  }
}
