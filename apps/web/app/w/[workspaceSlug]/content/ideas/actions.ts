"use server";

import { discoverContentIdeas } from "@/lib/api";

export async function discoverIdeasAction(workspaceSlug: string) {
  return discoverContentIdeas(workspaceSlug, `ideas:discover:${crypto.randomUUID()}`);
}
