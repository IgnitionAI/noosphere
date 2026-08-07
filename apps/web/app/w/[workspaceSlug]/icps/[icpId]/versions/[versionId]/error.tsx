"use client";

import { CrmErrorState } from "@/components/crm-states";

export default function IcpVersionError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <CrmErrorState resource="la version ICP" reset={reset} />;
}
