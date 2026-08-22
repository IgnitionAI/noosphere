import { describe, expect, test } from "bun:test";
import { documentProcessingFailureDisposition } from "@outbound/infrastructure/documents/research-document-service";

describe("research document failure policy", () => {
  test("does not retry permanent lightweight extraction failures", () => {
    for (const code of [
      "DOCUMENT_FORMAT_UNSUPPORTED_BY_LIGHTWEIGHT_EXTRACTOR",
      "DOCUMENT_PDF_TOO_LARGE_FOR_LIGHTWEIGHT_EXTRACTOR",
      "DOCUMENT_TEXT_EMPTY",
      "DOCUMENT_PDF_EXTRACTION_FAILED",
      "RESEARCH_DOCUMENT_CHECKSUM_MISMATCH",
      "RESEARCH_DOCUMENT_CONTENT_TYPE_MISMATCH",
      "RESEARCH_DOCUMENT_OBJECT_EMPTY",
    ]) {
      expect(documentProcessingFailureDisposition(code)).toBe("terminal");
    }
  });

  test("keeps infrastructure and provider failures retryable", () => {
    expect(documentProcessingFailureDisposition("DOCUMENT_PDF_EXTRACTOR_UNAVAILABLE")).toBe("retry");
    expect(documentProcessingFailureDisposition("DOCUMENT_EMBEDDINGS_NOT_CONFIGURED")).toBe("retry");
    expect(documentProcessingFailureDisposition("RESEARCH_DOCUMENT_PROCESSING_FAILED")).toBe("retry");
  });
});
