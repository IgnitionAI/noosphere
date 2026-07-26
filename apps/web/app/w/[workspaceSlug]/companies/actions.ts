"use server";

import { revalidatePath } from "next/cache";
import { createCompany } from "@/lib/api";

export async function createCompanyAction(workspaceSlug: string, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Le nom de l’entreprise est obligatoire.");
  const domain = String(formData.get("domain") ?? "").trim();
  const sector = String(formData.get("sector") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  await createCompany(workspaceSlug, {
    name,
    ...(domain ? { domain } : {}),
    ...(sector ? { sector } : {}),
    ...(location ? { location } : {}),
  });
  revalidatePath(`/w/${workspaceSlug}/companies`);
}
