"use client";

import { ExternalLink, LoaderCircle, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ConnectionOnboarding } from "@/lib/api";

const CHANNELS = ["email", "linkedin", "whatsapp"] as const;
const STATUS: Record<string, { label: string; className: string }> = {
  initiated: { label: "initialisation", className: "badge badge-warning" },
  awaiting_callback: { label: "en attente du callback", className: "badge badge-signal" },
  verifying: { label: "vérification initiale", className: "badge badge-signal" },
  completed: { label: "terminé", className: "badge badge-success" },
  failed: { label: "échec récupérable", className: "badge badge-danger" },
  expired: { label: "expiré", className: "badge badge-danger" },
};

export function OnboardingStartForm({ action }: { action: (formData: FormData) => Promise<void> }) {
  return <form action={action} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"><label className="text-xs font-semibold text-muted">Canal<select className="control mt-1 w-full" defaultValue="email" name="channel">{CHANNELS.map((channel) => <option key={channel} value={channel}>{channelLabel(channel)}</option>)}</select></label><button className="button button-signal" type="submit"><ExternalLink size={14} /> Démarrer l’assistant</button></form>;
}

export function OnboardingProgress({ onboarding, workspaceSlug }: { onboarding: ConnectionOnboarding; workspaceSlug: string }) {
  const router = useRouter();
  useEffect(() => {
    if (!["initiated", "awaiting_callback", "verifying"].includes(onboarding.status)) return;
    const timer = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [onboarding.status, router]);
  const status = STATUS[onboarding.status] ?? { label: "statut inconnu", className: "badge badge-warning" };
  const step = onboarding.step === "initiation" ? 1 : onboarding.step === "callback" ? 2 : 3;
  const providerHostedUrl = onboarding.hostedUrl?.startsWith("https://") ? onboarding.hostedUrl : null;
  return <section className="panel mb-5 border-brand-blue/30"><div className="panel-header"><div><h2 className="font-semibold">Assistant {onboarding.channel}</h2><p className="mt-1 text-xs text-muted">Onboarding {onboarding.id.slice(0, 8)} · expiration {formatDate(onboarding.expiresAt)}</p></div><span className={status.className}>{status.label}</span></div><div className="panel-body"><div className="grid gap-2 sm:grid-cols-3">{["Initiation", "Callback fournisseur", "Vérification"].map((label, index) => <div className={`rounded-lg border p-3 text-xs ${index + 1 === step ? "border-brand-blue bg-blue-50 text-navy" : index + 1 < step ? "border-success/30 bg-emerald-50 text-success" : "border-line text-muted"}`} key={label}><span className="font-semibold">{index + 1}. {label}</span></div>)}</div>{providerHostedUrl && onboarding.status !== "completed" ? <a className="button button-primary mt-4 inline-flex" href={providerHostedUrl} rel="noreferrer" target="_blank"><ExternalLink size={14} /> Ouvrir la connexion Unipile</a> : null}{onboarding.hostedUrl && !providerHostedUrl && onboarding.status !== "completed" ? <p className="mt-4 rounded-lg border border-warning/30 bg-amber-50 p-3 text-xs text-navy">Ce lien appartient à l’ancien parcours et n’est plus utilisable. Relancez l’assistant avec le même canal pour générer une connexion sécurisée.</p> : null}{["initiated", "awaiting_callback", "verifying"].includes(onboarding.status) ? <p className="mt-3 flex items-center gap-2 text-xs text-muted" role="status"><LoaderCircle className="animate-spin" size={13} />Progression actualisée automatiquement. Vous pouvez quitter cette page et reprendre l’assistant avec le même canal.</p> : null}{onboarding.status === "failed" ? <p className="mt-3 rounded-lg border border-danger/30 bg-red-50 p-3 text-xs text-danger">{onboarding.errorCode || "PROVIDER_UNAVAILABLE"} : {onboarding.errorMessage || "La vérification fournisseur a échoué. Relancez l’assistant."}</p> : null}{onboarding.status === "expired" ? <p className="mt-3 text-xs text-muted">Cet onboarding a expiré. Relancez l’assistant pour créer une nouvelle session.</p> : null}{onboarding.status === "completed" ? <p className="mt-3 flex items-center gap-2 text-xs text-success"><RotateCcw size={13} />Connexion terminée. Les capacités et quotas sont maintenant lus du compte.</p> : null}<a className="mt-3 inline-flex text-xs font-semibold text-brand-blue" href={`/w/${workspaceSlug}/integrations`}>Fermer l’assistant</a></div></section>;
}

function formatDate(value: string): string { return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function channelLabel(channel: (typeof CHANNELS)[number]): string { return channel === "linkedin" ? "LinkedIn" : channel === "whatsapp" ? "WhatsApp" : "Email"; }
