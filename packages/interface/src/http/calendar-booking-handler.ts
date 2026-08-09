import { z } from "zod";
import type { PostgresCalendarIntegration } from "@outbound/infrastructure/calendar/postgres-calendar-integration";
import { CalendarIntegrationError } from "@outbound/infrastructure/calendar/postgres-calendar-integration";
import { CalcomApiError } from "@outbound/infrastructure/calendar/calcom-client";
import type { RequestContextResolver, WorkspaceRole } from "@outbound/interface/http/request-context";

const bookingActionPath = /^\/api\/v1\/calendar-bookings\/([^/]+)\/actions\/(reschedule|cancel|no-show)$/;
const mutationSchema = z.object({ requestKey: z.string().trim().min(1).max(500), reason: z.string().trim().min(3).max(1_000), start: z.iso.datetime().optional() }).strict();
const meetingTypesSchema = z.object({ providerEventTypeIds: z.array(z.number().int().positive()).min(1).max(50), defaultProviderEventTypeId: z.number().int().positive() }).strict();

type CalendarProductService = Pick<PostgresCalendarIntegration, "listBookings" | "listMeetingTypes" | "configureMeetingTypes" | "rescheduleById" | "cancelById" | "markNoShow">;

export function createCalendarBookingHttpHandler(input: { integration: CalendarProductService; contextResolver: RequestContextResolver }) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      const context = await input.contextResolver.resolve(request);
      if (url.pathname === "/api/v1/calendar-bookings") {
        if (request.method !== "GET") return methodNotAllowed("GET");
        requireReader(context.role);
        const bookings = await input.integration.listBookings({ workspaceId: context.workspaceId, ...(url.searchParams.get("contactId") ? { contactId: uuid(url.searchParams.get("contactId")!) } : {}), ...(url.searchParams.get("opportunityId") ? { opportunityId: uuid(url.searchParams.get("opportunityId")!) } : {}), limit: boundedLimit(url.searchParams.get("limit")) });
        return Response.json({ data: bookings.map((booking) => serializeBooking(booking, context.role)) });
      }
      if (url.pathname === "/api/v1/calendar-connection/meeting-types") {
        if (request.method === "GET") {
          requireReader(context.role);
          return Response.json({ data: await input.integration.listMeetingTypes(context.workspaceId) });
        }
        if (request.method !== "PUT") return methodNotAllowed("GET, PUT");
        requireAdmin(context.role);
        const body = meetingTypesSchema.parse(await request.json());
        return Response.json({ data: await input.integration.configureMeetingTypes({ workspaceId: context.workspaceId, actorUserId: context.userId, providerEventTypeIds: body.providerEventTypeIds, defaultProviderEventTypeId: body.defaultProviderEventTypeId, now: new Date() }) });
      }
      const action = bookingActionPath.exec(url.pathname);
      if (action) {
        if (request.method !== "POST") return methodNotAllowed("POST");
        requireMutator(context.role);
        const bookingId = uuid(action[1]!);
        const body = mutationSchema.parse(await request.json());
        if (action[2] === "reschedule") {
          if (!body.start) throw new CalendarIntegrationError("CALENDAR_SLOT_INVALID", 422);
          if (Date.parse(body.start) <= Date.now()) throw new CalendarIntegrationError("CALENDAR_SLOT_IN_PAST", 422);
          return Response.json(await input.integration.rescheduleById({ workspaceId: context.workspaceId, bookingId, start: body.start, reason: body.reason, requestKey: body.requestKey, actorUserId: context.userId, now: new Date() }));
        }
        if (action[2] === "cancel") return Response.json(await input.integration.cancelById({ workspaceId: context.workspaceId, bookingId, reason: body.reason, requestKey: body.requestKey, actorUserId: context.userId, now: new Date() }));
        return Response.json(serializeBooking(await input.integration.markNoShow({ workspaceId: context.workspaceId, bookingId, reason: body.reason, requestKey: body.requestKey, actorUserId: context.userId, now: new Date() }), context.role));
      }
      return problem(404, "ROUTE_NOT_FOUND", "Route not found");
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError) return problem(422, "VALIDATION_FAILED", "The request is invalid");
      if (error instanceof CalendarIntegrationError || error instanceof CalcomApiError) return problem(error.status, error.code, error.message);
      if (error instanceof CalendarPermissionError) return problem(403, "CALENDAR_FORBIDDEN", error.message);
      if (error instanceof Error && error.name === "RequestAuthenticationError") return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      if (error instanceof Error && error.name === "WorkspaceAccessDeniedError") return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      if (error instanceof Error && error.name === "WorkspaceContextRequiredError") return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      throw error;
    }
  };
}

function serializeBooking(booking: Awaited<ReturnType<PostgresCalendarIntegration["listBookings"]>>[number] | Awaited<ReturnType<PostgresCalendarIntegration["markNoShow"]>>, role: WorkspaceRole) {
  const redact = role === "viewer";
  return { ...booking, ...(redact ? { contactId: null, campaignId: null, opportunityId: null, attendeeName: null, attendeeEmail: null, attendeePhone: null, meetingUrl: null } : {}) };
}
class CalendarPermissionError extends Error {}
function requireReader(role: WorkspaceRole) { if (!(["owner", "admin", "operator", "reviewer", "viewer"] as WorkspaceRole[]).includes(role)) throw new CalendarPermissionError("Workspace access required"); }
function requireMutator(role: WorkspaceRole) { if (!(["owner", "admin", "operator"] as WorkspaceRole[]).includes(role)) throw new CalendarPermissionError("Calendar mutation is restricted"); }
function requireAdmin(role: WorkspaceRole) { if (role !== "owner" && role !== "admin") throw new CalendarPermissionError("Calendar configuration is restricted"); }
function uuid(value: string): string { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new CalendarIntegrationError("INVALID_ID", 422); return value; }
function boundedLimit(value: string | null): number { if (!value) return 100; const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 200) throw new CalendarIntegrationError("INVALID_LIMIT", 422); return parsed; }
function methodNotAllowed(allow: string) { const response = problem(405, "METHOD_NOT_ALLOWED", "Method not allowed"); response.headers.set("allow", allow); return response; }
function problem(status: number, code: string, detail: string) { return Response.json({ type: `https://ignition-outbound.local/problems/${code.toLowerCase()}`, title: code, status, detail, code }, { status, headers: { "content-type": "application/problem+json; charset=utf-8" } }); }
