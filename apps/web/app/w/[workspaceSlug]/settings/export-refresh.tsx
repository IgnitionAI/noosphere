"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function ExportRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => router.refresh(), 2_500);
    return () => window.clearInterval(timer);
  }, [active, router]);
  return null;
}
