import { ZodError } from "zod";
import type { ContentBrandKitApplication } from "@outbound/application/content/content-brand-kit";
import { RetryableAgentError, TerminalAgentError } from "@outbound/application/gtm/product-research-ports";
import { contentBrandDirectionRequestSchema, contentBrandKitUpdateRequestSchema, contentBrandLogoImportRequestSchema } from "@outbound/contracts/content";
import type { RequestContextResolver } from "@outbound/interface/http/request-context";
import { RequestAuthenticationError, WorkspaceAccessDeniedError, WorkspaceContextRequiredError } from "@outbound/interface/http/request-context";

export function createContentBrandKitHttpHandler(input: {
  readonly application: ContentBrandKitApplication;
  readonly contextResolver: RequestContextResolver;
}) {
  return async function handle(request: Request): Promise<Response> {
    try {
      const context = await input.contextResolver.resolve(request);
      const pathname = new URL(request.url).pathname;
      if (pathname === "/api/v1/content/brand-kit/generate-direction" && request.method === "POST") {
        requireOperator(context.role);
        const body = contentBrandDirectionRequestSchema.parse(await request.json());
        return Response.json(await input.application.generateDirection({
          workspaceId: context.workspaceId,
          userId: context.userId,
          requestKey: body.requestKey,
          landingPageUrl: body.landingPageUrl,
          description: body.description,
          useLogo: body.useLogo,
        }));
      }
      if (pathname === "/api/v1/content/brand-kit/logo-import" && request.method === "POST") {
        requireOperator(context.role);
        const body = contentBrandLogoImportRequestSchema.parse(await request.json());
        const bytes = Uint8Array.from(Buffer.from(body.dataBase64, "base64"));
        if (bytes.byteLength < 1 || bytes.byteLength > 5 * 1024 * 1024) return problem(413, "CONTENT_BRAND_LOGO_SIZE_INVALID", "Le logo doit peser 5 Mo maximum");
        return Response.json(await input.application.importLogo({
          workspaceId: context.workspaceId,
          userId: context.userId,
          requestKey: body.requestKey,
          fileName: body.fileName,
          mimeType: body.mimeType,
          bytes,
        }));
      }
      if (request.method === "GET") {
        requireViewer(context.role);
        return Response.json(await input.application.get(context.workspaceId));
      }
      if (request.method === "PUT") {
        requireOperator(context.role);
        const body = contentBrandKitUpdateRequestSchema.parse(await request.json());
        return Response.json(await input.application.update({
          workspaceId: context.workspaceId,
          userId: context.userId,
          requestKey: body.requestKey,
          snapshot: body.brandKit,
        }));
      }
      return problem(405, "METHOD_NOT_ALLOWED", "The HTTP method is not allowed");
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) return problem(422, "VALIDATION_FAILED", "The request is invalid");
      if (error instanceof Error && ["CONTENT_BRAND_DIRECTION_UNAVAILABLE", "CONTENT_BRAND_LANDING_PAGE_UNAVAILABLE"].includes(error.message)) {
        return problem(503, error.message, "L’analyse intelligente de la marque est temporairement indisponible");
      }
      if (error instanceof RetryableAgentError) return problem(503, error.code, "La landing page n’a pas pu être lue pour le moment");
      if (error instanceof TerminalAgentError) return problem(422, error.code, "La landing page ne peut pas être utilisée");
      if (error instanceof Error && error.message === "CONTENT_BRAND_DIRECTION_OUTPUT_INVALID") {
        return problem(502, error.message, "L’agent n’a pas produit une direction visuelle exploitable");
      }
      if (error instanceof Error && error.message.startsWith("CONTENT_BRAND_")) return problem(422, error.message, "L’identité de marque n’a pas pu être enregistrée");
      if (error instanceof RequestAuthenticationError) return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      if (error instanceof WorkspaceContextRequiredError) return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      if (error instanceof WorkspaceAccessDeniedError || error instanceof PermissionError) return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      return problem(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
  };
}

class PermissionError extends Error {}
function requireViewer(role: string) { if (!["viewer", "operator", "reviewer", "admin", "owner"].includes(role)) throw new PermissionError("Workspace access is required"); }
function requireOperator(role: string) { if (!["operator", "admin", "owner"].includes(role)) throw new PermissionError("Operator access is required"); }
function problem(status: number, code: string, detail: string) { return Response.json({ type: `https://api.noosphere.local/problems/${code.toLowerCase()}`, title: code, status, detail, code }, { status, headers: { "content-type": "application/problem+json; charset=utf-8" } }); }
