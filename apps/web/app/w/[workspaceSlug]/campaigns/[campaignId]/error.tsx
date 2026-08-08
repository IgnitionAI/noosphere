"use client";
import { CrmErrorState } from "@/components/crm-states";
export default function CampaignError({ reset }: { error: Error & { digest?: string }; reset: () => void }) { return <CrmErrorState resource="la campagne" reset={reset} />; }
