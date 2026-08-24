"use client";

import { CrmErrorState } from "@/components/crm-states";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <CrmErrorState resource="la fiche offre" reset={reset} />;
}
