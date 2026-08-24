"use client";

import { CrmErrorState } from "@/components/crm-states";

export default function DiscoverError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <CrmErrorState resource="la découverte de prospects" reset={reset} />;
}
