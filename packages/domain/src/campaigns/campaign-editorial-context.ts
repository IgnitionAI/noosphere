import type { ProspectingChannel } from "./prospecting-plan";
import type { SequenceStepKind } from "./sequence-validation";

export interface CampaignStepObjective {
  readonly stage: "opener" | "follow_up" | "closing";
  readonly objective: string;
}

export interface CampaignMessageHistoryItem {
  readonly direction: "inbound" | "outbound";
  readonly body: string;
  readonly occurredAt: string;
  readonly source: "campaign" | "conversation";
}

export function mergeCampaignMessageHistory(
  items: readonly {
    readonly direction: "inbound" | "outbound";
    readonly body: string;
    readonly occurredAt: Date;
    readonly source: "campaign" | "conversation";
  }[],
): readonly CampaignMessageHistoryItem[] {
  const seen = new Set<string>();
  return [...items]
    .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime())
    .flatMap((item) => {
      const body = item.body.trim();
      if (!body) return [];
      const key = `${item.occurredAt.toISOString()}:${normalizeMessage(body)}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{
        direction: item.direction,
        body,
        occurredAt: item.occurredAt.toISOString(),
        source: item.source,
      }];
    })
    .slice(-30);
}

export function requiresEditorialRegeneration(input: {
  readonly generationPending: boolean;
  readonly promptVersion: string | null;
}): boolean {
  if (input.generationPending) return true;
  if (input.promptVersion === "campaign-personalization-v2-knowledge") return true;
  return /^message-generation-v\d+$/.test(input.promptVersion ?? "");
}

export function campaignStepObjective(input: {
  readonly channel: ProspectingChannel;
  readonly kind: SequenceStepKind;
  readonly position: number;
  readonly totalSteps: number;
}): CampaignStepObjective {
  if (input.position > 1 && input.position === input.totalSteps) {
    return {
      stage: "closing",
      objective: "Apporter un dernier angle concret, permettre au prospect de clore simplement l’échange et ne créer aucune fausse urgence.",
    };
  }
  if (input.position > 1) {
    return {
      stage: "follow_up",
      objective: "Ajouter un angle utile qui n’apparaît pas dans les messages précédents et obtenir une réponse simple, sans répéter l’ouverture.",
    };
  }
  if (input.kind === "linkedin_invite") {
    return {
      stage: "opener",
      objective: "Obtenir l’acceptation de la connexion grâce à un contexte précis, sans argumentaire commercial ni promesse.",
    };
  }
  if (input.channel === "whatsapp") {
    return {
      stage: "opener",
      objective: "Identifier clairement l’expéditeur, expliquer la pertinence du contact en une phrase et demander la permission de poursuivre.",
    };
  }
  return {
    stage: "opener",
    objective: "Établir une hypothèse de pertinence fondée sur une preuve prospect et obtenir une réponse à faible effort.",
  };
}

function normalizeMessage(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("fr").replace(/\s+/g, " ").trim();
}
