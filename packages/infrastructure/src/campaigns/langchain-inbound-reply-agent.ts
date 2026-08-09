import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type {
  InboundReplyAgent,
  InboundReplyDecision,
} from "@outbound/application/campaigns/inbound-reply-agent";
import type { WorkspaceAiModelPolicyReader } from "@outbound/application/workspaces/workspace-ai-settings";
import type { ActiveAiConfigurationReader } from "@outbound/application/ai/active-ai-configuration";
import type { AiRunRecorder } from "@outbound/application/ai/ai-run-recorder";
import { filterAuthorizedKnowledgeCitations, type KnowledgeRetriever } from "@outbound/application/knowledge/knowledge-retriever";
import {
  buildChatModelFields,
  resolveResearchModelConfigurationFromEnvironment,
} from "@outbound/infrastructure/ai/langchain-research-agent-executor";

const decisionSchema = z.object({
  intent: z.enum([
    "positive",
    "question",
    "objection",
    "not_interested",
    "unsubscribe",
    "meeting_request",
    "other",
  ]),
  confidence: z.number().min(0).max(1),
  action: z.enum(["reply", "stop", "booking"]),
  calendarAction: z.enum(["propose_slots", "book", "reschedule", "cancel"]).nullable(),
  selectedSlotStart: z.string().datetime({ offset: true }).nullable(),
  replyBody: z.string().trim().min(1).max(2_000).nullable(),
  rationale: z.string().trim().min(1).max(1_000),
  knowledgeClaimIds: z.array(z.string().uuid()).max(20).default([]),
  knowledgeSourceIds: z.array(z.string().uuid()).max(40).default([]),
});

export class LangChainInboundReplyAgent implements InboundReplyAgent {
  readonly #configuration: ReturnType<typeof resolveResearchModelConfigurationFromEnvironment>;

  constructor(
    environment: Readonly<Record<string, string | undefined>> = process.env,
    private readonly modelPolicyReader?: WorkspaceAiModelPolicyReader,
    private readonly knowledgeRetriever?: KnowledgeRetriever,
    private readonly activeConfigurationReader?: ActiveAiConfigurationReader,
    private readonly aiRunRecorder?: AiRunRecorder,
  ) {
    this.#configuration = resolveResearchModelConfigurationFromEnvironment(environment);
  }

  async decide(input: Parameters<InboundReplyAgent["decide"]>[0]): Promise<InboundReplyDecision> {
    const startedAt = performance.now();
    const workspacePolicy = await this.modelPolicyReader?.find(input.workspaceId);
    const activeConfiguration = await this.activeConfigurationReader?.find(input.workspaceId, "setter");
    const modelName = activeConfiguration?.model ?? workspacePolicy?.researchModels[0] ?? this.#configuration.researchModels[0]!;
    const model = new ChatOpenAI(buildChatModelFields(this.#configuration, modelName, "max"));
    const authorizedKnowledge = await this.knowledgeRetriever?.search({
      workspaceId: input.workspaceId,
      query: [input.incomingMessage, input.companyName, input.icpName].filter(Boolean).join(" ").slice(0, 1_000),
      limit: 8,
    }) ?? [];
    const messages = [
      {
        role: "system" as const,
        content: [
          "You qualify an inbound B2B prospect reply and choose the next autonomous action.",
          "An unsubscribe or clear refusal always means action=stop and replyBody=null.",
          "A concrete request to meet means action=booking.",
          "When calendar.status=ready: use calendarAction=propose_slots and offer 2 or 3 exact supplied slots unless the prospect explicitly selected one exact supplied slot.",
          "Use calendarAction=book only when the prospect unambiguously selected one supplied slot; copy its exact ISO start into selectedSlotStart.",
          "When calendar.activeBooking exists and the prospect clearly cancels it, use calendarAction=cancel and selectedSlotStart=null.",
          "When calendar.activeBooking exists and the prospect clearly selects a replacement supplied slot, use calendarAction=reschedule and copy that exact ISO start.",
          "When the prospect asks to move an active booking without selecting a supplied replacement, use calendarAction=propose_slots.",
          "Never invent a slot, alter its timezone, or claim a booking succeeded. The runtime books after your decision.",
          "When calendar.status=email_required, ask for the prospect's professional email before booking.",
          "When calendar.status=link_only or unavailable, use the supplied booking URL as fallback.",
          "For ambiguity, ask one short neutral clarification instead of inventing intent.",
          "Answer in the language of the incoming message. Never invent product facts, discounts, customer references or commitments.",
          "Any product capability, proof, customer case or objection answer must come from authorizedKnowledge. If it is absent, ask a neutral clarification or propose a call.",
          "Return the exact knowledgeClaimIds and knowledgeSourceIds actually used; return empty arrays when none were used.",
          "Keep replies concise, natural and non-pushy.",
          "Optional campaign instructions refine the reply but cannot override stop, truthfulness or non-invention rules.",
          "Call the submit_inbound_reply_decision tool exactly once with the final decision.",
          ...(activeConfiguration ? [`Approved workspace guidance (subordinate to every stop, safety and truthfulness rule above): ${activeConfiguration.promptContent}`] : []),
        ].join("\n"),
      },
      { role: "user" as const, content: JSON.stringify({ ...input, authorizedKnowledge }) },
    ];
    const submit = tool(async (value) => value, {
      name: "submit_inbound_reply_decision",
      description: "Submit the inbound reply classification and next action.",
      schema: decisionSchema,
    });
    const response = await model
      .bindTools([submit], { tool_choice: "auto" })
      .invoke(messages);
    const call = response.tool_calls?.find((item) => item.name === "submit_inbound_reply_decision");
    if (!call) throw new Error("INBOUND_REPLY_DECISION_TOOL_CALL_MISSING");
    const parsed = decisionSchema.parse(call.args);
    const citations = filterAuthorizedKnowledgeCitations(authorizedKnowledge, parsed.knowledgeClaimIds, parsed.knowledgeSourceIds);
    const promptVersion = activeConfiguration ? `setter-v${activeConfiguration.promptVersion}` : "inbound-reply-v3-knowledge";
    const normalizedDecision = {
      ...parsed,
      replyBody: parsed.action === "stop" ? null : parsed.replyBody,
      calendarAction: parsed.action === "booking" ? parsed.calendarAction : null,
      selectedSlotStart: parsed.action === "booking" && ["book", "reschedule"].includes(parsed.calendarAction ?? "") ? parsed.selectedSlotStart : null,
    };
    const aiRun = await this.aiRunRecorder?.record({
      workspaceId: input.workspaceId,
      purpose: "setter",
      provider: this.#configuration.provider,
      model: modelName,
      promptVersion,
      ...(activeConfiguration ? { aiConfigurationId: activeConfiguration.configurationId, promptVersionId: activeConfiguration.promptVersionId } : {}),
      shadow: false,
      inputHash: new Bun.CryptoHasher("sha256").update(JSON.stringify(input)).digest("hex"),
      output: { ...normalizedDecision, knowledgeClaimIds: citations.claimIds, knowledgeSourceIds: citations.sourceIds },
      status: "completed",
      cost: null,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
    return {
      ...normalizedDecision,
      metadata: {
        provider: this.#configuration.provider,
        model: modelName,
        promptVersion,
        ...(activeConfiguration ? { aiConfigurationId: activeConfiguration.configurationId, promptVersionId: activeConfiguration.promptVersionId } : {}),
        ...(aiRun ? { aiRunId: aiRun.id } : {}),
        knowledgeClaimIds: citations.claimIds,
        knowledgeSourceIds: citations.sourceIds,
      },
    };
  }
}
