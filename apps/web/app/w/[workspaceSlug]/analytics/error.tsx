"use client";

import { CrmErrorState } from "@/components/crm-states";

export default function AnalyticsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <CrmErrorState resource="les analytics" reset={reset} />;
}
