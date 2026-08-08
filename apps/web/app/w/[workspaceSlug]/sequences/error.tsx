"use client";

import { CrmErrorState } from "@/components/crm-states";

export default function SequencesError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <CrmErrorState resource="les séquences" reset={reset} />;
}
