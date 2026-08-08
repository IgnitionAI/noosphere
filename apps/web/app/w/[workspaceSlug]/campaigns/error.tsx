"use client";
import { CrmErrorState } from "@/components/crm-states";
export default function CampaignsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) { return <CrmErrorState resource="les campagnes" reset={reset} />; }
