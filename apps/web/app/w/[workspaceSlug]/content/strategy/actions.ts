"use server";

import { deriveEditorialStrategy, publishEditorialStrategy } from "@/lib/api";

export async function deriveStrategyAction(workspaceSlug: string) {
  return deriveEditorialStrategy(workspaceSlug, `strategy:derive:${crypto.randomUUID()}`);
}

export async function publishStrategyAction(workspaceSlug: string) {
  return publishEditorialStrategy(workspaceSlug, `strategy:publish:${crypto.randomUUID()}`);
}
