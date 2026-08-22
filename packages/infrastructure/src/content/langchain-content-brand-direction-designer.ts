import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import type { ContentBrandDirectionDesigner } from "@outbound/application/content/content-brand-kit";
import type { AiRunRecorder } from "@outbound/application/ai/ai-run-recorder";
import type { WorkspaceAiModelPolicyReader } from "@outbound/application/workspaces/workspace-ai-settings";
import type { ModelRoute } from "@outbound/application/ai/model-gateway";
import { contentBrandDirectionProposalSchema } from "@outbound/contracts/content";
import { contentBrandPaletteIssues } from "@outbound/domain/content/content-brand-kit";
import {
  buildChatModelFields,
  resolveResearchModelConfigurationFromEnvironment,
} from "@outbound/infrastructure/ai/langchain-research-agent-executor";
import type { WorkspaceStructuredModel } from "@outbound/infrastructure/ai/workspace-structured-model";

type DirectionModelInvoker = (input: {
  readonly fields: ConstructorParameters<typeof ChatOpenAI>[0];
  readonly grounding: Parameters<ContentBrandDirectionDesigner["design"]>[0];
  readonly attempt: number;
  readonly validationIssues: readonly string[];
}) => Promise<unknown>;

const promptVersion = "noosphere-brand-direction-v1";
const maxStructuredOutputAttempts = 2;

export class LangChainContentBrandDirectionDesigner implements ContentBrandDirectionDesigner {
  readonly #configuration: ReturnType<typeof resolveResearchModelConfigurationFromEnvironment>;

  constructor(
    environment: Readonly<Record<string, string | undefined>> = process.env,
    private readonly modelPolicyReader?: WorkspaceAiModelPolicyReader,
    private readonly aiRunRecorder?: AiRunRecorder,
    private readonly invokeModel: DirectionModelInvoker = invokeDirectionModel,
    private readonly routedModel?: WorkspaceStructuredModel,
  ) {
    this.#configuration = resolveResearchModelConfigurationFromEnvironment(environment);
  }

  async design(input: Parameters<ContentBrandDirectionDesigner["design"]>[0]) {
    const startedAt = performance.now();
    const workspacePolicy = this.routedModel ? null : await this.modelPolicyReader?.find(input.workspaceId);
    let model = workspacePolicy?.researchModels[0] ?? this.#configuration.researchModels[0]!;
    let provider: string = this.#configuration.provider;
    const fields = buildChatModelFields(this.#configuration, model, "max");
    const inputHash = new Bun.CryptoHasher("sha256").update(JSON.stringify({
      brandName: input.brand.brandName,
      tagline: input.brand.tagline,
      websiteUrl: input.brand.websiteUrl,
      description: input.description,
      logoColors: input.sources.includes("logo") ? input.brand.colors : null,
      landingPageUrl: input.landingPage?.url ?? null,
      landingPageHash: input.landingPage ? new Bun.CryptoHasher("sha256").update(input.landingPage.markdown).digest("hex") : null,
    })).digest("hex");
    let validationIssues: readonly string[] = [];

    for (let attempt = 1; attempt <= maxStructuredOutputAttempts; attempt += 1) {
      let rawOutput: unknown;
      try {
        if (this.routedModel) {
          const spec = directionModelSpec(input, attempt, validationIssues);
          const result = await this.routedModel.invoke({
            workspaceId: input.workspaceId,
            capability: "brand_direction",
            requestKey: `brand-direction:${inputHash}:${attempt}`,
            fallbackRoutes: this.fallbackRoutes(),
            systemPrompt: spec.system,
            payload: spec.payload,
            outputName: "submit_brand_direction",
            outputDescription: "Submit the accessible visual direction for this brand.",
            schema: contentBrandDirectionProposalSchema,
          });
          rawOutput = result.output;
          provider = result.metadata.provider;
          model = result.metadata.model;
        } else {
          rawOutput = await this.invokeModel({ fields, grounding: input, attempt, validationIssues });
        }
      } catch (error) {
        validationIssues = [error instanceof Error ? error.message : "CONTENT_BRAND_DIRECTION_TOOL_CALL_MISSING"];
        if (attempt < maxStructuredOutputAttempts) continue;
        await this.recordFailure(input.workspaceId, provider, model, inputHash, startedAt, validationIssues);
        throw new Error("CONTENT_BRAND_DIRECTION_OUTPUT_INVALID");
      }
      const parsed = contentBrandDirectionProposalSchema.safeParse(rawOutput);
      if (!parsed.success) {
        validationIssues = parsed.error.issues.map((issue) => `${issue.path.map(String).join(".") || "root"}:${issue.message}`);
      } else {
        validationIssues = contentBrandPaletteIssues(parsed.data.colors);
        if (validationIssues.length === 0) {
          const aiRun = await this.aiRunRecorder?.record({
            workspaceId: input.workspaceId,
            purpose: "content_brand_direction",
            provider,
            model,
            promptVersion,
            shadow: false,
            inputHash,
            output: parsed.data,
            status: "completed",
            cost: null,
            latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
          });
          return {
            ...parsed.data,
            metadata: {
              provider: this.#configuration.provider,
              model,
              promptVersion,
              aiRunId: aiRun?.id ?? null,
            },
          };
        }
      }
      if (attempt < maxStructuredOutputAttempts) continue;
        await this.recordFailure(input.workspaceId, provider, model, inputHash, startedAt, validationIssues);
      throw new Error("CONTENT_BRAND_DIRECTION_OUTPUT_INVALID");
    }
    throw new Error("CONTENT_BRAND_DIRECTION_OUTPUT_INVALID");
  }

  private fallbackRoutes(): readonly ModelRoute[] {
    return this.#configuration.researchModels.map((model) => ({
      provider: this.#configuration.provider === "openai" ? "openai-api" as const : "kimi-code" as const,
      model,
      reasoningEffort: "max" as const,
    }));
  }

  private async recordFailure(workspaceId: string, provider: string, model: string, inputHash: string, startedAt: number, validationIssues: readonly string[]) {
    await this.aiRunRecorder?.record({
      workspaceId,
      purpose: "content_brand_direction",
      provider,
      model,
      promptVersion,
      shadow: false,
      inputHash,
      output: { errorCode: "CONTENT_BRAND_DIRECTION_OUTPUT_INVALID", validationIssues },
      status: "failed",
      cost: null,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
  }
}

async function invokeDirectionModel(input: Parameters<DirectionModelInvoker>[0]) {
  const submit = tool(async (value) => value, {
    name: "submit_brand_direction",
    description: "Submit the accessible visual direction for this brand.",
    schema: contentBrandDirectionProposalSchema,
  });
  const spec = directionModelSpec(input.grounding, input.attempt, input.validationIssues);
  const response = await new ChatOpenAI(input.fields).bindTools([submit], { tool_choice: "auto" }).invoke([
    {
      role: "system",
      content: spec.system,
    },
    { role: "user", content: JSON.stringify(spec.payload) },
  ]);
  const call = response.tool_calls?.find((candidate) => candidate.name === "submit_brand_direction");
  if (!call) throw new Error("CONTENT_BRAND_DIRECTION_TOOL_CALL_MISSING");
  return call.args;
}

function directionModelSpec(
  groundingInput: Parameters<ContentBrandDirectionDesigner["design"]>[0],
  attempt: number,
  validationIssues: readonly string[],
) {
  const retryInstruction = validationIssues.length > 0
    ? `The previous proposal was rejected: ${validationIssues.join("; ")}. Correct every issue.`
    : null;
  const grounding = {
    brandName: groundingInput.brand.brandName,
    tagline: groundingInput.brand.tagline,
    websiteUrl: groundingInput.brand.websiteUrl,
    description: groundingInput.description ?? groundingInput.brand.brandDescription,
    sources: groundingInput.sources,
    logo: groundingInput.sources.includes("logo") ? {
      candidateColors: groundingInput.brand.colors,
      width: groundingInput.brand.logo?.width ?? null,
      height: groundingInput.brand.logo?.height ?? null,
    } : null,
    landingPage: groundingInput.landingPage ? {
      url: groundingInput.landingPage.url,
      title: groundingInput.landingPage.title,
      content: groundingInput.landingPage.markdown,
    } : null,
  };
  return {
    system: [
      "You are Noosphere's principal brand art director.",
      "Create one distinctive, production-ready palette from the supplied landing page positioning, logo color candidates and/or written description.",
      "Do not merely copy the most frequent logo pixels. Interpret the brand promise, audience, category, desired emotion and existing visual signals.",
      "Assign functional roles: primary is the dominant branded surface, accent is used sparingly for signals and calls to action, background is the quiet canvas, text is body copy.",
      "Accessibility is mandatory: text/background >= 4.5:1, background/primary >= 4.5:1, accent/primary >= 3:1. Never rely on color alone for meaning.",
      "Avoid generic AI purple gradients, random neon palettes, more than one accent, or category clichés unsupported by the inputs.",
      "Select typography only from inter, space_grotesk, system and imageStyle only from editorial, technical, bold, minimal.",
      "Explain the decision concretely in French in 2 or 3 short sentences. Do not invent business facts.",
      "Return the complete structured brand direction.",
      retryInstruction,
      `Structured output attempt ${attempt} of ${maxStructuredOutputAttempts}.`,
    ].filter(Boolean).join("\n"),
    payload: grounding,
  };
}
