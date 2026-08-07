"use client";

import { CrmErrorState } from "@/components/crm-states";

export default function ProspectsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <CrmErrorState resource="les prospects" reset={reset} />;
}
