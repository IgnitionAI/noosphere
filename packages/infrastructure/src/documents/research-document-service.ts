import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { OpenAIEmbeddings } from "@langchain/openai";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";
import type { Clock, IdGenerator } from "@outbound/application/shared/ports";
import type { Database, SqlClient } from "@outbound/infrastructure/database/client";
import {
  researchDocumentChunks,
  researchDocuments,
} from "@outbound/infrastructure/database/schema";
import type { InternalDocumentSearch } from "@outbound/infrastructure/ai/research-tools";
import type { DocumentTextExtractor } from "@outbound/application/documents/document-text-extractor";
import { LightweightDocumentTextExtractor } from "@outbound/infrastructure/documents/lightweight-document-text-extractor";
import { DoclingDocumentTextExtractor } from "@outbound/infrastructure/documents/docling-document-text-extractor";

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
  readonly documentExtractor?: "lightweight" | "docling";
  readonly extractor?: DocumentTextExtractor;
  readonly doclingUrl?: string;
  readonly doclingApiKey?: string;
  readonly openAIApiKey?: string;
  readonly embeddingModel?: string;
}

export class ResearchDocumentService {
  readonly #s3: S3Client;
  readonly #embeddings: OpenAIEmbeddings | null;
  readonly #extractor: DocumentTextExtractor;

  constructor(
    private readonly db: Database,
    private readonly queue: JobQueue,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly options: ResearchDocumentServiceOptions,
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
    this.#embeddings =
      options.openAIApiKey && options.embeddingModel
        ? new OpenAIEmbeddings({
            apiKey: options.openAIApiKey,
            model: options.embeddingModel,
            dimensions: 1536,
          })
        : null;
    this.#extractor = options.extractor
      ?? (options.documentExtractor === "docling"
        ? new DoclingDocumentTextExtractor(options.doclingUrl ?? "", options.doclingApiKey)
        : new LightweightDocumentTextExtractor());
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
    const uploadUrl = await getSignedUrl(
      this.#s3,
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: document.objectKey,
        ContentType: document.contentType,
      }),
      { expiresIn: 15 * 60 },
    );
    return { document, uploadUrl, expiresInSeconds: 15 * 60 };
  }

  async completeUpload(input: {
    workspaceId: string;
    documentId: string;
    correlationId: string;
  }) {
    const document = await this.#find(input.workspaceId, input.documentId);
    if (!document) throw new Error("RESEARCH_DOCUMENT_NOT_FOUND");
    if (document.status === "ready" || document.status === "processing") return document;
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
    if (document.status === "ready") {
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
      const markdown = await this.#extractMarkdown(document.filename, document.contentType, bytes);
      const chunks = splitDocument(markdown);
      if (!this.#embeddings) throw new Error("DOCUMENT_EMBEDDINGS_NOT_CONFIGURED");
      const vectors = await this.#embeddings.embedDocuments(chunks.map((chunk) => chunk.content));
      await this.db.transaction(async (tx) => {
        await tx
          .delete(researchDocumentChunks)
          .where(
            and(
              eq(researchDocumentChunks.workspaceId, payload.workspaceId),
              eq(researchDocumentChunks.documentId, payload.documentId),
            ),
          );
        if (chunks.length) {
          await tx.insert(researchDocumentChunks).values(
            chunks.map((chunk, index) => ({
              id: this.ids.generate(),
              workspaceId: payload.workspaceId,
              documentId: payload.documentId,
              ordinal: index,
              content: chunk.content,
              contentHash: sha256(chunk.content),
              tokenCount: Math.ceil(chunk.content.length / 4),
              metadata: { heading: chunk.heading },
              embedding: vectors[index]!,
            })),
          );
        }
        await tx
          .update(researchDocuments)
          .set({
            status: "ready",
            extractedMarkdown: markdown,
            updatedAt: this.clock.now(),
            failureCode: null,
          })
          .where(
            and(
              eq(researchDocuments.workspaceId, payload.workspaceId),
              eq(researchDocuments.id, payload.documentId),
            ),
          );
      });
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
    } catch (error) {
      const outcome = await this.queue.retry({
        jobId: job.id,
        workerId: job.lockedBy,
        availableAt: new Date(this.clock.now().getTime() + 30_000 * job.attempts),
        errorCode: "RESEARCH_DOCUMENT_PROCESSING_FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
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

  async #extractMarkdown(filename: string, contentType: string, bytes: Uint8Array): Promise<string> {
    return (await this.#extractor.extract({ filename, contentType, bytes })).markdown;
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
}

export class ParadeDbInternalDocumentSearch implements InternalDocumentSearch {
  readonly #embeddings: OpenAIEmbeddings;

  constructor(
    private readonly sqlClient: SqlClient,
    openAIApiKey: string,
    embeddingModel: string,
  ) {
    this.#embeddings = new OpenAIEmbeddings({
      apiKey: openAIApiKey,
      model: embeddingModel,
      dimensions: 1536,
    });
  }

  async search(input: {
    workspaceId: string;
    documentIds: readonly string[];
    query: string;
    limit: number;
  }): Promise<readonly Record<string, unknown>[]> {
    if (!input.documentIds.length) return [];
    const embedding = await this.#embeddings.embedQuery(input.query);
    const ids = `{${input.documentIds.join(",")}}`;
    const vectorLiteral = `[${embedding.join(",")}]`;
    return this.sqlClient`
      with lexical as (
        select id, row_number() over (order by paradedb.score(id) desc) as rank
        from research_document_chunks
        where workspace_id = ${input.workspaceId}
          and document_id = any(${ids}::uuid[])
          and content @@@ ${input.query}
        limit ${input.limit * 3}
      ),
      semantic as (
        select id, row_number() over (order by embedding <=> ${vectorLiteral}::vector) as rank
        from research_document_chunks
        where workspace_id = ${input.workspaceId}
          and document_id = any(${ids}::uuid[])
        limit ${input.limit * 3}
      ),
      fused as (
        select coalesce(lexical.id, semantic.id) as id,
          coalesce(1.0 / (60 + lexical.rank), 0) +
          coalesce(1.0 / (60 + semantic.rank), 0) as score
        from lexical full join semantic on lexical.id = semantic.id
      )
      select c.id, c.document_id as "documentId", c.ordinal, c.content,
        c.metadata, fused.score
      from fused
      join research_document_chunks c on c.id = fused.id
      order by fused.score desc
      limit ${input.limit}
    ` as Promise<readonly Record<string, unknown>[]>;
  }

  async read(input: {
    workspaceId: string;
    documentIds: readonly string[];
    chunkId: string;
    contextWindow: number;
  }): Promise<Readonly<Record<string, unknown>> | null> {
    if (!input.documentIds.length) return null;
    const rows = await this.sqlClient<{
      documentId: string;
      ordinal: number;
    }[]>`
      select document_id as "documentId", ordinal
      from research_document_chunks
      where workspace_id = ${input.workspaceId}
        and id = ${input.chunkId}
        and document_id = any(${`{${input.documentIds.join(",")}}`}::uuid[])
      limit 1
    `;
    const match = rows[0];
    if (!match) return null;
    const chunks = await this.sqlClient`
      select id, document_id as "documentId", ordinal, content, metadata
      from research_document_chunks
      where workspace_id = ${input.workspaceId}
        and document_id = ${match.documentId}
        and ordinal between ${match.ordinal - input.contextWindow}
          and ${match.ordinal + input.contextWindow}
      order by ordinal
    `;
    return { documentId: match.documentId, chunks };
  }
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

function splitDocument(markdown: string): { content: string; heading: string | null }[] {
  const sections = markdown.split(/(?=^#{1,3}\s)/m);
  const chunks: { content: string; heading: string | null }[] = [];
  for (const section of sections) {
    const heading = section.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim() ?? null;
    for (let offset = 0; offset < section.length; offset += 3_000) {
      const content = section.slice(Math.max(0, offset - 300), offset + 3_500).trim();
      if (content.length >= 40) chunks.push({ content, heading });
    }
  }
  return chunks;
}

function sha256(value: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(value);
  return hasher.digest("hex");
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
