"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Polls only the server-rendered projection. The durable memory job lives in
 * PostgreSQL and continues when this component unmounts or the drawer closes.
 */
export function ProspectMemoryRefreshWatcher({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const poll = window.setInterval(() => router.refresh(), 3_000);
    return () => window.clearInterval(poll);
  }, [active, router]);
  return null;
}
