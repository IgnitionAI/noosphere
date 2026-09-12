"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ChatGptDeviceFlow } from "@/lib/api";
import { chatGptLoginAction } from "./actions";

export function ChatGptConnect({ connectionId, connected }: { connectionId: string; connected: boolean }) {
  const [flow, setFlow] = useState<ChatGptDeviceFlow>({ state: "idle" });
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const active = flow.state === "starting" || flow.state === "waiting";
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const next = await chatGptLoginAction(connectionId, false);
      if (cancelled) return;
      setFlow(next);
      if (next.state === "connected") router.replace("/setup?notice=chatgpt");
      else if (next.state === "starting" || next.state === "waiting") timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 1000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [active, connectionId, router]);
  return <div className="my-3 space-y-3 rounded-lg bg-canvas p-3 text-sm">
    <p>{connected ? "ChatGPT est connecté. Choisissez ci-dessous le modèle à utiliser." : "Connectez votre compte ChatGPT pour l’utiliser dans Noosphere."}</p>
    {flow.state === "waiting" && flow.verificationUrl && flow.userCode ? <div className="space-y-3">
      <p>Ouvrez ChatGPT, puis saisissez ce code :</p>
      <code className="block text-xl font-semibold tracking-widest">{flow.userCode}</code>
      <a className="button button-primary" href={flow.verificationUrl} target="_blank" rel="noopener noreferrer">Ouvrir ChatGPT</a>
      <p className="text-xs text-muted" role="status">Cette page se mettra à jour dès la connexion terminée.</p>
    </div> : null}
    {flow.state === "starting" ? <p role="status">Préparation de la connexion…</p> : null}
    {flow.state === "connected" ? <p role="status">Compte ChatGPT connecté.</p> : null}
    {flow.state === "failed" ? <p role="alert">La connexion n’a pas abouti. Réessayez ; si cela persiste, le service de connexion doit être vérifié.</p> : null}
    {!active ? <button type="button" className="button button-primary" disabled={pending} onClick={() => startTransition(async () => setFlow(await chatGptLoginAction(connectionId, true)))}>{pending ? "Préparation…" : connected ? "Reconnecter ChatGPT" : "Connecter ChatGPT"}</button> : null}
  </div>;
}
