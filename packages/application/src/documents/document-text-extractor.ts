export type DocumentExtractionQuality = "complete" | "partial";

export interface DocumentTextExtraction {
  readonly markdown: string;
  readonly provider: "lightweight" | "docling";
  readonly quality: DocumentExtractionQuality;
  readonly durationMs: number;
}

export interface DocumentTextExtractor {
  extract(input: { filename: string; contentType: string; bytes: Uint8Array }): Promise<DocumentTextExtraction>;
}
