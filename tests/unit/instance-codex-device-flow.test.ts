import { expect, test } from "bun:test";
import { parseCodexDevicePrompt } from "@outbound/infrastructure/ai/instance-codex-home";

test("device login exposes only the official verification page and bounded one-time code", () => {
  expect(parseCodexDevicePrompt("Open https://auth.openai.com/codex/device\nEnter this code: ABCD-EFGHJ\nprivate diagnostic text")).toEqual({ verificationUrl: "https://auth.openai.com/codex/device", userCode: "ABCD-EFGHJ" });
  expect(parseCodexDevicePrompt("Open https://evil.example/codex/device\nABCD-EFGHJ")).toBeNull();
  expect(parseCodexDevicePrompt("https://auth.openai.com/codex/device?token=secret\nABCD-EFGHJ")).toBeNull();
  expect(parseCodexDevicePrompt("https://auth.openai.com/codex/device\nno code yet")).toBeNull();
});
