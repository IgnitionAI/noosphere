"use client";

import { CrmErrorState } from "@/components/crm-states";

export default function ContactError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <CrmErrorState resource="la fiche prospect" reset={reset} />;
}
