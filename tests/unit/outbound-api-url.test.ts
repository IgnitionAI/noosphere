import { afterEach, describe, expect, test } from "bun:test";
import { outboundApiUrl } from "../../apps/web/lib/outbound-api-url";

const originalUrl = process.env.OUTBOUND_API_URL;

afterEach(() => {
  if (originalUrl === undefined) delete process.env.OUTBOUND_API_URL;
  else process.env.OUTBOUND_API_URL = originalUrl;
});

describe("outbound API URL", () => {
  test("keeps API paths and queries on the configured internal origin", () => {
    process.env.OUTBOUND_API_URL = "https://api.internal.example:3443";
    expect(outboundApiUrl("/api/v1/conversations?cursor=next").href)
      .toBe("https://api.internal.example:3443/api/v1/conversations?cursor=next");
  });

  test("rejects paths that could override or escape the internal origin", () => {
    for (const pathname of [
      "https://attacker.example/api/v1/data",
      "//attacker.example/api/v1/data",
      "/api\\\\attacker.example/data",
      "/health",
      "/api/v1/data#fragment",
      "/api/v1/data\nX-Test: injected",
    ]) {
      expect(() => outboundApiUrl(pathname)).toThrow("INVALID_OUTBOUND_API_PATH");
    }
  });

  test("rejects unsafe backend base URLs", () => {
    for (const base of [
      "file:///tmp/socket",
      "https://user:secret@api.internal.example",
      "https://api.internal.example?redirect=1",
      "https://api.internal.example#fragment",
    ]) {
      process.env.OUTBOUND_API_URL = base;
      expect(() => outboundApiUrl("/api/v1/data")).toThrow("INVALID_OUTBOUND_API_URL");
    }
  });
});
