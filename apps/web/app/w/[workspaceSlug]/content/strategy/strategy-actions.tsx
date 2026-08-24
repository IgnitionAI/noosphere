"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deriveStrategyAction, publishStrategyAction } from "./actions";

export function StrategyActions({ workspaceSlug, hasStrategy, currentVersion }: { workspaceSlug: string; hasStrategy: boolean; currentVersion: number }) {
  const router = useRouter();
  const [pending, setPending] = useState<"derive" | "publish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run(kind: "derive" | "publish") {
    setPending(kind);
    setError(null);
    try {
      if (kind === "derive") await deriveStrategyAction(workspaceSlug);
      else await publishStrategyAction(workspaceSlug);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "L’opération a échoué");
    } finally {
      setPending(null);
    }
  }
  return (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
      {error ? <span className="w-full text-xs font-semibold text-danger" role="alert">{error}</span> : null}
      <button className="button w-full sm:w-auto" disabled={pending !== null} onClick={() => run("derive")} type="button">
        {pending === "derive" ? "Réflexion K3…" : hasStrategy ? "Recalculer depuis l’offre et l’ICP" : "Dériver la stratégie"}
      </button>
      {hasStrategy ? <button className="button button-primary w-full sm:w-auto" disabled={pending !== null} onClick={() => run("publish")} type="button">
        {pending === "publish" ? "Publication…" : currentVersion > 0 ? "Publier une nouvelle version" : "Activer la stratégie"}
      </button> : null}
    </div>
  );
}
