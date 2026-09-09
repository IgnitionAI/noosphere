"use server";
import { redirect } from "next/navigation";
import { skipInstanceAiSetup } from "@/lib/api";
export async function skipSetupAction(): Promise<void> {
  try { await skipInstanceAiSetup(); }
  catch { redirect("/setup?error=skip"); }
  redirect("/onboarding");
}
