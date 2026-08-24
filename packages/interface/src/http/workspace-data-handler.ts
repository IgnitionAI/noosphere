import { z } from "zod";
import type { Clock } from "@outbound/application/shared/ports";
import type { WorkspaceDataPolicy, WorkspaceRetentionPolicy } from "@outbound/domain/workspaces/workspace-data-policy";
import { WorkspaceDataLifecycleError } from "@outbound/infrastructure/workspaces/postgres-workspace-data-lifecycle";
import type { RequestContextResolver, WorkspaceRole } from "@outbound/interface/http/request-context";

const workspaceProfilePath = /^\/api\/v1\/workspaces\/([^/]+)$/;
const workspaceSettingPath = /^\/api\/v1\/workspaces\/([^/]+)\/(sending-preferences|channel-limits|retention-policy)$/;
const workspaceExportPath = /^\/api\/v1\/workspaces\/([^/]+)\/actions\/export$/;
const exportPath = /^\/api\/v1\/exports\/([^/]+)$/;
const exportDownloadPath = /^\/api\/v1\/exports\/([^/]+)\/download$/;
const anonymizePath = /^\/api\/v1\/contacts\/([^/]+)\/actions\/anonymize$/;

const profileSchema = z.object({ name: z.string().trim().min(1).max(200) }).strict();
const sendingSchema = z.object({
  sending: z.object({
    timezone: z.string().trim().min(1).max(120),
    activeDays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    windowStart: z.string(),
    windowEnd: z.string(),
  }).strict(),
}).strict();
const limitsSchema = z.object({ channelLimits: z.object({ linkedin: z.number().int(), email: z.number().int(), whatsapp: z.number().int() }).strict() }).strict();
const retentionSchema = z.object({ retention: z.object({
  invitationsDays: z.number().int(),
  jobsDays: z.number().int(),
  auditDays: z.number().int(),
  memoryEventsDays: z.number().int(),
  memorySnapshotsDays: z.number().int(),
  memoryReceiptsDays: z.number().int(),
}).strict(), confirmation: z.string().max(100).default("") }).strict();
const exportSchema = z.object({ requestKey: z.string().trim().min(1).max(200) }).strict();
const anonymizeSchema = z.object({ confirmation: z.string().max(100) }).strict();

export interface WorkspaceDataLifecycleService {
  getProfile(workspaceId: string): Promise<unknown>;
  updateProfile(input: { workspaceId: string; actorUserId: string; name: string }): Promise<unknown>;
  getPolicy(workspaceId: string): Promise<WorkspaceDataPolicy>;
  updateSendingPreferences(input: { workspaceId: string; actorUserId: string; sending: WorkspaceDataPolicy["sending"] }): Promise<unknown>;
  updateChannelLimits(input: { workspaceId: string; actorUserId: string; channelLimits: WorkspaceDataPolicy["channelLimits"] }): Promise<unknown>;
  updateRetentionPolicy(input: { workspaceId: string; actorUserId: string; retention: WorkspaceRetentionPolicy; confirmation: string }): Promise<unknown>;
  requestExport(input: { workspaceId: string; actorUserId: string; requestKey: string }): Promise<unknown>;
  getExport(workspaceId: string, exportId: string): Promise<null | { id: string; workspaceId: string; status: string; objectKey?: string | null; expiresAt?: Date | string | null; [key: string]: unknown }>;
  anonymizeContact(input: { workspaceId: string; contactId: string; actorUserId: string; confirmation: string }): Promise<unknown>;
  listAuditLogs(input: { workspaceId: string; actorUserId?: string; action?: string; from?: Date; to?: Date; limit: number }): Promise<unknown>;
}

export interface WorkspaceExportDownloads {
  get(input: { objectKey: string }): Promise<{
    body: ReadableStream<Uint8Array>;
    contentLength: number | null;
  }>;
}

export function createWorkspaceDataHttpHandler(dependencies: {
  readonly contextResolver: RequestContextResolver;
  readonly service: WorkspaceDataLifecycleService;
  readonly clock: Clock;
  readonly downloads: WorkspaceExportDownloads;
}) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    try {
      const context = await dependencies.contextResolver.resolve(request);
      const profile = workspaceProfilePath.exec(pathname);
      if (profile) {
        assertWorkspace(context.workspaceId, uuid(profile[1]));
        if (request.method !== "PATCH") return methodNotAllowed("PATCH");
        requireAdmin(context.role);
        const body = profileSchema.parse(await request.json());
        return Response.json(await dependencies.service.updateProfile({ workspaceId: context.workspaceId, actorUserId: context.userId, name: body.name }));
      }
      const setting = workspaceSettingPath.exec(pathname);
      if (setting) {
        assertWorkspace(context.workspaceId, uuid(setting[1]));
        const section = setting[2]!;
        if (request.method === "GET") {
          if (section === "retention-policy") requireAdmin(context.role);
          else requireOperationalReader(context.role);
          const policy = await dependencies.service.getPolicy(context.workspaceId);
          return Response.json(section === "sending-preferences" ? { sending: policy.sending } : section === "channel-limits" ? { channelLimits: policy.channelLimits } : { retention: policy.retention });
        }
        if (request.method !== "PUT") return methodNotAllowed("GET, PUT");
        requireAdmin(context.role);
        if (section === "sending-preferences") {
          const body = sendingSchema.parse(await request.json());
          return Response.json({ sending: await dependencies.service.updateSendingPreferences({ workspaceId: context.workspaceId, actorUserId: context.userId, sending: body.sending }) });
        }
        if (section === "channel-limits") {
          const body = limitsSchema.parse(await request.json());
          return Response.json({ channelLimits: await dependencies.service.updateChannelLimits({ workspaceId: context.workspaceId, actorUserId: context.userId, channelLimits: body.channelLimits }) });
        }
        const body = retentionSchema.parse(await request.json());
        return Response.json({ retention: await dependencies.service.updateRetentionPolicy({ workspaceId: context.workspaceId, actorUserId: context.userId, retention: body.retention, confirmation: body.confirmation }) });
      }
      const exportRequest = workspaceExportPath.exec(pathname);
      if (exportRequest) {
        assertWorkspace(context.workspaceId, uuid(exportRequest[1]));
        if (request.method !== "POST") return methodNotAllowed("POST");
        requireAdmin(context.role);
        const body = exportSchema.parse(await request.json());
        return Response.json(await dependencies.service.requestExport({ workspaceId: context.workspaceId, actorUserId: context.userId, requestKey: body.requestKey }), { status: 202 });
      }
      const exportMatch = exportPath.exec(pathname);
      if (exportMatch) {
        if (request.method !== "GET") return methodNotAllowed("GET");
        requireAdmin(context.role);
        const result = await dependencies.service.getExport(context.workspaceId, uuid(exportMatch[1]));
        if (!result) return problem(404, "WORKSPACE_EXPORT_NOT_FOUND", "Workspace export not found");
        const expiresAt = result.expiresAt ? new Date(result.expiresAt) : null;
        if (expiresAt && expiresAt <= dependencies.clock.now()) return problem(410, "WORKSPACE_EXPORT_EXPIRED", "Workspace export link expired");
        const downloadUrl = result.status === "completed" && result.objectKey && expiresAt
          ? `/api/v1/exports/${result.id}/download`
          : null;
        const { objectKey: _objectKey, ...safe } = result;
        return Response.json({ ...safe, downloadUrl });
      }
      const exportDownload = exportDownloadPath.exec(pathname);
      if (exportDownload) {
        if (request.method !== "GET") return methodNotAllowed("GET");
        requireAdmin(context.role);
        const result = await dependencies.service.getExport(context.workspaceId, uuid(exportDownload[1]));
        if (!result) return problem(404, "WORKSPACE_EXPORT_NOT_FOUND", "Workspace export not found");
        const expiresAt = result.expiresAt ? new Date(result.expiresAt) : null;
        if (!expiresAt || expiresAt <= dependencies.clock.now()) {
          return problem(410, "WORKSPACE_EXPORT_EXPIRED", "Workspace export link expired");
        }
        if (result.status !== "completed" || !result.objectKey) {
          return problem(409, "WORKSPACE_EXPORT_NOT_READY", "Workspace export is not ready");
        }
        const archive = await dependencies.downloads.get({ objectKey: result.objectKey });
        const headers = new Headers({
          "cache-control": "private, no-store",
          "content-disposition": `attachment; filename="noosphere-export-${result.id}.json.gz"`,
          "content-type": "application/gzip",
          "x-content-type-options": "nosniff",
        });
        if (archive.contentLength !== null) headers.set("content-length", String(archive.contentLength));
        return new Response(archive.body, { status: 200, headers });
      }
      const anonymize = anonymizePath.exec(pathname);
      if (anonymize) {
        if (request.method !== "POST") return methodNotAllowed("POST");
        requireAdmin(context.role);
        const body = anonymizeSchema.parse(await request.json());
        return Response.json(await dependencies.service.anonymizeContact({ workspaceId: context.workspaceId, contactId: uuid(anonymize[1]), actorUserId: context.userId, confirmation: body.confirmation }));
      }
      if (pathname === "/api/v1/audit-logs") {
        if (request.method !== "GET") return methodNotAllowed("GET");
        requireAdmin(context.role);
        return Response.json(await dependencies.service.listAuditLogs({
          workspaceId: context.workspaceId,
          ...(url.searchParams.get("actorUserId") ? { actorUserId: uuid(url.searchParams.get("actorUserId")) } : {}),
          ...(url.searchParams.get("action") ? { action: url.searchParams.get("action")!.slice(0, 160) } : {}),
          ...(dateParam(url, "from") ? { from: dateParam(url, "from")! } : {}),
          ...(dateParam(url, "to") ? { to: dateParam(url, "to")! } : {}),
          limit: boundedInteger(url.searchParams.get("limit"), 50, 1, 100),
        }));
      }
      return problem(404, "ROUTE_NOT_FOUND", "Route not found");
    } catch (error) {
      if (error instanceof WorkspaceDataLifecycleError) return problem(error.status, error.code, error.message);
      if (error instanceof z.ZodError || error instanceof SyntaxError) return problem(422, "VALIDATION_FAILED", error instanceof Error ? error.message : "Invalid request");
      if (error instanceof Error && error.name === "RequestAuthenticationError") return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      if (error instanceof Error && error.name === "WorkspaceAccessDeniedError") return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      if (error instanceof Error && error.name === "WorkspaceContextRequiredError") return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      throw error;
    }
  };
}

function requireAdmin(role: WorkspaceRole) {
  if (role !== "owner" && role !== "admin") throw new WorkspaceDataLifecycleError("WORKSPACE_SETTINGS_FORBIDDEN", 403);
}

function requireOperationalReader(role: WorkspaceRole) {
  if (!["owner", "admin", "operator", "reviewer"].includes(role)) throw new WorkspaceDataLifecycleError("WORKSPACE_SETTINGS_FORBIDDEN", 403);
}

function assertWorkspace(actual: string, requested: string) {
  if (actual !== requested) throw new WorkspaceDataLifecycleError("WORKSPACE_FORBIDDEN", 403);
}

function uuid(value: string | null | undefined): string {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new WorkspaceDataLifecycleError("INVALID_ID", 422);
  return value;
}

function dateParam(url: URL, name: string): Date | null {
  const value = url.searchParams.get(name);
  if (!value) return null;
  const date = name === "to" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T23:59:59.999Z`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) throw new WorkspaceDataLifecycleError("INVALID_DATE", 422);
  return date;
}

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new WorkspaceDataLifecycleError("INVALID_LIMIT", 422);
  return parsed;
}

function methodNotAllowed(allow: string) {
  const response = problem(405, "METHOD_NOT_ALLOWED", "The HTTP method is not allowed for this route");
  response.headers.set("allow", allow);
  return response;
}

function problem(status: number, code: string, detail: string) {
  return Response.json({ type: `https://ignition-outbound.local/problems/${code.toLowerCase()}`, title: code, status, detail, code }, { status, headers: { "content-type": "application/problem+json; charset=utf-8" } });
}
