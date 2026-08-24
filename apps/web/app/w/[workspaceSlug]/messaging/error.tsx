"use client";

import { CrmErrorState } from "@/components/crm-states";

export default function MessagingError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <CrmErrorState resource="la stratégie de message et la politique IA" reset={reset} />;
}
