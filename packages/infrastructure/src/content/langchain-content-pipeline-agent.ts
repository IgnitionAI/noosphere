import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import type { ZodType } from "zod";
import type { ContentPipelineAgent, ContentGenerationContext } from "@outbound/application/content/content-generation";
import type { AiRunRecorder } from "@outbound/application/ai/ai-run-recorder";
import type { WorkspaceAiModelPolicyReader } from "@outbound/application/workspaces/workspace-ai-settings";
import type { AiCapability, ModelRoute } from "@outbound/application/ai/model-gateway";
import {
  contentBriefSnapshotSchema,
  contentDraftSnapshotSchema,
  contentEditorialCritiqueSchema,
  contentEvidenceAuditSchema,
} from "@outbound/contracts/content";
import {
  buildChatModelFields,
  resolveResearchModelConfigurationFromEnvironment,
} from "@outbound/infrastructure/ai/langchain-research-agent-executor";
import type { WorkspaceStructuredModel } from "@outbound/infrastructure/ai/workspace-structured-model";

type PipelineRole = "brief" | "writer" | "audit" | "critic";
type ModelInvoker = (input: {
  readonly role: PipelineRole;
  readonly fields: ConstructorParameters<typeof ChatOpenAI>[0];
  readonly context: unknown;
}) => Promise<unknown>;

export class LangChainContentPipelineAgent implements ContentPipelineAgent {
  readonly #configuration: ReturnType<typeof resolveResearchModelConfigurationFromEnvironment>;

  constructor(
    environment: Readonly<Record<string, string | undefined>> = process.env,
    private readonly modelPolicyReader?: WorkspaceAiModelPolicyReader,
    private readonly aiRunRecorder?: AiRunRecorder,
    private readonly invokeModel: ModelInvoker = invokePipelineModel,
    private readonly routedModel?: WorkspaceStructuredModel,
  ) {
    this.#configuration = resolveResearchModelConfigurationFromEnvironment(environment);
  }

  async buildBrief(input: Parameters<ContentPipelineAgent["buildBrief"]>[0]) {
    return contentBriefSnapshotSchema.parse(await this.invoke("brief", input.run.workspaceId, input.run.id, boundedContext(input), input));
  }

  async write(input: Parameters<ContentPipelineAgent["write"]>[0]) {
    return contentDraftSnapshotSchema.parse(await this.invoke("writer", input.run.workspaceId, input.run.id, boundedContext(input), input));
  }

  async audit(input: Parameters<ContentPipelineAgent["audit"]>[0]) {
    return contentEvidenceAuditSchema.parse(await this.invoke("audit", input.run.workspaceId, input.run.id, boundedContext(input), input));
  }

  async critique(input: Parameters<ContentPipelineAgent["critique"]>[0]) {
    return contentEditorialCritiqueSchema.parse(await this.invoke("critic", input.run.workspaceId, input.run.id, boundedContext(input), input));
  }

  private async invoke(role: PipelineRole, workspaceId: string, runId: string, context: unknown, original: unknown): Promise<unknown> {
    const startedAt = performance.now();
    const principalRole = role === "writer" || role === "critic";
    let provider: string;
    let model: string;
    let output: unknown;
    if (this.routedModel) {
      const spec = pipelineModelSpec(role, context);
      const result = await this.routedModel.invoke({
        workspaceId,
        capability: pipelineCapability(role),
        requestKey: `content-${role}:${runId}`,
        fallbackRoutes: this.fallbackRoutes(principalRole),
        systemPrompt: spec.system,
        payload: spec.context,
        outputName: spec.name,
        outputDescription: spec.description,
        schema: spec.schema as ZodType<unknown>,
      });
      output = result.output;
      provider = result.metadata.provider;
      model = result.metadata.model;
    } else {
      const policy = await this.modelPolicyReader?.find(workspaceId);
      const principal = policy?.researchModels[0] ?? this.#configuration.researchModels[0]!;
      const executor = policy?.synthesisModels[0] ?? this.#configuration.synthesisModels[0]!;
      model = principalRole ? principal : executor;
      provider = this.#configuration.provider;
      output = await this.invokeModel({
        role,
        fields: buildChatModelFields(this.#configuration, model, principalRole ? "max" : "low"),
        context,
      });
    }
    await this.aiRunRecorder?.record({
      workspaceId,
      contentGenerationRunId: runId,
      purpose: `content_${role}`,
      provider,
      model,
      promptVersion: role === "writer"
        ? "noosphere-content-writer-v4"
        : role === "critic" ? "noosphere-content-critic-v3" : `noosphere-content-${role}-v2`,
      shadow: false,
      inputHash: new Bun.CryptoHasher("sha256").update(JSON.stringify(original)).digest("hex"),
      output,
      status: "completed",
      cost: null,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
    return output;
  }

  private fallbackRoutes(principal: boolean): readonly ModelRoute[] {
    const models = principal ? this.#configuration.researchModels : this.#configuration.synthesisModels;
    return models.map((model) => ({
      provider: this.#configuration.provider === "openai" ? "openai-api" as const : "kimi-code" as const,
      model,
      reasoningEffort: principal ? "max" as const : "low" as const,
    }));
  }
}

function pipelineCapability(role: PipelineRole): AiCapability {
  return ({
    brief: "content_brief",
    writer: "content_writer",
    audit: "content_audit",
    critic: "content_critic",
  } as const)[role];
}

function boundedContext(input: Partial<ContentGenerationContext> & Record<string, unknown>) {
  return {
    run: input.run ? { id: input.run.id, instruction: input.run.instruction } : null,
    idea: input.idea,
    strategy: input.strategy,
    brandKit: input.brandKit,
    evidence: input.evidence,
    brief: input.brief,
    draft: input.draft,
    audit: input.audit,
    validationFeedback: input.validationFeedback,
    recentBodies: input.recentBodies?.slice(0, 12),
    recentFormats: input.recentFormats?.slice(0, 14),
  };
}

async function invokePipelineModel(input: Parameters<ModelInvoker>[0]) {
  const spec = pipelineModelSpec(input.role, input.context);
  return invokeTool({ fields: input.fields, ...spec });
}

function pipelineModelSpec(role: PipelineRole, context: unknown) {
  if (role === "brief") return {
    name: "submit_content_brief",
    description: "Submit the grounded immutable LinkedIn content brief.",
    schema: contentBriefSnapshotSchema,
    system: [
      "You are Noosphere's bounded LinkedIn brief writer.",
      "Turn the supplied idea into one precise brief. Use only exact evidence keys and authorized claim IDs from the input.",
      "The problem, angle and objective must be specific to the offer and audience. Choose only a CTA from the strategy, or null.",
      "Choose exactly one format enabled by brandKit. Use its weeklyMix and recentFormats to favor the most underrepresented enabled format, while matching the idea: linkedin_text for nuance, linkedin_image for one memorable point, linkedin_document for a 3-9 page educational carousel, linkedin_video for a 12-60 second motion story.",
      "Treat strategy.formats as historical guidance, but brandKit.enabledFormats is the current authoritative capability list.",
      "Constraints must include factual grounding, no invented metrics, no generic hook and no unsupported urgency.",
      "Do not write the post, schedule it or call a provider. Call submit_content_brief exactly once.",
    ].join("\n"),
    context,
  };
  if (role === "writer") return {
    name: "submit_linkedin_draft",
    description: "Submit one grounded LinkedIn draft, its media plan and explicit claim ledger.",
    schema: contentDraftSnapshotSchema,
    system: [
      "You are Noosphere's principal LinkedIn writer. Write in French unless the strategy explicitly uses another language.",
      "Use the complete offer context, audience, idea, brief, real evidence and recent posts. The post must be specific enough that it cannot be swapped into another company.",
      "Open with a concrete tension, observation or consequence. Never use empty thought-leadership hooks, fabricated urgency or generic B2B advice.",
      "Write one focused idea. Prefer 500 to 1100 characters and never exceed 1500 characters. When evidence is thin, write a shorter post instead of padding it with inferred mechanisms, outcomes or process claims. Use one CTA and at most one question in the complete body.",
      "The evidence ledger is internal metadata, not reader-facing copy. Never narrate source keys, claim status, audit mechanics or proof bookkeeping in body.",
      "Avoid defensive phrases such as 'ce qui est documenté', 'la seule affirmation factuelle', 'notre analyse', 'registre de preuves' or repeated warranty disclaimers. State the useful point naturally; if one caveat is genuinely necessary, say it once and briefly.",
      "Use recentBodies to choose a genuinely different problem, mechanism and takeaway. A paraphrase of a recent post is not distinct.",
      "Every factual statement, number, performance claim or product capability must appear verbatim in factualClaims with exact supplied source keys.",
      "Every factualClaims.statement must also be a verbatim contiguous excerpt of body; never paraphrase the ledger separately.",
      "Always return mediaPlan. Its format must exactly match brief.format. For linkedin_text, leave title/subtitle/altText null and slides/scenes empty. For linkedin_image, provide a sharp title, optional subtitle and useful alt text. For linkedin_document, provide 5-8 concise slides that form a visual narrative. For linkedin_video, provide 3-8 concise scenes totaling 12-60 seconds. Never copy the whole post into the visual.",
      "For linkedin_document, design every slide deliberately. Slide 1 uses layout cover, the last uses closing. Across the middle slides use at least two different layouts among insight, checklist, framework, comparison and process. Never output a monotonous sequence of numbered paragraph slides.",
      "Use kicker to orient the reader, callout for one memorable sentence, and 2-4 structured items for checklist, framework, comparison or process. Each item needs a short label and one concrete sentence. Keep each slide focused on one job and favor visual hierarchy over filling space.",
      "All factual statements and numbers shown in the media plan are public copy and obey the same evidence ledger as body.",
      "If validationFeedback contains CONTENT_DRAFT_UNSOURCED_NUMBER, remove every number absent from evidence or add the exact sourced sentence to factualClaims.",
      "If validationFeedback contains CONTENT_DRAFT_CLAIM_NOT_IN_BODY, make each claim statement an exact excerpt of body.",
      "If validationFeedback contains CONTENT_DRAFT_UNRESOLVED_CLAIM, use only evidence keys present in the supplied context.",
      "If validationFeedback contains CONTENT_AUDIT_UNGROUNDED_STATEMENT, either add the exact factual sentence to factualClaims only when supplied evidence directly proves it, or delete it. An opinion label such as 'mon analyse' never makes an unsupported product mechanism, outcome or process acceptable. Prefer a materially shorter post to a softened unsupported claim.",
      "If validationFeedback contains CONTENT_AUDIT_UNSUPPORTED_CLAIM, remove or narrow the claim to the exact supplied evidence. Never override or argue with the auditor.",
      "If validationFeedback contains CONTENT_AUDIT_FORBIDDEN_TOPIC, remove the matching passage and every unsupported implication of that topic. Never replace it with a disclaimer or meta-commentary.",
      "If validationFeedback contains CONTENT_CRITIQUE_BLOCKER or CONTENT_READINESS_BLOCKER, rewrite the complete post to remove every named issue. Apply the feedback directly; never mention, defend or quote the critique in reader-facing copy.",
      "Mark personal analysis explicitly in opinionStatements. Do not turn an opinion into a fact.",
      "The body is the complete ready-to-review post, including hook and CTA. Do not schedule or publish. Call submit_linkedin_draft exactly once.",
    ].join("\n"),
    context,
  };
  if (role === "audit") return {
    name: "submit_evidence_audit",
    description: "Submit an adversarial evidence audit of every factual LinkedIn statement.",
    schema: contentEvidenceAuditSchema,
    system: [
      "You are Noosphere's bounded evidence auditor, independent from the writer.",
      "Inspect the full draft sentence by sentence. Review every factual claim, number, capability and outcome against the exact supplied evidence excerpts.",
      "The media plan is public content too. Audit its title, subtitle, slides and scenes with the same strictness as body.",
      "A source key is not enough: mark unsupported when its excerpt does not prove the wording. Never repair, rewrite or excuse a claim.",
      "Conversely, a factual claim that is a faithful verbatim excerpt of an active supplied source must be supported. Never return verdict unsupported with a reason saying the source proves or repeats the statement exactly.",
      "List factual statements omitted from the writer's claim ledger as ungroundedStatements. Match forbidden topics exactly and conservatively.",
      "Do not schedule or publish. Call submit_evidence_audit exactly once.",
    ].join("\n"),
    context,
  };
  return {
    name: "submit_editorial_critique",
    description: "Submit the independent final anti-generic editorial critique.",
    schema: contentEditorialCritiqueSchema,
    system: [
      "You are Noosphere's principal editorial critic, independent from the writer.",
      "Reject interchangeable hooks, vague claims, fake intimacy, manufactured urgency, repetition of recent posts and CTA unrelated to the offer or objective.",
      "Reject body longer than 1500 characters, more than one question, more than one CTA, or copy that explains internal evidence, audit, claim-ledger or source-validation mechanics to the reader.",
      "Reject a media plan that merely repeats the body, is unreadably dense, has a generic title, or does not create a coherent image, carousel or short video for the selected format.",
      "For a linkedin_document, reject a monotonous stack of title-and-paragraph slides. Require a cover, a closing, at least two distinct middle layouts, and at least one structured slide using 2-4 meaningful items. Reject decorative layout changes that do not improve comprehension.",
      "Reject bureaucratic or defensive wording such as repeated provenance labels, 'la seule affirmation factuelle', 'notre analyse' or warranty disclaimers when a direct natural sentence would carry the same grounded meaning.",
      "Compare the problem, mechanism and takeaway with recentBodies. Set distinctFromHistory to false for a semantic paraphrase even when the exact words differ.",
      "The hook field is metadata copied from the opening of the complete body. Its exact presence at the start of body is required by contract and is not repetition; only flag repeated wording that occurs again later inside body.",
      "Populate repeatedConcepts only for excessive or detrimental repetition that must block readiness. A necessary central term used coherently across the post is not a repeatedConcept, even when it appears several times.",
      "A blocker means the draft must not become ready. Never rewrite the draft and never weaken an evidence audit.",
      "Be demanding but concrete. Advice is allowed only for non-blocking polish. Do not schedule or publish.",
      "Call submit_editorial_critique exactly once.",
    ].join("\n"),
    context,
  };
}

async function invokeTool(input: {
  readonly fields: ConstructorParameters<typeof ChatOpenAI>[0];
  readonly name: string;
  readonly description: string;
  readonly schema: typeof contentBriefSnapshotSchema | typeof contentDraftSnapshotSchema | typeof contentEvidenceAuditSchema | typeof contentEditorialCritiqueSchema;
  readonly system: string;
  readonly context: unknown;
}) {
  const submit = tool(async (value) => value, { name: input.name, description: input.description, schema: input.schema });
  const response = await new ChatOpenAI(input.fields).bindTools([submit], { tool_choice: "auto" }).invoke([
    { role: "system", content: input.system },
    { role: "user", content: JSON.stringify(input.context) },
  ]);
  const call = response.tool_calls?.find((candidate) => candidate.name === input.name);
  if (!call) throw new Error(`CONTENT_${input.name.toUpperCase()}_TOOL_CALL_MISSING`);
  return call.args;
}
