"use server";

import { revalidatePath } from "next/cache";
import {
  createSequence,
  OutboundApiError,
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
  try {
    await publishSequenceVersion(workspaceSlug, sequenceId);
  } catch (error) {
    if (error instanceof OutboundApiError) {
      const details = error.details as { errors?: unknown } | null;
      const errors = Array.isArray(details?.errors) ? details.errors : [];
      if (errors.length) {
        const localized = errors.map((item) => {
          const entry = item as { position?: unknown; code?: unknown; message?: unknown };
          return `step:${String(entry.position ?? "?")}:${String(entry.code ?? "SEQUENCE_INVALID")}:${String(entry.message ?? error.message)}`;
        });
        throw new Error(`${error.code}: ${error.message}\n${localized.join("\n")}`);
      }
      throw new Error(`${error.code}: ${error.message}`);
    }
    throw error;
  }
  revalidatePath(`/w/${workspaceSlug}/sequences/${sequenceId}`);
}
