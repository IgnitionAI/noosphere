"use server";

import { generateContentBrandDirection, importContentBrandLogo, updateContentBrandKit, type ContentBrandKit } from "@/lib/api";

export async function updateWorkspaceBrandAction(workspaceSlug: string, brandKit: ContentBrandKit["snapshot"]) {
  return updateContentBrandKit(workspaceSlug, {
    requestKey: `workspace-brand:update:${crypto.randomUUID()}`,
    brandKit,
  });
}

export async function importWorkspaceBrandLogoAction(workspaceSlug: string, formData: FormData) {
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size < 1) throw new Error("Sélectionnez un logo PNG, JPEG ou WebP.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Le logo doit peser 5 Mo maximum.");
  if (!(["image/png", "image/jpeg", "image/webp"] as const).includes(file.type as "image/png")) {
    throw new Error("Le logo doit être au format PNG, JPEG ou WebP.");
  }
  return importContentBrandLogo(workspaceSlug, {
    requestKey: `workspace-brand:logo:${crypto.randomUUID()}`,
    fileName: file.name,
    mimeType: file.type as "image/png" | "image/jpeg" | "image/webp",
    dataBase64: Buffer.from(await file.arrayBuffer()).toString("base64"),
  });
}

export async function generateWorkspaceBrandDirectionAction(workspaceSlug: string, input: {
  landingPageUrl: string | null;
  description: string | null;
  useLogo: boolean;
}) {
  return generateContentBrandDirection(workspaceSlug, {
    requestKey: `workspace-brand:direction:${crypto.randomUUID()}`,
    ...input,
  });
}
