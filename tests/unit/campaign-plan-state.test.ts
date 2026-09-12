import { expect, test } from "bun:test";
import { campaignPlanPreparation } from "../../apps/web/lib/campaign-plan-state";

test("an old failed LinkedIn assessment cannot make an empty plan ready", () => {
  const state = campaignPlanPreparation([{ status: "completed", recommendation: "unsuitable" }, { status: "completed", recommendation: "unsuitable" }, { status: "failed" }]);
  expect(state.label).toBe("Évaluation bloquée");
  expect(state.message).toContain("Aucune recherche de prospects n’a démarré");
});
test("pending assessment is not a completed prospect search", () => {
  expect(campaignPlanPreparation([{ status: "pending" }]).label).toBe("Évaluation en cours");
});
test("completed assessment with no campaign is not a ready campaign", () => {
  expect(campaignPlanPreparation([{ status: "completed", recommendation: "unsuitable" }]).label).toBe("Aucun canal activé");
  expect(campaignPlanPreparation([]).label).toBe("À préparer");
});
