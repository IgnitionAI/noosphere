"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createOffer, publishOfferVersion, updateOfferDraft } from "@/lib/api";

export async function createOfferAction(workspaceSlug: string, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Le nom de l’offre est obligatoire.");
  const category = String(formData.get("category") ?? "autre");
  const targetAudience = String(formData.get("targetAudience") ?? "").trim();
  const offer = await createOffer(workspaceSlug, { name, category, targetAudience });
  revalidatePath(`/w/${workspaceSlug}/offers`);
  redirect(`/w/${workspaceSlug}/offers/${offer.id}`);
}

export async function updateOfferAction(workspaceSlug: string, offerId: string, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const valueProposition = String(formData.get("valueProposition") ?? "").trim();
  const targetAudience = String(formData.get("targetAudience") ?? "").trim();
  const category = String(formData.get("category") ?? "autre");
  const claims = parseClaims(String(formData.get("claims") ?? "[]"));
  await updateOfferDraft(workspaceSlug, offerId, {
    name,
    category,
    valueProposition,
    targetAudience,
    claims,
    pricing: String(formData.get("pricing") ?? ""),
    commercialRules: String(formData.get("commercialRules") ?? ""),
    constraints: String(formData.get("constraints") ?? ""),
    objections: String(formData.get("objections") ?? ""),
  });
  revalidatePath(`/w/${workspaceSlug}/offers`);
  revalidatePath(`/w/${workspaceSlug}/offers/${offerId}`);
}

export async function publishOfferAction(workspaceSlug: string, offerId: string, _formData: FormData) {
  await publishOfferVersion(workspaceSlug, offerId);
  revalidatePath(`/w/${workspaceSlug}/offers`);
  revalidatePath(`/w/${workspaceSlug}/offers/${offerId}`);
}

function parseClaims(value: string): { claim: string; validationStatus: "hypothesis" | "sourced" | "validated" | "invalidated"; evidenceUri: string | null }[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const status = row.validationStatus;
      if (typeof row.claim !== "string" || !["hypothesis", "sourced", "validated", "invalidated"].includes(String(status))) return [];
      return [{ claim: row.claim.trim(), validationStatus: status as "hypothesis" | "sourced" | "validated" | "invalidated", evidenceUri: typeof row.evidenceUri === "string" ? row.evidenceUri : null }];
    });
  } catch {
    return [];
  }
}
