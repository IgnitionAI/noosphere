import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type {
  CampaignContentGenerator,
  PersonalizedCampaignContent,
} from "@outbound/application/campaigns/campaign-content-generator";
import type { WorkspaceAiModelPolicyReader } from "@outbound/application/workspaces/workspace-ai-settings";
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
});

export class LangChainCampaignContentGenerator implements CampaignContentGenerator {
  readonly #configuration: ReturnType<typeof resolveResearchModelConfigurationFromEnvironment>;

  constructor(
    environment: Readonly<Record<string, string | undefined>> = process.env,
    private readonly modelPolicyReader?: WorkspaceAiModelPolicyReader,
  ) {
    this.#configuration = resolveResearchModelConfigurationFromEnvironment(environment);
  }

  async generate(
    input: Parameters<CampaignContentGenerator["generate"]>[0],
  ): Promise<PersonalizedCampaignContent> {
    const workspacePolicy = await this.modelPolicyReader?.find(input.workspaceId);
    const modelName = workspacePolicy?.synthesisModels[0]
      ?? this.#configuration.synthesisModels[0]!;
    const model = new ChatOpenAI(buildChatModelFields(this.#configuration, modelName, "low"));
    const messages = [
      {
        role: "system" as const,
        content: [
          "You write concise B2B outbound messages in French unless the supplied context clearly requires another language.",
          "Personalize only from the supplied facts. Never invent an activity, pain, event, relationship or purchase intent.",
          "Keep the exact positions and number of supplied steps. Return no manual task.",
          "Hard limits: LinkedIn invitation 280 characters, LinkedIn message 1900, WhatsApp 900, email body 4500 and email subject 180.",
          "Each message must sound natural, mention one defensible contextual element and end with one low-friction question.",
          "For email, treat position 1 as the opener and later positions as follow-ups in the same thread. Follow-ups must add a different useful angle instead of paraphrasing the opener.",
          "Campaign policy instructions influence tone and emphasis but never authorize invented facts.",
          "Also provide a concise prospect assessment: why the prospect fits, observed strengths, uncertainties or risks, and the best defensible outreach angle.",
          "Call the submit_campaign_content tool exactly once with the final result.",
          "Do not claim that you monitored, audited or diagnosed the prospect unless the evidence explicitly says so.",
        ].join("\n"),
      },
      {
        role: "user" as const,
        content: JSON.stringify(input),
      },
    ];
    const submit = tool(async (value) => value, {
      name: "submit_campaign_content",
      description: "Submit the personalized outbound content and prospect assessment.",
      schema: personalizedContentSchema,
    });
    const response = await model
      .bindTools([submit], { tool_choice: "auto" })
      .invoke(messages);
    const call = response.tool_calls?.find((item) => item.name === "submit_campaign_content");
    if (!call) throw new Error("CAMPAIGN_CONTENT_TOOL_CALL_MISSING");
    const parsed = personalizedContentSchema.parse(call.args);
    return {
      steps: parsed.steps,
      assessment: parsed.assessment,
      metadata: {
        provider: this.#configuration.provider,
        model: modelName,
        promptVersion: "campaign-personalization-v1",
      },
    };
  }
}
