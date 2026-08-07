"use client";

import { CrmErrorState } from "@/components/crm-states";

export default function SuppressionsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <CrmErrorState resource="les suppressions" reset={reset} />;
}
