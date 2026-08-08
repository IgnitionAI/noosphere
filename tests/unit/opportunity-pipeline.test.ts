import { describe, expect, test } from "bun:test";
import {
  canTransitionOpportunity,
  opportunityStageLabel,
  pipelineColumn,
} from "@outbound/domain/pipeline/opportunity";

describe("opportunity pipeline", () => {
  test("groups automatic meeting stages into stable commercial columns", () => {
    expect(pipelineColumn("qualified")).toBe("qualified");
    expect(pipelineColumn("meeting_requested")).toBe("meeting");
    expect(pipelineColumn("meeting_booked")).toBe("meeting");
    expect(pipelineColumn("meeting_no_show")).toBe("follow_up");
    expect(pipelineColumn("meeting_completed")).toBe("follow_up");
    expect(pipelineColumn("won")).toBe("closed");
  });

  test("keeps terminal outcomes explicit but allows an intentional reopen", () => {
    expect(canTransitionOpportunity("meeting_completed", "won")).toBe(true);
    expect(canTransitionOpportunity("meeting_completed", "lost")).toBe(true);
    expect(canTransitionOpportunity("won", "qualified")).toBe(true);
    expect(canTransitionOpportunity("qualified", "qualified")).toBe(false);
  });

  test("exposes French labels for every persisted stage", () => {
    expect(opportunityStageLabel("meeting_booked")).toBe("Rendez-vous réservé");
    expect(opportunityStageLabel("meeting_no_show")).toBe("À replanifier");
    expect(opportunityStageLabel("unknown")).toBe("Étape inconnue");
  });
});
