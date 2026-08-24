"use client";

import { CheckCircle2, LoaderCircle, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

type MutationAction = (formData: FormData) => Promise<unknown>;
type MutationStatus = "idle" | "confirming" | "pending" | "success" | "error";

export function MutationForm({
  action,
  children,
  className,
  confirmation,
  onError,
  onSuccess,
  successMessage = "Modification enregistrée. La page est actualisée.",
}: {
  action: MutationAction;
  children: ReactNode;
  className?: string;
  confirmation?: string;
  onError?: (message: string) => void;
  onSuccess?: (result: unknown) => void;
  successMessage?: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<MutationStatus>("idle");
  const [message, setMessage] = useState("");
  const [pendingData, setPendingData] = useState<FormData | null>(null);

  async function execute(formData: FormData) {
    setStatus("pending");
    setMessage("");
    try {
      const result = await action(formData);
      setStatus("success");
      setMessage(successMessage);
      onSuccess?.(result);
      router.refresh();
    } catch (error) {
      setStatus("error");
      const nextMessage = error instanceof Error && error.message ? error.message : "La modification a échoué. Réessayez.";
      setMessage(nextMessage);
      onError?.(nextMessage);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "pending") return;
    const formData = new FormData(event.currentTarget);
    if (confirmation) {
      setPendingData(formData);
      setStatus("confirming");
      setMessage(confirmation);
      return;
    }
    void execute(formData);
  }

  function confirm() {
    if (!pendingData) return;
    const formData = pendingData;
    setPendingData(null);
    void execute(formData);
  }

  function cancel() {
    setPendingData(null);
    setStatus("idle");
    setMessage("");
  }

  return (
    <form className={className} onSubmit={submit}>
      <fieldset className="contents" disabled={status === "pending" || status === "confirming"}>
        {children}
      </fieldset>
      {status === "confirming" ? (
        <div className="mt-3 rounded-lg border border-warning/40 bg-amber-50 p-3 text-xs text-warning" role="alert">
          <p>{message}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="button button-signal" onClick={confirm} type="button">
              Confirmer
            </button>
            <button className="button" onClick={cancel} type="button">
              Annuler
            </button>
          </div>
        </div>
      ) : null}
      {status === "pending" ? (
        <p className="mt-2 flex items-center gap-2 text-xs text-muted" role="status">
          <LoaderCircle className="animate-spin" size={13} />
          Enregistrement en cours…
        </p>
      ) : null}
      {status === "success" ? (
        <p className="mt-2 flex items-center gap-2 text-xs text-success" role="status">
          <CheckCircle2 size={13} />
          {message}
        </p>
      ) : null}
      {status === "error" ? (
        <p className="mt-2 flex items-start gap-2 rounded-lg border border-danger/30 bg-red-50 p-2 text-xs text-danger" role="alert">
          <TriangleAlert className="mt-0.5 shrink-0" size={13} />
          <span className="whitespace-pre-line">{message}</span>
        </p>
      ) : null}
    </form>
  );
}
