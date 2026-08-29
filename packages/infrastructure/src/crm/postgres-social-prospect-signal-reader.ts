import { and, eq, inArray } from "drizzle-orm";
import {
  assessSocialProspectSignals,
  type SocialInteractionKind,
  type SocialProspectSignalAssessment,
  type SocialProspectSignalFact,
} from "@outbound/domain/crm/social-prospect-signal";
import type { DatabaseExecutor } from "@outbound/infrastructure/database/client";
import {
  attributionTouches,
  conversations,
  socialInteractions,
} from "@outbound/infrastructure/database/schema";

export class PostgresSocialProspectSignalReader {
  constructor(private readonly database: DatabaseExecutor) {}

  async read(input: {
    readonly workspaceId: string;
    readonly contactId: string;
    readonly baseScore: number | null;
    readonly now: Date;
  }): Promise<SocialProspectSignalAssessment> {
    const result = await this.readMany({
      workspaceId: input.workspaceId,
      contacts: [{ id: input.contactId, baseScore: input.baseScore }],
      now: input.now,
    });
    return result.get(input.contactId)!;
  }

  async readMany(input: {
    readonly workspaceId: string;
    readonly contacts: readonly { readonly id: string; readonly baseScore: number | null }[];
    readonly now: Date;
  }): Promise<Map<string, SocialProspectSignalAssessment>> {
    const result = new Map<string, SocialProspectSignalAssessment>();
    if (!input.contacts.length) return result;
    const contactIds = input.contacts.map((contact) => contact.id);
    const [rows, openConversationRows] = await Promise.all([
      this.database
        .select({
          contactId: attributionTouches.contactId,
          interactionId: socialInteractions.id,
          type: socialInteractions.type,
          direction: socialInteractions.direction,
          status: socialInteractions.status,
          body: socialInteractions.body,
          reaction: socialInteractions.reaction,
          occurredAt: socialInteractions.occurredAt,
          firstSeenAt: socialInteractions.firstSeenAt,
          certainty: attributionTouches.certainty,
          rule: attributionTouches.rule,
          confidence: attributionTouches.confidence,
          proofType: attributionTouches.proofType,
        })
        .from(attributionTouches)
        .innerJoin(
          socialInteractions,
          and(
            eq(socialInteractions.workspaceId, attributionTouches.workspaceId),
            eq(socialInteractions.id, attributionTouches.socialInteractionId),
          ),
        )
        .where(and(
          eq(attributionTouches.workspaceId, input.workspaceId),
          inArray(attributionTouches.contactId, contactIds),
          eq(attributionTouches.kind, "identity"),
          eq(attributionTouches.status, "active"),
        )),
      this.database
        .select({ contactId: conversations.contactId })
        .from(conversations)
        .where(and(
          eq(conversations.workspaceId, input.workspaceId),
          inArray(conversations.contactId, contactIds),
          eq(conversations.channel, "linkedin"),
          eq(conversations.status, "open"),
        )),
    ]);
    const openContactIds = new Set(openConversationRows.flatMap((row) => row.contactId ? [row.contactId] : []));
    const facts = new Map<string, SocialProspectSignalFact[]>();
    for (const row of rows) {
      if (!row.contactId || !isInteractionKind(row.type)) continue;
      const contactFacts = facts.get(row.contactId) ?? [];
      contactFacts.push({
        id: row.interactionId,
        type: row.type,
        direction: row.direction,
        status: row.status,
        body: row.body,
        reaction: row.reaction,
        occurredAt: row.occurredAt ?? row.firstSeenAt,
        identityCertainty: row.certainty,
        identityRule: row.rule,
        identityConfidence: Number(row.confidence),
        identityProofType: row.proofType,
        proofHref: `/attribution?interactionId=${row.interactionId}`,
      });
      facts.set(row.contactId, contactFacts);
    }
    for (const contact of input.contacts) {
      result.set(contact.id, assessSocialProspectSignals({
        now: input.now,
        baseScore: contact.baseScore,
        signals: facts.get(contact.id) ?? [],
        openLinkedinConversation: openContactIds.has(contact.id),
      }));
    }
    return result;
  }
}

function isInteractionKind(value: string): value is SocialInteractionKind {
  return ["comment", "reply", "mention", "reaction"].includes(value);
}
