import { and, eq, inArray, sql } from "drizzle-orm";
import type { ContentHasher } from "@outbound/application/shared/ports";
import type {
  ProspectMemoryAuthoritativeStateReader,
  ProspectMemorySemanticBudgetReader,
  ProspectMemorySourceMaterial,
  ProspectMemorySourceMaterialReader,
} from "@outbound/application/prospect-memory/prospect-memory";
import type { ProspectMemoryEvent } from "@outbound/domain/prospect-memory/prospect-memory";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  aiRuns,
  messages,
  socialInteractions,
} from "@outbound/infrastructure/database/schema";

export class PostgresProspectMemoryAuthoritativeStateReader implements ProspectMemoryAuthoritativeStateReader {
  constructor(private readonly database: Database) {}

  async read(workspaceId: string, contactId: string) {
    // Context assembly is latency-sensitive and may run at high concurrency.
    // Resolve the authoritative projection in one round trip instead of
    // fanning six queries into a small connection pool for every request.
    const rows = await this.database.execute<{
      first_name: string | null;
      last_name: string | null;
      preferred_channel: string | null;
      status: string;
      merged_into_id: string | null;
      anonymized_at: Date | null;
      privacy_epoch: number;
      company_name: string | null;
      job_title: string | null;
      identity_types: string[];
      active_campaign_ids: string[];
      active_decision_id: string | null;
      suppressed: boolean;
    }>(sql`
      select
        contact.first_name,
        contact.last_name,
        contact.preferred_channel,
        contact.status,
        contact.merged_into_id,
        contact.anonymized_at,
        contact.privacy_epoch,
        employment.company_name,
        employment.job_title,
        array(
          select distinct identity.type::text
          from contact_identities identity
          where identity.workspace_id = contact.workspace_id
            and identity.contact_id = contact.id
            and identity.verification_status <> 'invalid'
          order by identity.type::text
        ) as identity_types,
        array(
          select distinct enrollment.campaign_id::text
          from campaign_enrollments enrollment
          where enrollment.workspace_id = contact.workspace_id
            and enrollment.contact_id = contact.id
            and enrollment.status = 'active'
          order by enrollment.campaign_id::text
        ) as active_campaign_ids,
        decision.id as active_decision_id,
        (
          contact.status = 'suppressed'
          or exists (
            select 1
            from contact_suppressions suppression
            where suppression.workspace_id = contact.workspace_id
              and suppression.contact_id = contact.id
              and suppression.lifted_at is null
          )
        ) as suppressed
      from contacts contact
      left join lateral (
        select company.name as company_name, employment.title as job_title
        from contact_employments employment
        join companies company
          on company.workspace_id = employment.workspace_id
         and company.id = employment.company_id
        where employment.workspace_id = contact.workspace_id
          and employment.contact_id = contact.id
          and employment.is_current = true
        order by employment.created_at desc, employment.id desc
        limit 1
      ) employment on true
      left join lateral (
        select candidate.id
        from prospect_decisions candidate
        where candidate.workspace_id = contact.workspace_id
          and candidate.contact_id = contact.id
          and candidate.status in ('pending', 'running')
          and candidate.invalidated_at is null
        order by candidate.priority desc, candidate.updated_at desc
        limit 1
      ) decision on true
      where contact.workspace_id = ${workspaceId}
        and contact.id = ${contactId}
      limit 1
    `);
    const contact = rows[0];
    if (!contact || contact.merged_into_id) return null;
    const channels = new Set<"linkedin" | "email" | "whatsapp">();
    for (const identityType of contact.identity_types) {
      if (identityType === "linkedin" || identityType === "email" || identityType === "whatsapp") {
        channels.add(identityType);
      } else if (identityType === "phone") {
        channels.add("whatsapp");
      }
    }
    if (
      contact.preferred_channel === "linkedin"
      || contact.preferred_channel === "email"
      || contact.preferred_channel === "whatsapp"
    ) channels.add(contact.preferred_channel);

    return {
      currentState: {
        displayName: [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim() || null,
        companyName: contact.company_name,
        jobTitle: contact.job_title,
        locale: null,
        availableChannels: [...channels].sort(),
        suppressed: contact.suppressed,
        anonymized: contact.anonymized_at !== null,
        activeCampaignIds: contact.active_campaign_ids,
        activeDecisionId: contact.active_decision_id,
      },
      privacyEpoch: contact.privacy_epoch,
      anonymizedAt: contact.anonymized_at,
    };
  }
}

export class PostgresProspectMemorySourceMaterialReader implements ProspectMemorySourceMaterialReader {
  constructor(
    private readonly database: Database,
    private readonly hasher: ContentHasher,
  ) {}

  async read(input: {
    readonly workspaceId: string;
    readonly contactId: string;
    readonly events: readonly ProspectMemoryEvent[];
  }): Promise<readonly ProspectMemorySourceMaterial[]> {
    const messageIds = input.events.filter((event) => event.sourceKind === "message").map((event) => event.sourceId);
    const socialIds = input.events.filter((event) => event.sourceKind === "social_interaction").map((event) => event.sourceId);
    const [messageRows, socialRows] = await Promise.all([
      messageIds.length
        ? this.database.select({ id: messages.id, body: messages.body })
          .from(messages)
          .where(and(eq(messages.workspaceId, input.workspaceId), inArray(messages.id, messageIds)))
        : Promise.resolve([]),
      socialIds.length
        ? this.database.select({ id: socialInteractions.id, body: socialInteractions.body, reaction: socialInteractions.reaction })
          .from(socialInteractions)
          .where(and(eq(socialInteractions.workspaceId, input.workspaceId), inArray(socialInteractions.id, socialIds)))
        : Promise.resolve([]),
    ]);
    const messageContent = new Map(messageRows.map((row) => [row.id, row.body]));
    const socialContent = new Map(socialRows.map((row) => [row.id, row.body ?? row.reaction ?? null]));
    return Promise.all(input.events.map(async (event) => {
      const content = event.sourceKind === "message"
        ? messageContent.get(event.sourceId) ?? null
        : event.sourceKind === "social_interaction"
          ? socialContent.get(event.sourceId) ?? null
          : semanticPayload(event);
      return {
        event,
        content,
        language: null,
        sourceHash: await this.hasher.hash({
          eventId: event.id,
          sourceKind: event.sourceKind,
          sourceId: event.sourceId,
          sourceVersion: event.sourceVersion,
          content,
        }),
      };
    }));
  }
}

export class PostgresProspectMemorySemanticBudgetReader implements ProspectMemorySemanticBudgetReader {
  constructor(private readonly database: Database) {}

  async readUsage(input: { readonly workspaceId: string; readonly since: Date }) {
    const rows = await this.database.select({
      refreshes: sql<number>`count(*)::int`,
      costUsd: sql<string>`coalesce(sum(${aiRuns.cost}), 0)::text`,
    }).from(aiRuns).where(and(
      eq(aiRuns.workspaceId, input.workspaceId),
      eq(aiRuns.purpose, "prospect_memory"),
      sql`${aiRuns.createdAt} >= ${input.since}`,
    ));
    return {
      refreshes: rows[0]?.refreshes ?? 0,
      costUsd: Number(rows[0]?.costUsd ?? 0),
    };
  }
}

function semanticPayload(event: ProspectMemoryEvent): string | null {
  if (![
    "message_received",
    "message_sent",
    "call_recorded",
    "social_interaction",
  ].includes(event.kind)) return null;
  for (const key of ["body", "summary", "transcript", "notes"] as const) {
    const value = event.payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
