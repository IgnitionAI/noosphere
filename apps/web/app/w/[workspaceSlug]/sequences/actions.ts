"use server";

import { revalidatePath } from "next/cache";
import {
  createSequence,
  publishSequenceVersion,
  replaceSequenceSteps,
  type SequenceStep,
} from "@/lib/api";

export async function createSequenceAction(workspaceSlug: string, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Le nom de la séquence est obligatoire.");
  const description = String(formData.get("description") ?? "").trim();
  await createSequence(workspaceSlug, {
    name,
    ...(description ? { description } : {}),
  });
  revalidatePath(`/w/${workspaceSlug}/sequences`);
}

export async function saveStepsAction(
  workspaceSlug: string,
  sequenceId: string,
  formData: FormData,
) {
  const raw = String(formData.get("steps") ?? "");
  const steps = JSON.parse(raw) as Omit<SequenceStep, "id">[];
  await replaceSequenceSteps(workspaceSlug, sequenceId, steps);
  revalidatePath(`/w/${workspaceSlug}/sequences/${sequenceId}`);
}

export async function publishSequenceAction(
  workspaceSlug: string,
  sequenceId: string,
  _formData: FormData,
) {
  await publishSequenceVersion(workspaceSlug, sequenceId);
  revalidatePath(`/w/${workspaceSlug}/sequences/${sequenceId}`);
}
