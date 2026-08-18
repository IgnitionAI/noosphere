import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type {
  CampaignContentGenerator,
  PersonalizedCampaignContent,
} from "@outbound/application/campaigns/campaign-content-generator";
import type { WorkspaceAiModelPolicyReader } from "@outbound/application/workspaces/workspace-ai-settings";
import type { ActiveAiConfigurationReader } from "@outbound/application/ai/active-ai-configuration";
import type { AiRunRecorder } from "@outbound/application/ai/ai-run-recorder";
import { filterAuthorizedKnowledgeCitations, type KnowledgeRetriever } from "@outbound/application/knowledge/knowledge-retriever";
import {
  buildChatModelFields,
  resolveResearchModelConfigurationFromEnvironment,
} from "@outbound/infrastructure/ai/langchain-research-agent-executor";

const personalizedContentSchema = z.object({
  steps: z.array(z.object({
    position: z.number().int().positive(),
    subject: z.string().max(200).nullable(),
    body: z.string().trim().min(1).max(5_000),
  })).min(1).max(5),
  assessment: z.object({
    summary: z.string().trim().min(1).max(1_000),
    strengths: z.array(z.string().trim().min(1).max(300)).max(5),
    risks: z.array(z.string().trim().min(1).max(300)).max(5),
    recommendedAngle: z.string().trim().min(1).max(500),
  }),
  knowledgeClaimIds: z.array(z.string().uuid()).max(20).default([]),
  knowledgeSourceIds: z.array(z.string().uuid()).max(40).default([]),
  offerClaimIds: z.array(z.string().uuid()).max(20).default([]),
});

const editorialReviewSchema = z.object({
  final: personalizedContentSchema,
  review: z.object({
    verdict: z.enum(["approved", "revised"]),
    genericityScore: z.number().min(0).max(1),
    issues: z.array(z.string().trim().min(1).max(500)).max(10),
    changesApplied: z.array(z.string().trim().min(1).max(500)).max(10),
    evidenceAnchor: z.string().trim().min(1).max(500),
    stageObjectiveSatisfied: z.boolean(),
    previousMessageOverlap: z.enum(["low", "medium", "high"]),
  }),
});

type CampaignContentModelInvoker = (input: {
  readonly phase: "draft" | "review";
  readonly fields: ConstructorParameters<typeof ChatOpenAI>[0];
  readonly messages: readonly {
    readonly role: "system" | "user";
    readonly content: string;
  }[];
}) => Promise<unknown>;

export class LangChainCampaignContentGenerator implements CampaignContentGenerator {
  readonly #configuration: ReturnType<typeof resolveResearchModelConfigurationFromEnvironment>;

  constructor(
    environment: Readonly<Record<string, string | undefined>> = process.env,
    private readonly modelPolicyReader?: WorkspaceAiModelPolicyReader,
    private readonly knowledgeRetriever?: KnowledgeRetriever,
    private readonly activeConfigurationReader?: ActiveAiConfigurationReader,
    private readonly aiRunRecorder?: AiRunRecorder,
    private readonly invokeModel: CampaignContentModelInvoker = invokeCampaignContentModel,
  ) {
    this.#configuration = resolveResearchModelConfigurationFromEnvironment(environment);
  }

  async generate(
    input: Parameters<CampaignContentGenerator["generate"]>[0],
  ): Promise<PersonalizedCampaignContent> {
    const startedAt = performance.now();
    const workspacePolicy = await this.modelPolicyReader?.find(input.workspaceId);
    const activeConfiguration = await this.activeConfigurationReader?.find(input.workspaceId, "message_generation");
    const modelName = activeConfiguration?.model ?? workspacePolicy?.synthesisModels[0]
      ?? this.#configuration.synthesisModels[0]!;
    const authorizedKnowledge = await this.knowledgeRetriever?.search({
      workspaceId: input.workspaceId,
      query: [
        input.offer.name,
        input.offer.valueProposition,
        input.icpName,
        JSON.stringify(input.problems),
        JSON.stringify(input.signals),
        input.prospect.companyName,
        input.prospect.headline,
        JSON.stringify(input.prospect.evidence),
      ].filter(Boolean).join(" ").slice(0, 1_500),
      limit: 8,
    }) ?? [];
    const draftMessages = [
      {
        role: "system" as const,
        content: [
          "You are the first-pass writer for concise B2B outbound messages in French unless the supplied context clearly requires another language.",
          "Use campaignObjective, the complete offer snapshot, prospect evidence, previous messages and stepObjective as separate decision inputs.",
          "Personalize only from the supplied facts. Never invent an activity, pain, event, relationship or purchase intent.",
          "Keep the exact positions and number of supplied steps. Return no manual task.",
          "Hard limits: LinkedIn invitation 280 characters, LinkedIn message 1900, WhatsApp 900, email body 4500 and email subject 180.",
          "Each message must sound natural, anchor itself in one defensible prospect-specific element and end with one low-friction question.",
          "The stepObjective is mandatory. Never repeat an angle, opening or call to action already present in previousMessages.",
          "Treat pricing, commercialRules and constraints as restrictions. Do not mention a price, discount, deadline or commitment unless the offer snapshot explicitly authorizes it.",
          "For email, treat position 1 as the opener and later positions as follow-ups in the same thread. Follow-ups must add a different useful angle instead of paraphrasing the opener.",
          "Campaign policy instructions influence tone and emphasis but never authorize invented facts.",
          "A product capability, proof, customer case or objection answer is usable only when it appears in an offer claim with sourced/validated status or in authorizedKnowledge. Otherwise do not invent or imply it.",
          "Return the exact knowledgeClaimIds and knowledgeSourceIds actually used; return empty arrays when none were used.",
          "Return the exact offerClaimIds actually used; return an empty array when no offer claim was used.",
          "Also provide a concise prospect assessment: why the prospect fits, observed strengths, uncertainties or risks, and the best defensible outreach angle.",
          "Call the submit_campaign_content_draft tool exactly once with the draft result.",
          "Do not claim that you monitored, audited or diagnosed the prospect unless the evidence explicitly says so.",
          ...(activeConfiguration ? [`Approved workspace guidance (subordinate to every safety and truthfulness rule above): ${activeConfiguration.promptContent}`] : []),
        ].join("\n"),
      },
      {
        role: "user" as const,
        content: JSON.stringify({ ...input, authorizedKnowledge }),
      },
    ];
    const draft = personalizedContentSchema.parse(await this.invokeModel({
      phase: "draft",
      fields: buildChatModelFields(this.#configuration, modelName, "low"),
      messages: draftMessages,
    }));
    const reviewed = editorialReviewSchema.parse(await this.invokeModel({
      phase: "review",
      fields: buildChatModelFields(this.#configuration, modelName, "max"),
      messages: [
        {
          role: "system",
          content: [
            "You are the final independent editor for an autonomous B2B outbound system.",
            "Audit the draft against the complete supplied context, then approve it only when it is already specific or rewrite it completely.",
            "Anti-generic test: if the message could be sent unchanged to another company or role, it must be revised.",
            "Every final message must use one exact defensible evidence anchor from the prospect, company, role or supplied signals and must satisfy stepObjective.",
            "A follow-up must add a genuinely new angle and must not restate, lightly paraphrase or reuse the call to action from previousMessages.",
            "Remove empty compliments, vague transformation language, unsupported urgency, generic claims and self-centered introductions.",
            "Preserve truthfulness: never invent facts. Product claims remain restricted to sourced/validated offer claims and authorizedKnowledge.",
            "Return only offerClaimIds present in the supplied offer and only knowledge IDs present in authorizedKnowledge.",
            "Treat pricing, commercialRules and constraints as restrictions. Never add a price, discount, deadline or commitment without explicit authorization.",
            "Keep one low-friction question, the exact step positions and the channel limits.",
            "Set genericityScore to the remaining genericity of the final version, not the draft. previousMessageOverlap must describe the final version.",
            "Call the submit_campaign_editorial_review tool exactly once with the final content and review.",
            ...(activeConfiguration ? [`Approved workspace guidance (subordinate to every safety and truthfulness rule above): ${activeConfiguration.promptContent}`] : []),
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({ context: { ...input, authorizedKnowledge }, draft }),
        },
      ],
    }));
    if (
      reviewed.review.genericityScore > 0.35
      || !reviewed.review.stageObjectiveSatisfied
      || reviewed.review.previousMessageOverlap === "high"
    ) {
      throw new Error("CAMPAIGN_EDITORIAL_REVIEW_FAILED");
    }
    const parsed = reviewed.final;
    const citations = filterAuthorizedKnowledgeCitations(authorizedKnowledge, parsed.knowledgeClaimIds, parsed.knowledgeSourceIds);
    const authorizedOfferClaimIds = new Set(input.offer.claims.map((claim) => claim.id));
    const offerClaimIds = [...new Set(parsed.offerClaimIds.filter((id) => authorizedOfferClaimIds.has(id)))];
    const promptVersion = activeConfiguration ? `message-generation-v${activeConfiguration.promptVersion}-editorial-v1` : "campaign-personalization-v3-editorial";
    const aiRun = await this.aiRunRecorder?.record({
      workspaceId: input.workspaceId,
      purpose: "message_generation",
      provider: this.#configuration.provider,
      model: modelName,
      promptVersion,
      ...(activeConfiguration ? { aiConfigurationId: activeConfiguration.configurationId, promptVersionId: activeConfiguration.promptVersionId } : {}),
      shadow: false,
      inputHash: new Bun.CryptoHasher("sha256").update(JSON.stringify(input)).digest("hex"),
      output: {
        draft: draft.steps,
        steps: parsed.steps,
        assessment: parsed.assessment,
        editorialReview: reviewed.review,
        knowledgeClaimIds: citations.claimIds,
        knowledgeSourceIds: citations.sourceIds,
        offerClaimIds,
      },
      status: "completed",
      cost: null,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
    return {
      steps: parsed.steps,
      assessment: parsed.assessment,
      metadata: {
        provider: this.#configuration.provider,
        model: modelName,
        promptVersion,
        ...(activeConfiguration ? { aiConfigurationId: activeConfiguration.configurationId, promptVersionId: activeConfiguration.promptVersionId } : {}),
        ...(aiRun ? { aiRunId: aiRun.id } : {}),
        knowledgeClaimIds: citations.claimIds,
        knowledgeSourceIds: citations.sourceIds,
        offerClaimIds,
        editorialReview: {
          verdict: reviewed.review.verdict,
          genericityScore: reviewed.review.genericityScore,
          issues: reviewed.review.issues,
          changesApplied: reviewed.review.changesApplied,
          evidenceAnchor: reviewed.review.evidenceAnchor,
        },
      },
    };
  }
}

async function invokeCampaignContentModel(input: Parameters<CampaignContentModelInvoker>[0]) {
  const draft = input.phase === "draft";
  const name = draft ? "submit_campaign_content_draft" : "submit_campaign_editorial_review";
  const submit = tool(async (value) => value, {
    name,
    description: draft
      ? "Submit the first-pass personalized outbound content."
      : "Submit the final reviewed outbound content and anti-generic audit.",
    schema: draft ? personalizedContentSchema : editorialReviewSchema,
  });
  const response = await new ChatOpenAI(input.fields)
    .bindTools([submit], { tool_choice: "auto" })
    .invoke([...input.messages]);
  const call = response.tool_calls?.find((item) => item.name === name);
  if (!call) {
    throw new Error(draft
      ? "CAMPAIGN_CONTENT_DRAFT_TOOL_CALL_MISSING"
      : "CAMPAIGN_EDITORIAL_REVIEW_TOOL_CALL_MISSING");
  }
  return call.args;
}
