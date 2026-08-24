"use client";

import { CrmErrorState } from "@/components/crm-states";

export default function ImportsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <CrmErrorState resource="les imports" reset={reset} />;
}
