"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function CampaignAutoRefresh({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => router.refresh(), 4_000);
    return () => window.clearInterval(timer);
  }, [enabled, router]);
  return null;
}
