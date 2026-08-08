"use client";
import { CrmErrorState } from "@/components/crm-states";
export default function IntegrationsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) { return <CrmErrorState resource="les intégrations" reset={reset} />; }
