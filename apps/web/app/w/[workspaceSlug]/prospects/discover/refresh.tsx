"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Keep an in-flight provider run visible without requiring a manual reload. */
export function DiscoveryRefresh({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => router.refresh(), 2500);
    return () => window.clearInterval(timer);
  }, [active, router]);

  return active ? <span className="sr-only" role="status">Actualisation du run en cours…</span> : null;
}
