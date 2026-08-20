import { CalendarCheck2, CalendarClock, ExternalLink, Settings2, Target, UserRound, Video } from "lucide-react";
import Link from "next/link";
import { CrmPermissionState } from "@/components/crm-states";
import { getCalendarConnection, listCalendarBookings, OutboundApiError, type CalendarBooking } from "@/lib/api";

export const metadata = { title: "Appels" };
export const dynamic = "force-dynamic";

type View = "upcoming" | "past" | "all";

export default async function AppointmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  const view: View = query.view === "past" || query.view === "all" ? query.view : "upcoming";
  let bookings: readonly CalendarBooking[];
  let connection: Awaited<ReturnType<typeof getCalendarConnection>>;
  try {
    [bookings, connection] = await Promise.all([
      listCalendarBookings(workspaceSlug, { limit: 200 }),
      getCalendarConnection(workspaceSlug),
    ]);
  } catch (error) {
    if (error instanceof OutboundApiError && (error.status === 401 || error.status === 403)) return <CrmPermissionState resource="les rendez-vous" />;
    throw error;
  }

  const now = Date.now();
  const isUpcoming = (booking: CalendarBooking) => Date.parse(booking.startAt) >= now && !["cancelled", "completed", "no_show"].includes(booking.status);
  const upcoming = bookings.filter(isUpcoming).sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  const past = bookings.filter((booking) => !isUpcoming(booking)).sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt));
  const visible = view === "upcoming" ? upcoming : view === "past" ? past : [...upcoming, ...past];
  const next = upcoming[0] ?? null;

  return (
    <>
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="badge badge-signal w-fit"><CalendarCheck2 size={13} /> Résultat commercial</div>
          <h1 className="page-title mt-3">Appels</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">Les appels réservés par le Setter apparaissent ici automatiquement. Vous n’avez plus qu’à les prendre.</p>
        </div>
        <Link className="button" href={`/w/${workspaceSlug}/settings/calendar`}><Settings2 size={14} /> Agenda</Link>
      </header>

      {!connection.connected ? (
        <section className="mb-5 flex flex-col gap-4 rounded-xl border border-amber-200 bg-amber-50 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="font-semibold text-navy">Connectez votre agenda</h2><p className="mt-1 text-sm text-amber-900">Le Setter pourra alors proposer des créneaux réels et réserver les appels sans intervention.</p></div>
          <Link className="button button-primary shrink-0" href={`/w/${workspaceSlug}/settings/calendar`}>Configurer</Link>
        </section>
      ) : null}

      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="À venir" value={upcoming.length} />
        <Metric label="Cette semaine" value={upcoming.filter((booking) => Date.parse(booking.startAt) <= now + 7 * 86_400_000).length} tone="signal" />
        <Metric label="Attribués à l’Outbound" value={bookings.filter((booking) => booking.campaignId).length} />
        <Metric label="Terminés" value={bookings.filter((booking) => booking.status === "completed").length} />
      </section>

      {next ? (
        <section className="mb-5 rounded-xl border border-lime-300 bg-lime-50/60 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-navy text-signal"><CalendarClock size={18} /></span>
              <div><p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Prochain appel</p><h2 className="mt-1 font-semibold text-navy">{displayName(next)}</h2><p className="mt-1 text-sm text-muted">{formatDate(next.startAt)} · {duration(next)}</p><BookingOrigin booking={next} workspaceSlug={workspaceSlug} /></div>
            </div>
            {next.meetingUrl ? <a className="button button-signal shrink-0" href={next.meetingUrl} rel="noreferrer" target="_blank"><Video size={15} /> Rejoindre l’appel</a> : null}
          </div>
        </section>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ViewLink active={view === "upcoming"} href={`/w/${workspaceSlug}/appointments?view=upcoming`} label={`À venir · ${upcoming.length}`} />
        <ViewLink active={view === "past"} href={`/w/${workspaceSlug}/appointments?view=past`} label={`Historique · ${past.length}`} />
        <ViewLink active={view === "all"} href={`/w/${workspaceSlug}/appointments?view=all`} label="Tous" />
      </div>

      {visible.length ? (
        <section className="panel overflow-hidden">
          <div className="divide-y divide-line">
            {visible.map((booking) => (
              <article className="grid gap-4 p-5 md:grid-cols-[160px_minmax(0,1fr)_170px_auto] md:items-center" key={booking.id}>
                <div><p className="text-sm font-semibold text-navy">{formatDay(booking.startAt)}</p><p className="mt-1 text-xs text-muted">{formatTime(booking.startAt)} · {duration(booking)}</p></div>
                <div className="flex min-w-0 items-center gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-navy"><UserRound size={15} /></span><div className="min-w-0"><h2 className="truncate text-sm font-semibold">{booking.contactId ? <Link className="hover:text-brand-blue" href={`/w/${workspaceSlug}/prospects/${booking.contactId}`}>{displayName(booking)}</Link> : displayName(booking)}</h2><p className="mt-1 truncate text-xs text-muted">{booking.attendeeEmail ?? booking.attendeePhone ?? booking.meetingType?.title ?? "Prospect qualifié"}</p><BookingOrigin booking={booking} workspaceSlug={workspaceSlug} /></div></div>
                <div><span className={statusBadge(booking.status)}>{statusLabel(booking.status)}</span>{booking.opportunityStage ? <p className="mt-1 text-[11px] text-muted">Pipeline · {opportunityLabel(booking.opportunityStage)}</p> : null}{booking.rescheduleCount ? <p className="mt-1 text-[11px] text-muted">Replanifié {booking.rescheduleCount} fois</p> : null}<p className="mt-1 text-[11px] text-muted">{booking.attendeeTimeZone} → {booking.organizerTimeZone}</p></div>
                <div className="flex justify-end gap-2">
                  {booking.opportunityId ? <Link className="button h-9 px-3" href={`/w/${workspaceSlug}/pipeline?opportunity=${booking.opportunityId}`}>Suivi</Link> : null}
                  {booking.meetingUrl && isUpcoming(booking) ? <a aria-label="Rejoindre l’appel" className="button button-primary h-9 px-3" href={booking.meetingUrl} rel="noreferrer" target="_blank"><ExternalLink size={14} /></a> : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : (
        <section className="panel py-16 text-center">
          <CalendarCheck2 className="mx-auto text-muted" size={30} />
          <h2 className="mt-4 font-semibold">{view === "upcoming" ? "Aucun appel à venir pour le moment" : "Aucun rendez-vous dans cet historique"}</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">Lancez un ICP : les campagnes cherchent, contactent et qualifient les prospects jusqu’à la réservation.</p>
          <Link className="button button-primary mt-5" href={`/w/${workspaceSlug}/campaigns`}>Voir la prospection</Link>
        </section>
      )}
    </>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "signal" }) {
  return <div className={`panel p-4 ${tone === "signal" ? "border-lime-300" : ""}`}><p className="text-xs text-muted">{label}</p><strong className="mt-2 block text-2xl text-navy">{value}</strong></div>;
}

function ViewLink({ active, href, label }: { active: boolean; href: string; label: string }) {
  return <Link aria-current={active ? "page" : undefined} className={active ? "button button-primary" : "button"} href={href}>{label}</Link>;
}

function BookingOrigin({ booking, workspaceSlug }: { booking: CalendarBooking; workspaceSlug: string }) {
  if (!booking.campaignId) return <span className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted"><Target size={11} /> Origine inconnue</span>;
  return <Link className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-blue hover:underline" href={`/w/${workspaceSlug}/campaigns/${booking.campaignId}`}><Target size={11} /> Outbound · {booking.campaignName ?? "Campagne"}</Link>;
}

function displayName(booking: CalendarBooking): string { return booking.contactName?.trim() || booking.attendeeName?.trim() || booking.attendeeEmail || booking.attendeePhone || "Prospect"; }
function duration(booking: CalendarBooking): string { if (booking.meetingType) return `${booking.meetingType.lengthMinutes} min`; if (!booking.endAt) return "durée à confirmer"; return `${Math.max(1, Math.round((Date.parse(booking.endAt) - Date.parse(booking.startAt)) / 60_000))} min`; }
function formatDate(value: string): string { return new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(value)); }
function formatDay(value: string): string { return new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "2-digit", month: "short", timeZone: "Europe/Paris" }).format(new Date(value)); }
function formatTime(value: string): string { return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(new Date(value)); }
function statusLabel(status: string): string { return ({ requested: "Demandé", booked: "Confirmé", scheduled: "Confirmé", rescheduled: "Replanifié", completed: "Terminé", cancelled: "Annulé", no_show: "Absent" } as Record<string, string>)[status] ?? status; }
function statusBadge(status: string): string { if (["requested", "booked", "scheduled", "rescheduled"].includes(status)) return "badge badge-success"; if (["cancelled", "no_show"].includes(status)) return "badge badge-warning"; return "badge"; }
function opportunityLabel(stage: string): string { return ({ qualified: "Qualifié", meeting_requested: "Appel demandé", meeting_booked: "Appel réservé", meeting_completed: "Appel terminé", meeting_no_show: "À replanifier", won: "Gagné", lost: "Perdu" } as Record<string, string>)[stage] ?? stage; }
