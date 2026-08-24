"use client";

import { ArrowDown, ArrowUp, CheckCircle2, Plus, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import type { SequenceStep } from "@/lib/api";
import { MutationForm } from "../../research/[runId]/report/mutation-form";
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
const VARIABLES: Record<string, string> = {
  firstName: "Camille",
  lastName: "Martin",
  companyName: "Acme",
  title: "Directrice commerciale",
  icpName: "SaaS B2B",
  senderName: "Alex",
};

type EditableStep = Omit<SequenceStep, "id">;
type StepError = { position: number; code: string; message: string };

export function StepsEditor({
  workspaceSlug,
  sequenceId,
  initialSteps,
  canEdit,
  canPublish,
}: {
  workspaceSlug: string;
  sequenceId: string;
  initialSteps: SequenceStep[];
  canEdit: boolean;
  canPublish: boolean;
}) {
  const [steps, setSteps] = useState<EditableStep[]>(initialSteps.map(({ position, kind, delayDays, windowStart, windowEnd, subject, body, fallbackKind }) => ({
    position, kind, delayDays, windowStart, windowEnd, subject, body, fallbackKind,
  })));
  const [validationErrors, setValidationErrors] = useState<StepError[]>([]);

  function update(index: number, patch: Partial<EditableStep>) {
    setSteps((current) => current.map((step, position) => position === index ? { ...step, ...patch } : step));
    setValidationErrors((current) => current.filter((error) => error.position !== index + 1));
  }
  function move(index: number, delta: number) {
    setSteps((current) => {
      const next = [...current]; const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next.map((step, position) => ({ ...step, position: position + 1 }));
    });
    setValidationErrors([]);
  }
  function addStep() {
    setSteps((current) => [...current, {
      position: current.length + 1, kind: "email", delayDays: current.length === 0 ? 0 : 3,
      windowStart: null, windowEnd: null, subject: null, body: "", fallbackKind: null,
    }]);
  }
  function removeStep(index: number) {
    setSteps((current) => current.filter((_, position) => position !== index).map((step, position) => ({ ...step, position: position + 1 })));
    setValidationErrors([]);
  }
  const serializedSteps = JSON.stringify(steps.map((step, index) => ({ ...step, position: index + 1 })));
  const parseErrors = (message: string): StepError[] => message.split("\n").flatMap((line) => {
    const match = /^step:(\d+):([^:]+):(.*)$/.exec(line);
    return match ? [{ position: Number(match[1]), code: match[2]!, message: match[3]! }] : [];
  });

  return (
    <div className="space-y-4">
      {!canEdit ? <p className="rounded-lg border border-warning/30 bg-amber-50 p-3 text-xs text-warning">Votre rôle permet la lecture des séquences, mais pas la modification.</p> : null}
      {steps.map((step, index) => {
        const limit = KIND_LIMIT[step.kind];
        const errors = validationErrors.filter((error) => error.position === index + 1);
        const tooLong = limit !== null && step.body.length > (limit ?? Infinity);
        return (
          <article className={`rounded-lg border p-4 ${errors.length || tooLong ? "border-warning" : "border-line"}`} key={index}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="badge badge-signal">Étape {index + 1}</span>
              <select className="control w-48" value={step.kind} disabled={!canEdit} onChange={(event) => update(index, { kind: event.target.value as EditableStep["kind"] })}>
                {Object.entries(KIND_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <label className="flex items-center gap-1 text-xs text-muted">J+<input className="control w-16" type="number" min={0} disabled={!canEdit} value={step.delayDays} onChange={(event) => update(index, { delayDays: Number(event.target.value) })} /></label>
              <label className="flex items-center gap-1 text-xs text-muted">Fenêtre
                <input className="control w-20" placeholder="09:00" disabled={!canEdit} value={step.windowStart ?? ""} onChange={(event) => update(index, { windowStart: event.target.value || null })} />→
                <input className="control w-20" placeholder="18:00" disabled={!canEdit} value={step.windowEnd ?? ""} onChange={(event) => update(index, { windowEnd: event.target.value || null })} />
              </label>
              <select className="control w-40" value={step.fallbackKind ?? ""} disabled={!canEdit || step.kind === "manual_task"} onChange={(event) => update(index, { fallbackKind: event.target.value || null })} title="Canal de repli">
                <option value="">Pas de repli</option><option value="linkedin_message">Repli LinkedIn</option><option value="email">Repli email</option><option value="whatsapp">Repli WhatsApp</option>
              </select>
              {canEdit ? <span className="ml-auto flex gap-1"><button className="button" type="button" onClick={() => move(index, -1)} aria-label="Monter"><ArrowUp size={13} /></button><button className="button" type="button" onClick={() => move(index, 1)} aria-label="Descendre"><ArrowDown size={13} /></button><button className="button" type="button" onClick={() => removeStep(index)} aria-label="Supprimer"><Trash2 size={13} /></button></span> : null}
            </div>
            {step.kind === "email" ? <input className="control mt-3 w-full" placeholder="Objet de l’email (obligatoire, ≤ 200 car.)" disabled={!canEdit} value={step.subject ?? ""} onChange={(event) => update(index, { subject: event.target.value || null })} /> : null}
            <textarea className="control mt-3 h-24 w-full text-sm" disabled={!canEdit} placeholder={step.kind === "manual_task" ? "Instruction de la tâche…" : "Template avec variables {{firstName}}, {{companyName}}, {{title}}…"} value={step.body} onChange={(event) => update(index, { body: event.target.value })} />
            <p className={`mt-1 text-[11px] ${tooLong ? "text-warning" : "text-muted"}`}>{step.body.length}{limit ? ` / ${limit}` : ""} caractères{tooLong ? " — dépasse la limite du canal" : ""}</p>
            {errors.length ? <div className="mt-2 space-y-1 rounded-lg border border-danger/30 bg-red-50 p-2 text-xs text-danger" role="alert">{errors.map((error) => <p key={`${error.code}-${error.position}`}><strong>{error.code}</strong> — {error.message}</p>)}</div> : null}
            <div className="mt-3 rounded-lg bg-canvas p-3 text-xs"><p className="mb-1 font-semibold text-muted">Prévisualisation · {KIND_LABEL[step.kind]}</p>{step.kind === "email" && step.subject ? <p className="font-semibold">{preview(step.subject)}</p> : null}<p className="mt-1 whitespace-pre-wrap">{preview(step.body) || "Votre template apparaîtra ici."}</p></div>
          </article>
        );
      })}
      {canEdit ? <button className="button" type="button" onClick={addStep}><Plus size={14} /> Ajouter une étape</button> : null}
      {canEdit ? <div className="flex flex-wrap gap-2">
        <MutationForm action={saveStepsAction.bind(null, workspaceSlug, sequenceId)} onError={(message) => setValidationErrors(parseErrors(message))} successMessage="Brouillon enregistré.">
          <input name="steps" type="hidden" value={serializedSteps} /><button className="button" type="submit"><Save size={14} /> Enregistrer le brouillon</button>
        </MutationForm>
        {canPublish ? <MutationForm action={publishSequenceAction.bind(null, workspaceSlug, sequenceId)} onError={(message) => setValidationErrors(parseErrors(message))} confirmation="Publier cette version ? Elle sera immuable et le brouillon pourra ensuite évoluer vers une v2." successMessage="Version immuable publiée."><button className="button button-signal" type="submit"><CheckCircle2 size={14} /> Publier une version</button></MutationForm> : <span className="self-center text-xs text-muted">Publication réservée aux admins/owners.</span>}
      </div> : null}
    </div>
  );
}

function preview(value: string | null): string {
  return (value ?? "").replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_, key: string) => VARIABLES[key] ?? `{{${key}}}`);
}
