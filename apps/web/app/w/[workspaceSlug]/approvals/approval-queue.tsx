"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ApprovalItem } from "@/lib/api";
import { MutationForm } from "../research/[runId]/report/mutation-form";

type ApprovalAction = (formData: FormData) => Promise<unknown>;

export function ApprovalQueue({
  workspaceSlug,
  items,
  canDecide,
  bulkAction,
}: {
  workspaceSlug: string;
  items: readonly ApprovalItem[];
  canDecide: boolean;
  bulkAction: ApprovalAction;
}) {
  const pending = useMemo(() => items.filter((item) => item.status === "pending"), [items]);
  const invalidated = useMemo(() => items.filter((item) => item.status === "invalidated"), [items]);
  const [selected, setSelected] = useState<string[]>([]);
  const [decision, setDecision] = useState<"approve" | "reject">("approve");

  function toggle(itemId: string) {
    setSelected((current) => current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]);
  }

  return (
    <div className="space-y-5">
      {canDecide && pending.length ? (
        <MutationForm action={bulkAction} confirmation={`Confirmer cette décision pour ${selected.length} item(s) ?`} successMessage="Décisions enregistrées. La file est actualisée.">
          <input name="itemIds" type="hidden" value={JSON.stringify(selected)} readOnly />
          <div className="flex flex-col gap-3 rounded-lg border border-line bg-slate-50 p-3 sm:flex-row sm:items-end">
            <label className="text-xs font-semibold text-ink">Décision en lot
              <select className="control mt-1 block min-w-40" name="decision" onChange={(event) => setDecision(event.target.value as "approve" | "reject")} value={decision}>
                <option value="approve">Approuver</option>
                <option value="reject">Rejeter</option>
              </select>
            </label>
            {decision === "reject" ? <label className="min-w-0 flex-1 text-xs font-semibold text-ink">Justification obligatoire
              <input className="control mt-1 w-full" name="justification" placeholder="Pourquoi ces items sont-ils rejetés ?" required />
            </label> : null}
            <button className="button button-signal" disabled={selected.length === 0} type="submit">Décider {selected.length ? `(${selected.length})` : ""}</button>
          </div>
        </MutationForm>
      ) : null}

      {pending.length ? (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">À traiter · {pending.length}</h2>
          {pending.map((item) => <ApprovalRow checked={selected.includes(item.id)} item={item} key={item.id} onToggle={() => toggle(item.id)} workspaceSlug={workspaceSlug} />)}
        </section>
      ) : null}

      {invalidated.length ? (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Invalidés · {invalidated.length}</h2>
          {invalidated.map((item) => <ApprovalRow item={item} invalidated key={item.id} workspaceSlug={workspaceSlug} />)}
        </section>
      ) : null}

      {items.filter((item) => item.status !== "pending" && item.status !== "invalidated").length ? (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Décidés</h2>
          {items.filter((item) => item.status !== "pending" && item.status !== "invalidated").map((item) => <ApprovalRow item={item} key={item.id} workspaceSlug={workspaceSlug} />)}
        </section>
      ) : null}
    </div>
  );
}

function ApprovalRow({ item, workspaceSlug, checked = false, invalidated = false, onToggle }: { item: ApprovalItem; workspaceSlug: string; checked?: boolean; invalidated?: boolean; onToggle?: () => void }) {
  return (
    <div className={`flex min-w-0 items-start gap-3 rounded-lg border p-4 ${invalidated ? "border-warning/40 bg-amber-50/60" : "border-line bg-white"}`}>
      {onToggle ? <input aria-label={`Sélectionner ${item.id}`} checked={checked} className="mt-1" onChange={onToggle} type="checkbox" /> : null}
      <Link className="min-w-0 flex-1" href={`/w/${workspaceSlug}/approvals/${item.id}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge">{item.itemType}</span>
          <span className="badge">{item.channel}</span>
          <StatusBadge status={item.status} />
          {item.stepPosition !== null ? <span className="text-xs text-muted">Étape {item.stepPosition}</span> : null}
        </div>
        <p className="mt-2 truncate text-sm font-semibold text-ink">{contextLabel(item)}</p>
        <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted">{contentPreview(item.contentEdited ?? item.contentOriginal)}</p>
        {item.invalidationReason ? <p className="mt-2 text-xs font-medium text-warning">Non actionnable · {invalidationLabel(item.invalidationReason)}</p> : null}
      </Link>
      <span className="shrink-0 text-xs font-semibold text-brand-blue">Voir →</span>
    </div>
  );
}

export function StatusBadge({ status }: { status: ApprovalItem["status"] }) {
  const label = { pending: "À traiter", approved: "Approuvé", rejected: "Rejeté", invalidated: "Invalidé" }[status];
  return <span className={`badge ${status === "invalidated" ? "badge-warning" : status === "approved" ? "badge-success" : status === "rejected" ? "badge-danger" : ""}`}>{label}</span>;
}

export function contentPreview(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "Aucun contenu";
  try { return JSON.stringify(value); } catch { return String(value); }
}

export function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function contextLabel(item: ApprovalItem): string {
  const context = item.context;
  const campaign = typeof context.campaignName === "string" ? context.campaignName : item.campaignId ? `Campagne ${item.campaignId.slice(0, 8)}` : "Sans campagne";
  const contact = typeof context.contactName === "string" ? context.contactName : item.contactId ? `Contact ${item.contactId.slice(0, 8)}` : "Sans contact";
  return `${campaign} · ${contact}`;
}

function invalidationLabel(reason: string): string {
  return ({ contact_deleted: "contact supprimé", contact_data_changed: "données du contact modifiées", contact_suppressed: "suppression globale active" } as Record<string, string>)[reason] ?? reason;
}
