export type DocumentExtractionProvider = "unpdf" | "docx" | "pptx" | "xlsx" | "html" | "text";
export type DocumentExtractionStatus = "complete" | "partial" | "ocr_required";

export interface DocumentExtractionSection {
  readonly locator: string;
  readonly title: string | null;
  readonly content: string;
}

export interface DocumentExtractionMetrics {
  readonly bytes: number;
  readonly characters: number;
  readonly sections: number;
  readonly pages?: number;
  readonly slides?: number;
  readonly sheets?: number;
  readonly nonEmptyCells?: number;
}

export interface DocumentTextExtraction {
  readonly provider: DocumentExtractionProvider;
  readonly status: DocumentExtractionStatus;
  readonly markdown: string;
  readonly warnings: readonly string[];
  readonly durationMs: number;
  readonly sections: readonly DocumentExtractionSection[];
  readonly metrics: DocumentExtractionMetrics;
}

export interface DocumentTextExtractor {
  extract(input: {
    filename: string;
    contentType: string;
    bytes: Uint8Array;
    signal?: AbortSignal;
  }): Promise<DocumentTextExtraction>;
}
