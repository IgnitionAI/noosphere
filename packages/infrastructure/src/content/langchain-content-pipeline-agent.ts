import { contentAuditModelSpec } from "./content-audit-coverage";
import { claimLedgerModelSpec } from "./content-claim-ledger-repair";
import { DOCUMENT_WRITING_LAYOUT_CONSTRAINTS } from "./content-document-layout";
import { AiTaskPauseError } from "@outbound/application/ai/ai-task-pause";
import { ModelGatewayError } from "@outbound/application/ai/model-gateway";
import { contentPublicText, invalidEditorialAssessmentCriteria } from "@outbound/domain/content/content-asset";
import { editorialPlaybook } from "@outbound/infrastructure/content/content-editorial-playbook";
import { contentRuntimeSkills } from "@outbound/infrastructure/content/content-runtime-skills";
import { selectNextContentFormat, linkedinContentFormats } from "@outbound/domain/content/content-brand-kit";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { z, type ZodType } from "zod";
import type { ContentPipelineAgent, ContentGenerationContext } from "@outbound/application/content/content-generation";
import type { AiRunRecorder } from "@outbound/application/ai/ai-run-recorder";
import type { WorkspaceAiModelPolicyReader } from "@outbound/application/workspaces/workspace-ai-settings";
import type { AiCapability, ModelRoute } from "@outbound/application/ai/model-gateway";
import {
  contentBriefSnapshotSchema,
  contentDraftSnapshotSchema,
  contentDraftGenerationSchema,
  currentContentEditorialCritiqueSchema,
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
    return contentDraftSnapshotSchema.parse(await this.invoke("writer", input.run.workspaceId, input.run.id, {
      ...boundedContext(input),
      ...(input.brief.format === "linkedin_document" ? { mediaLayoutConstraints: DOCUMENT_WRITING_LAYOUT_CONSTRAINTS } : {}),
    }, input));
  }

  async audit(input: Parameters<ContentPipelineAgent["audit"]>[0]) {
    // Previous findings are retained by the application after this independent review.
    // Sending old verdicts here can make the auditor quote superseded public copy.
    const { audit: _previousAudit, ...context } = boundedContext(input);
    return contentEvidenceAuditSchema.parse(await this.invoke("audit", input.run.workspaceId, input.run.id, context, input));
  }

  async critique(input: Parameters<ContentPipelineAgent["critique"]>[0]) {
    const critique = currentContentEditorialCritiqueSchema.parse(await this.invoke("critic", input.run.workspaceId, input.run.id, critiqueContext(input), input));
    const invalid = invalidEditorialAssessmentCriteria(input.draft, critique);
    if (invalid.length === 0) return critique;
    const repair = {
      ...critiqueContext(input),
      currentPublicPassages: indexedPublicPassages(input.draft),
      validationFeedback: [`CONTENT_CRITIC_ASSESSMENT_INVALID: ${invalid.join(", ")}. Re-evaluate the unchanged current draft. Every criterion needs a reason of at least 20 characters and at least one passageId selected from currentPublicPassages. Select relevant current passages; never invent an identifier or cite the brief, sources, prior versions or your assessment reasons. Preserve substantive concerns; a technical repair is not a request to approve the post.`],
    };
    return currentContentEditorialCritiqueSchema.parse(await this.invoke("critic", input.run.workspaceId, input.run.id, repair, repair, "assessment-repair"));
  }

  private async invoke(role: PipelineRole, workspaceId: string, runId: string, context: unknown, original: unknown, requestSuffix?: string): Promise<unknown> {
    const startedAt = performance.now();
    const principalRole = role === "writer" || role === "critic";
    let provider = "unknown";
    let model = "unknown";
    let output: unknown;
    const record = (status: "completed" | "failed", recordedOutput: unknown) => this.aiRunRecorder?.record({
      workspaceId,
      contentGenerationRunId: runId,
      purpose: `content_${role}`,
      provider,
      model,
      promptVersion: role === "writer"
        ? "noosphere-content-writer-v30"
        : role === "critic" ? "noosphere-content-critic-v21" : role === "audit" ? "noosphere-content-audit-v10" : "noosphere-content-brief-v10",
      shadow: false,
      inputHash: new Bun.CryptoHasher("sha256").update(JSON.stringify(original)).digest("hex"),
      output: recordedOutput,
      status,
      cost: null,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
    try {
      if (this.routedModel) {
        const spec = pipelineModelSpec(role, context);
        const result = await this.routedModel.invoke({
          workspaceId,
          capability: pipelineCapability(role),
          requestKey: `content-${role}:${runId}${requestSuffix ? `:${requestSuffix}` : ""}`,
          fallbackRoutes: this.fallbackRoutes(principalRole),
          systemPrompt: spec.system,
          payload: spec.context,
          outputName: spec.name,
          outputDescription: spec.description,
          schema: spec.schema as ZodType<unknown>,
        });
        provider = result.metadata.provider;
        model = result.metadata.model;
        output = "decode" in spec ? spec.decode(result.output) : result.output;
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
    } catch (error) {
      if (error instanceof ModelGatewayError) provider = error.provider;
      if (error instanceof AiTaskPauseError) {
        const models = new Set(error.routes.filter(route => route.provider === error.provider).map(route => route.model));
        if (models.size === 1) model = [...models][0]!;
      }
      try {
        await record("failed", { code: error instanceof ModelGatewayError ? error.code : "CONTENT_MODEL_INVOCATION_FAILED" });
      } catch {
        // Recording must not replace the provider error that governs pause/retry.
      }
      throw error;
    }
    await record("completed", output);
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
    businessContext: input.businessContext,
    brandKit: input.brandKit,
    preferredFormat: input.brandKit ? selectNextContentFormat(input.brandKit, input.recentFormats ?? []) : null,
    evidence: input.evidence,
    brief: input.brief,
    draft: input.draft,
    audit: input.audit,
    validationFeedback: input.validationFeedback,
    repairMode: input.repairMode,
    recentBodies: input.recentBodies?.slice(0, 12),
    recentFormats: input.recentFormats?.slice(0, 14),
  };
}

function critiqueContext(input: Parameters<ContentPipelineAgent["critique"]>[0]) {
  return {
    strategy: { audience: input.strategy.audience, voice: input.strategy.voice },
    businessContext: input.businessContext,
    brandKit: input.brandKit,
    evidence: input.evidence,
    draft: input.draft,
    currentPublicPassages: indexedPublicPassages(input.draft),
    recentBodies: input.recentBodies.slice(0, 12),
  };
}

// Model-facing choices are exact public copy; persisted critique contracts stay unchanged.
function publicPassages(draft: Parameters<ContentPipelineAgent["critique"]>[0]["draft"]): string[] {
  const passages: string[] = [];
  const text = contentPublicText(draft);
  const lines = text.split("\n");
  const candidates = lines.filter(line => line.trim().length >= 12);
  // Short titles/lines still need citable context, including multiline-only copy.
  if (lines.some(line => line.trim().length > 0 && line.trim().length < 12)) candidates.push(text);
  for (const line of candidates) {
    // Historical drafts may contain paragraphs above the excerpt limit. Overlap
    // windows so the last characters remain available with their context.
    for (let start = 0; start < line.length; start += 1488) {
      const passage = line.slice(start, start + 1500);
      passages.push(passage);
      if (start + 1500 >= line.length) break;
    }
  }
  return [...new Set(passages)];
}

function indexedPublicPassages(draft: Parameters<ContentPipelineAgent["critique"]>[0]["draft"]) {
  return publicPassages(draft).map((text, index) => ({ id: `p${index + 1}`, text }));
}

const criticPassagesSchema = z.object({ currentPublicPassages: z.array(z.object({
  id: z.string().regex(/^p[1-9][0-9]*$/), text: z.string().min(12).max(1500),
})).min(1) });

function criticModelSchema(context: unknown) {
  const { currentPublicPassages } = criticPassagesSchema.parse(context);
  const passageIds = z.array(z.enum(currentPublicPassages.map(p => p.id) as [string, ...string[]])).min(1).max(4);
  const shape = currentContentEditorialCritiqueSchema.shape.qualityAssessment.shape;
  const criterion = shape.readerValue.omit({ excerpts: true }).extend({ passageIds });
  return currentContentEditorialCritiqueSchema.extend({ qualityAssessment: z.object({
    audienceRelevance: criterion, readerValue: criterion, coherence: criterion,
    sourceAttribution: criterion, ctaTruthfulness: criterion, brandVoice: criterion, distinctness: criterion,
  }).strict() });
}

function decodeCriticOutput(output: unknown, context: unknown) {
  const result = criticModelSchema(context).parse(output);
  const passages = new Map(criticPassagesSchema.parse(context).currentPublicPassages.map(p => [p.id, p.text]));
  return currentContentEditorialCritiqueSchema.parse({ ...result, qualityAssessment: Object.fromEntries(
    Object.entries(result.qualityAssessment).map(([key, { passageIds, ...criterion }]) => [key, {
      ...criterion, excerpts: passageIds.map(id => passages.get(id)),
    }]),
  ) });
}

async function invokePipelineModel(input: Parameters<ModelInvoker>[0]) {
  const spec = pipelineModelSpec(input.role, input.context);
  const output = await invokeTool({ fields: input.fields, ...spec });
  return "decode" in spec ? spec.decode(output) : output;
}

function pipelineModelSpec(role: PipelineRole, context: unknown) {
  if (role === "brief") return {
    name: "submit_content_brief",
    description: "Submit the grounded immutable LinkedIn content brief.",
    schema: contentBriefSnapshotSchema,
    system: [
      "You are Noosphere's bounded LinkedIn brief writer.",
      contentRuntimeSkills.strategist,
      ...editorialPlaybook.brief,
      "Turn the supplied idea into one precise brief. Use only exact evidence keys and authorized claim IDs from the input.",
      "The problem, angle and objective must be specific to the offer and audience. Choose only a CTA from the strategy, or null.",
      "Choose exactly one format enabled by brandKit that serves the reader's decision: linkedin_text for nuance, linkedin_image for one memorable point, linkedin_document for a 3-9 page educational carousel, linkedin_video for a 12-60 second motion story. preferredFormat reflects weeklyMix and recentFormats; use it to break ties between equally useful treatments, not to stretch a short observation into a carousel.",
      "Treat strategy.formats as historical guidance, but brandKit.enabledFormats is the current authoritative capability list.",
      "Constraints must include factual grounding, no invented metrics, no generic hook and no unsupported urgency.",
      "Do not write the post, schedule it or call a provider. Call submit_content_brief exactly once.",
    ].join("\n"),
    context,
  };
  if (role === "writer" && z.object({ repairMode: z.literal("claim_ledger") }).safeParse(context).success) return claimLedgerModelSpec(context);
  if (role === "writer") return {
    name: "submit_linkedin_draft",
    description: "Submit one grounded LinkedIn draft, its media plan and explicit claim ledger.",
    schema: contentDraftGenerationSchema(z.object({ brief: z.object({ format: z.enum(linkedinContentFormats) }) }).parse(context).brief.format),
    system: [
      "You are Noosphere's principal LinkedIn writer. Write in French unless the strategy explicitly uses another language.",
      contentRuntimeSkills.strategist,
      contentRuntimeSkills.guardian,
      ...editorialPlaybook.writer,
      "Use the complete offer context, audience, idea, brief, real evidence and recent posts. The post must be specific enough that it cannot be swapped into another company.",
      "Open with a concrete tension, observation or consequence. Never use empty thought-leadership hooks, fabricated urgency or generic B2B advice.",
      "Write one focused idea. Prefer 500 to 1100 characters and never exceed 1500 characters. When evidence is thin, write a shorter post instead of padding it with inferred mechanisms, outcomes or process claims. Use one reader CTA. A numbered diagnostic checklist may contain questions that help apply the method; a question mark in a quoted source title is not a reader CTA.",
      "The evidence ledger is internal metadata, not reader-facing copy. Never narrate source keys, claim status, audit mechanics or proof bookkeeping in body.",
      "Avoid defensive phrases such as 'ce qui est documenté', 'la seule affirmation factuelle', 'notre analyse', 'registre de preuves' or repeated warranty disclaimers. State the useful point naturally; if one caveat is genuinely necessary, say it once and briefly.",
      "Use recentBodies to choose a genuinely different problem, mechanism and takeaway. A paraphrase of a recent post is not distinct.",
      "Every factual statement, number, performance claim or product capability must appear verbatim in factualClaims with exact supplied source keys.",
      "Every factualClaims.statement must be a verbatim contiguous excerpt of the body or one visible media field (a title, subtitle, slide, item or scene). Never paraphrase the ledger separately. A fact explained in the carousel need not also be copied into the caption merely to satisfy the ledger; keep each supported public claim traceable where it is actually shown.",
      "Always return mediaPlan. Its format must exactly match brief.format. For linkedin_text, leave title/subtitle/altText null and slides/scenes empty. For linkedin_image, provide a sharp title, optional subtitle and useful alt text. For linkedin_document, provide 3-9 concise slides that form a visual narrative. Choose the fewest pages that fully explain the point; never add pages merely to repeat it. For linkedin_video, provide 3-8 concise scenes totaling 12-60 seconds. Never copy the whole post into the visual.",
      "For linkedin_document, use mediaLayoutConstraints on every draft and repair. These are the renderer’s actual field limits; keep margin for wrapping and shared page space. Never treat them as a reason to omit essential reasoning.",
      "For linkedin_document, design every slide deliberately. Slide 1 uses layout cover, the last uses closing. Choose each middle layout among insight, checklist, framework, comparison and process for its communication job. A short document may have one substantive middle slide. Vary layouts when the reasoning benefits; never add a slide merely to meet a layout quota. Avoid a monotonous sequence of numbered paragraph slides.",
      "Use kicker to orient the reader, callout for one memorable sentence, and 2-4 structured items for checklist, framework, comparison or process. Each item needs a short label and one concrete sentence. Keep each slide focused on one job and favor visual hierarchy over filling space.",
      "All factual statements and numbers shown in the media plan are public copy and obey the same evidence ledger as body.",
      "If validationFeedback contains CONTENT_DRAFT_TOO_LONG, use the measured body length and limit to rewrite more concisely. Remove repeated explanations and unnecessary implementation detail, preserving the useful point and source attribution. Never cut a sentence or a URL; synchronize every ledger with the revised copy.",
      "If validationFeedback contains CONTENT_DRAFT_UNSOURCED_NUMBER, remove every number absent from evidence or add the exact sourced sentence to factualClaims.",
      "If validationFeedback contains CONTENT_DRAFT_CLAIM_NOT_IN_BODY, synchronize each claim statement with an exact excerpt of the current body or one visible media field. The legacy error name covers all public copy; do not duplicate slide copy in the caption to repair the ledger.",
      "If validationFeedback contains CONTENT_DRAFT_UNRESOLVED_CLAIM, use only evidence keys present in the supplied context.",
      "If validationFeedback contains CONTENT_DRAFT_SCENARIO_INVALID, correct the supplied rejected draft: each illustrativeScenarios entry must begin with 'Exemple fictif :' and reproduce an exact complete contiguous passage present in the current public copy. Resynchronize the ledger after rewriting body or media. Never remove a still-present invented numeric example from the ledger to bypass validation; preserve its explicit fictional label and independent audit.",
      "If validationFeedback contains CONTENT_AUDIT_UNGROUNDED_STATEMENT, either add the exact factual sentence to factualClaims only when supplied evidence directly proves it. Otherwise replace the unsupported premise with an explicitly hypothetical worked example that demonstrates a proposed decision without claiming real effectiveness, or remove the premise while preserving the useful explanation. An opinion label such as 'mon analyse' never makes an unsupported product mechanism, outcome or process acceptable. Do not soften a factual claim into an implied claim, and do not substitute a disclaimer for reader value.",
      "If validationFeedback contains CONTENT_AUDIT_UNSUPPORTED_CLAIM, remove or narrow the claim to the exact supplied evidence. Never override or argue with the auditor.",
      "If validationFeedback contains CONTENT_AUDIT_FORBIDDEN_TOPIC, remove the matching passage and every unsupported implication of that topic. Never replace it with a disclaimer or meta-commentary.",
      "If validationFeedback contains media_text_overflow, the document could not fit its complete copy legibly. Shorten or redistribute the overloaded slide copy within the existing format and slide limit, retaining the essential example and reasoning. Keep evidence and illustrative ledgers synchronized with the rewritten copy. Never use ellipses to hide missing content or replace the demonstration with empty slogans.",
      "If validationFeedback contains CONTENT_CRITIQUE_BLOCKER or CONTENT_READINESS_BLOCKER, rewrite the complete post to remove every named issue. Apply the feedback to the supplied current draft and preserve earlier corrections, including visible source attribution, while fixing the new issue. The feedback may include resolved requirements that must remain satisfied. Never mention, defend or quote the critique in reader-facing copy.",
      "Mark personal analysis explicitly in opinionStatements. Do not turn an opinion into a fact.",
      "The body is the complete ready-to-review post, including hook and CTA. Do not schedule or publish. Call submit_linkedin_draft exactly once.",
    ].join("\n"),
    context,
  };
  if (role === "audit") return contentAuditModelSpec(context, [
      "You are Noosphere's bounded evidence auditor, independent from the writer.",
      ...editorialPlaybook.audit,
      "Inspect the full draft sentence by sentence. Review every factual claim, number, capability and outcome against the exact supplied evidence excerpts.",
      "The media plan is public content too. Audit its title, subtitle, slides and scenes with the same strictness as body.",
      "For substantive factual claims, a source key is not enough: mark unsupported when its excerpt does not prove the wording. Verify bibliographic credits against source title, URL and excerpt as instructed, including credits already listed in factualClaims. A hosting platform does not establish author affiliation or institutional endorsement. Never repair, rewrite or excuse a claim.",
      "Evaluate a quotation in its public context; matching source text alone does not prove implied attribution, scope or endorsement.",
      "Review omitted factual claims with supported or unsupported verdicts too. Match forbidden topics exactly and conservatively.",
      "Do not schedule or publish. Call submit_evidence_audit exactly once.",
    ].join("\n"));
  return {
    name: "submit_editorial_critique",
    description: "Submit the independent final anti-generic editorial critique.",
    schema: criticModelSchema(context),
    decode: (output: unknown) => decodeCriticOutput(output, context),
    system: [
      "You are Noosphere's principal editorial critic, independent from the writer.",
      contentRuntimeSkills.guardian,
      ...editorialPlaybook.critic,
      "Reject interchangeable hooks, vague claims, fake intimacy, manufactured urgency, repetition of recent posts and CTA unrelated to the offer or objective.",
      "Reject body longer than 1500 characters, competing reader CTAs, or copy that explains internal evidence, audit, claim-ledger or source-validation mechanics to the reader.",
      "Reject a media plan that merely repeats the body, is unreadably dense, has a generic title, or does not create a coherent image, carousel or short video for the selected format.",
      "For a linkedin_document, reject a monotonous stack of title-and-paragraph slides. Require a cover, a closing and a substantive middle that delivers the reading promise. One explained comparison or insight can be sufficient; do not demand extra pages or layout diversity for its own sake. Reject repeated pages and decorative layout changes that do not improve comprehension.",
      "Reject bureaucratic or defensive wording such as repeated provenance labels, 'la seule affirmation factuelle', 'notre analyse' or warranty disclaimers when a direct natural sentence would carry the same grounded meaning.",
      "Compare the problem, mechanism and takeaway with recentBodies. Set distinctFromHistory to false for a semantic paraphrase even when the exact words differ.",
      "The hook field is metadata copied from the opening of the complete body. Its exact presence at the start of body is required by contract and is not repetition; only flag repeated wording that occurs again later inside body.",
      "Populate repeatedConcepts only for excessive or detrimental repetition that must block readiness. A necessary central term used coherently across the post is not a repeatedConcept, even when it appears several times.",
      "If validationFeedback reports CONTENT_CRITIC_ASSESSMENT_INVALID, correct your assessment of the unchanged draft using its exact current public copy. Rejected citations are not evidence. Preserve every substantive concern; do not approve merely to satisfy the output contract.",
      "A blocker means the draft must not become ready. Never rewrite the draft and never weaken an evidence audit.",
      "Be demanding but concrete. Advice is allowed only for non-blocking polish. Do not schedule or publish.",
      "For each qualityAssessment criterion, return passageIds selected from currentPublicPassages. The code resolves each ID to its exact public text. Select passages relevant to your reason, never invented IDs or text. Citation validity is independent of editorial quality: preserve substantive concerns and reject low-value copy.",
      "Call submit_editorial_critique exactly once.",
    ].join("\n"),
    context,
  };
}

async function invokeTool(input: {
  readonly fields: ConstructorParameters<typeof ChatOpenAI>[0];
  readonly name: string;
  readonly description: string;
  readonly schema: ZodType;
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
