import { and, asc, desc, eq, exists, gt, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import type {
  AttributionJourneyView,
  AttributionRepository,
  AttributionTouchView,
} from "@outbound/application/attribution/attribution";
import { normalizeLinkedinUrl } from "@outbound/domain/crm/normalization";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  attributionTouches,
  calendarBookings,
  campaigns,
  contactIdentities,
  contacts,
  conversations,
  socialContentItems,
  socialInteractions,
} from "@outbound/infrastructure/database/schema";

const MODEL_VERSION = "attribution-v1";
const BOOKING_WINDOW_MS = 90 * 24 * 60 * 60_000;

export class PostgresAttributionRepository implements AttributionRepository {
  constructor(private readonly database: Database) {}

  async reconcile(input: { readonly workspaceId?: string; readonly now: Date; readonly limit: number }): Promise<number> {
    const due = await this.database.select({ interaction: socialInteractions, post: socialContentItems, identity: attributionTouches }).from(socialInteractions)
      .innerJoin(socialContentItems, and(
        eq(socialContentItems.workspaceId, socialInteractions.workspaceId),
        eq(socialContentItems.id, socialInteractions.socialContentId),
      ))
      .leftJoin(attributionTouches, and(
        eq(attributionTouches.workspaceId, socialInteractions.workspaceId),
        eq(attributionTouches.socialInteractionId, socialInteractions.id),
        eq(attributionTouches.logicalKey, "identity"),
      ))
      .where(and(
        eq(socialInteractions.status, "observed"),
        ...(input.workspaceId ? [eq(socialInteractions.workspaceId, input.workspaceId)] : []),
        or(
          isNull(attributionTouches.id),
          lte(attributionTouches.nextResolutionAt, input.now),
          gt(socialInteractions.updatedAt, attributionTouches.updatedAt),
        ),
      ))
      .orderBy(asc(socialInteractions.lastSeenAt), asc(socialInteractions.id))
      .limit(input.limit);
    for (const row of due) await this.#resolve(row.interaction, row.post, input.now);
    return due.length;
  }

  async listJourneys(input: Parameters<AttributionRepository["listJourneys"]>[0]) {
    const cursor = input.cursor ? parseCursor(input.cursor) : null;
    const rows = await this.database.select({ interaction: socialInteractions, post: socialContentItems }).from(socialInteractions)
      .innerJoin(socialContentItems, and(
        eq(socialContentItems.workspaceId, socialInteractions.workspaceId),
        eq(socialContentItems.id, socialInteractions.socialContentId),
      ))
      .where(and(
        eq(socialInteractions.workspaceId, input.workspaceId),
        eq(socialInteractions.status, "observed"),
        ...(input.interactionId ? [eq(socialInteractions.id, input.interactionId)] : []),
        ...(input.bookingId ? [exists(this.database.select({ id: attributionTouches.id }).from(attributionTouches).where(and(
          eq(attributionTouches.workspaceId, input.workspaceId),
          eq(attributionTouches.socialInteractionId, socialInteractions.id),
          eq(attributionTouches.bookingId, input.bookingId),
          eq(attributionTouches.kind, "booking"),
          eq(attributionTouches.status, "active"),
        )))] : []),
        ...(cursor ? [or(
          lt(socialInteractions.lastSeenAt, cursor.at),
          and(eq(socialInteractions.lastSeenAt, cursor.at), lt(socialInteractions.id, cursor.id)),
        )!] : []),
      ))
      .orderBy(desc(socialInteractions.lastSeenAt), desc(socialInteractions.id))
      .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const page = rows.slice(0, input.limit);
    const ids = page.map(({ interaction }) => interaction.id);
    const touchRows = ids.length ? await this.database.select({
      touch: attributionTouches,
      contactFirstName: contacts.firstName,
      contactLastName: contacts.lastName,
      campaignName: campaigns.name,
      bookingStartAt: calendarBookings.startAt,
    }).from(attributionTouches)
      .leftJoin(contacts, and(eq(contacts.workspaceId, attributionTouches.workspaceId), eq(contacts.id, attributionTouches.contactId)))
      .leftJoin(campaigns, and(eq(campaigns.workspaceId, attributionTouches.workspaceId), eq(campaigns.id, attributionTouches.campaignId)))
      .leftJoin(calendarBookings, and(eq(calendarBookings.workspaceId, attributionTouches.workspaceId), eq(calendarBookings.id, attributionTouches.bookingId)))
      .where(and(
        eq(attributionTouches.workspaceId, input.workspaceId),
        inArray(attributionTouches.socialInteractionId, ids),
        eq(attributionTouches.status, "active"),
      ))
      .orderBy(asc(attributionTouches.occurredAt), asc(attributionTouches.id)) : [];
    const bookingIds = [...new Set(touchRows.flatMap(({ touch }) => touch.bookingId ? [touch.bookingId] : []))];
    const bookingPositions = await this.#bookingPositions(input.workspaceId, bookingIds);
    const grouped = new Map<string, AttributionTouchView[]>();
    for (const row of touchRows) {
      const values = grouped.get(row.touch.socialInteractionId) ?? [];
      values.push(toTouch(row, bookingPositions.get(row.touch.bookingId ?? "")?.get(row.touch.socialInteractionId) ?? null));
      grouped.set(row.touch.socialInteractionId, values);
    }
    const data = page.map(({ interaction, post }): AttributionJourneyView => {
      const touches = grouped.get(interaction.id) ?? [];
      const identity = touches.find((touch) => touch.kind === "identity");
      return {
        interaction: {
          id: interaction.id,
          type: interaction.type as AttributionJourneyView["interaction"]["type"],
          actorName: interaction.actorName,
          actorProfileUrl: interaction.actorProfileUrl,
          body: interaction.body,
          reaction: interaction.reaction,
          occurredAt: interaction.occurredAt ?? interaction.firstSeenAt,
        },
        source: { socialContentId: post.id, publicationId: post.publicationId, text: post.text, url: post.url },
        resolution: resolutionFor(identity),
        touches,
      };
    });
    const last = page.at(-1)?.interaction;
    return { data, nextCursor: hasMore && last ? `${last.lastSeenAt.toISOString()}|${last.id}` : null };
  }

  async #resolve(interaction: typeof socialInteractions.$inferSelect, post: typeof socialContentItems.$inferSelect, now: Date): Promise<void> {
    await this.database.transaction(async (tx) => {
      const resolution = await resolveIdentity(tx, interaction);
      await tx.update(attributionTouches).set({ status: "superseded", updatedAt: now }).where(and(
        eq(attributionTouches.workspaceId, interaction.workspaceId),
        eq(attributionTouches.socialInteractionId, interaction.id),
        ne(attributionTouches.logicalKey, "identity"),
        eq(attributionTouches.status, "active"),
      ));
      const occurredAt = interaction.occurredAt ?? interaction.firstSeenAt;
      await upsertTouch(tx, baseTouch(interaction, post, {
        kind: "identity",
        logicalKey: "identity",
        certainty: resolution.contactId ? "evidence" : "unknown",
        rule: resolution.rule,
        confidence: resolution.confidence,
        proofType: resolution.proofType,
        proofRef: resolution.proofRef,
        proofHref: resolution.contactId ? `/prospects/${resolution.contactId}` : `/content/calendar?interaction=${interaction.id}`,
        contactId: resolution.contactId,
        occurredAt,
        nextResolutionAt: new Date(now.getTime() + resolution.retryMs),
      }, now));
      if (!resolution.contactId) return;
      const conversationRows = await tx.select().from(conversations).where(and(
        eq(conversations.workspaceId, interaction.workspaceId),
        eq(conversations.contactId, resolution.contactId),
        eq(conversations.channel, "linkedin"),
        eq(conversations.connectedAccountId, interaction.connectedAccountId),
      )).orderBy(asc(conversations.createdAt), asc(conversations.id));
      for (const conversation of conversationRows) {
        await upsertTouch(tx, baseTouch(interaction, post, {
          kind: "conversation",
          logicalKey: `conversation:${conversation.id}`,
          certainty: "evidence",
          rule: "crm_contact_conversation_fk_v1",
          confidence: 1,
          proofType: "crm_foreign_key",
          proofRef: `conversation:${conversation.id}:contact:${resolution.contactId}`,
          proofHref: `/inbox?conversation=${conversation.id}`,
          contactId: resolution.contactId,
          conversationId: conversation.id,
          campaignId: conversation.campaignId,
          occurredAt,
        }, now));
        if (conversation.campaignId) await upsertTouch(tx, baseTouch(interaction, post, {
          kind: "campaign",
          logicalKey: `campaign:${conversation.campaignId}`,
          certainty: "evidence",
          rule: "conversation_campaign_fk_v1",
          confidence: 1,
          proofType: "crm_foreign_key",
          proofRef: `conversation:${conversation.id}:campaign:${conversation.campaignId}`,
          proofHref: `/campaigns/${conversation.campaignId}`,
          contactId: resolution.contactId,
          conversationId: conversation.id,
          campaignId: conversation.campaignId,
          occurredAt,
        }, now));
      }
      const bookingRows = await tx.select().from(calendarBookings).where(and(
        eq(calendarBookings.workspaceId, interaction.workspaceId),
        eq(calendarBookings.contactId, resolution.contactId),
        gt(calendarBookings.startAt, occurredAt),
        lte(calendarBookings.startAt, new Date(occurredAt.getTime() + BOOKING_WINDOW_MS)),
      )).orderBy(asc(calendarBookings.startAt), asc(calendarBookings.id));
      for (const booking of bookingRows) {
        await upsertTouch(tx, baseTouch(interaction, post, {
          kind: "booking",
          logicalKey: `booking:${booking.id}`,
          certainty: "inference",
          rule: "same_verified_contact_after_touch_90d_v1",
          confidence: 0.6,
          proofType: "contact_time_correlation",
          proofRef: `contact:${resolution.contactId}:booking:${booking.id}`,
          proofHref: `/appointments?booking=${booking.id}`,
          contactId: resolution.contactId,
          campaignId: booking.campaignId,
          bookingId: booking.id,
          opportunityId: booking.opportunityId,
          occurredAt,
        }, now));
        if (booking.opportunityId) await upsertTouch(tx, baseTouch(interaction, post, {
          kind: "opportunity",
          logicalKey: `opportunity:${booking.opportunityId}`,
          certainty: "inference",
          rule: "booking_opportunity_fk_after_correlated_touch_v1",
          confidence: 0.6,
          proofType: "booking_foreign_key",
          proofRef: `booking:${booking.id}:opportunity:${booking.opportunityId}`,
          proofHref: "/pipeline",
          contactId: resolution.contactId,
          campaignId: booking.campaignId,
          bookingId: booking.id,
          opportunityId: booking.opportunityId,
          occurredAt,
        }, now));
      }
    });
  }

  async #bookingPositions(workspaceId: string, bookingIds: readonly string[]) {
    const result = new Map<string, Map<string, AttributionTouchView["position"]>>();
    if (!bookingIds.length) return result;
    const rows = await this.database.select({ bookingId: attributionTouches.bookingId, interactionId: attributionTouches.socialInteractionId }).from(attributionTouches).where(and(
      eq(attributionTouches.workspaceId, workspaceId),
      inArray(attributionTouches.bookingId, bookingIds),
      eq(attributionTouches.kind, "booking"),
      eq(attributionTouches.status, "active"),
    )).orderBy(asc(attributionTouches.occurredAt), asc(attributionTouches.socialInteractionId));
    for (const bookingId of bookingIds) {
      const ids = rows.filter((row) => row.bookingId === bookingId).map((row) => row.interactionId);
      const positions = new Map<string, AttributionTouchView["position"]>();
      ids.forEach((id, index) => positions.set(id, ids.length === 1 ? "first_and_last" : index === 0 ? "first" : index === ids.length - 1 ? "last" : "middle"));
      result.set(bookingId, positions);
    }
    return result;
  }
}

type Resolution = { contactId: string | null; rule: string; confidence: number; proofType: string; proofRef: string | null; retryMs: number };

async function resolveIdentity(tx: any, interaction: typeof socialInteractions.$inferSelect): Promise<Resolution> {
  if (interaction.direction === "owner") return { contactId: null, rule: "owner_interaction_excluded_v1", confidence: 0, proofType: "provider_direction", proofRef: `interaction:${interaction.id}`, retryMs: 30 * 24 * 60 * 60_000 };
  const providerKey = interaction.actorProviderId ? `unipile:${interaction.providerAccountId}:${interaction.actorProviderId}` : null;
  const profileKey = normalizeProfile(interaction.actorProfileUrl);
  const candidates = [providerKey, profileKey].filter((value): value is string => Boolean(value));
  if (!candidates.length) return { contactId: null, rule: "no_exact_linkedin_identity_v1", confidence: 0, proofType: "none", proofRef: null, retryMs: 24 * 60 * 60_000 };
  const matches = await tx.select({ identity: contactIdentities, contact: contacts }).from(contactIdentities).innerJoin(contacts, and(
    eq(contacts.workspaceId, contactIdentities.workspaceId),
    eq(contacts.id, contactIdentities.contactId),
  )).where(and(
    eq(contactIdentities.workspaceId, interaction.workspaceId),
    eq(contactIdentities.type, "linkedin"),
    inArray(contactIdentities.normalizedValue, candidates),
    ne(contactIdentities.verificationStatus, "invalid"),
    eq(contacts.status, "active"),
    isNull(contacts.mergedIntoId),
  )) as Array<{ identity: typeof contactIdentities.$inferSelect; contact: typeof contacts.$inferSelect }>;
  const contactIds = [...new Set(matches.map(({ contact }) => contact.id))];
  if (contactIds.length !== 1) return { contactId: null, rule: contactIds.length ? "ambiguous_exact_linkedin_identity_v1" : "no_exact_linkedin_identity_v1", confidence: 0, proofType: contactIds.length ? "conflicting_contact_identities" : "none", proofRef: null, retryMs: 24 * 60 * 60_000 };
  const exact = matches.find(({ identity }) => identity.normalizedValue === providerKey) ?? matches[0]!;
  return {
    contactId: contactIds[0]!,
    rule: exact.identity.normalizedValue === providerKey ? "linkedin_provider_identity_exact_v1" : "linkedin_profile_url_exact_v1",
    confidence: exact.identity.normalizedValue === providerKey ? 1 : 0.95,
    proofType: "contact_identity",
    proofRef: `contact_identity:${exact.identity.id}`,
    retryMs: 7 * 24 * 60 * 60_000,
  };
}

function baseTouch(interaction: typeof socialInteractions.$inferSelect, post: typeof socialContentItems.$inferSelect, value: Record<string, unknown>, now: Date) {
  return { id: crypto.randomUUID(), workspaceId: interaction.workspaceId, socialContentId: post.id, socialInteractionId: interaction.id, publicationId: post.publicationId, modelVersion: MODEL_VERSION, status: "active", createdAt: now, updatedAt: now, ...value };
}
async function upsertTouch(tx: any, value: ReturnType<typeof baseTouch>) {
  const { id: _id, createdAt: _createdAt, ...mutable } = value;
  await tx.insert(attributionTouches).values(value).onConflictDoUpdate({
    target: [attributionTouches.workspaceId, attributionTouches.socialInteractionId, attributionTouches.logicalKey],
    set: { ...mutable, status: "active" },
  });
}
function normalizeProfile(value: string | null): string | null { if (!value) return null; try { return normalizeLinkedinUrl(value); } catch { return null; } }
function resolutionFor(identity?: AttributionTouchView): AttributionJourneyView["resolution"] { if (!identity) return "unknown"; if (identity.rule.startsWith("owner_")) return "excluded"; if (identity.contactId) return "resolved"; return identity.rule.startsWith("ambiguous_") ? "ambiguous" : "unknown"; }
function parseCursor(value: string) { const separator = value.indexOf("|"); const at = new Date(separator > 0 ? value.slice(0, separator) : ""); const id = separator > 0 ? value.slice(separator + 1) : ""; if (Number.isNaN(at.getTime()) || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) throw new Error("ATTRIBUTION_CURSOR_INVALID"); return { at, id }; }
function toTouch(row: { touch: typeof attributionTouches.$inferSelect; contactFirstName: string | null; contactLastName: string | null; campaignName: string | null; bookingStartAt: Date | null }, position: AttributionTouchView["position"]): AttributionTouchView { const touch = row.touch; const contactName = [row.contactFirstName, row.contactLastName].filter(Boolean).join(" ") || null; return { id: touch.id, kind: touch.kind as AttributionTouchView["kind"], certainty: touch.certainty as AttributionTouchView["certainty"], rule: touch.rule, modelVersion: touch.modelVersion, confidence: Number(touch.confidence), proofType: touch.proofType, proofRef: touch.proofRef, proofHref: touch.proofHref, contactId: touch.contactId, contactName, conversationId: touch.conversationId, campaignId: touch.campaignId, campaignName: row.campaignName, bookingId: touch.bookingId, bookingStartAt: row.bookingStartAt, opportunityId: touch.opportunityId, position: touch.kind === "booking" ? position : null, occurredAt: touch.occurredAt }; }
