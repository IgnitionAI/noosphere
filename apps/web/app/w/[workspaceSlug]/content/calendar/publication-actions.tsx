"use client";

import { CalendarClock, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cancelPublicationAction, reschedulePublicationAction } from "./actions";

export function PublicationActions({ workspaceSlug, publicationId, scheduledFor }: { readonly workspaceSlug: string; readonly publicationId: string; readonly scheduledFor: string }) {
  const router = useRouter();
  const [date, setDate] = useState(localDate(new Date(scheduledFor)));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(operation: "move" | "cancel") {
    setPending(true); setError(null);
    try {
      if (operation === "move") await reschedulePublicationAction(workspaceSlug, publicationId, new Date(date).toISOString());
      else await cancelPublicationAction(workspaceSlug, publicationId);
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Action impossible"); }
    finally { setPending(false); }
  }
  return <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center"><input className="input min-w-0 flex-1" disabled={pending} min={localDate(new Date(Date.now() + 60_000))} onChange={(event) => setDate(event.target.value)} type="datetime-local" value={date} /><button className="button" disabled={pending} onClick={() => run("move")} type="button"><CalendarClock size={13} /> Déplacer</button><button className="button text-danger" disabled={pending} onClick={() => run("cancel")} type="button"><X size={13} /> Annuler</button>{error ? <span className="text-xs font-semibold text-danger">{error}</span> : null}</div>;
}

function localDate(date: Date): string { return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
