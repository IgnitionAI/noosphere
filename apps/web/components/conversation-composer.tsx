"use client";

import { type FormEvent, useEffect, useState, useTransition } from "react";
import { Bot, Eye, RotateCcw, Send, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { improveProspectMessageAction } from "@/app/w/[workspaceSlug]/prospects/actions";

export function ConversationComposer({
  workspaceSlug,
  conversationId,
  commandStatus,
  commandExecutionMode,
  generatedBody,
  sendAction,
}: {
  workspaceSlug: string;
  conversationId: string;
  commandStatus: string | null;
  commandExecutionMode: "live" | "dry_run" | null;
  generatedBody: string | null;
  sendAction: (formData: FormData) => Promise<void>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [originalDraft, setOriginalDraft] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [isImproving, startImprovement] = useTransition();
  const [isSending, startSending] = useTransition();
  const commandInFlight = commandStatus === "scheduled" || commandStatus === "sending";

  useEffect(() => setIdempotencyKey(crypto.randomUUID()), []);

  useEffect(() => {
    if (!commandInFlight) return;
    const poll = window.setInterval(() => router.refresh(), 2_000);
    return () => window.clearInterval(poll);
  }, [commandInFlight, router]);

  function improve() {
    const value = draft.trim();
    if (!value || isImproving) return;
    setFeedback(null);
    startImprovement(async () => {
      try {
        const result = await improveProspectMessageAction(
          workspaceSlug,
          conversationId,
          value,
        );
        setOriginalDraft(value);
        setDraft(result.body);
        setFeedback("Brouillon amélioré — relisez-le avant de l’envoyer.");
      } catch {
        setFeedback("L’IA n’a pas pu améliorer ce brouillon. Votre texte est conservé.");
      }
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSending || isImproving || commandInFlight) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (!(submitter instanceof HTMLButtonElement)) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    formData.set("mode", submitter.value);
    const executionMode = submitter.dataset.executionMode === "dry_run" ? "dry_run" : "live";
    formData.set("executionMode", executionMode);
    formData.set("idempotencyKey", idempotencyKey || crypto.randomUUID());
    setFeedback(null);
    startSending(async () => {
      try {
        await sendAction(formData);
        if (executionMode === "dry_run") {
          setFeedback("Prévisualisation lancée — aucun message ne sera envoyé. Vous pouvez fermer cette fenêtre.");
        } else {
          setDraft("");
          setOriginalDraft(null);
          setFeedback("Envoi lancé — la conversation se met à jour automatiquement.");
        }
        setIdempotencyKey(crypto.randomUUID());
        router.refresh();
        window.setTimeout(() => router.refresh(), 1_500);
        window.setTimeout(() => router.refresh(), 4_000);
      } catch {
        setFeedback("Le message n’a pas pu être envoyé. Votre brouillon est conservé.");
      }
    });
  }

  return (
    <form className="space-y-2" onSubmit={submit}>
      {commandExecutionMode === "dry_run" && commandStatus === "generated" && generatedBody ? (
        <section className="rounded-xl border border-lime-300 bg-lime-50 p-3" aria-live="polite">
          <div className="flex items-center justify-between gap-2">
            <strong className="text-xs">Prévisualisation du Setter</strong>
            <span className="badge badge-success">Aucun envoi</span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-xs leading-5">{generatedBody}</p>
          <button
            className="button mt-3"
            onClick={() => {
              setDraft(generatedBody);
              setOriginalDraft(null);
              setFeedback("Prévisualisation copiée dans votre brouillon.");
            }}
            type="button"
          >
            Utiliser comme brouillon
          </button>
        </section>
      ) : null}
      <textarea
        className="control min-h-24 w-full resize-y"
        name="body"
        onChange={(event) => {
          setDraft(event.target.value);
          setFeedback(null);
        }}
        placeholder="Écrivez votre message…"
        value={draft}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="button button-signal"
          disabled={!draft.trim() || isImproving || isSending || commandInFlight}
          onClick={improve}
          type="button"
        >
          <Sparkles size={13} />{isImproving ? "Amélioration…" : "Améliorer avec l’IA"}
        </button>
        {originalDraft !== null ? (
          <button
            className="button"
            onClick={() => {
              setDraft(originalDraft);
              setOriginalDraft(null);
              setFeedback("Version originale restaurée.");
            }}
            type="button"
          >
            <RotateCcw size={13} />Annuler
          </button>
        ) : null}
      </div>
      {feedback ? <p aria-live="polite" className="text-[11px] text-muted">{feedback}</p> : null}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button className="button" data-execution-mode="live" disabled={!draft.trim() || isImproving || isSending || commandInFlight} name="mode" value="manual" type="submit"><Send size={13} />{isSending || commandInFlight ? "Envoi…" : "Envoyer moi-même"}</button>
        <button className="button" data-execution-mode="live" disabled={isImproving || isSending || commandInFlight} name="mode" value="setter" type="submit"><Bot size={13} />{isSending || commandInFlight ? "Setter en cours…" : "Setter IA"}</button>
      </div>
      <button className="button w-full" data-execution-mode="dry_run" disabled={isImproving || isSending || commandInFlight} name="mode" value="setter" type="submit">
        <Eye size={13} />Tester le Setter sans envoyer
      </button>
    </form>
  );
}
