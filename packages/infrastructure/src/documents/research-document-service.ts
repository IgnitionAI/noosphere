import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";
import type { Clock, IdGenerator } from "@outbound/application/shared/ports";
import type { Database } from "@outbound/infrastructure/database/client";
import { researchDocuments } from "@outbound/infrastructure/database/schema";
import type { DocumentTextExtractor } from "@outbound/application/documents/document-text-extractor";
import type { DocumentTextExtraction } from "@outbound/application/documents/document-text-extractor";
import { StructuredDocumentTextExtractor } from "@outbound/infrastructure/documents/structured-document-text-extractor";

const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const allowedContentTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/html",
  "text/markdown",
  "text/plain",
]);

export interface ResearchDocumentServiceOptions {
  readonly bucket: string;
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly extractor?: DocumentTextExtractor;
  readonly extractorProcessPath?: string;
}

export interface ResearchDocumentKnowledgeIndexer {
  indexResearchDocument(input: {
    readonly workspaceId: string;
    readonly sourceDocumentId: string;
    readonly filename: string;
    readonly contentType: string;
    readonly checksumSha256: string;
    readonly sourceCreatedAt: Date;
    readonly extraction: DocumentTextExtraction;
    readonly chunks: readonly { content: string; heading: string | null; locator: string }[];
  }): Promise<void>;
}

export class ResearchDocumentService {
  readonly #s3: S3Client;
  readonly #extractor: DocumentTextExtractor;

  constructor(
    private readonly db: Database,
    private readonly queue: JobQueue,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly options: ResearchDocumentServiceOptions,
    private readonly knowledgeIndexer?: ResearchDocumentKnowledgeIndexer,
  ) {
    this.#s3 = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
    this.#extractor = options.extractor
      ?? new StructuredDocumentTextExtractor(
        options.extractorProcessPath ? { processPath: options.extractorProcessPath } : {},
      );
  }

  async createUploadIntent(input: {
    workspaceId: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
    checksumSha256: string;
  }) {
    validateUpload(input);
    const id = this.ids.generate();
    const filename = sanitizeFilename(input.filename);
    const objectKey = `${input.workspaceId}/research-documents/${id}/${filename}`;
    await this.db
      .insert(researchDocuments)
      .values({
        id,
        workspaceId: input.workspaceId,
        filename,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        checksumSha256: input.checksumSha256.toLowerCase(),
        objectKey,
      })
      .onConflictDoNothing({
        target: [researchDocuments.workspaceId, researchDocuments.checksumSha256],
      });
    const rows = await this.db
      .select()
      .from(researchDocuments)
      .where(
        and(
          eq(researchDocuments.workspaceId, input.workspaceId),
          eq(researchDocuments.checksumSha256, input.checksumSha256.toLowerCase()),
        ),
      )
      .limit(1);
    const document = rows[0];
    if (!document) throw new Error("RESEARCH_DOCUMENT_CREATE_FAILED");
    return {
      document,
      uploadUrl: `/api/v1/research-documents/${document.id}/content`,
      expiresInSeconds: 15 * 60,
    };
  }

  async uploadContent(input: {
    workspaceId: string;
    documentId: string;
    contentType: string;
    bytes: Uint8Array;
  }): Promise<void> {
    const document = await this.#find(input.workspaceId, input.documentId);
    if (!document) throw new Error("RESEARCH_DOCUMENT_NOT_FOUND");
    if (!["uploading", "uploaded", "failed"].includes(document.status)) {
      throw new Error("RESEARCH_DOCUMENT_UPLOAD_ALREADY_COMPLETED");
    }
    if (input.contentType !== document.contentType) {
      throw new Error("RESEARCH_DOCUMENT_CONTENT_TYPE_MISMATCH");
    }
    if (input.bytes.byteLength !== document.sizeBytes) {
      throw new Error("RESEARCH_DOCUMENT_SIZE_MISMATCH");
    }
    if (sha256Bytes(input.bytes) !== document.checksumSha256) {
      throw new Error("RESEARCH_DOCUMENT_CHECKSUM_MISMATCH");
    }
    if (!matchesDeclaredContentType(document.contentType, input.bytes)) {
      throw new Error("RESEARCH_DOCUMENT_CONTENT_TYPE_MISMATCH");
    }
    await this.#s3.send(new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: document.objectKey,
      Body: input.bytes,
      ContentType: document.contentType,
      ContentLength: input.bytes.byteLength,
      Metadata: { sha256: document.checksumSha256 },
    }));
  }

  async completeUpload(input: {
    workspaceId: string;
    documentId: string;
    correlationId: string;
  }) {
    const document = await this.#find(input.workspaceId, input.documentId);
    if (!document) throw new Error("RESEARCH_DOCUMENT_NOT_FOUND");
    if (["ready", "partial", "ocr_required", "processing"].includes(document.status)) return document;
    const object = await this.#s3.send(
      new HeadObjectCommand({ Bucket: this.options.bucket, Key: document.objectKey }),
    );
    if (object.ContentLength !== document.sizeBytes) {
      throw new Error("RESEARCH_DOCUMENT_SIZE_MISMATCH");
    }
    await this.db
      .update(researchDocuments)
      .set({ status: "uploaded", updatedAt: this.clock.now(), failureCode: null })
      .where(
        and(
          eq(researchDocuments.workspaceId, input.workspaceId),
          eq(researchDocuments.id, input.documentId),
        ),
      );
    await this.queue.enqueue({
      id: this.ids.generate(),
      workspaceId: input.workspaceId,
      type: "research.document.process",
      payload: { workspaceId: input.workspaceId, documentId: input.documentId },
      idempotencyKey: `${input.documentId}:process`,
      correlationId: input.correlationId,
      maxAttempts: 3,
      availableAt: this.clock.now(),
    });
    return { ...document, status: "uploaded" as const };
  }

  async list(workspaceId: string) {
    return this.db
      .select()
      .from(researchDocuments)
      .where(
        and(
          eq(researchDocuments.workspaceId, workspaceId),
          sql`${researchDocuments.status} <> 'deleted'`,
        ),
      )
      .orderBy(asc(researchDocuments.createdAt));
  }

  async softDelete(workspaceId: string, documentId: string): Promise<void> {
    await this.db
      .update(researchDocuments)
      .set({ status: "deleted", deletedAt: this.clock.now(), updatedAt: this.clock.now() })
      .where(
        and(
          eq(researchDocuments.workspaceId, workspaceId),
          eq(researchDocuments.id, documentId),
        ),
      );
  }

  async process(job: LeasedJob): Promise<void> {
    const payload = documentJobPayload(job.payload);
    const document = await this.#find(payload.workspaceId, payload.documentId);
    if (!document) throw new Error("RESEARCH_DOCUMENT_NOT_FOUND");
    const alreadyIndexed = ["ready", "partial"].includes(document.status)
      && await this.#hasActiveKnowledgeIndex(payload.workspaceId, payload.documentId);
    if (alreadyIndexed || document.status === "ocr_required") {
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return;
    }
    try {
      await this.db
        .update(researchDocuments)
        .set({ status: "processing", updatedAt: this.clock.now(), failureCode: null })
        .where(
          and(
            eq(researchDocuments.workspaceId, payload.workspaceId),
            eq(researchDocuments.id, payload.documentId),
          ),
        );
      const object = await this.#s3.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: document.objectKey }),
      );
      if (!object.Body) throw new Error("RESEARCH_DOCUMENT_OBJECT_EMPTY");
      const bytes = await object.Body.transformToByteArray();
      if (sha256Bytes(bytes) !== document.checksumSha256) {
        throw new Error("RESEARCH_DOCUMENT_CHECKSUM_MISMATCH");
      }
      if (!matchesDeclaredContentType(document.contentType, bytes)) {
        throw new Error("RESEARCH_DOCUMENT_CONTENT_TYPE_MISMATCH");
      }
      const extraction = await this.#extractor.extract({
        filename: document.filename,
        contentType: document.contentType,
        bytes,
      });
      if (extraction.status === "ocr_required") {
        await this.db.transaction(async (tx) => {
          await tx.update(researchDocuments).set({
            status: "ocr_required",
            extractedMarkdown: null,
            extractionProvider: extraction.provider,
            extractionDurationMs: extraction.durationMs,
            extractionMetrics: extraction.metrics,
            extractionWarnings: extraction.warnings,
            extractedAt: this.clock.now(),
            updatedAt: this.clock.now(),
            failureCode: "DOCUMENT_OCR_REQUIRED",
          }).where(and(
            eq(researchDocuments.workspaceId, payload.workspaceId),
            eq(researchDocuments.id, payload.documentId),
          ));
        });
        await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
        return;
      }
      const chunks = documentChunksForExtraction(extraction);
      if (!this.knowledgeIndexer) throw new Error("DOCUMENT_EMBEDDINGS_NOT_CONFIGURED");
      await this.knowledgeIndexer.indexResearchDocument({
        workspaceId: payload.workspaceId,
        sourceDocumentId: payload.documentId,
        filename: document.filename,
        contentType: document.contentType,
        checksumSha256: document.checksumSha256,
        sourceCreatedAt: document.createdAt,
        extraction,
        chunks,
      });
      await this.db.update(researchDocuments).set({
        status: extraction.status === "partial" ? "partial" : "ready",
        extractedMarkdown: extraction.markdown,
        extractionProvider: extraction.provider,
        extractionDurationMs: extraction.durationMs,
        extractionMetrics: extraction.metrics,
        extractionWarnings: extraction.warnings,
        extractedAt: this.clock.now(),
        updatedAt: this.clock.now(),
        failureCode: null,
      }).where(and(
        eq(researchDocuments.workspaceId, payload.workspaceId),
        eq(researchDocuments.id, payload.documentId),
      ));
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
    } catch (error) {
      const failureCode = documentProcessingFailureCode(error);
      if (documentProcessingFailureDisposition(failureCode) === "terminal") {
        await this.db
          .update(researchDocuments)
          .set({ status: "failed", failureCode, updatedAt: this.clock.now() })
          .where(
            and(
              eq(researchDocuments.workspaceId, payload.workspaceId),
              eq(researchDocuments.id, payload.documentId),
            ),
          );
        await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
        return;
      }
      const outcome = await this.queue.retry({
        jobId: job.id,
        workerId: job.lockedBy,
        availableAt: new Date(this.clock.now().getTime() + 30_000 * job.attempts),
        errorCode: "RESEARCH_DOCUMENT_PROCESSING_FAILED",
        errorMessage: failureCode,
      });
      await this.db
        .update(researchDocuments)
        .set({
          status: outcome === "dead_lettered" ? "failed" : "uploaded",
          failureCode: "RESEARCH_DOCUMENT_PROCESSING_FAILED",
          updatedAt: this.clock.now(),
        })
        .where(
          and(
            eq(researchDocuments.workspaceId, payload.workspaceId),
            eq(researchDocuments.id, payload.documentId),
          ),
        );
    }
  }

  async #find(workspaceId: string, documentId: string) {
    const rows = await this.db
      .select()
      .from(researchDocuments)
      .where(
        and(
          eq(researchDocuments.workspaceId, workspaceId),
          eq(researchDocuments.id, documentId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async #hasActiveKnowledgeIndex(workspaceId: string, documentId: string): Promise<boolean> {
    const rows = await this.db.execute(sql`
      select 1
      from knowledge_documents kd
      join knowledge_chunk_sets kcs
        on kcs.workspace_id = kd.workspace_id
       and kcs.document_id = kd.id
       and kcs.status = 'active'
      where kd.workspace_id = ${workspaceId}
        and kd.source_type = 'research_document'
        and kd.source_id = ${documentId}
      limit 1
    `);
    return rows.length > 0;
  }
}

export function documentProcessingFailureDisposition(code: string): "terminal" | "retry" {
  return new Set([
    "DOCUMENT_FORMAT_UNSUPPORTED_BY_LIGHTWEIGHT_EXTRACTOR",
    "DOCUMENT_PDF_TOO_LARGE_FOR_LIGHTWEIGHT_EXTRACTOR",
    "DOCUMENT_OCR_REQUIRED",
    "DOCUMENT_ENCRYPTED_UNSUPPORTED",
    "DOCUMENT_CONTENT_LIMIT_EXCEEDED",
    "DOCUMENT_FORMAT_INVALID",
    "DOCUMENT_TEXT_EMPTY",
    "DOCUMENT_PDF_EXTRACTION_FAILED",
    "RESEARCH_DOCUMENT_CHECKSUM_MISMATCH",
    "RESEARCH_DOCUMENT_CONTENT_TYPE_MISMATCH",
    "RESEARCH_DOCUMENT_OBJECT_EMPTY",
  ]).has(code) ? "terminal" : "retry";
}

function documentProcessingFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /^[A-Z][A-Z0-9_]{2,159}$/.test(message)
    ? message
    : "RESEARCH_DOCUMENT_PROCESSING_FAILED";
}

function validateUpload(input: {
  filename: string;
  contentType: string;
  sizeBytes: number;
  checksumSha256: string;
}): void {
  if (!input.filename.trim() || input.filename.length > 500) throw new Error("INVALID_FILENAME");
  if (!allowedContentTypes.has(input.contentType)) throw new Error("UNSUPPORTED_DOCUMENT_TYPE");
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MAX_DOCUMENT_BYTES) {
    throw new Error("INVALID_DOCUMENT_SIZE");
  }
  if (!/^[a-f0-9]{64}$/i.test(input.checksumSha256)) throw new Error("INVALID_DOCUMENT_CHECKSUM");
}

function sanitizeFilename(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 200);
}

function documentJobPayload(value: unknown): { workspaceId: string; documentId: string } {
  if (!value || typeof value !== "object") throw new Error("INVALID_DOCUMENT_JOB");
  const workspaceId = "workspaceId" in value ? value.workspaceId : null;
  const documentId = "documentId" in value ? value.documentId : null;
  if (typeof workspaceId !== "string" || typeof documentId !== "string") {
    throw new Error("INVALID_DOCUMENT_JOB");
  }
  return { workspaceId, documentId };
}

export function documentChunksForExtraction(extraction: DocumentTextExtraction): { content: string; heading: string | null; locator: string }[] {
  if (extraction.status === "ocr_required") return [];
  const chunks: { content: string; heading: string | null; locator: string }[] = [];
  for (const section of extraction.sections) {
    for (let offset = 0; offset < section.content.length; offset += 3_000) {
      const content = section.content.slice(Math.max(0, offset - 300), offset + 3_500).trim();
      if (content.length >= 40) {
        chunks.push({ content, heading: section.title, locator: section.locator });
      }
    }
  }
  return chunks;
}

function sha256Bytes(value: Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(value);
  return hasher.digest("hex");
}

function matchesDeclaredContentType(contentType: string, value: Uint8Array): boolean {
  if (contentType === "application/pdf") {
    return new TextDecoder().decode(value.slice(0, 5)) === "%PDF-";
  }
  if (contentType.startsWith("application/vnd.openxmlformats-officedocument.")) {
    return value[0] === 0x50 && value[1] === 0x4b;
  }
  if (contentType === "text/plain" || contentType === "text/markdown" || contentType === "text/html") {
    return !value.slice(0, Math.min(value.length, 8_192)).includes(0);
  }
  return false;
}
