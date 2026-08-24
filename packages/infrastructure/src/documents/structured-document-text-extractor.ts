import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
  DocumentTextExtraction,
  DocumentTextExtractor,
} from "@outbound/application/documents/document-text-extractor";

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const EXTRACTION_TIMEOUT_MS = 120_000;

export interface StructuredDocumentTextExtractorOptions {
  readonly processPath?: string;
  readonly timeoutMs?: number;
}

/**
 * The limiter coordinates infrastructure capacity only. Parser state always
 * lives in a fresh child process and is destroyed after every extraction.
 */
class ExtractionSemaphore {
  #tail = Promise.resolve();

  async withSlot<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#tail;
    let release!: () => void;
    this.#tail = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

const extractionSemaphore = new ExtractionSemaphore();

export class StructuredDocumentTextExtractor implements DocumentTextExtractor {
  constructor(private readonly options: StructuredDocumentTextExtractorOptions = {}) {}

  async extract(input: {
    filename: string;
    contentType: string;
    bytes: Uint8Array;
    signal?: AbortSignal;
  }): Promise<DocumentTextExtraction> {
    if (input.bytes.byteLength > MAX_FILE_BYTES) {
      throw new Error("DOCUMENT_CONTENT_LIMIT_EXCEEDED");
    }
    validateMagic(input.contentType, input.bytes);
    return extractionSemaphore.withSlot(() => this.#extractInChild(input));
  }

  async #extractInChild(input: {
    filename: string;
    contentType: string;
    bytes: Uint8Array;
    signal?: AbortSignal;
  }): Promise<DocumentTextExtraction> {
    if (input.signal?.aborted) throw new Error("DOCUMENT_EXTRACTION_CANCELLED");
    const directory = await mkdtemp(join(tmpdir(), "noosphere-document-"));
    const inputPath = join(directory, "input.bin");
    try {
      await writeFile(inputPath, input.bytes);
      const processPath = await resolveProcessPath(this.options.processPath);
      const child = Bun.spawn(
        [
          Bun.which("bun") ?? process.execPath,
          processPath,
          inputPath,
          input.filename,
          input.contentType,
        ],
        { stdout: "pipe", stderr: "pipe", env: {} },
      );
      const timeoutMs = this.options.timeoutMs ?? EXTRACTION_TIMEOUT_MS;
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);
      const onAbort = () => child.kill();
      input.signal?.addEventListener("abort", onAbort, { once: true });
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).arrayBuffer(),
        new Response(child.stderr).text(),
      ]);
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", onAbort);
      if (timedOut) throw new Error("DOCUMENT_EXTRACTION_TIMEOUT");
      if (input.signal?.aborted) throw new Error("DOCUMENT_EXTRACTION_CANCELLED");
      if (stdout.byteLength > MAX_OUTPUT_BYTES) throw new Error("DOCUMENT_CONTENT_LIMIT_EXCEEDED");
      let envelope: { ok: true; extraction: DocumentTextExtraction } | { ok: false; code: string };
      try {
        envelope = JSON.parse(new TextDecoder().decode(stdout)) as typeof envelope;
      } catch {
        if (exitCode !== 0) throw new Error(normalizeChildError(stderr));
        throw new Error("DOCUMENT_FORMAT_INVALID");
      }
      if (!envelope.ok) throw new Error(envelope.code);
      return envelope.extraction;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

async function resolveProcessPath(configured?: string): Promise<string> {
  const candidates = [
    configured,
    resolve(import.meta.dir, "document-extractor-process.ts"),
    resolve(process.cwd(), "dist/document-extractor/document-extractor-process.js"),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue to the bundled production location.
    }
  }
  throw new Error("DOCUMENT_EXTRACTOR_UNAVAILABLE");
}

function validateMagic(contentType: string, value: Uint8Array): void {
  if (contentType === "application/pdf") {
    if (new TextDecoder().decode(value.slice(0, 5)) !== "%PDF-") {
      throw new Error("DOCUMENT_FORMAT_INVALID");
    }
    return;
  }
  if (contentType.startsWith("application/vnd.openxmlformats-officedocument.")) {
    if (value[0] !== 0x50 || value[1] !== 0x4b) throw new Error("DOCUMENT_FORMAT_INVALID");
    return;
  }
  if (["text/plain", "text/markdown", "text/html"].includes(contentType)) {
    if (value.slice(0, Math.min(value.length, 8_192)).includes(0)) {
      throw new Error("DOCUMENT_FORMAT_INVALID");
    }
    return;
  }
  throw new Error("UNSUPPORTED_DOCUMENT_TYPE");
}

function normalizeChildError(stderr: string): string {
  const candidate = stderr.trim().split(/\s+/).find((part) => /^DOCUMENT_[A-Z0-9_]+$/.test(part));
  return candidate ?? "DOCUMENT_EXTRACTION_FAILED";
}
