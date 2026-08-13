import { createAgent, toolStrategy } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import type { ProspectDecisionAgent } from "@outbound/application/campaigns/prospect-decision";
import type { ProspectDecisionProposal } from "@outbound/domain/campaigns/prospect-decision";
import type { WorkspaceAiModelPolicyReader } from "@outbound/application/workspaces/workspace-ai-settings";
import {
  buildChatModelFields,
  resolveResearchModelConfigurationFromEnvironment,
} from "@outbound/infrastructure/ai/langchain-research-agent-executor";

const proposalSchema = z.object({
  observation: z.string().trim().min(1).max(2_000),
  action: z.enum(["send", "wait", "research", "pause", "stop", "handoff"]),
  reason: z.string().trim().min(1).max(2_000),
  nextDueAt: z.string().datetime({ offset: true }).nullable(),
  nextReason: z.string().trim().min(1).max(2_000).nullable(),
});

export class LangChainProspectDecisionAgent implements ProspectDecisionAgent {
  readonly #configuration: ReturnType<typeof resolveResearchModelConfigurationFromEnvironment>;
  readonly #modelName: string;

  constructor(
    environment: Readonly<Record<string, string | undefined>> = process.env,
    private readonly modelPolicyReader?: WorkspaceAiModelPolicyReader,
  ) {
    this.#configuration = resolveResearchModelConfigurationFromEnvironment(environment);
    this.#modelName = environment.PROSPECT_DECISION_MODEL?.trim()
      || this.#configuration.researchModels[0]
      || "k3";
  }

  async decide(input: Parameters<ProspectDecisionAgent["decide"]>[0]): Promise<ProspectDecisionProposal> {
    const workspacePolicy = await this.modelPolicyReader?.find(input.workspaceId);
    const modelName = workspacePolicy?.researchModels[0] ?? this.#modelName;
    const model = new ChatOpenAI(buildChatModelFields(this.#configuration, modelName, "max"));
    const agent = createAgent({
      name: "outbound-prospect-next-action",
      model,
      tools: [],
      responseFormat: toolStrategy(proposalSchema),
      systemPrompt: [
        "You decide exactly one next action for an existing B2B outbound prospect.",
        "The campaign is a policy boundary, not a rigid sequence. The deterministic runtime will authorize or block your proposal.",
        "Never claim that a message was sent or that research was performed. You only propose the next action.",
        "Choose send only when the scheduled outreach action is due and no inbound answer appears in the state.",
        "Choose wait with a future ISO date when more time is appropriate.",
        "Choose research when the available evidence is insufficient; include a future recheck date.",
        "Choose stop after a clear refusal, suppression or exhausted strategy; choose handoff for an interested or ambiguous high-value reply.",
        "Keep observation and reason factual and concise. Do not invent evidence.",
      ].join("\n"),
    });
    const result = await agent.invoke({ messages: [{ role: "user", content: JSON.stringify(input) }] }, { recursionLimit: 8 });
    const structured = (result as { structuredResponse?: unknown }).structuredResponse;
    return proposalSchema.parse(structured);
  }
}
