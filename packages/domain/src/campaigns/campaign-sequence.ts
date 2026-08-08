import type { SequenceStepInput } from "./sequence-validation";
import type { ProspectingChannel } from "./prospecting-plan";

export function defaultCampaignSequenceSteps(
  channel: ProspectingChannel,
): readonly SequenceStepInput[] {
  if (channel === "linkedin") return [
    {
      position: 1,
      kind: "linkedin_invite",
      delayDays: 0,
      windowStart: "09:00",
      windowEnd: "17:30",
      subject: null,
      body: "Bonjour {{firstName}}, j’ai regardé le contexte de {{companyName}} autour de {{icpName}}. Ouvert à un échange ?",
      fallbackKind: null,
    },
    {
      position: 2,
      kind: "linkedin_message",
      delayDays: 3,
      windowStart: "09:00",
      windowEnd: "17:30",
      subject: null,
      body: "Merci pour la connexion {{firstName}}. Le contexte de {{companyName}} semble proche de {{icpName}}. Est-ce un sujet que vous explorez actuellement ?",
      fallbackKind: null,
    },
  ];
  if (channel === "email") return [
    {
      position: 1,
      kind: "email",
      delayDays: 0,
      windowStart: "09:00",
      windowEnd: "17:30",
      subject: "{{companyName}} — {{icpName}}",
      body: "Bonjour {{firstName}},\n\nEn regardant {{companyName}}, j’ai identifié un contexte qui semble proche de {{icpName}}. Je préfère valider le besoin avec vous plutôt que présumer de vos priorités.\n\nSeriez-vous disponible pour un échange court ?\n\nBien à vous,\n{{senderName}}",
      fallbackKind: null,
    },
    {
      position: 2,
      kind: "email",
      delayDays: 4,
      windowStart: "09:00",
      windowEnd: "17:30",
      subject: "Re: {{companyName}} — {{icpName}}",
      body: "Bonjour {{firstName}},\n\nJe me permets une seule relance. Le sujet {{icpName}} est-il pertinent pour {{companyName}}, ou dois-je clore cette piste ?\n\nBien à vous,\n{{senderName}}",
      fallbackKind: null,
    },
    {
      position: 3,
      kind: "email",
      delayDays: 6,
      windowStart: "09:00",
      windowEnd: "17:00",
      subject: "Re: {{companyName}} — {{icpName}}",
      body: "Bonjour {{firstName}},\n\nJe clôture cette piste après ce message. Si {{icpName}} devient un sujet chez {{companyName}}, je pourrai vous partager quelques pistes concrètes adaptées à votre contexte.\n\nBien à vous,\n{{senderName}}",
      fallbackKind: null,
    },
  ];
  return [
    {
      position: 1,
      kind: "whatsapp",
      delayDays: 0,
      windowStart: "09:00",
      windowEnd: "17:30",
      subject: null,
      body: "Bonjour {{firstName}}, ici {{senderName}}. Je vous contacte sur votre numéro professionnel au sujet de {{icpName}} chez {{companyName}}. Dites-moi simplement si ce sujet n’est pas pertinent.",
      fallbackKind: null,
    },
  ];
}

export function prepareAutomatedSequenceSteps(
  steps: readonly SequenceStepInput[],
): readonly SequenceStepInput[] {
  return steps
    .filter((step) => step.kind !== "manual_task")
    .map((step, index) => ({ ...step, position: index + 1 }));
}
