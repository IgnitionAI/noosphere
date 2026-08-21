import { ExternalLink, GitMerge, MessageCircleMore, Target } from "lucide-react";
import Link from "next/link";
import type { CalendarBooking, CalendarBookingAttributionTouch } from "@/lib/api";

export function BookingSourceAttribution({
  booking,
  workspaceSlug,
  compact = false,
}: {
  booking: CalendarBooking;
  workspaceSlug: string;
  compact?: boolean;
}) {
  const label = sourceLabel(booking.source);
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={sourceBadge(booking.source)}>
          {booking.source === "mixed" ? <GitMerge size={11} /> : booking.source === "inbound" ? <MessageCircleMore size={11} /> : <Target size={11} />}
          Source {label}
        </span>
        {booking.campaignId ? (
          <Link className="text-[11px] font-semibold text-brand-blue hover:underline" href={`/w/${workspaceSlug}/campaigns/${booking.campaignId}`}>
            {booking.campaignName ?? "Campagne Outbound"}
          </Link>
        ) : null}
      </div>
      {booking.attribution.touches.length ? (
        <details className="rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2 text-[11px]">
          <summary className="cursor-pointer font-semibold text-violet-900">
            Parcours social attribué · inférence, pas causalité
          </summary>
          <p className="mt-2 leading-5 text-violet-900/80">
            Même contact LinkedIn vérifié, puis appel réservé dans les 90 jours. Confiance {Math.round((booking.attribution.firstTouch?.confidence ?? 0) * 100)} %.
          </p>
          <div className={`mt-2 grid gap-2 ${compact ? "" : "sm:grid-cols-2"}`}>
            <Touch touch={booking.attribution.firstTouch} title="Premier signal" workspaceSlug={workspaceSlug} />
            {booking.attribution.lastTouch?.id !== booking.attribution.firstTouch?.id ? (
              <Touch touch={booking.attribution.lastTouch} title="Dernier signal" workspaceSlug={workspaceSlug} />
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

export function BookingSourceBadge({ source }: { source: CalendarBooking["source"] }) {
  return <span className={sourceBadge(source)}>Source {sourceLabel(source)}</span>;
}

function Touch({ touch, title, workspaceSlug }: { touch: CalendarBookingAttributionTouch | null; title: string; workspaceSlug: string }) {
  if (!touch) return null;
  return (
    <div className="rounded-md border border-violet-200 bg-white/80 p-2">
      <p className="font-semibold text-navy">{title} · {interactionLabel(touch.type)}</p>
      <p className="mt-1 text-muted">{touch.actorName ?? "Contact masqué"} · {formatDate(touch.occurredAt)}</p>
      {touch.body ? <p className="mt-1 line-clamp-2 leading-5 text-navy">« {touch.body} »</p> : null}
      <p className="mt-1 line-clamp-2 leading-5 text-muted">Post : {touch.postText}</p>
      <div className="mt-2 flex flex-wrap gap-3">
        <Link className="font-semibold text-brand-blue hover:underline" href={`/w/${workspaceSlug}${touch.proofHref}`}>
          Voir la preuve
        </Link>
        {touch.postUrl ? (
          <a className="inline-flex items-center gap-1 font-semibold text-brand-blue hover:underline" href={touch.postUrl} rel="noreferrer" target="_blank">
            Post LinkedIn <ExternalLink size={10} />
          </a>
        ) : null}
      </div>
    </div>
  );
}

function sourceLabel(source: CalendarBooking["source"]): string {
  return ({ inbound: "Inbound", outbound: "Outbound", mixed: "Mixte", unknown: "inconnue" } as const)[source];
}

function sourceBadge(source: CalendarBooking["source"]): string {
  if (source === "inbound") return "badge badge-signal";
  if (source === "mixed") return "badge badge-success";
  if (source === "outbound") return "badge";
  return "badge badge-warning";
}

function interactionLabel(type: CalendarBookingAttributionTouch["type"]): string {
  return ({ comment: "commentaire", reply: "réponse", mention: "mention" } as const)[type];
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(value));
}
