import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DatabaseExecutor } from "@outbound/infrastructure/database/client";
import { channelAssessments } from "@outbound/infrastructure/database/schema";

/** Bind an approval to the assessment content, including edits that retain completed status. */
export async function nativeActivationPolicyVersion(database: DatabaseExecutor, campaign: { workspaceId: string; assessmentId: string | null; autopilotPolicy: unknown }, lock = false): Promise<string> {
  let assessment: unknown = null;
  if (campaign.assessmentId) {
    const query = database.select().from(channelAssessments).where(and(eq(channelAssessments.workspaceId, campaign.workspaceId), eq(channelAssessments.id, campaign.assessmentId))).limit(1);
    const rows = lock ? await query.for("share") : await query;
    assessment = rows[0] ?? null;
  }
  return `native:${createHash("sha256").update(canonical({ policy: campaign.autopilotPolicy, assessment })).digest("hex")}`;
}

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
