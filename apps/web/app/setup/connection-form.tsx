import type { InstanceAiConnectionSummary } from "@/lib/api";
import { saveConnectionAction } from "./actions";

export function ConnectionForm({ connection }: { connection?: InstanceAiConnectionSummary }) {
  return <form action={saveConnectionAction} className="mt-4 space-y-4">
    {connection ? <input type="hidden" name="connectionId" value={connection.id} /> : null}
    <label className="block text-sm font-medium">Nom de la connexion<input className="control mt-1" name="name" defaultValue={connection?.name ?? "OpenAI"} required maxLength={120} /></label>
    <label className="block text-sm font-medium">Clé API OpenAI<input className="control mt-1" type="password" name="apiKey" autoComplete="new-password" required={!connection} maxLength={4096} placeholder={connection ? "Laisser vide pour conserver la clé" : "Votre clé API"} /></label>
    <label className="block text-sm font-medium">Modèles autorisés<textarea className="control mt-1 min-h-20" name="models" required defaultValue={connection?.models.map((model) => model.model).join("\n") ?? ""} placeholder="Un identifiant de modèle par ligne" /></label>
    <p className="text-xs leading-5 text-muted">La clé est chiffrée sur le serveur. Chaque modèle doit réussir un test avant de pouvoir être utilisé. Enregistrer une modification demande de tester à nouveau les modèles.</p>
    <button className="button button-primary" type="submit">{connection ? "Enregistrer les modifications" : "Enregistrer la connexion"}</button>
  </form>;
}
