"use client";

import { CrmErrorState } from "@/components/crm-states";

export default function CompaniesError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <CrmErrorState resource="les entreprises" reset={reset} />;
}
