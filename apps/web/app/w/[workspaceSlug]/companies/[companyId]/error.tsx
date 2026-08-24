"use client";

import { CrmErrorState } from "@/components/crm-states";

export default function CompanyError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <CrmErrorState resource="la fiche entreprise" reset={reset} />;
}
