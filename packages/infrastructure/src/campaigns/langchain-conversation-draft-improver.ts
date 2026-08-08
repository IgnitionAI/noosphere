import { and, asc, desc, eq } from "drizzle-orm";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  ConversationDraftNotFoundError,
  type ConversationDraftImprovement,
  type ConversationDraftImprover,
} from "@outbound/application/campaigns/conversation-draft-improver";
import type { WorkspaceAiModelPolicyReader } from "@outbound/application/workspaces/workspace-ai-settings";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  buildChatModelFields,
  resolveResearchModelConfigurationFromEnvironment,
} from "@outbound/infrastructure/ai/langchain-research-agent-executor";
import {
  campaignProspects,
  campaigns,
  companies,
  contactEmployments,
  contacts,
  conversations,
  icpVersions,
  messages,
  prospectDiscoveryCandidates,
} from "@outbound/infrastructure/database/schema";

const draftImprovementSchema = z.object({
  body: z.string().trim().min(1).max(5_000),
});

type DraftImprovementModelInvoker = (input: {
  readonly fields: ConstructorParameters<typeof ChatOpenAI>[0];
  readonly messages: readonly {
    readonly role: "system" | "user";
    readonly content: string;
  }[];
}) => Promise<z.infer<typeof draftImprovementSchema>>;

export class LangChainConversationDraftImprover implements ConversationDraftImprover {
  readonly #configuration: ReturnType<typeof resolveResearchModelConfigurationFromEnvironment>;

  constructor(
    private readonly database: Database,
    environment: Readonly<Record<string, string | undefined>> = process.env,
    private readonly modelPolicyReader?: WorkspaceAiModelPolicyReader,
    private readonly invokeModel: DraftImprovementModelInvoker = invokeStructuredModel,
  ) {
    this.#configuration = resolveResearchModelConfigurationFromEnvironment(environment);
  }

  async improve(input: {
    readonly workspaceId: string;
    readonly conversationId: string;
    readonly draft: string;
  }): Promise<ConversationDraftImprovement> {
    const draft = input.draft.trim();
    const [context] = await this.database
      .select({
        channel: conversations.channel,
        contactId: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        icpName: icpVersions.name,
        candidateCompanyName: prospectDiscoveryCandidates.companyName,
      })
      .from(conversations)
      .innerJoin(
        contacts,
        and(
          eq(contacts.workspaceId, conversations.workspaceId),
          eq(contacts.id, conversations.contactId),
        ),
      )
      .leftJoin(
        campaigns,
        and(
          eq(campaigns.workspaceId, conversations.workspaceId),
          eq(campaigns.id, conversations.campaignId),
        ),
      )
      .leftJoin(
        icpVersions,
        and(
          eq(icpVersions.workspaceId, campaigns.workspaceId),
          eq(icpVersions.id, campaigns.icpVersionId),
        ),
      )
      .leftJoin(
        campaignProspects,
        and(
          eq(campaignProspects.workspaceId, conversations.workspaceId),
          eq(campaignProspects.campaignId, conversations.campaignId),
          eq(campaignProspects.contactId, conversations.contactId),
        ),
      )
      .leftJoin(
        prospectDiscoveryCandidates,
        and(
          eq(prospectDiscoveryCandidates.workspaceId, campaignProspects.workspaceId),
          eq(prospectDiscoveryCandidates.id, campaignProspects.candidateId),
        ),
      )
      .where(
        and(
          eq(conversations.workspaceId, input.workspaceId),
          eq(conversations.id, input.conversationId),
        ),
      )
      .limit(1);
    if (!context) throw new ConversationDraftNotFoundError();

    const [historyDescending, currentEmployment, workspacePolicy] = await Promise.all([
      this.database
        .select({ direction: messages.direction, body: messages.body })
        .from(messages)
        .where(
          and(
            eq(messages.workspaceId, input.workspaceId),
            eq(messages.conversationId, input.conversationId),
          ),
        )
        .orderBy(desc(messages.createdAt))
        .limit(30),
      this.database
        .select({ companyName: companies.name, title: contactEmployments.title })
        .from(contactEmployments)
        .innerJoin(
          companies,
          and(
            eq(companies.workspaceId, contactEmployments.workspaceId),
            eq(companies.id, contactEmployments.companyId),
          ),
        )
        .where(
          and(
            eq(contactEmployments.workspaceId, input.workspaceId),
            eq(contactEmployments.contactId, context.contactId),
            eq(contactEmployments.isCurrent, true),
          ),
        )
        .orderBy(asc(contactEmployments.createdAt))
        .limit(1),
      this.modelPolicyReader?.find(input.workspaceId) ?? Promise.resolve(null),
    ]);
    const modelName = workspacePolicy?.synthesisModels[0]
      ?? this.#configuration.synthesisModels[0]!;
    const result = await this.invokeModel({
      fields: buildChatModelFields(this.#configuration, modelName, "low"),
      messages: [
        {
          role: "system",
          content: [
            "You improve a user-written B2B conversation message without changing its intent.",
            "Preserve every factual claim, commitment, date, price, proper noun and URL exactly unless fixing an obvious typo.",
            "Never invent personalization, product capabilities, customer references, urgency, discounts, meetings or facts absent from the draft and context.",
            "Use the draft's language. Make it natural, clear, concise and appropriate for the supplied channel.",
            "For LinkedIn and WhatsApp, avoid email-like formality and unnecessary signatures. For email, preserve a useful subject only if present in the draft.",
            "Do not answer a question the user did not attempt to answer. Do not add a call to action unless the draft already contains one.",
            "Call the submit_improved_conversation_draft tool exactly once with the final improved message. The user will review it before any send action.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            channel: context.channel,
            contact: {
              name: `${context.firstName} ${context.lastName}`.trim(),
              companyName: context.candidateCompanyName ?? currentEmployment[0]?.companyName ?? null,
              title: currentEmployment[0]?.title ?? null,
            },
            icpName: context.icpName,
            conversationHistory: [...historyDescending].reverse(),
            draft,
          }),
        },
      ],
    });
    return {
      body: result.body,
      metadata: {
        provider: this.#configuration.provider,
        model: modelName,
        promptVersion: "conversation-draft-improvement-v1",
      },
    };
  }
}

async function invokeStructuredModel(input: {
  readonly fields: ConstructorParameters<typeof ChatOpenAI>[0];
  readonly messages: readonly {
    readonly role: "system" | "user";
    readonly content: string;
  }[];
}) {
  const submit = tool(async (value) => value, {
    name: "submit_improved_conversation_draft",
    description: "Submit the improved editable message draft.",
    schema: draftImprovementSchema,
  });
  const response = await new ChatOpenAI(input.fields)
    .bindTools([submit], { tool_choice: "auto" })
    .invoke([...input.messages]);
  const call = response.tool_calls?.find(
    (item) => item.name === "submit_improved_conversation_draft",
  );
  if (!call) throw new Error("CONVERSATION_DRAFT_IMPROVEMENT_TOOL_CALL_MISSING");
  return draftImprovementSchema.parse(call.args);
}
