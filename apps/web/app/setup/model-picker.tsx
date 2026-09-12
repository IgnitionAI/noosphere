"use client";
import { useState } from "react";
import type { InstanceAiConnectionSummary } from "@/lib/api";

type Provider = InstanceAiConnectionSummary["provider"];
type Choice = { id: string; name: string };
// Suggestions verified 2026-09-10 against the providers' public catalogs.
// They are not an account entitlement check; the existing connection probe is authoritative.
// https://developers.openai.com/api/docs/models
// https://platform.claude.com/docs/en/models/overview
// https://www.kimi.com/code/docs/en/kimi-code/models.html
// https://openrouter.ai/api/v1/models
const openai: Choice[] = [
  { id: "gpt-6-astra", name: "GPT-6 Astra" },
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
  { id: "gpt-5.6-terra", name: "GPT-5.6 Terra" },
  { id: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
];
const suggestions: Record<Provider, Choice[]> = {
  "openai-api": openai,
  "codex-cli": openai,
  anthropic: [
    { id: "claude-fable-5-1", name: "Claude Fable 5.1" },
    { id: "claude-opus-5", name: "Claude Opus 5" },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
  ],
  "kimi-code": [
    { id: "k3", name: "Kimi K3" },
    { id: "k3-256k", name: "Kimi K3 — contexte 256k" },
    { id: "kimi-for-coding", name: "Kimi K2.7 Code" },
    { id: "kimi-for-coding-highspeed", name: "Kimi K2.7 Code HighSpeed" },
  ],
  openrouter: [
    { id: "openai/gpt-6-astra", name: "OpenAI · GPT-6 Astra" },
    { id: "openai/gpt-5.6-luna", name: "OpenAI · GPT-5.6 Luna" },
    { id: "anthropic/claude-sonnet-5", name: "Anthropic · Claude Sonnet 5" },
    { id: "moonshotai/kimi-k3", name: "MoonshotAI · Kimi K3" },
  ],
  "openai-compatible": [],
};

export function ModelPicker({ provider, initialModels = [] }: { provider: Provider; initialModels?: readonly string[] }) {
  const choices = suggestions[provider];
  const [selected, setSelected] = useState(initialModels.filter(id => choices.some(choice => choice.id === id)));
  const [custom, setCustom] = useState(initialModels.filter(id => !choices.some(choice => choice.id === id)).join("\n"));
  const models = [...new Set([...selected, ...custom.split(/[\n,]+/).map(id => id.trim()).filter(Boolean)])];
  return <fieldset className="space-y-3">
    <legend className="text-sm font-medium">Modèles à utiliser</legend>
    <p className="text-xs text-muted">Cochez un ou plusieurs modèles. Le test de connexion vérifiera ensuite leur accès avec votre compte.</p>
    {choices.length ? <div className="grid gap-2 sm:grid-cols-2">{choices.map(choice => <label key={choice.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 text-sm">
      <input type="checkbox" aria-label={choice.name} checked={selected.includes(choice.id)} onChange={event => setSelected(current => event.target.checked ? [...current, choice.id] : current.filter(id => id !== choice.id))} className="mt-1" />
      <span><span className="block font-medium">{choice.name}</span><span className="block break-all text-xs text-muted">{choice.id}</span></span>
    </label>)}</div> : <p className="text-sm text-muted">Pour une API personnalisée, utilisez les identifiants indiqués dans le catalogue de votre fournisseur.</p>}
    <p className="text-xs text-muted" aria-live="polite">{models.length ? `${models.length} modèle${models.length > 1 ? "s" : ""} sélectionné${models.length > 1 ? "s" : ""}` : "Sélectionnez au moins un modèle avant d’enregistrer."}</p>
    <details open={!choices.length || initialModels.some(id => !choices.some(choice => choice.id === id)) || undefined} className="rounded-lg border border-line p-3">
      <summary className="cursor-pointer text-sm">Ajouter un modèle par son identifiant</summary>
      <label className="mt-3 block text-sm">Identifiants de modèles (avancé)<textarea className="control mt-1 min-h-20" value={custom} onChange={event => setCustom(event.target.value)} placeholder="Un identifiant par ligne, uniquement si votre modèle n’est pas proposé" /></label>
      {custom ? <p className="mt-2 text-xs text-muted">Ces identifiants sont inclus dans votre sélection.</p> : null}
    </details>
    <input type="hidden" name="models" value={models.join("\n")} />
    <button className="button button-primary" type="submit" disabled={!models.length}>{initialModels.length ? "Enregistrer les modifications" : "Enregistrer la connexion"}</button>
  </fieldset>;
}
