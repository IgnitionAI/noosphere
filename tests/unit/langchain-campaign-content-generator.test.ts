import { describe, expect, test } from "bun:test";
import { LangChainCampaignContentGenerator } from "@outbound/infrastructure/campaigns/langchain-campaign-content-generator";
import { DEFAULT_CONTENT_BRAND_KIT } from "@outbound/domain/content/content-brand-kit";
import type { ProspectContextBundle } from "@outbound/domain/prospect-memory/prospect-memory";
import type { WorkspaceStructuredModel } from "@outbound/infrastructure/ai/workspace-structured-model";

describe("LangChainCampaignContentGenerator", () => {
  test("writes from complete context then returns the anti-generic editorial revision", async () => {
    const calls: Array<{ phase: string; messages: readonly { role: string; content: string }[] }> = [];
    const generator = new LangChainCampaignContentGenerator(
      {
        AI_PROVIDER: "kimi-code",
        KIMI_CODE_API_KEY: "test-key",
        KIMI_CODE_BASE_URL: "http://127.0.0.1:9",
        KIMI_SYNTHESIS_MODEL: "k3",
      },
      undefined,
      undefined,
      undefined,
      undefined,
      async (input) => {
        calls.push({ phase: input.phase, messages: input.messages });
        if (input.phase === "draft") {
          return {
            steps: [{ position: 2, subject: "Re: sécurité documentaire", body: "Bonjour Marie, je reviens vers vous au sujet de la sécurité documentaire. Ouverte à un échange ?" }],
            assessment: { summary: "Bon fit", strengths: [], risks: ["Message générique"], recommendedAngle: "Utiliser la preuve ISO 27001" },
            knowledgeClaimIds: [],
            knowledgeSourceIds: [],
          };
        }
        return {
          final: {
            steps: [{ position: 2, subject: "Re: sécurité documentaire", body: "Bonjour Marie, votre recrutement d’un RSSI et votre certification ISO 27001 rendent la traçabilité documentaire particulièrement concrète. Est-ce déjà couvert côté recherche interne ?" }],
            assessment: { summary: "Preuve précise", strengths: ["ISO 27001"], risks: [], recommendedAngle: "Traçabilité" },
            knowledgeClaimIds: [],
            knowledgeSourceIds: [],
          },
          review: {
            verdict: "revised",
            genericityScore: 0.1,
            issues: ["Le brouillon ne mobilisait pas la preuve prospect."],
            changesApplied: ["Ajout du recrutement RSSI et de la certification ISO 27001."],
            evidenceAnchor: "Recrutement RSSI et certification ISO 27001",
            stageObjectiveSatisfied: true,
            previousMessageOverlap: "low",
          },
        };
      },
      {
        async find(workspaceId) {
          return {
            workspaceId,
            version: 1,
            updatedAt: new Date(),
            snapshot: {
              ...DEFAULT_CONTENT_BRAND_KIT,
              brandName: "IgnitionRAG",
              voice: { traits: ["direct", "expert"], avoid: ["jargon"], preferredVocabulary: ["preuve résoluble"] },
            },
          };
        },
      },
    );

    const result = await generator.generate(campaignInput());

    expect(calls.map((call) => call.phase)).toEqual(["draft", "review"]);
    const draftContext = JSON.parse(calls[0]!.messages.at(-1)!.content);
    expect(draftContext).toMatchObject({
      campaignObjective: "Obtenir un échange de qualification de 15 minutes.",
      offer: { name: "IgnitionRAG", valueProposition: "Recherche documentaire sécurisée et traçable" },
      prospect: { evidence: { publicData: { signals: ["Recrutement RSSI", "Certification ISO 27001"] } } },
      previousMessages: [{ body: "Bonjour Marie, votre équipe juridique grandit. Comment gérez-vous la recherche interne ?" }],
      stepObjective: { stage: "follow_up" },
      brandVoice: { brandName: "IgnitionRAG", traits: ["direct", "expert"], preferredVocabulary: ["preuve résoluble"] },
    });
    expect(result.steps[0]?.body).toContain("recrutement d’un RSSI");
    expect(result.metadata.editorialReview).toMatchObject({ verdict: "revised", genericityScore: 0.1 });
  });

  test("keeps Kimi thinking compatible with the structured draft and editorial review", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = await request.json() as Record<string, unknown>;
        requests.push(body);
        if (body.tool_choice !== "auto") {
          return Response.json(
            { error: { message: "tool_choice 'specified' is incompatible with thinking enabled" } },
            { status: 400 },
          );
        }
        const tools = body.tools as Array<{ function?: { name?: string } }>;
        const name = tools[0]?.function?.name;
        const args = name === "submit_campaign_content_draft"
          ? {
              steps: [{ position: 2, subject: "Re: sécurité documentaire", body: "Bonjour Marie, votre recrutement RSSI rend la traçabilité concrète. Est-ce déjà couvert ?" }],
              assessment: { summary: "Bon fit", strengths: ["RSSI"], risks: [], recommendedAngle: "Traçabilité" },
              knowledgeClaimIds: [],
              knowledgeSourceIds: [],
              offerClaimIds: [],
            }
          : {
              final: {
                steps: [{ position: 2, subject: "Re: sécurité documentaire", body: "Bonjour Marie, votre recrutement RSSI rend la traçabilité documentaire concrète. Est-ce déjà couvert côté recherche interne ?" }],
                assessment: { summary: "Preuve précise", strengths: ["RSSI"], risks: [], recommendedAngle: "Traçabilité" },
                knowledgeClaimIds: [],
                knowledgeSourceIds: [],
                offerClaimIds: [],
              },
              review: {
                verdict: "approved",
                genericityScore: 0.1,
                issues: [],
                changesApplied: [],
                evidenceAnchor: "Recrutement RSSI",
                stageObjectiveSatisfied: true,
                previousMessageOverlap: "low",
              },
            };
        return Response.json({
          id: crypto.randomUUID(),
          object: "chat.completion",
          created: Math.floor(Date.now() / 1_000),
          model: "k3",
          choices: [{
            index: 0,
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: crypto.randomUUID(),
                type: "function",
                function: { name, arguments: JSON.stringify(args) },
              }],
            },
          }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        });
      },
    });
    try {
      const generator = new LangChainCampaignContentGenerator({
        AI_PROVIDER: "kimi-code",
        KIMI_CODE_API_KEY: "test-key",
        KIMI_CODE_BASE_URL: server.url.origin,
        KIMI_SYNTHESIS_MODEL: "k3",
      });
      const result = await generator.generate(campaignInput());
      expect(result.steps).toHaveLength(1);
      expect(requests.map((request) => request.tool_choice)).toEqual(["auto", "auto"]);
    } finally {
      server.stop(true);
    }
  });

  test("uses active Prospect 360 context only through an approved provider and audits its receipt", async () => {
    const routedCalls: Array<{ allowedProviders?: readonly string[]; payload: unknown; outputName: string }> = [];
    const routedModel = {
      invoke: async (input: { allowedProviders?: readonly string[]; payload: unknown; outputName: string }) => {
        routedCalls.push(input);
        const content = {
          steps: [{ position: 2, subject: "Re: sécurité documentaire", body: "Bonjour Marie, vous aviez demandé de ne pas répéter l’angle sécurité. Souhaitez-vous plutôt regarder la réversibilité ?" }],
          assessment: { summary: "Contexte durable utilisé", strengths: ["Objection mémorisée"], risks: [], recommendedAngle: "Réversibilité" },
          knowledgeClaimIds: [],
          knowledgeSourceIds: [],
          offerClaimIds: [],
        };
        return {
          output: input.outputName === "submit_campaign_content_draft" ? content : {
            final: content,
            review: {
              verdict: "approved",
              genericityScore: 0.1,
              issues: [],
              changesApplied: [],
              evidenceAnchor: "Objection mémorisée",
              stageObjectiveSatisfied: true,
              previousMessageOverlap: "low",
            },
          },
          metadata: {
            provider: "codex-cli",
            model: "gpt-5.6-luna",
            reasoningEffort: "xhigh",
            transport: "codex-process",
            usage: { inputTokens: null, cachedInputTokens: null, outputTokens: null, source: "unknown" },
            latencyMs: 1,
          },
          providerAttempt: 1,
          fallbackReason: null,
        };
      },
    } as unknown as WorkspaceStructuredModel;
    const aiRuns: Array<Record<string, unknown>> = [];
    const generator = new LangChainCampaignContentGenerator(
      { AI_PROVIDER: "codex-cli", CODEX_SERVICE_HOME: "/tmp/codex-test" },
      undefined,
      undefined,
      undefined,
      { record: async (input) => { aiRuns.push(input as unknown as Record<string, unknown>); return { id: "ai-run-outbound" }; } },
      undefined,
      undefined,
      routedModel,
      { assemble: async () => activeMemoryBundle() },
      {
        find: async () => ({
          flags: { prospectMemoryCapture: true, prospectMemoryShadow: false, prospectMemorySetter: false, enabledCapabilities: ["outbound_drafting"] },
          processingProfiles: [{
            provider: "codex-cli",
            encryptedInTransit: true,
            trainingUse: "none",
            providerRetentionDays: 0,
            regionOrJurisdiction: "EU",
            operatorAccessPolicy: "Restricted support access with audit logs",
            subprocessorsReviewed: true,
            deletionProcedure: "Provider deletion request followed by contract expiry",
            personalDataAllowed: true,
            allowedCapabilities: ["outbound_drafting"],
            reviewedAt: new Date("2026-08-23T00:00:00.000Z"),
          }],
          maxDailySemanticRefreshes: 10,
          maxDailyCostUsd: 10,
        }),
      },
    );

    const result = await generator.generate(campaignInput());

    expect(routedCalls).toHaveLength(2);
    expect(routedCalls.every((call) => JSON.stringify(call.payload).includes("Ne pas répéter l’angle sécurité"))).toBe(true);
    expect(routedCalls.map((call) => call.allowedProviders)).toEqual([["codex-cli"], ["codex-cli"]]);
    expect(result.metadata).toMatchObject({
      memoryReceiptId: "receipt-outbound",
      memorySnapshotId: "snapshot-outbound",
      memorySnapshotVersion: 4,
      memoryWatermark: 77,
    });
    expect(aiRuns[0]?.output).toMatchObject({
      prospectMemory: { receiptId: "receipt-outbound", snapshotId: "snapshot-outbound", watermark: 77 },
    });
  });
});

function activeMemoryBundle(): ProspectContextBundle {
  return {
    workspaceId: "workspace-1",
    contactId: "contact-1",
    capability: "outbound_drafting",
    mode: "active",
    status: "fresh",
    snapshotId: "snapshot-outbound",
    snapshotVersion: 4,
    receiptId: "receipt-outbound",
    watermark: 77,
    privacyEpoch: 1,
    assembledAt: new Date("2026-08-23T00:00:00.000Z"),
    currentState: {
      displayName: "Marie Durand",
      companyName: "Cabinet Durand",
      jobTitle: "Directrice juridique",
      locale: "fr",
      availableChannels: ["email"],
      suppressed: false,
      anonymized: false,
      activeCampaignIds: [],
      activeDecisionId: null,
    },
    activeDecisionId: null,
    context: { memory: { relationshipSummary: "Ne pas répéter l’angle sécurité." } },
    sourceEventIds: ["event-1"],
    excludedSourceEventIds: [],
    estimatedTokens: 100,
    automaticActionAllowed: true,
    waitCode: null,
  };
}

function campaignInput(): Parameters<LangChainCampaignContentGenerator["generate"]>[0] {
  return {
    workspaceId: crypto.randomUUID(),
    channel: "email",
    campaignObjective: "Obtenir un échange de qualification de 15 minutes.",
    icpName: "Directions juridiques réglementées",
    problems: ["Documents dispersés"],
    signals: ["Recrutement RSSI"],
    offer: {
      source: "offer_version",
      name: "IgnitionRAG",
      category: "saas",
      valueProposition: "Recherche documentaire sécurisée et traçable",
      targetAudience: "Directions juridiques",
      pricing: { disclosure: "call_only" },
      commercialRules: { noDiscountInMessage: true },
      constraints: { deployment: "private" },
      objections: ["Sécurité"],
      claims: [],
    },
    previousMessages: [{
      direction: "outbound",
      body: "Bonjour Marie, votre équipe juridique grandit. Comment gérez-vous la recherche interne ?",
      occurredAt: "2026-08-01T09:00:00.000Z",
      source: "campaign",
    }],
    stepObjective: {
      stage: "follow_up",
      objective: "Ajouter un angle utile qui n’apparaît pas dans les messages précédents et obtenir une réponse simple, sans répéter l’ouverture.",
    },
    policy: { language: "fr", firstMessageInstructions: null, followUpInstructions: "Rester factuel." },
    prospect: {
      contactId: crypto.randomUUID(),
      firstName: "Marie",
      lastName: "Durand",
      headline: "Directrice juridique",
      companyName: "Cabinet Durand",
      location: "Paris",
      score: 82,
      scoreExplanation: ["ICP exact"],
      evidence: {
        publicData: { signals: ["Recrutement RSSI", "Certification ISO 27001"] },
        scoreFactors: ["ICP exact"],
      },
    },
    templateSteps: [{
      position: 2,
      kind: "email",
      delayDays: 4,
      windowStart: "09:00",
      windowEnd: "17:00",
      subject: "Re: sécurité documentaire",
      body: "Relance",
      fallbackKind: null,
    }],
  };
}
