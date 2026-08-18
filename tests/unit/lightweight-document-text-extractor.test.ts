import { describe, expect, test } from "bun:test";
import { LightweightDocumentTextExtractor } from "@outbound/infrastructure/documents/lightweight-document-text-extractor";

describe("lightweight document text extractor", () => {
  test("normalizes native HTML without scripts or markup", async () => {
    const extractor = new LightweightDocumentTextExtractor();
    const result = await extractor.extract({
      filename: "brief.html",
      contentType: "text/html",
      bytes: new TextEncoder().encode("<h1>Produit</h1><script>ignore()</script><p>Recherche &amp; preuve</p>"),
    });
    expect(result.provider).toBe("lightweight");
    expect(result.markdown).toContain("Produit");
    expect(result.markdown).toContain("Recherche & preuve");
    expect(result.markdown).not.toContain("ignore");
  });

  test("fails explicitly for formats requiring the optional advanced profile", async () => {
    const extractor = new LightweightDocumentTextExtractor();
    await expect(extractor.extract({
      filename: "deck.pptx",
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      bytes: new Uint8Array([1, 2, 3]),
    })).rejects.toThrow("DOCUMENT_FORMAT_UNSUPPORTED_BY_LIGHTWEIGHT_EXTRACTOR");
  });
});
