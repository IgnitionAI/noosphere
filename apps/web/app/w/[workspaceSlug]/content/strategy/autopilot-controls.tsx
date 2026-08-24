"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { configureAutopilotAction } from "./actions";

const days = [
  { value: 1, label: "L" },
  { value: 2, label: "M" },
  { value: 3, label: "M" },
  { value: 4, label: "J" },
  { value: 5, label: "V" },
  { value: 6, label: "S" },
  { value: 7, label: "D" },
] as const;

export function AutopilotControls({ workspaceSlug, enabled, localTime, timezone, publicationTimes, publicationDays }: { workspaceSlug: string; enabled: boolean; localTime: string; timezone: string; publicationTimes: readonly string[]; publicationDays: readonly number[] }) {
  const router = useRouter();
  const [time, setTime] = useState(localTime);
  const [zone, setZone] = useState(timezone);
  const [postTimes, setPostTimes] = useState(() => publicationTimes.length > 0 ? [...publicationTimes] : ["09:00"]);
  const [postDays, setPostDays] = useState(() => publicationDays.length > 0 ? [...publicationDays] : [1, 2, 3, 4, 5]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(nextEnabled = enabled) {
    setPending(true);
    setError(null);
    try {
      await configureAutopilotAction(workspaceSlug, { enabled: nextEnabled, localTime: time, timezone: zone, publicationTimes: postTimes, publicationDays: postDays });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "La configuration n’a pas pu être enregistrée");
    } finally {
      setPending(false);
    }
  }

  function setFrequency(frequency: 1 | 2) {
    if (frequency === 1) {
      setPostTimes((current) => [current[0] ?? "09:00"]);
      return;
    }
    setPostTimes((current) => current.length === 2 ? current : [current[0] ?? "09:00", current[0] === "17:00" ? "09:00" : "17:00"]);
  }

  function toggleDay(day: number) {
    setPostDays((current) => current.includes(day)
      ? current.length === 1 ? current : current.filter((value) => value !== day)
      : [...current, day].sort((left, right) => left - right));
  }

  function updatePostTime(index: number, value: string) {
    setPostTimes((current) => current.map((item, itemIndex) => itemIndex === index ? value : item));
  }

  return (
    <div className="mt-4 space-y-5">
      <fieldset>
        <legend className="text-sm font-semibold text-ink">Publications LinkedIn</legend>
        <p className="mt-1 text-xs leading-5 text-muted">Choisissez le rythme. Noosphere répartit les contenus prêts sur ces créneaux.</p>
        <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Nombre de publications par jour">
          {[1, 2].map((frequency) => <button aria-pressed={postTimes.length === frequency} className={`button min-h-11 ${postTimes.length === frequency ? "button-primary" : ""}`} disabled={pending} key={frequency} onClick={() => setFrequency(frequency as 1 | 2)} type="button">{frequency} / jour</button>)}
        </div>
        <div className={`mt-3 grid gap-2 ${postTimes.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
          {postTimes.map((postTime, index) => <label className="text-xs font-semibold text-muted" key={index}>Créneau {index + 1}<input className="input mt-1 w-full" disabled={pending} onChange={(event) => updatePostTime(index, event.target.value)} type="time" value={postTime} /></label>)}
        </div>
        <div className="mt-3">
          <span className="text-xs font-semibold text-muted">Jours de publication</span>
          <div className="mt-2 grid grid-cols-7 gap-1" role="group" aria-label="Jours de publication">
            {days.map((day) => <button aria-label={dayName(day.value)} aria-pressed={postDays.includes(day.value)} className={`min-h-11 rounded-lg border text-xs font-bold transition-colors ${postDays.includes(day.value) ? "border-navy bg-navy text-white" : "border-line bg-white text-muted hover:border-navy/30"}`} disabled={pending} key={day.value} onClick={() => toggleDay(day.value)} type="button">{day.label}</button>)}
          </div>
        </div>
        <p className="mt-3 text-xs font-semibold text-ink">{postTimes.length * postDays.length} publication{postTimes.length * postDays.length === 1 ? "" : "s"} maximum par semaine</p>
      </fieldset>

      <div className="border-t border-line pt-4">
        <p className="text-sm font-semibold text-ink">Recherche de sujets</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <label className="text-xs font-semibold text-muted">Radar quotidien<input className="input mt-1 w-full" disabled={pending} onChange={(event) => setTime(event.target.value)} type="time" value={time} /></label>
          <label className="text-xs font-semibold text-muted">Fuseau<input autoComplete="off" className="input mt-1 w-full" disabled={pending} onChange={(event) => setZone(event.target.value)} value={zone} /></label>
        </div>
      </div>
      {error ? <p className="text-xs font-semibold text-danger" role="alert">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button className={`button ${enabled ? "" : "button-primary"}`} disabled={pending} onClick={() => save(!enabled)} type="button">{pending ? "Enregistrement…" : enabled ? "Mettre en pause" : "Activer l’autopilote"}</button>
        <button className="button" disabled={pending} onClick={() => save()} type="button">Enregistrer les réglages</button>
      </div>
    </div>
  );
}

function dayName(day: number): string {
  return ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"][day] ?? "Jour";
}
