import { parseMcpWriteArguments } from "@outbound/interface/mcp/mcp-write-contracts";
import { expect, test } from "bun:test";
import { activeContentBrandKit, assertContentBrandKit, DEFAULT_CONTENT_BRAND_KIT, selectNextContentFormat } from "@outbound/domain/content/content-brand-kit";
import { ContentMediaProducer } from "@outbound/application/content/content-media";

test("legacy carousel-only settings fall back to text without changing brand identity", () => {
  const legacy = { ...DEFAULT_CONTENT_BRAND_KIT, brandName: "IgnitionAI", enabledFormats: ["linkedin_document" as const], weeklyMix: { linkedin_text: 0, linkedin_image: 0, linkedin_document: 3, linkedin_video: 0 } };
  const active = activeContentBrandKit(legacy);
  expect(active.brandName).toBe("IgnitionAI");
  expect(active.enabledFormats).toEqual(["linkedin_text"]);
  expect(active.weeklyMix.linkedin_document).toBe(0);
  expect(() => assertContentBrandKit(active)).not.toThrow();
  expect(selectNextContentFormat(legacy, [])).toBe("linkedin_text");
  expect(legacy.enabledFormats).toEqual(["linkedin_document"]);
});

test("document production fails before rendering or storage access", async () => {
  let effects = 0;
  const unexpected = async (): Promise<never> => { effects++; throw new Error("unexpected effect"); };
  const producer = new ContentMediaProducer({ put: unexpected, get: unexpected }, { render: unexpected });
  await expect(producer.produce({ workspaceId: "workspace", runId: "run", format: "linkedin_document", brandKit: DEFAULT_CONTENT_BRAND_KIT,
    draft: { hook: "Example", body: "Example", callToAction: null, factualClaims: [], opinionStatements: [] } })).rejects.toThrow("CONTENT_FORMAT_UNAVAILABLE");
  expect(effects).toBe(0);
});

test("MCP rejects new carousel drafts", () => {
  expect(() => parseMcpWriteArguments("content_draft_create", { requestKey: "carousel-disabled", ideaId: crypto.randomUUID(), body: "A draft", format: "linkedin_document" })).toThrow();
});
