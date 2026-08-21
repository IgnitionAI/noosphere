"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { configureAutopilotAction } from "./actions";

export function AutopilotControls({ workspaceSlug, enabled, localTime, timezone }: { workspaceSlug: string; enabled: boolean; localTime: string; timezone: string }) {
  const router = useRouter();
  const [time, setTime] = useState(localTime);
  const [zone, setZone] = useState(timezone);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(nextEnabled = enabled) {
    setPending(true);
    setError(null);
    try {
      await configureAutopilotAction(workspaceSlug, { enabled: nextEnabled, localTime: time, timezone: zone });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "La configuration n’a pas pu être enregistrée");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-muted">Radar quotidien<input className="input mt-1 w-full" disabled={pending} onChange={(event) => setTime(event.target.value)} type="time" value={time} /></label>
        <label className="text-xs font-semibold text-muted">Fuseau<input className="input mt-1 w-full" disabled={pending} onChange={(event) => setZone(event.target.value)} value={zone} /></label>
      </div>
      {error ? <p className="text-xs font-semibold text-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button className={`button ${enabled ? "" : "button-primary"}`} disabled={pending} onClick={() => save(!enabled)} type="button">{pending ? "Enregistrement…" : enabled ? "Mettre en pause" : "Activer l’autopilote"}</button>
        <button className="button" disabled={pending} onClick={() => save()} type="button">Enregistrer l’horaire</button>
      </div>
    </div>
  );
}
