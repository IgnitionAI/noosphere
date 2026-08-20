"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { discoverIdeasAction } from "./actions";

export function IdeasControls({ workspaceSlug, runId, running }: { workspaceSlug: string; runId?: string; running: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), 3_000);
    return () => clearInterval(timer);
  }, [router, running, runId]);
  async function launch() {
    setPending(true);
    setError(null);
    try {
      const run = await discoverIdeasAction(workspaceSlug);
      router.replace(`/w/${workspaceSlug}/content/ideas?run=${run.id}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "La recherche n’a pas pu démarrer");
    } finally { setPending(false); }
  }
  return <div className="flex flex-wrap items-center justify-end gap-2">{error ? <span className="text-xs font-semibold text-danger">{error}</span> : null}<button className="button button-primary" disabled={pending || running} onClick={launch} type="button"><RefreshCw className={pending || running ? "animate-spin" : ""} size={14} />{running ? "Recherche en cours" : pending ? "Planification…" : "Relancer la recherche"}</button></div>;
}
