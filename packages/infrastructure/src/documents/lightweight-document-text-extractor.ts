import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocumentTextExtractor, DocumentTextExtraction } from "@outbound/application/documents/document-text-extractor";

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const PDF_TIMEOUT_MS = 60_000;

export class LightweightDocumentTextExtractor implements DocumentTextExtractor {
  async extract(input: { filename: string; contentType: string; bytes: Uint8Array }): Promise<DocumentTextExtraction> {
    const started = Date.now();
    if (input.bytes.byteLength > MAX_PDF_BYTES && input.contentType === "application/pdf") {
      throw new Error("DOCUMENT_PDF_TOO_LARGE_FOR_LIGHTWEIGHT_EXTRACTOR");
    }
    let markdown: string;
    if (input.contentType === "application/pdf") markdown = await extractPdf(input.bytes);
    else if (input.contentType === "text/html") markdown = htmlToText(new TextDecoder().decode(input.bytes));
    else if (input.contentType === "text/plain" || input.contentType === "text/markdown") markdown = new TextDecoder().decode(input.bytes);
    else throw new Error("DOCUMENT_FORMAT_UNSUPPORTED_BY_LIGHTWEIGHT_EXTRACTOR");
    const normalized = markdown.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
    if (!normalized) throw new Error("DOCUMENT_TEXT_EMPTY");
    return { markdown: normalized, provider: "lightweight", quality: "complete", durationMs: Date.now() - started };
  }
}

async function extractPdf(bytes: Uint8Array): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ignition-outbound-pdf-"));
  const inputPath = join(dir, "document.pdf");
  const outputPath = join(dir, "document.txt");
  try {
    await writeFile(inputPath, bytes);
    const process = Bun.spawn(["pdftotext", "-layout", inputPath, outputPath], { stdout: "pipe", stderr: "pipe" });
    const timeout = setTimeout(() => process.kill(), PDF_TIMEOUT_MS);
    const exitCode = await process.exited;
    clearTimeout(timeout);
    if (exitCode !== 0) throw new Error("DOCUMENT_PDF_EXTRACTION_FAILED");
    const text = await Bun.file(outputPath).text();
    return text;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("DOCUMENT_PDF")) throw error;
    throw new Error("DOCUMENT_PDF_EXTRACTOR_UNAVAILABLE");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function htmlToText(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"');
}
