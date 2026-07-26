"use server";

import { revalidatePath } from "next/cache";
import {
  correctIcpProposal,
  publishIcpVersion,
  researchMore,
  reviewFinding,
  reviewIcpProposal,
} from "@/lib/api";

const REPORT_PATH = (workspaceSlug: string, runId: string) =>
  `/w/${workspaceSlug}/research/${runId}/report`;

export async function approveProposal(
  workspaceSlug: string,
  runId: string,
  proposalId: string,
  _formData: FormData,
) {
  await reviewIcpProposal(workspaceSlug, runId, "approve-icp", proposalId, null);
  revalidatePath(REPORT_PATH(workspaceSlug, runId));
}

export async function rejectProposal(
  workspaceSlug: string,
  runId: string,
  proposalId: string,
  formData: FormData,
) {
  await reviewIcpProposal(
    workspaceSlug,
    runId,
    "reject-icp",
    proposalId,
    String(formData.get("reason") ?? "ICP rejeté lors de la revue humaine."),
  );
  revalidatePath(REPORT_PATH(workspaceSlug, runId));
}

export async function confirmFinding(
  workspaceSlug: string,
  runId: string,
  findingId: string,
  _formData: FormData,
) {
  await reviewFinding(workspaceSlug, runId, findingId, { decision: "confirmed" });
  revalidatePath(REPORT_PATH(workspaceSlug, runId));
}

export async function correctFinding(
  workspaceSlug: string,
  runId: string,
  findingId: string,
  formData: FormData,
) {
  const statement = String(formData.get("statement") ?? "").trim();
  if (!statement) throw new Error("Une correction de finding exige une reformulation.");
  await reviewFinding(workspaceSlug, runId, findingId, {
    decision: "corrected",
    statement,
  });
  revalidatePath(REPORT_PATH(workspaceSlug, runId));
}

export async function rejectFinding(
  workspaceSlug: string,
  runId: string,
  findingId: string,
  formData: FormData,
) {
  const reason = String(formData.get("reason") ?? "").trim();
  await reviewFinding(workspaceSlug, runId, findingId, {
    decision: "rejected",
    reason:
      reason.length >= 3
        ? reason
        : "Contradiction non résolue identifiée lors de la revue humaine.",
  });
  revalidatePath(REPORT_PATH(workspaceSlug, runId));
}

export async function correctProposal(
  workspaceSlug: string,
  runId: string,
  proposalId: string,
  formData: FormData,
) {
  const fields: Record<string, unknown> = {};
  const name = String(formData.get("name") ?? "").trim();
  if (name) fields.name = name;
  for (const listField of ["buyingCommittee", "problems", "signals", "exclusions", "unknowns"] as const) {
    const raw = formData.get(listField);
    if (raw !== null) {
      fields[listField] = String(raw)
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    }
  }
  const criteria = String(formData.get("criteria") ?? "").trim();
  if (criteria) {
    fields.criteria = JSON.parse(criteria);
  }
  if (Object.keys(fields).length === 0) return;
  await correctIcpProposal(workspaceSlug, runId, proposalId, fields);
  revalidatePath(REPORT_PATH(workspaceSlug, runId));
}

export async function publishProposal(
  workspaceSlug: string,
  runId: string,
  proposalId: string,
  _formData: FormData,
) {
  await publishIcpVersion(workspaceSlug, runId, proposalId);
  revalidatePath(REPORT_PATH(workspaceSlug, runId));
}

export async function requestMoreResearch(
  workspaceSlug: string,
  runId: string,
  formData: FormData,
) {
  const fromStage = String(formData.get("fromStage") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 10) {
    throw new Error("Décrivez la recherche complémentaire attendue (10 caractères minimum).");
  }
  await researchMore(workspaceSlug, runId, fromStage, reason);
  revalidatePath(`/w/${workspaceSlug}/research/${runId}`);
}
