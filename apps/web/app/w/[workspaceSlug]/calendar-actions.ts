"use server";

import { revalidatePath } from "next/cache";
import { cancelCalendarBooking, markCalendarBookingNoShow, OutboundApiError, rescheduleCalendarBooking } from "@/lib/api";

export async function rescheduleCalendarBookingAction(workspaceSlug: string, bookingId: string, formData: FormData) {
  const timeZone = value(formData, "timeZone") || "Europe/Paris";
  const start = zonedLocalToIso(value(formData, "startLocal"), timeZone);
  try { await rescheduleCalendarBooking(workspaceSlug, bookingId, { start, reason: requiredReason(formData), requestKey: requestKey(formData, "reschedule") }); }
  catch (error) { throw new Error(calendarError(error)); }
  refresh(workspaceSlug);
}

export async function cancelCalendarBookingAction(workspaceSlug: string, bookingId: string, formData: FormData) {
  try { await cancelCalendarBooking(workspaceSlug, bookingId, { reason: requiredReason(formData), requestKey: requestKey(formData, "cancel") }); }
  catch (error) { throw new Error(calendarError(error)); }
  refresh(workspaceSlug);
}

export async function markCalendarBookingNoShowAction(workspaceSlug: string, bookingId: string, formData: FormData) {
  try { await markCalendarBookingNoShow(workspaceSlug, bookingId, { reason: requiredReason(formData), requestKey: requestKey(formData, "no-show") }); }
  catch (error) { throw new Error(calendarError(error)); }
  refresh(workspaceSlug);
}

function refresh(workspaceSlug: string) {
  revalidatePath(`/w/${workspaceSlug}/prospects`);
  revalidatePath(`/w/${workspaceSlug}/pipeline`);
}
function value(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }
function requiredReason(formData: FormData) { const reason = value(formData, "reason"); if (reason.length < 3) throw new Error("Indiquez un motif d’au moins 3 caractères."); return reason; }
function requestKey(formData: FormData, action: string) { return value(formData, "requestKey") || `${action}:${crypto.randomUUID()}`; }
function zonedLocalToIso(local: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) throw new Error("Le nouveau créneau est invalide.");
  const desired = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  let guess = desired;
  for (let index = 0; index < 2; index += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((candidate) => candidate.type === type)?.value ?? 0);
    const represented = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"));
    guess += desired - represented;
  }
  const result = new Date(guess);
  if (!Number.isFinite(result.getTime())) throw new Error("Le fuseau horaire est invalide.");
  return result.toISOString();
}
function calendarError(error: unknown) { if (!(error instanceof OutboundApiError)) return error instanceof Error ? error.message : "L’action agenda a échoué."; return `${error.code}: ${error.status === 409 ? "Le rendez-vous a déjà changé. Actualisez la fiche." : error.status === 422 ? "Vérifiez le créneau, le fuseau et le motif." : error.message}`; }
