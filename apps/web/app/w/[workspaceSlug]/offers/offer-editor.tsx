"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { MutationForm } from "../research/[runId]/report/mutation-form";
import type { Offer, OfferClaimValidationStatus } from "@/lib/api";

type FormAction = (formData: FormData) => Promise<unknown>;

export function OfferEditor({ offer, action }: { offer: Offer; action: FormAction }) {
  const [claims, setClaims] = useState(() => offer.claims.map((claim) => ({
    claim: claim.claim,
    validationStatus: claim.validationStatus,
    evidenceUri: claim.evidenceUri ?? "",
  })));
  const payload = JSON.stringify(claims.map(({ claim, validationStatus, evidenceUri }) => ({ claim, validationStatus, evidenceUri: evidenceUri || null })));

  function updateClaim(index: number, field: "claim" | "validationStatus" | "evidenceUri", value: string) {
    setClaims((current) => current.map((claim, claimIndex) => claimIndex === index ? { ...claim, [field]: value } : claim));
  }

  return (
    <MutationForm action={action} className="space-y-4" successMessage="Le brouillon est enregistré.">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-xs font-semibold text-muted">Nom de l’offre<input className="control mt-1" name="name" defaultValue={offer.name} required /></label>
        <label className="block text-xs font-semibold text-muted">Catégorie<select className="control mt-1" name="category" defaultValue={offer.category}><option value="service">Service</option><option value="saas">SaaS</option><option value="licence">Licence</option><option value="autre">Autre</option></select></label>
      </div>
      <label className="block text-xs font-semibold text-muted">Proposition de valeur *<textarea className="control mt-1 min-h-28" name="valueProposition" defaultValue={offer.valueProposition} required placeholder="Quel résultat concret l’offre apporte-t-elle ?" /></label>
      <label className="block text-xs font-semibold text-muted">Cible communicable<textarea className="control mt-1 min-h-20" name="targetAudience" defaultValue={offer.targetAudience} placeholder="Pour quelles équipes, entreprises ou situations ?" /></label>
      <div className="grid gap-3 md:grid-cols-2">
        <TextField name="pricing" label="Prix communicable" value={displayValue(offer.pricing)} placeholder="Ex. 45–120 k€" />
        <TextField name="commercialRules" label="Règles commerciales" value={displayValue(offer.commercialRules)} placeholder="Ex. hors intégration spécifique" />
        <TextField name="constraints" label="Contraintes et limites" value={displayValue(offer.constraints)} placeholder="Ce que l’offre ne promet pas" />
        <TextField name="objections" label="Objections et réponses" value={displayValue(offer.objections)} placeholder="Objection → réponse" />
      </div>

      <section className="rounded-lg border border-line p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">Claims autorisés</h3><p className="mt-1 text-xs text-muted">Chaque claim doit indiquer son statut et sa preuve libre. Un claim invalidé bloque la publication.</p></div><button className="button" onClick={() => setClaims((current) => [...current, { claim: "", validationStatus: "hypothesis" as const, evidenceUri: "" }])} type="button"><Plus size={14} /> Ajouter un claim</button></div>
        <input name="claims" type="hidden" value={payload} readOnly />
        <div className="mt-4 space-y-3">
          {claims.length ? claims.map((claim, index) => <ClaimEditor claim={claim} index={index} key={index} onChange={updateClaim} onRemove={() => setClaims((current) => current.filter((_, claimIndex) => claimIndex !== index))} />) : <p className="rounded-lg border border-dashed border-line p-4 text-center text-xs text-muted">Aucun claim. Ajoutez-en au moins un avant publication.</p>}
        </div>
      </section>
      <button className="button button-primary" type="submit">Enregistrer le brouillon</button>
    </MutationForm>
  );
}

function ClaimEditor({ claim, index, onChange, onRemove }: { claim: { claim: string; validationStatus: OfferClaimValidationStatus; evidenceUri: string }; index: number; onChange: (index: number, field: "claim" | "validationStatus" | "evidenceUri", value: string) => void; onRemove: () => void }) {
  return <article className="rounded-lg border border-line p-3"><div className="flex items-start gap-2"><textarea className="control min-h-20 min-w-0 flex-1" value={claim.claim} onChange={(event) => onChange(index, "claim", event.target.value)} placeholder="Ex. Déploiement dans un environnement privé" aria-label={`Claim ${index + 1}`} /><button className="button h-9 w-9 shrink-0 p-0" onClick={onRemove} type="button" aria-label={`Supprimer le claim ${index + 1}`}><Trash2 size={14} /></button></div><div className="mt-2 grid gap-2 sm:grid-cols-2"><select className="control" value={claim.validationStatus} onChange={(event) => onChange(index, "validationStatus", event.target.value)} aria-label={`Statut du claim ${index + 1}`}><option value="hypothesis">Hypothèse</option><option value="sourced">Sourcé</option><option value="validated">Validé</option><option value="invalidated">Invalidé</option></select><input className="control" value={claim.evidenceUri} onChange={(event) => onChange(index, "evidenceUri", event.target.value)} placeholder="Preuve : URL, document ou constat" aria-label={`Preuve du claim ${index + 1}`} /></div></article>;
}

function TextField({ name, label, value, placeholder }: { name: string; label: string; value: string; placeholder: string }) { return <label className="block text-xs font-semibold text-muted">{label}<textarea className="control mt-1 min-h-20" name={name} defaultValue={value} placeholder={placeholder} /></label>; }
function displayValue(value: unknown): string { if (typeof value === "string") return value; if (value === undefined || value === null) return ""; try { return JSON.stringify(value, null, 2); } catch { return String(value); } }
