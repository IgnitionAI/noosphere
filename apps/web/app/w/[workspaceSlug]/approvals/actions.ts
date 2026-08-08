"use server";

import { revalidatePath } from "next/cache";
import {
  approveApprovalItem,
  bulkDecideApprovalItems,
  editApprovalItem,
  OutboundApiError,
  rejectApprovalItem,
} from "@/lib/api";

const root = (workspaceSlug: string) => `/w/${workspaceSlug}/approvals`;

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function content(formData: FormData): unknown {
  const value = text(formData, "contentEdited");
  if (!value) throw new Error("Le contenu édité est obligatoire.");
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function apiMessage(error: unknown, fallback: string): string {
  if (!(error instanceof OutboundApiError)) return error instanceof Error ? error.message : fallback;
  return `${error.code}: ${error.message}`;
}

export async function editApprovalItemAction(workspaceSlug: string, itemId: string, formData: FormData) {
  try {
    await editApprovalItem(workspaceSlug, itemId, content(formData));
  } catch (error) {
    throw new Error(apiMessage(error, "La modification de l’item a échoué."));
  }
  revalidatePath(root(workspaceSlug));
  revalidatePath(`${root(workspaceSlug)}/${itemId}`);
}

export async function approveApprovalItemAction(workspaceSlug: string, itemId: string, _formData: FormData) {
  try {
    await approveApprovalItem(workspaceSlug, itemId);
  } catch (error) {
    throw new Error(apiMessage(error, "L’approbation a échoué."));
  }
  revalidatePath(root(workspaceSlug));
  revalidatePath(`${root(workspaceSlug)}/${itemId}`);
}

export async function rejectApprovalItemAction(workspaceSlug: string, itemId: string, formData: FormData) {
  const justification = text(formData, "justification");
  if (!justification) throw new Error("Une justification est obligatoire pour rejeter cet item.");
  try {
    await rejectApprovalItem(workspaceSlug, itemId, justification);
  } catch (error) {
    throw new Error(apiMessage(error, "Le rejet a échoué."));
  }
  revalidatePath(root(workspaceSlug));
  revalidatePath(`${root(workspaceSlug)}/${itemId}`);
}

export async function bulkDecideApprovalItemsAction(workspaceSlug: string, formData: FormData) {
  let itemIds: string[];
  try {
    const parsed = JSON.parse(text(formData, "itemIds")) as unknown;
    itemIds = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    itemIds = [];
  }
  if (!itemIds.length) throw new Error("Sélectionnez au moins un item en attente.");
  const decision = text(formData, "decision");
  if (decision !== "approve" && decision !== "reject") throw new Error("Choisissez une décision.");
  const justification = text(formData, "justification");
  if (decision === "reject" && !justification) throw new Error("Une justification est obligatoire pour un rejet en lot.");
  try {
    await bulkDecideApprovalItems(workspaceSlug, { itemIds, decision, ...(justification ? { justification } : {}) });
  } catch (error) {
    throw new Error(apiMessage(error, "La décision en lot a échoué."));
  }
  revalidatePath(root(workspaceSlug));
}
