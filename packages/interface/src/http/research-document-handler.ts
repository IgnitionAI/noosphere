import { ZodError, z } from "zod";
import type { RequestContextResolver } from "@outbound/interface/http/request-context";
import {
  RequestAuthenticationError,
  WorkspaceAccessDeniedError,
  WorkspaceContextRequiredError,
} from "@outbound/interface/http/request-context";

const documentPath = /^\/api\/v1\/research-documents\/([^/]+)$/;
const contentPath = /^\/api\/v1\/research-documents\/([^/]+)\/content$/;
const completePath = /^\/api\/v1\/research-documents\/([^/]+)\/complete$/;
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const uuidSchema = z.string().uuid();
const uploadIntentSchema = z
  .object({
    filename: z.string().trim().min(1).max(500),
    contentType: z.string().trim().min(1).max(200),
    sizeBytes: z.number().int().min(1).max(50 * 1024 * 1024),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  })
  .strict();

export interface ResearchDocumentHttpService {
  createUploadIntent(input: {
    workspaceId: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
    checksumSha256: string;
  }): Promise<{
    document: ResearchDocumentHttpView;
    uploadUrl: string;
    expiresInSeconds: number;
  }>;
  uploadContent(input: {
    workspaceId: string;
    documentId: string;
    contentType: string;
    bytes: Uint8Array;
  }): Promise<void>;
  completeUpload(input: {
    workspaceId: string;
    documentId: string;
    correlationId: string;
  }): Promise<ResearchDocumentHttpView>;
  list(workspaceId: string): Promise<readonly ResearchDocumentHttpView[]>;
  softDelete(workspaceId: string, documentId: string): Promise<void>;
}

interface ResearchDocumentHttpView {
  readonly id: string;
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly checksumSha256: string;
  readonly status: string;
  readonly failureCode: string | null;
  readonly extractionProvider?: string | null;
  readonly extractionDurationMs?: number | null;
  readonly extractionMetrics?: unknown;
  readonly extractionWarnings?: unknown;
  readonly extractedAt?: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function createResearchDocumentHttpHandler(input: {
  service: ResearchDocumentHttpService;
  contextResolver: RequestContextResolver;
}) {
  return async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const context = await input.contextResolver.resolve(request);
      if (request.method === "POST" && url.pathname === "/api/v1/research-documents/upload-intents") {
        requireOperator(context.role);
        const body = uploadIntentSchema.parse(await request.json());
        const result = await input.service.createUploadIntent({
          workspaceId: context.workspaceId,
          ...body,
        });
        return Response.json(
          {
            document: serialize(result.document),
            uploadUrl: result.uploadUrl,
            expiresInSeconds: result.expiresInSeconds,
          },
          { status: 201 },
        );
      }
      if (request.method === "GET" && url.pathname === "/api/v1/research-documents") {
        requireViewer(context.role);
        return Response.json({
          data: (await input.service.list(context.workspaceId)).map(serialize),
        });
      }
      const content = contentPath.exec(url.pathname);
      if (request.method === "PUT" && content) {
        requireOperator(context.role);
        const declaredLength = request.headers.get("content-length");
        if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_DOCUMENT_BYTES)) {
          return problem(413, "RESEARCH_DOCUMENT_TOO_LARGE", "The document exceeds the 50 MiB limit");
        }
        const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
        if (!contentType) return problem(400, "RESEARCH_DOCUMENT_CONTENT_TYPE_REQUIRED", "Content-Type is required");
        const bytes = await readBoundedBody(request, MAX_DOCUMENT_BYTES);
        await input.service.uploadContent({
          workspaceId: context.workspaceId,
          documentId: uuidSchema.parse(content[1]),
          contentType,
          bytes,
        });
        return new Response(null, { status: 204 });
      }
      const complete = completePath.exec(url.pathname);
      if (request.method === "POST" && complete) {
        requireOperator(context.role);
        const document = await input.service.completeUpload({
          workspaceId: context.workspaceId,
          documentId: uuidSchema.parse(complete[1]),
          correlationId: correlationId(request),
        });
        return Response.json(serialize(document), { status: 202 });
      }
      const document = documentPath.exec(url.pathname);
      if (request.method === "DELETE" && document) {
        requireOperator(context.role);
        await input.service.softDelete(context.workspaceId, uuidSchema.parse(document[1]));
        return new Response(null, { status: 204 });
      }
      return problem(404, "ROUTE_NOT_FOUND", "Route not found");
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        return problem(400, "INVALID_REQUEST", "The request is invalid");
      }
      if (error instanceof RequestAuthenticationError) {
        return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      }
      if (error instanceof WorkspaceContextRequiredError) {
        return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      }
      if (error instanceof WorkspaceAccessDeniedError || error instanceof WorkspacePermissionError) {
        return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      }
      const message = error instanceof Error ? error.message : "INTERNAL_ERROR";
      if (message === "RESEARCH_DOCUMENT_NOT_FOUND") {
        return problem(404, message, "Document not found");
      }
      if (
        message.startsWith("INVALID_") ||
        message === "UNSUPPORTED_DOCUMENT_TYPE" ||
        message === "RESEARCH_DOCUMENT_SIZE_MISMATCH"
        || message === "RESEARCH_DOCUMENT_CHECKSUM_MISMATCH"
        || message === "RESEARCH_DOCUMENT_CONTENT_TYPE_MISMATCH"
      ) {
        return problem(400, message, "The document upload is invalid");
      }
      if (message === "RESEARCH_DOCUMENT_UPLOAD_ALREADY_COMPLETED") {
        return problem(409, message, "The document upload is already complete");
      }
      if (message === "RESEARCH_DOCUMENT_TOO_LARGE") {
        return problem(413, message, "The document exceeds the 50 MiB limit");
      }
      return problem(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
  };
}

async function readBoundedBody(request: Request, maximumBytes: number): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) throw new Error("RESEARCH_DOCUMENT_TOO_LARGE");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

class WorkspacePermissionError extends Error {}

function requireOperator(role: string): void {
  if (!["operator", "admin", "owner"].includes(role)) {
    throw new WorkspacePermissionError("Operator access is required");
  }
}

function requireViewer(role: string): void {
  if (!["viewer", "operator", "reviewer", "admin", "owner"].includes(role)) {
    throw new WorkspacePermissionError("Workspace access is required");
  }
}

function serialize(document: ResearchDocumentHttpView) {
  return {
    id: document.id,
    filename: document.filename,
    contentType: document.contentType,
    sizeBytes: document.sizeBytes,
    checksumSha256: document.checksumSha256,
    status: document.status,
    failureCode: document.failureCode,
    extractionProvider: document.extractionProvider ?? null,
    extractionDurationMs: document.extractionDurationMs ?? null,
    extractionMetrics: document.extractionMetrics ?? {},
    extractionWarnings: document.extractionWarnings ?? [],
    extractedAt: document.extractedAt?.toISOString() ?? null,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

function correlationId(request: Request): string {
  const supplied = request.headers.get("x-correlation-id")?.trim();
  return supplied && supplied.length <= 200 ? supplied : crypto.randomUUID();
}

function problem(status: number, code: string, detail: string): Response {
  return Response.json(
    {
      type: `https://ignition-outbound.local/problems/${code.toLowerCase()}`,
      title: code,
      status,
      detail,
      code,
    },
    {
      status,
      headers: { "content-type": "application/problem+json; charset=utf-8" },
    },
  );
}
