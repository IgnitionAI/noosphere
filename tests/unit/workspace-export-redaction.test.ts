import { expect, test } from "bun:test";
import { redactWorkspaceExportValue } from "@outbound/infrastructure/workspaces/workspace-data-export";

test("workspace exports recursively redact technical secrets without dropping business data", () => {
  expect(redactWorkspaceExportValue({
    email: "prospect@example.com",
    payload: { accessToken: "secret-token", nested: [{ api_key: "secret-key", message: "bonjour" }] },
    encrypted_secret: "ciphertext",
  })).toEqual({
    email: "prospect@example.com",
    payload: { accessToken: "[REDACTED]", nested: [{ api_key: "[REDACTED]", message: "bonjour" }] },
    encrypted_secret: "[REDACTED]",
  });
});
