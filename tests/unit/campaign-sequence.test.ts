import { describe, expect, test } from "bun:test";
import {
  defaultCampaignSequenceSteps,
  prepareAutomatedSequenceSteps,
} from "@outbound/domain/campaigns/campaign-sequence";
import {
  fitSequenceStepContent,
  validateSequenceSteps,
} from "@outbound/domain/campaigns/sequence-validation";

describe("campaign draft sequence", () => {
  test("prepares a valid autonomous LinkedIn sequence without a manual gate", () => {
    const steps = defaultCampaignSequenceSteps("linkedin");

    expect(steps.map((step) => step.kind)).toEqual([
      "linkedin_invite",
      "linkedin_message",
    ]);
    expect(validateSequenceSteps(steps)).toEqual([]);
  });

  test("never mixes channels inside generated campaign sequences", () => {
    expect(defaultCampaignSequenceSteps("email").map((step) => step.kind)).toEqual([
      "email",
      "email",
      "email",
    ]);
    expect(defaultCampaignSequenceSteps("whatsapp").map((step) => step.kind)).toEqual([
      "whatsapp",
    ]);
    expect(validateSequenceSteps(defaultCampaignSequenceSteps("email"))).toEqual([]);
    expect(validateSequenceSteps(defaultCampaignSequenceSteps("whatsapp"))).toEqual([]);
  });

  test("removes a legacy manual gate and reindexes the autonomous steps", () => {
    const [invite, message] = defaultCampaignSequenceSteps("linkedin");
    const steps = prepareAutomatedSequenceSteps([
      {
        position: 1,
        kind: "manual_task",
        delayDays: 0,
        windowStart: null,
        windowEnd: null,
        subject: null,
        body: "Validation humaine legacy",
        fallbackKind: null,
      },
      { ...invite!, position: 2 },
      { ...message!, position: 3 },
    ]);

    expect(steps.map((step) => [step.position, step.kind])).toEqual([
      [1, "linkedin_invite"],
      [2, "linkedin_message"],
    ]);
    expect(validateSequenceSteps(steps)).toEqual([]);
  });

  test("keeps an oversized personalized invitation inside the provider limit", () => {
    const [template] = defaultCampaignSequenceSteps("linkedin");
    const fitted = fitSequenceStepContent({
      ...template!,
      body: `${"Contexte documenté et pertinent pour votre organisation. ".repeat(9)}Seriez-vous ouvert à un échange rapide ?`,
    });

    expect(fitted.body.length).toBeLessThanOrEqual(300);
    expect(fitted.body.endsWith("?")).toBe(true);
    expect(validateSequenceSteps([fitted])).toEqual([]);
  });
});
