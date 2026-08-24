import { describe, expect, test } from "bun:test";
import { ModelGatewayError } from "@outbound/application/ai/model-gateway";
import { channelAssessmentFailure } from "@outbound/infrastructure/campaigns/channel-assessment-runner";

describe("channelAssessmentFailure", () => {
  test("preserves an actionable provider failure instead of hiding it behind a generic code", () => {
    expect(channelAssessmentFailure(new ModelGatewayError(
      "AI_PROVIDER_UNAVAILABLE",
      "codex-cli",
      "Codex cannot reach OpenAI from the service",
      true,
      true,
    ))).toEqual({
      errorCode: "AI_PROVIDER_UNAVAILABLE",
      errorMessage: "Codex cannot reach OpenAI from the service",
    });
  });

  test("keeps a generic boundary for non-provider failures", () => {
    expect(channelAssessmentFailure(new Error("source failed"))).toEqual({
      errorCode: "CHANNEL_ASSESSMENT_FAILED",
      errorMessage: "source failed",
    });
  });
});
