import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type {
  CampaignEditorialContext,
  CampaignEditorialContextReader,
  CampaignOfferEditorialContext,
} from "@outbound/application/campaigns/campaign-content-generator";
import {
  campaignStepObjective,
  mergeCampaignMessageHistory,
} from "@outbound/domain/campaigns/campaign-editorial-context";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  campaigns,
  conversations,
  icpVersions,
  messages,
  offerClaims,
  offerVersions,
  outreachActions,
  productResearchRuns,
} from "@outbound/infrastructure/database/schema";

export class PostgresCampaignEditorialContextReader implements CampaignEditorialContextReader {
  constructor(private readonly database: Database) {}

  async read(
    input: Parameters<CampaignEditorialContextReader["read"]>[0],
  ): Promise<CampaignEditorialContext> {
    const campaign = await this.#campaign(input.workspaceId, input.campaignId);
    if (!campaign) throw new Error("CAMPAIGN_EDITORIAL_CONTEXT_NOT_FOUND");
    const [offer, campaignTouches, conversationMessages] = await Promise.all([
      this.#offer(input.workspaceId, campaign.offerVersionId, campaign.brief),
      this.database
        .select({
          bodySnapshot: outreachActions.contentSnapshot,
          occurredAt: outreachActions.sentAt,
        })
        .from(outreachActions)
        .where(and(
          eq(outreachActions.workspaceId, input.workspaceId),
          eq(outreachActions.campaignId, input.campaignId),
          eq(outreachActions.contactId, input.contactId),
          eq(outreachActions.status, "sent"),
          lt(outreachActions.stepPosition, input.step.position),
        ))
        .orderBy(asc(outreachActions.sentAt)),
      this.database
        .select({
          direction: messages.direction,
          body: messages.body,
          sentAt: messages.sentAt,
          receivedAt: messages.receivedAt,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .innerJoin(
          conversations,
          and(
            eq(conversations.workspaceId, messages.workspaceId),
            eq(conversations.id, messages.conversationId),
          ),
        )
        .where(and(
          eq(messages.workspaceId, input.workspaceId),
          eq(conversations.campaignId, input.campaignId),
          eq(conversations.contactId, input.contactId),
        ))
        .orderBy(asc(messages.createdAt))
        .limit(30),
    ]);
    const previousMessages = mergeCampaignMessageHistory([
      ...campaignTouches.flatMap((touch) => {
        const body = bodyFromSnapshot(touch.bodySnapshot);
        return body && touch.occurredAt
          ? [{ direction: "outbound" as const, body, occurredAt: touch.occurredAt, source: "campaign" as const }]
          : [];
      }),
      ...conversationMessages
        .filter((message): message is typeof message & { direction: "inbound" | "outbound" } =>
          message.direction === "inbound" || message.direction === "outbound")
        .map((message) => ({
          direction: message.direction,
          body: message.body,
          occurredAt: message.sentAt ?? message.receivedAt ?? message.createdAt,
          source: "conversation" as const,
        })),
    ]);
    return {
      campaignObjective: campaign.objective,
      offer,
      prospectEvidence: input.prospectEvidence,
      previousMessages,
      stepObjective: campaignStepObjective({
        channel: campaign.channel,
        kind: input.step.kind,
        position: input.step.position,
        totalSteps: input.totalSteps,
      }),
    };
  }

  async #campaign(workspaceId: string, campaignId: string) {
    const [row] = await this.database
      .select({
        objective: campaigns.objective,
        channel: campaigns.channel,
        offerVersionId: campaigns.offerVersionId,
        brief: productResearchRuns.brief,
      })
      .from(campaigns)
      .innerJoin(
        icpVersions,
        and(eq(icpVersions.workspaceId, campaigns.workspaceId), eq(icpVersions.id, campaigns.icpVersionId)),
      )
      .leftJoin(
        productResearchRuns,
        and(
          eq(productResearchRuns.workspaceId, icpVersions.workspaceId),
          eq(productResearchRuns.id, icpVersions.runId),
        ),
      )
      .where(and(eq(campaigns.workspaceId, workspaceId), eq(campaigns.id, campaignId)))
      .limit(1);
    return row ?? null;
  }

  async #offer(
    workspaceId: string,
    offerVersionId: string | null,
    brief: unknown,
  ): Promise<CampaignOfferEditorialContext> {
    const productName = productNameFromBrief(brief);
    const [matchingVersion] = !offerVersionId && productName
      ? await this.database
          .select({ id: offerVersions.id })
          .from(offerVersions)
          .where(and(
            eq(offerVersions.workspaceId, workspaceId),
            sql`lower(${offerVersions.name}) = lower(${productName})`,
          ))
          .orderBy(desc(offerVersions.version))
          .limit(1)
      : [];
    const resolvedOfferVersionId = offerVersionId ?? matchingVersion?.id ?? null;
    if (resolvedOfferVersionId) {
      const [version, claims] = await Promise.all([
        this.database
          .select()
          .from(offerVersions)
          .where(and(eq(offerVersions.workspaceId, workspaceId), eq(offerVersions.id, resolvedOfferVersionId)))
          .limit(1),
        this.database
          .select({
            id: offerClaims.id,
            claim: offerClaims.claim,
            validationStatus: offerClaims.validationStatus,
            evidenceUri: offerClaims.evidenceUri,
          })
          .from(offerClaims)
          .where(and(
            eq(offerClaims.workspaceId, workspaceId),
            eq(offerClaims.offerVersionId, resolvedOfferVersionId),
            inArray(offerClaims.validationStatus, ["sourced", "validated"]),
          )),
      ]);
      const snapshot = version[0];
      if (snapshot) {
        return {
          source: "offer_version",
          name: snapshot.name,
          category: snapshot.category,
          valueProposition: snapshot.valueProposition,
          targetAudience: snapshot.targetAudience,
          pricing: snapshot.pricing,
          commercialRules: snapshot.commercialRules,
          constraints: snapshot.constraints,
          objections: snapshot.objections,
          claims: claims.map((claim) => ({
            ...claim,
            validationStatus: claim.validationStatus as "sourced" | "validated",
          })),
        };
      }
    }
    return offerFromResearchBrief(brief);
  }
}

function productNameFromBrief(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return text((value as Record<string, unknown>).productName);
}

function offerFromResearchBrief(value: unknown): CampaignOfferEditorialContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return unavailableOffer();
  const brief = value as Record<string, unknown>;
  const name = text(brief.productName);
  const description = text(brief.description);
  if (!name && !description) return unavailableOffer();
  return {
    source: "research_brief",
    name: name || "Offre étudiée",
    category: text(brief.salesMotion) || null,
    valueProposition: description,
    targetAudience: "",
    pricing: {},
    commercialRules: {},
    constraints: {},
    objections: [],
    claims: [],
  };
}

function unavailableOffer(): CampaignOfferEditorialContext {
  return {
    source: "unavailable",
    name: "Offre non renseignée",
    category: null,
    valueProposition: "",
    targetAudience: "",
    pricing: {},
    commercialRules: {},
    constraints: {},
    objections: [],
    claims: [],
  };
}

function bodyFromSnapshot(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return text((value as Record<string, unknown>).body) || null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
