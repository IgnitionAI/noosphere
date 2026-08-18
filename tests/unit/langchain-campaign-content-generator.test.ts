import { describe, expect, test } from "bun:test";
import { LangChainCampaignContentGenerator } from "@outbound/infrastructure/campaigns/langchain-campaign-content-generator";

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
    );

    const result = await generator.generate({
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
    });

    expect(calls.map((call) => call.phase)).toEqual(["draft", "review"]);
    const draftContext = JSON.parse(calls[0]!.messages.at(-1)!.content);
    expect(draftContext).toMatchObject({
      campaignObjective: "Obtenir un échange de qualification de 15 minutes.",
      offer: { name: "IgnitionRAG", valueProposition: "Recherche documentaire sécurisée et traçable" },
      prospect: { evidence: { publicData: { signals: ["Recrutement RSSI", "Certification ISO 27001"] } } },
      previousMessages: [{ body: "Bonjour Marie, votre équipe juridique grandit. Comment gérez-vous la recherche interne ?" }],
      stepObjective: { stage: "follow_up" },
    });
    expect(result.steps[0]?.body).toContain("recrutement d’un RSSI");
    expect(result.metadata.editorialReview).toMatchObject({ verdict: "revised", genericityScore: 0.1 });
  });
});
