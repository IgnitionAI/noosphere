"use client";

import { CrmErrorState } from "@/components/crm-states";

export default function SequenceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <CrmErrorState resource="la séquence" reset={reset} />;
}
