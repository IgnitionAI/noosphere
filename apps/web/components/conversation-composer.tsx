"use client";

import { type FormEvent, useState, useTransition } from "react";
import { Bot, RotateCcw, Send, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { improveProspectMessageAction } from "@/app/w/[workspaceSlug]/prospects/actions";

export function ConversationComposer({
  workspaceSlug,
  conversationId,
  sendAction,
}: {
  workspaceSlug: string;
  conversationId: string;
  sendAction: (formData: FormData) => Promise<void>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [originalDraft, setOriginalDraft] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isImproving, startImprovement] = useTransition();
  const [isSending, startSending] = useTransition();

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
    if (isSending || isImproving) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (!(submitter instanceof HTMLButtonElement)) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    formData.set("mode", submitter.value);
    setFeedback(null);
    startSending(async () => {
      try {
        await sendAction(formData);
        setDraft("");
        setOriginalDraft(null);
        setFeedback("Envoi lancé — la conversation se met à jour automatiquement.");
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
          disabled={!draft.trim() || isImproving || isSending}
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
        <button className="button" disabled={!draft.trim() || isImproving || isSending} name="mode" value="manual" type="submit"><Send size={13} />{isSending ? "Envoi…" : "Envoyer moi-même"}</button>
        <button className="button" disabled={isImproving || isSending} name="mode" value="setter" type="submit"><Bot size={13} />{isSending ? "Envoi…" : "Setter IA"}</button>
      </div>
    </form>
  );
}
