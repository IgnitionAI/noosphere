"use client";

import { RefreshCw, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { generateContentAction, improveContentAction } from "./actions";

export function ContentControls({ workspaceSlug, ideaId, assetId, runId, running }: { workspaceSlug: string; ideaId: string; assetId?: string; runId?: string; running: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), 2_500);
    return () => clearInterval(timer);
  }, [router, running, runId]);
  async function launch() {
    setPending(true); setError(null);
    try {
      const run = assetId ? await improveContentAction(workspaceSlug, assetId, instruction) : await generateContentAction(workspaceSlug, ideaId);
      router.replace(`/w/${workspaceSlug}/content/ideas/${ideaId}?run=${run.id}`);
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "La génération n’a pas pu démarrer"); }
    finally { setPending(false); }
  }
  return <div className="space-y-2">{assetId ? <textarea className="input min-h-20 w-full" disabled={pending || running} onChange={(event) => setInstruction(event.target.value)} placeholder="Optionnel : ce que vous souhaitez améliorer, sans changer les faits" value={instruction} /> : null}<button className="button button-primary w-full justify-center" disabled={pending || running} onClick={launch} type="button">{assetId ? <Sparkles size={14} /> : <RefreshCw className={pending || running ? "animate-spin" : ""} size={14} />}{running ? "Pipeline en cours" : pending ? "Planification…" : assetId ? "Améliorer sans publier" : "Créer le contenu"}</button>{error ? <p className="text-xs font-semibold text-danger">{error}</p> : null}</div>;
}
