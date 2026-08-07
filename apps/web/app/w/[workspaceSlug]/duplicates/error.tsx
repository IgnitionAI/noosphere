"use client";

import { CrmErrorState } from "@/components/crm-states";

export default function DuplicatesError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <CrmErrorState resource="les candidats de fusion" reset={reset} />;
}
