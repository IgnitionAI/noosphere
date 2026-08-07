"use server";

import { revalidatePath } from "next/cache";
import { createImport, applyImport } from "@/lib/api";

export async function uploadImportAction(
  workspaceSlug: string,
  formData: FormData,
): Promise<{ id: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Sélectionnez un fichier CSV.");
  if (!file.name.toLowerCase().endsWith(".csv")) throw new Error("Le fichier doit être au format CSV.");
  if (file.size > 10 * 1024 * 1024) throw new Error("Le fichier ne doit pas dépasser 10 Mo.");
  const mappingValue = String(formData.get("mapping") ?? "").trim();
  let mapping: Record<string, string> | undefined;
  if (mappingValue) {
    try {
      const parsed: unknown = JSON.parse(mappingValue);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("mapping");
      mapping = Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0));
    } catch {
      throw new Error("Le mapping des colonnes est invalide.");
    }
  }
  const batch = await createImport(workspaceSlug, {
    filename: file.name,
    content: await file.text(),
    ...(mapping ? { mapping } : {}),
  });
  revalidatePath(`/w/${workspaceSlug}/imports`);
  return { id: batch.id };
}

export async function applyImportAction(
  workspaceSlug: string,
  importId: string,
  _formData: FormData,
) {
  await applyImport(workspaceSlug, importId);
  revalidatePath(`/w/${workspaceSlug}/imports/${importId}`);
}
