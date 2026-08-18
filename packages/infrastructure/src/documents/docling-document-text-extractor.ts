import type { DocumentTextExtractor, DocumentTextExtraction } from "@outbound/application/documents/document-text-extractor";

export class DoclingDocumentTextExtractor implements DocumentTextExtractor {
  constructor(private readonly url: string, private readonly apiKey?: string) {}

  async extract(input: { filename: string; contentType: string; bytes: Uint8Array }): Promise<DocumentTextExtraction> {
    const started = Date.now();
    const form = new FormData();
    const fileBytes = Uint8Array.from(input.bytes);
    form.append("files", new Blob([fileBytes.buffer], { type: input.contentType }), input.filename);
    form.append("to_formats", "md");
    form.append("do_ocr", "true");
    form.append("image_export_mode", "placeholder");
    form.append("table_mode", "accurate");
    const response = await fetch(`${this.url.replace(/\/+$/, "")}/v1/convert/file`, {
      method: "POST",
      ...(this.apiKey ? { headers: { "x-api-key": this.apiKey } } : {}),
      body: form,
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!response.ok) throw new Error(`Docling returned ${response.status}`);
    const result = await response.json() as { status?: string; document?: { md_content?: string } };
    const markdown = result.document?.md_content?.trim();
    if (!markdown || result.status === "failure") throw new Error("Docling did not return Markdown");
    return { markdown, provider: "docling", quality: "complete", durationMs: Date.now() - started };
  }
}
