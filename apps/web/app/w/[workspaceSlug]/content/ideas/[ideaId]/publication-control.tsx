"use client";

import { CalendarClock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { scheduleContentPublicationAction } from "./actions";

export function PublicationControl({ workspaceSlug, assetId }: { readonly workspaceSlug: string; readonly assetId: string }) {
  const router = useRouter();
  const [scheduledFor, setScheduledFor] = useState(defaultLocalDate());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function schedule() {
    setPending(true);
    setError(null);
    try {
      await scheduleContentPublicationAction(workspaceSlug, assetId, new Date(scheduledFor).toISOString());
      router.push(`/w/${workspaceSlug}/content/calendar`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "La publication n’a pas pu être planifiée");
    } finally {
      setPending(false);
    }
  }
  return <div className="space-y-2"><label className="block text-xs font-semibold text-navy" htmlFor="publication-date">Date de publication</label><input className="input w-full" id="publication-date" min={minimumLocalDate()} onChange={(event) => setScheduledFor(event.target.value)} type="datetime-local" value={scheduledFor} /><button className="button button-primary w-full justify-center" disabled={pending || !scheduledFor} onClick={schedule} type="button"><CalendarClock size={14} />{pending ? "Planification…" : "Planifier sur LinkedIn"}</button><p className="text-[11px] leading-4 text-muted">Le texte, la policy et le compte sont figés. Un résultat provider incertain ne sera jamais renvoyé automatiquement.</p>{error ? <p className="text-xs font-semibold text-danger">{error}</p> : null}</div>;
}

function minimumLocalDate(): string { return localDate(new Date(Date.now() + 60_000)); }
function defaultLocalDate(): string { return localDate(new Date(Date.now() + 60 * 60_000)); }
function localDate(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
