"use server";

import { revalidatePath } from "next/cache";
import { createCompany, updateCompany } from "@/lib/api";

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

function optionalNumber(formData: FormData, name: string): number | null {
  const value = String(formData.get(name) ?? "").trim();
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("Les effectifs doivent être des nombres entiers positifs ou nuls.");
  }
  return parsed;
}

export async function updateCompanyAction(
  workspaceSlug: string,
  companyId: string,
  formData: FormData,
) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Le nom de l’entreprise est obligatoire.");
  const domain = String(formData.get("domain") ?? "").trim();
  const sector = String(formData.get("sector") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const linkedinUrl = String(formData.get("linkedinUrl") ?? "").trim();
  const employeeCountMin = optionalNumber(formData, "employeeCountMin");
  const employeeCountMax = optionalNumber(formData, "employeeCountMax");
  if (employeeCountMin !== null && employeeCountMax !== null && employeeCountMin > employeeCountMax) {
    throw new Error("L’effectif minimum ne peut pas dépasser le maximum.");
  }
  await updateCompany(workspaceSlug, companyId, {
    name,
    domain: domain || null,
    sector: sector || null,
    location: location || null,
    linkedinUrl: linkedinUrl || null,
    employeeCountMin,
    employeeCountMax,
  });
  revalidatePath(`/w/${workspaceSlug}/companies`);
  revalidatePath(`/w/${workspaceSlug}/companies/${companyId}`);
}
