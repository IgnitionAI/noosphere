"use client";

import { CalendarDays, CheckCircle2, Play, Settings2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { configureAutopilotAction } from "../content/strategy/actions";

const dayLabels = new Map([
  [1, "lun."],
  [2, "mar."],
  [3, "mer."],
  [4, "jeu."],
  [5, "ven."],
  [6, "sam."],
  [7, "dim."],
]);

export function InboundAutopilotCard({
  enabled,
  localTime,
  nextPublicationAt,
  postsPerWeek,
  preferredDays,
  publicationTimes,
  scheduledPublications,
  timezone,
  workspaceSlug,
}: {
  readonly enabled: boolean;
  readonly localTime: string;
  readonly nextPublicationAt: string | null;
  readonly postsPerWeek: number;
  readonly preferredDays: readonly number[];
  readonly publicationTimes: readonly string[];
  readonly scheduledPublications: number;
  readonly timezone: string;
  readonly workspaceSlug: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cadence = cadenceLabel(postsPerWeek, preferredDays, publicationTimes);

  async function start() {
    setPending(true);
    setError(null);
    try {
      await configureAutopilotAction(workspaceSlug, { enabled: true, localTime, timezone, publicationTimes, publicationDays: preferredDays });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "L’Inbound n’a pas pu démarrer");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={`mt-4 rounded-2xl border p-5 ${enabled ? "border-lime-300 bg-lime-50" : "border-amber-300 bg-amber-50"}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <span className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${enabled ? "bg-success text-white" : "bg-amber-500 text-white"}`}>
            {enabled ? <CheckCircle2 size={18} /> : <Play size={17} />}
          </span>
          <div>
            <h2 className="font-semibold text-navy">{enabled ? "Inbound actif" : "Inbound en pause"}</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              {enabled
                ? `Noosphere cherche de nouvelles idées chaque matin à ${localTime}, puis publie ${cadence}.`
                : "Aucune nouvelle recherche et aucune publication automatique ne seront lancées."}
            </p>
            {enabled ? (
              <p className="mt-1 text-xs font-semibold text-navy">
                {nextPublicationAt
                  ? `Prochain post ${formatDate(nextPublicationAt, timezone)}`
                  : scheduledPublications > 0
                    ? `${scheduledPublications} publication${scheduledPublications === 1 ? "" : "s"} planifiée${scheduledPublications === 1 ? "" : "s"}`
                    : "Le prochain post sera planifié dès qu’un contenu aura passé l’audit."}
              </p>
            ) : null}
            {error ? <p className="mt-2 text-xs font-semibold text-danger">{error}</p> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {enabled ? (
            <Link className="button button-primary" href={`/w/${workspaceSlug}/content/calendar`}>
              <CalendarDays size={14} /> Voir les posts
            </Link>
          ) : (
            <button className="button button-primary" disabled={pending} onClick={start} type="button">
              <Play size={14} /> {pending ? "Démarrage…" : "Démarrer l’Inbound"}
            </button>
          )}
          <Link className="button" href={`/w/${workspaceSlug}/content/strategy`}>
            <Settings2 size={14} /> Régler
          </Link>
        </div>
      </div>
    </section>
  );
}

function cadenceLabel(postsPerWeek: number, preferredDays: readonly number[], publicationTimes: readonly string[]): string {
  if (publicationTimes.length === 2 && preferredDays.length === 7) return `deux fois par jour à ${publicationTimes.join(" et ")}`;
  if (publicationTimes.length === 1 && preferredDays.length === 7) return `chaque jour à ${publicationTimes[0]}`;
  const days = preferredDays.map((day) => dayLabels.get(day)).filter(Boolean).join(", ");
  return `${postsPerWeek} post${postsPerWeek === 1 ? "" : "s"} par semaine${days ? ` (${days})` : ""}`;
}

function formatDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(value));
}
