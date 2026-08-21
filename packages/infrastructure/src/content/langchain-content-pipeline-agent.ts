import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import type { ContentPipelineAgent, ContentGenerationContext } from "@outbound/application/content/content-generation";
import type { AiRunRecorder } from "@outbound/application/ai/ai-run-recorder";
import type { WorkspaceAiModelPolicyReader } from "@outbound/application/workspaces/workspace-ai-settings";
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
    const policy = await this.modelPolicyReader?.find(workspaceId);
    const principal = policy?.researchModels[0] ?? this.#configuration.researchModels[0]!;
    const executor = policy?.synthesisModels[0] ?? this.#configuration.synthesisModels[0]!;
    const principalRole = role === "writer" || role === "critic";
    const model = principalRole ? principal : executor;
    const output = await this.invokeModel({
      role,
      fields: buildChatModelFields(this.#configuration, model, principalRole ? "max" : "low"),
      context,
    });
    await this.aiRunRecorder?.record({
      workspaceId,
      contentGenerationRunId: runId,
      purpose: `content_${role}`,
      provider: this.#configuration.provider,
      model,
      promptVersion: `noosphere-content-${role}-v1`,
      shadow: false,
      inputHash: new Bun.CryptoHasher("sha256").update(JSON.stringify(original)).digest("hex"),
      output,
      status: "completed",
      cost: null,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
    return output;
  }
}

function boundedContext(input: Partial<ContentGenerationContext> & Record<string, unknown>) {
  return {
    run: input.run ? { id: input.run.id, instruction: input.run.instruction } : null,
    idea: input.idea,
    strategy: input.strategy,
    evidence: input.evidence,
    brief: input.brief,
    draft: input.draft,
    audit: input.audit,
    validationFeedback: input.validationFeedback,
    recentBodies: input.recentBodies?.slice(0, 12),
  };
}

async function invokePipelineModel(input: Parameters<ModelInvoker>[0]) {
  if (input.role === "brief") return invokeTool({
    fields: input.fields,
    name: "submit_content_brief",
    description: "Submit the grounded immutable LinkedIn content brief.",
    schema: contentBriefSnapshotSchema,
    system: [
      "You are Noosphere's bounded LinkedIn brief writer.",
      "Turn the supplied idea into one precise brief. Use only exact evidence keys and authorized claim IDs from the input.",
      "The problem, angle and objective must be specific to the offer and audience. Choose only a CTA from the strategy, or null.",
      "The format is linkedin_text. Constraints must include factual grounding, no invented metrics, no generic hook and no unsupported urgency.",
      "Do not write the post, schedule it or call a provider. Call submit_content_brief exactly once.",
    ].join("\n"),
    context: input.context,
  });
  if (input.role === "writer") return invokeTool({
    fields: input.fields,
    name: "submit_linkedin_draft",
    description: "Submit one grounded LinkedIn text draft and its explicit claim ledger.",
    schema: contentDraftSnapshotSchema,
    system: [
      "You are Noosphere's principal LinkedIn writer. Write in French unless the strategy explicitly uses another language.",
      "Use the complete offer context, audience, idea, brief, real evidence and recent posts. The post must be specific enough that it cannot be swapped into another company.",
      "Open with a concrete tension, observation or consequence. Never use empty thought-leadership hooks, fabricated urgency or generic B2B advice.",
      "Every factual statement, number, performance claim or product capability must appear verbatim in factualClaims with exact supplied source keys.",
      "Every factualClaims.statement must also be a verbatim contiguous excerpt of body; never paraphrase the ledger separately.",
      "If validationFeedback contains CONTENT_DRAFT_UNSOURCED_NUMBER, remove every number absent from evidence or add the exact sourced sentence to factualClaims.",
      "If validationFeedback contains CONTENT_DRAFT_CLAIM_NOT_IN_BODY, make each claim statement an exact excerpt of body.",
      "If validationFeedback contains CONTENT_DRAFT_UNRESOLVED_CLAIM, use only evidence keys present in the supplied context.",
      "Mark personal analysis explicitly in opinionStatements. Do not turn an opinion into a fact.",
      "The body is the complete ready-to-review post, including hook and CTA. Do not schedule or publish. Call submit_linkedin_draft exactly once.",
    ].join("\n"),
    context: input.context,
  });
  if (input.role === "audit") return invokeTool({
    fields: input.fields,
    name: "submit_evidence_audit",
    description: "Submit an adversarial evidence audit of every factual LinkedIn statement.",
    schema: contentEvidenceAuditSchema,
    system: [
      "You are Noosphere's bounded evidence auditor, independent from the writer.",
      "Inspect the full draft sentence by sentence. Review every factual claim, number, capability and outcome against the exact supplied evidence excerpts.",
      "A source key is not enough: mark unsupported when its excerpt does not prove the wording. Never repair, rewrite or excuse a claim.",
      "List factual statements omitted from the writer's claim ledger as ungroundedStatements. Match forbidden topics exactly and conservatively.",
      "Do not schedule or publish. Call submit_evidence_audit exactly once.",
    ].join("\n"),
    context: input.context,
  });
  return invokeTool({
    fields: input.fields,
    name: "submit_editorial_critique",
    description: "Submit the independent final anti-generic editorial critique.",
    schema: contentEditorialCritiqueSchema,
    system: [
      "You are Noosphere's principal editorial critic, independent from the writer.",
      "Reject interchangeable hooks, vague claims, fake intimacy, manufactured urgency, repetition of recent posts and CTA unrelated to the offer or objective.",
      "The hook field is metadata copied from the opening of the complete body. Its exact presence at the start of body is required by contract and is not repetition; only flag repeated wording that occurs again later inside body.",
      "Populate repeatedConcepts only for excessive or detrimental repetition that must block readiness. A necessary central term used coherently across the post is not a repeatedConcept, even when it appears several times.",
      "A blocker means the draft must not become ready. Never rewrite the draft and never weaken an evidence audit.",
      "Be demanding but concrete. Advice is allowed only for non-blocking polish. Do not schedule or publish.",
      "Call submit_editorial_critique exactly once.",
    ].join("\n"),
    context: input.context,
  });
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
