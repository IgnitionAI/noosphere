import { z, ZodError } from "zod";
import {
  validateSequenceSteps,
  type SequenceStepInput,
} from "@outbound/domain/campaigns/sequence-validation";
import type { Database } from "@outbound/infrastructure/database/client";
import { PostgresSequenceRepository } from "@outbound/infrastructure/campaigns/postgres-sequence-repository";
import {
  RequestAuthenticationError,
  WorkspaceAccessDeniedError,
  WorkspaceContextRequiredError,
  type RequestContextResolver,
} from "@outbound/interface/http/request-context";

const uuidSchema = z.string().uuid();
const requestContextSchema = z.object({
  userId: uuidSchema,
  workspaceId: uuidSchema,
  role: z.enum(["viewer", "operator", "reviewer", "admin", "owner"]),
});
const sequenceCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(300),
    description: z.string().trim().max(2_000).nullish(),
  })
  .strict();
const sequencePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(300).optional(),
    description: z.string().trim().max(2_000).nullish(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "At least one field must be provided",
  });
const stepKindSchema = z.enum([
  "linkedin_invite",
  "linkedin_message",
  "email",
  "whatsapp",
  "manual_task",
]);
const stepsReplaceSchema = z
  .object({
    steps: z
      .array(
        z
          .object({
            position: z.number().int().min(1).max(100),
            kind: stepKindSchema,
            delayDays: z.number().int().min(0).max(365).default(0),
            windowStart: z.string().max(5).nullish(),
            windowEnd: z.string().max(5).nullish(),
            subject: z.string().max(300).nullish(),
            body: z.string().max(10_000).default(""),
            fallbackKind: stepKindSchema.nullish(),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();

const sequencePath = /^\/api\/v1\/sequences\/([^/]+)$/;
const sequenceStepsPath = /^\/api\/v1\/sequences\/([^/]+)\/steps$/;
const sequenceVersionsPath = /^\/api\/v1\/sequences\/([^/]+)\/versions$/;
const sequencePublishPath = /^\/api\/v1\/sequences\/([^/]+)\/actions\/publish$/;

export interface SequenceHttpDependencies {
  readonly contextResolver: RequestContextResolver;
  readonly database: Database;
}

export function createSequenceHttpHandler(dependencies: SequenceHttpDependencies) {
  const repository = new PostgresSequenceRepository(dependencies.database);
  return async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const context = await resolveContext(dependencies.contextResolver, request);

      if (url.pathname === "/api/v1/sequences") {
        if (request.method === "GET") {
          requireViewer(context.role);
          const data = await repository.listSequences(context.workspaceId);
          return json({ data });
        }
        if (request.method === "POST") {
          requireOperator(context.role);
          const body = sequenceCreateSchema.parse(await request.json());
          const sequence = await repository.createSequence({
            id: crypto.randomUUID(),
            workspaceId: context.workspaceId,
            name: body.name,
            description: body.description ?? null,
            createdBy: context.userId,
          });
          return json(sequence, 201);
        }
      }

      const sequenceMatch = sequencePath.exec(url.pathname);
      if (sequenceMatch && request.method === "GET") {
        requireViewer(context.role);
        const detail = await repository.getSequence({
          workspaceId: context.workspaceId,
          sequenceId: uuidSchema.parse(sequenceMatch[1]),
        });
        if (!detail) return problem(404, "SEQUENCE_NOT_FOUND", "Sequence not found");
        return json(detail);
      }
      if (sequenceMatch && request.method === "PATCH") {
        requireOperator(context.role);
        const body = sequencePatchSchema.parse(await request.json());
        const updated = await repository.updateSequence({
          workspaceId: context.workspaceId,
          sequenceId: uuidSchema.parse(sequenceMatch[1]),
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
        });
        return json(updated);
      }

      const stepsMatch = sequenceStepsPath.exec(url.pathname);
      if (stepsMatch && request.method === "PUT") {
        requireOperator(context.role);
        const sequenceId = uuidSchema.parse(stepsMatch[1]);
        const body = stepsReplaceSchema.parse(await request.json());
        await repository.replaceSteps({
          workspaceId: context.workspaceId,
          sequenceId,
          steps: body.steps.map((step) => ({
            id: crypto.randomUUID(),
            position: step.position,
            kind: step.kind,
            delayDays: step.delayDays,
            windowStart: step.windowStart ?? null,
            windowEnd: step.windowEnd ?? null,
            subject: step.subject ?? null,
            body: step.body,
            fallbackKind: step.fallbackKind ?? null,
          })),
        });
        return new Response(null, { status: 204 });
      }

      const versionsMatch = sequenceVersionsPath.exec(url.pathname);
      if (versionsMatch && request.method === "GET") {
        requireViewer(context.role);
        const data = await repository.listVersions({
          workspaceId: context.workspaceId,
          sequenceId: uuidSchema.parse(versionsMatch[1]),
        });
        return json({ data });
      }

      const publishMatch = sequencePublishPath.exec(url.pathname);
      if (publishMatch && request.method === "POST") {
        requireAdmin(context.role);
        const sequenceId = uuidSchema.parse(publishMatch[1]);
        const detail = await repository.getSequence({
          workspaceId: context.workspaceId,
          sequenceId,
        });
        if (!detail) return problem(404, "SEQUENCE_NOT_FOUND", "Sequence not found");
        const errors = validateSequenceSteps(
          detail.steps.map(
            (step): SequenceStepInput => ({
              position: step.position,
              kind: step.kind,
              delayDays: step.delayDays,
              windowStart: step.windowStart,
              windowEnd: step.windowEnd,
              subject: step.subject,
              body: step.body,
              fallbackKind: step.fallbackKind,
            }),
          ),
        );
        if (detail.steps.length === 0) {
          return problem(422, "SEQUENCE_EMPTY", "A publishable sequence needs at least one step", {
            errors: [],
          });
        }
        if (errors.length) {
          return problem(422, "SEQUENCE_INVALID", "The sequence violates channel constraints", {
            errors,
          });
        }
        const version = await repository.publishVersion({
          id: crypto.randomUUID(),
          workspaceId: context.workspaceId,
          sequenceId,
          publishedBy: context.userId,
          publishedAt: new Date(),
        });
        return json(version, 201);
      }

      const allowed = allowedMethods(url.pathname);
      if (allowed) return methodNotAllowed(allowed);
      return problem(404, "ROUTE_NOT_FOUND", "Route not found");
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        return problem(400, "INVALID_REQUEST", "The request is invalid", {
          errors: error instanceof ZodError ? error.issues : undefined,
        });
      }
      if (error instanceof WorkspacePermissionError) {
        return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      }
      if (error instanceof RequestAuthenticationError) {
        return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      }
      if (error instanceof WorkspaceContextRequiredError) {
        return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      }
      if (error instanceof WorkspaceAccessDeniedError) {
        return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      }
      const message = error instanceof Error ? error.message : "";
      if (message === "SEQUENCE_NOT_FOUND") {
        return problem(404, message, "Sequence not found");
      }
      return problem(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
  };
}

class WorkspacePermissionError extends Error {}

function requireViewer(role: string): void {
  if (!["viewer", "operator", "reviewer", "admin", "owner"].includes(role)) {
    throw new WorkspacePermissionError("Workspace access is required");
  }
}

function requireOperator(role: string): void {
  if (!["operator", "admin", "owner"].includes(role)) {
    throw new WorkspacePermissionError("Operator access is required");
  }
}

function requireAdmin(role: string): void {
  if (!["admin", "owner"].includes(role)) {
    throw new WorkspacePermissionError("Admin access is required to publish a sequence version");
  }
}

async function resolveContext(resolver: RequestContextResolver, request: Request) {
  try {
    return requestContextSchema.parse(await resolver.resolve(request));
  } catch (error) {
    if (
      error instanceof RequestAuthenticationError ||
      error instanceof WorkspaceContextRequiredError ||
      error instanceof WorkspaceAccessDeniedError
    ) {
      throw error;
    }
    throw new RequestAuthenticationError("The authenticated request context is invalid");
  }
}

function allowedMethods(pathname: string): string | null {
  if (pathname === "/api/v1/sequences") return "GET, POST";
  if (sequencePath.test(pathname)) return "GET, PATCH";
  if (sequenceStepsPath.test(pathname)) return "PUT";
  if (sequenceVersionsPath.test(pathname)) return "GET";
  if (sequencePublishPath.test(pathname)) return "POST";
  return null;
}

function methodNotAllowed(allowed: string): Response {
  return problem(405, "METHOD_NOT_ALLOWED", "The HTTP method is not allowed for this route", {
    allowed,
  });
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function problem(
  status: number,
  code: string,
  detail: string,
  extensions: Readonly<Record<string, unknown>> = {},
): Response {
  return Response.json(
    {
      type: `https://ignition-outbound.local/problems/${code.toLowerCase()}`,
      title: code,
      status,
      detail,
      code,
      ...extensions,
    },
    {
      status,
      headers: { "content-type": "application/problem+json; charset=utf-8" },
    },
  );
}
