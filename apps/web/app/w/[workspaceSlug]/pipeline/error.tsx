"use client";

import { CrmErrorState } from "@/components/crm-states";

export default function PipelineError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <CrmErrorState resource="le pipeline" reset={reset} />;
}
