"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function ActionsRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => router.refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [active, router]);
  return active ? <p className="text-[11px] text-muted">Actualisation automatique toutes les 15 secondes pendant l’exécution.</p> : null;
}
