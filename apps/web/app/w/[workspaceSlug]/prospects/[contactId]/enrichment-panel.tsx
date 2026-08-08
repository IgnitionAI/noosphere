"use client";

import { ExternalLink, LoaderCircle, Mail, Phone, RefreshCw, UserRound } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { ContactDetail, EnrichmentJobDetail, EnrichmentObservation, EnrichmentObservationStatus } from "@/lib/api";
import { MutationForm } from "../../research/[runId]/report/mutation-form";

type MutationAction = (formData: FormData) => Promise<unknown>;
const CHANNELS = ["email", "phone", "whatsapp", "linkedin"] as const;
const CHANNEL_LABEL: Record<(typeof CHANNELS)[number], string> = { email: "Email", phone: "Téléphone", whatsapp: "WhatsApp", linkedin: "LinkedIn" };
const STATUS: Record<EnrichmentObservationStatus, { label: string; className: string }> = {
  found: { label: "trouvé", className: "badge" },
  probable: { label: "probable", className: "badge badge-warning" },
  verified: { label: "vérifié", className: "badge badge-success" },
  invalid: { label: "invalide", className: "badge badge-danger" },
};

export function EnrichmentPanel({
  workspaceSlug,
  contact,
  observations,
  job,
  canEnrich,
  requestKey,
  enrichAction,
  retryAction,
  addIdentityAction,
}: {
  workspaceSlug: string;
  contact: ContactDetail;
  observations: readonly EnrichmentObservation[];
  job: EnrichmentJobDetail | null;
  canEnrich: boolean;
  requestKey: string;
  enrichAction: MutationAction;
  retryAction: MutationAction | null;
  addIdentityAction: MutationAction;
}) {
  const router = useRouter();
  const suppressed = contact.status === "suppressed";
  const currentObservations = job?.observations.length ? job.observations : observations;
  const inFlight = job ? job.status === "queued" || job.status === "running" : false;
  const latestByChannel = useMemo(() => {
    const map = new Map<string, EnrichmentObservation>();
    for (const observation of currentObservations) {
      const channel = channelFor(observation.field);
      if (channel && !map.has(channel)) map.set(channel, observation);
    }
    return map;
  }, [currentObservations]);

  useEffect(() => {
    if (!inFlight) return;
    const timer = window.setInterval(() => router.refresh(), 4_000);
    return () => window.clearInterval(timer);
  }, [inFlight, router]);

  function showJob(result: unknown) {
    if (!result || typeof result !== "object" || !("id" in result) || typeof result.id !== "string") return;
    const url = new URL(window.location.href);
    url.searchParams.set("enrichmentJobId", result.id);
    router.replace(url.pathname + url.search);
  }

  return (
    <section className="panel">
      <div className="panel-header flex-wrap gap-2">
        <div><h2 className="font-semibold">Coordonnées</h2><p className="mt-1 text-xs text-muted">Statut, provenance et preuves des canaux connus.</p></div>
        <span className="badge">{suppressed ? "purgées" : CHANNELS.length}</span>
      </div>
      <div className="panel-body space-y-3">
        {suppressed ? <p className="rounded-lg border border-warning/30 bg-amber-50 p-3 text-sm text-warning">Les coordonnées de ce contact ont été purgées après suppression et ne sont pas affichées.</p> : null}
        {!suppressed && job && (job.status === "queued" || job.status === "running") ? <p className="flex items-center gap-2 rounded-lg border border-brand-blue/30 bg-blue-50 p-3 text-xs text-brand-blue" role="status"><LoaderCircle className="animate-spin" size={14} /> Enrichissement en cours… tentative {job.attempts}/{job.maxAttempts}. Actualisation automatique.</p> : null}
        {!suppressed && job?.status === "failed" ? <div className={`rounded-lg border p-3 text-xs ${providerDown(job) ? "border-warning/40 bg-amber-50 text-warning" : "border-danger/30 bg-red-50 text-danger"}`}><p className="font-semibold">{providerDown(job) ? "Fournisseur indisponible" : "L’enrichissement a échoué"}</p><p className="mt-1">{job.errorMessage || job.errorCode || "Réessayez pour relancer le job."}</p>{retryAction ? <MutationForm action={retryAction} onSuccess={showJob} successMessage="Nouvelle tentative mise en file."><button className="button mt-2" type="submit"><RefreshCw size={14} /> Réessayer</button></MutationForm> : null}</div> : null}
        {!suppressed && !latestByChannel.size ? <p className="rounded-lg border border-dashed border-line p-4 text-center text-sm text-muted">Aucune coordonnée enrichie avec provenance pour le moment.</p> : null}
        {!suppressed ? <div className="space-y-2">{CHANNELS.map((channel) => { const observation = latestByChannel.get(channel); const identity = contact.identities.find((candidate) => candidate.type === channel); return <ChannelCard channel={channel} identity={identity} key={channel} observation={observation} />; })}</div> : null}
        {!suppressed && canEnrich && !inFlight ? <MutationForm action={enrichAction} onSuccess={showJob} successMessage="Enrichissement demandé."><input name="requestKey" type="hidden" value={requestKey} readOnly /><button className="button button-signal" type="submit"><RefreshCw size={14} /> Enrichir les coordonnées</button><p className="mt-2 text-[11px] text-muted">La demande est idempotente : un double clic ne crée pas deux jobs.</p></MutationForm> : null}
        {!suppressed && canEnrich ? <details className="pt-2"><summary className="cursor-pointer text-sm font-semibold text-brand-blue">Ajouter une coordonnée manuellement</summary><MutationForm action={addIdentityAction} className="mt-3 flex flex-col gap-2 sm:flex-row"><select className="control sm:w-36" name="type" defaultValue="email"><option value="email">Email</option><option value="linkedin">LinkedIn</option><option value="phone">Téléphone</option><option value="whatsapp">WhatsApp</option></select><input className="control min-w-0 flex-1" name="value" required /><button className="button" type="submit">Ajouter</button></MutationForm></details> : null}
        {!suppressed && !canEnrich ? <p className="text-[11px] text-muted">L’enrichissement est réservé aux opérateurs, admins et owners.</p> : null}
      </div>
    </section>
  );
}

function ChannelCard({ channel, observation, identity }: { channel: (typeof CHANNELS)[number]; observation?: EnrichmentObservation | undefined; identity?: ContactDetail["identities"][number] | undefined }) {
  const Icon = channel === "email" ? Mail : channel === "linkedin" ? UserRound : Phone;
  const status = observation ? STATUS[observation.status] : identity ? identityStatus(identity.verificationStatus) : null;
  const value = observation?.value ?? identity?.value;
  return <div className="rounded-lg border border-line p-3"><div className="flex flex-wrap items-start gap-3"><Icon className="mt-0.5 shrink-0 text-brand-blue" size={16} /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{CHANNEL_LABEL[channel]}</p><p className={`truncate text-sm ${observation?.status === "probable" && channel === "email" ? "text-warning" : "text-navy"}`}>{value || "Non renseigné"}</p>{observation ? <p className="mt-1 text-[11px] text-muted">Source {observation.source}{observation.provider ? ` · ${observation.provider}` : ""} · observé le {formatDate(observation.observedAt)} · confiance {observation.confidence}</p> : identity ? <p className="mt-1 text-[11px] text-muted">Source {identity.source}</p> : null}{channel === "phone" || channel === "whatsapp" ? <p className="mt-1 text-[11px] text-muted">Type : {phoneKindLabel(observation?.phoneKind ?? null)}</p> : null}{observation?.status === "probable" && channel === "email" ? <p className="mt-1 text-[11px] font-medium text-warning">Email probable : non envoyable sans vérification.</p> : null}{observation?.evidenceSnippet ? <p className="mt-2 text-xs italic text-muted">« {observation.evidenceSnippet} »</p> : null}{observation?.evidenceUrl ? <a className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-blue" href={observation.evidenceUrl} rel="noreferrer" target="_blank">Voir la preuve <ExternalLink size={11} /></a> : null}</div>{status ? <span className={status.className}>{status.label}</span> : null}</div></div>;
}

function channelFor(field: string): (typeof CHANNELS)[number] | null {
  if (field === "email" || field === "linkedin" || field === "phone" || field === "whatsapp") return field;
  return null;
}

function identityStatus(status: ContactDetail["identities"][number]["verificationStatus"]): { label: string; className: string } {
  return status === "verified" ? STATUS.verified : status === "invalid" ? STATUS.invalid : { label: "non vérifié", className: "badge" };
}

function phoneKindLabel(value: EnrichmentObservation["phoneKind"]): string {
  return value === "public_company" ? "numéro public d’entreprise" : value === "personal" ? "numéro personnel" : "non renseigné (aucune inférence)";
}

function providerDown(job: EnrichmentJobDetail): boolean {
  return /provider|unavailable|down|crawler/i.test(`${job.errorCode ?? ""} ${job.errorMessage ?? ""}`);
}

function formatDate(value: string): string { return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(value)); }
