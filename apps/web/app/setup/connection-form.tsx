"use client";
import { useState } from "react";
import type { InstanceAiConnectionSummary } from "@/lib/api";
import { saveConnectionAction } from "./actions";
import { ModelPicker } from "./model-picker";

export function ConnectionForm({ connection }: { connection?: InstanceAiConnectionSummary }) {
  const [provider, setProvider] = useState(connection?.provider ?? "openai-api");
  return <form action={saveConnectionAction} className="mt-4 space-y-4">
    {connection ? <input type="hidden" name="connectionId" value={connection.id} /> : null}
    <label className="block text-sm font-medium">Fournisseur<select className="control mt-1" name={connection ? undefined : "provider"} value={provider} disabled={!!connection} onChange={(event) => setProvider(event.target.value as typeof provider)}>
      <option value="openai-api">OpenAI</option><option value="anthropic">Anthropic</option><option value="openrouter">OpenRouter</option><option value="codex-cli">Codex via ChatGPT</option><option value="kimi-code">Kimi</option><option value="openai-compatible">API compatible OpenAI</option>
    </select></label>
    {connection ? <input type="hidden" name="provider" value={provider} /> : null}
    {provider === "openai-compatible" ? <label className="block text-sm font-medium">URL de l’API<input className="control mt-1" name="baseUrl" type="url" defaultValue={connection?.baseUrl ?? ""} placeholder="https://api.exemple.com/v1" required /><span className="mt-1 block text-xs text-muted">HTTPS public uniquement. Les réseaux privés et les redirections sont bloqués.</span></label> : null}
    <label className="block text-sm font-medium">Nom de la connexion<input className="control mt-1" name="name" defaultValue={connection?.name ?? ""} required maxLength={120} /></label>
    {provider !== "codex-cli" ? <label className="block text-sm font-medium">Clé API<input className="control mt-1" type="password" name="apiKey" autoComplete="new-password" required={!connection} maxLength={4096} placeholder={connection ? "Laisser vide pour conserver la clé" : "Votre clé API"} /></label> : <p className="text-sm text-muted">Enregistrez votre choix, puis cliquez sur « Connecter ChatGPT ». Aucune clé API ni commande à saisir.</p>}
    <p className="text-xs leading-5 text-muted">{provider === "codex-cli" ? "L’authentification ChatGPT reste dans le répertoire privé de la connexion de service." : "La clé est chiffrée sur le serveur."} Chaque modèle doit réussir un test avant de pouvoir être utilisé. Enregistrer une modification demande de tester à nouveau les modèles.</p>
    <ModelPicker key={`${provider}:${connection?.id ?? "new"}`} provider={provider} initialModels={connection?.models.map(model => model.model) ?? []} />
  </form>;
}
