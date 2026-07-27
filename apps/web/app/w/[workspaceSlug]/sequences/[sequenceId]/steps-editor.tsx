"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, Plus, Save, Trash2 } from "lucide-react";
import type { SequenceStep } from "@/lib/api";
import { publishSequenceAction, saveStepsAction } from "../actions";

const KIND_LABEL: Record<string, string> = {
  linkedin_invite: "Invitation LinkedIn",
  linkedin_message: "Message LinkedIn",
  email: "Email",
  whatsapp: "WhatsApp",
  manual_task: "Tâche manuelle",
};

const KIND_LIMIT: Record<string, number | null> = {
  linkedin_invite: 300,
  linkedin_message: 2000,
  email: 5000,
  whatsapp: 1000,
  manual_task: null,
};

type EditableStep = Omit<SequenceStep, "id">;

export function StepsEditor({
  workspaceSlug,
  sequenceId,
  initialSteps,
  canPublish,
}: {
  workspaceSlug: string;
  sequenceId: string;
  initialSteps: SequenceStep[];
  canPublish: boolean;
}) {
  const [steps, setSteps] = useState<EditableStep[]>(
    initialSteps.map(({ position, kind, delayDays, windowStart, windowEnd, subject, body, fallbackKind }) => ({
      position,
      kind,
      delayDays,
      windowStart,
      windowEnd,
      subject,
      body,
      fallbackKind,
    })),
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function update(index: number, patch: Partial<EditableStep>) {
    setSteps((current) =>
      current.map((step, position) => (position === index ? { ...step, ...patch } : step)),
    );
  }

  function move(index: number, delta: number) {
    setSteps((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next.map((step, position) => ({ ...step, position: position + 1 }));
    });
  }

  function addStep() {
    setSteps((current) => [
      ...current,
      {
        position: current.length + 1,
        kind: "email",
        delayDays: current.length === 0 ? 0 : 3,
        windowStart: null,
        windowEnd: null,
        subject: null,
        body: "",
        fallbackKind: null,
      },
    ]);
  }

  function save() {
    setFeedback(null);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("steps", JSON.stringify(steps.map((step, index) => ({ ...step, position: index + 1 }))));
        await saveStepsAction(workspaceSlug, sequenceId, formData);
        setFeedback("Brouillon enregistré.");
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Erreur d’enregistrement");
      }
    });
  }

  function publish() {
    setFeedback(null);
    startTransition(async () => {
      try {
        await publishSequenceAction(workspaceSlug, sequenceId, new FormData());
        setFeedback("Version immuable publiée.");
      } catch (error) {
        setFeedback(
          error instanceof Error
            ? `Publication refusée : ${error.message}`
            : "Publication refusée",
        );
      }
    });
  }

  return (
    <div className="space-y-3">
      {steps.map((step, index) => {
        const limit = KIND_LIMIT[step.kind];
        const tooLong = limit !== null && step.body.length > (limit ?? Infinity);
        return (
          <article className={`rounded-lg border p-4 ${tooLong ? "border-warning" : "border-line"}`} key={index}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="badge badge-signal">Étape {index + 1}</span>
              <select
                className="control w-48"
                value={step.kind}
                onChange={(event) => update(index, { kind: event.target.value as EditableStep["kind"] })}
              >
                {Object.entries(KIND_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-xs text-muted">
                J+
                <input
                  className="control w-16"
                  type="number"
                  min={0}
                  value={step.delayDays}
                  onChange={(event) => update(index, { delayDays: Number(event.target.value) })}
                />
              </label>
              <label className="flex items-center gap-1 text-xs text-muted">
                Fenêtre
                <input
                  className="control w-20"
                  placeholder="09:00"
                  value={step.windowStart ?? ""}
                  onChange={(event) => update(index, { windowStart: event.target.value || null })}
                />
                →
                <input
                  className="control w-20"
                  placeholder="18:00"
                  value={step.windowEnd ?? ""}
                  onChange={(event) => update(index, { windowEnd: event.target.value || null })}
                />
              </label>
              <select
                className="control w-40"
                value={step.fallbackKind ?? ""}
                onChange={(event) => update(index, { fallbackKind: event.target.value || null })}
                disabled={step.kind === "manual_task"}
                title="Canal de repli"
              >
                <option value="">Pas de repli</option>
                <option value="linkedin_message">Repli LinkedIn</option>
                <option value="email">Repli email</option>
                <option value="whatsapp">Repli WhatsApp</option>
              </select>
              <span className="ml-auto flex gap-1">
                <button className="button" type="button" onClick={() => move(index, -1)} aria-label="Monter">
                  <ArrowUp size={13} />
                </button>
                <button className="button" type="button" onClick={() => move(index, 1)} aria-label="Descendre">
                  <ArrowDown size={13} />
                </button>
                <button
                  className="button"
                  type="button"
                  onClick={() => setSteps((current) => current.filter((_, position) => position !== index).map((step, position) => ({ ...step, position: position + 1 })))}
                  aria-label="Supprimer"
                >
                  <Trash2 size={13} />
                </button>
              </span>
            </div>
            {step.kind === "email" ? (
              <input
                className="control mt-3 w-full"
                placeholder="Objet de l’email (obligatoire, ≤ 200 car.)"
                value={step.subject ?? ""}
                onChange={(event) => update(index, { subject: event.target.value || null })}
              />
            ) : null}
            <textarea
              className="control mt-3 h-24 w-full text-sm"
              placeholder={
                step.kind === "manual_task"
                  ? "Instruction de la tâche…"
                  : "Template avec variables {{firstName}}, {{companyName}}, {{title}}…"
              }
              value={step.body}
              onChange={(event) => update(index, { body: event.target.value })}
            />
            <p className={`mt-1 text-[11px] ${tooLong ? "text-warning" : "text-muted"}`}>
              {step.body.length}{limit ? ` / ${limit}` : ""} caractères
              {tooLong ? " — dépasse la limite du canal" : ""}
            </p>
          </article>
        );
      })}

      <div className="flex flex-wrap items-center gap-2">
        <button className="button" type="button" onClick={addStep}>
          <Plus size={14} />
          Ajouter une étape
        </button>
        <button className="button" type="button" disabled={pending} onClick={save}>
          <Save size={14} />
          Enregistrer le brouillon
        </button>
        {canPublish ? (
          <button className="button button-signal" type="button" disabled={pending} onClick={publish}>
            <CheckCircle2 size={14} />
            Publier une version immuable
          </button>
        ) : (
          <span className="text-xs text-muted">Publication réservée aux admins/owners.</span>
        )}
      </div>
      {feedback ? <p className="text-xs text-muted" role="status">{feedback}</p> : null}
    </div>
  );
}
