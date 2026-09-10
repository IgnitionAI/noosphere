import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, getInstanceSetup, getInstanceAiConnections } from "@/lib/api";
import { ConnectionForm } from "./connection-form";
import { skipSetupAction, testConnectionAction, selectDefaultAction } from "./actions";

export const dynamic = "force-dynamic";
export default async function InstanceSetupPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  if (!await getSession()) redirect("/login");
  const [state, query] = await Promise.all([getInstanceSetup(), searchParams]);
  const ai = state.isAdministrator ? await getInstanceAiConnections() : null;
  const fallbackUnavailable = !!ai?.fallbackModel && !ai.connections.some((connection) => connection.id === ai.fallbackModel!.connectionId && !connection.authenticationInProgress && connection.models.some((model) => model.model === ai.fallbackModel!.model && model.status === "ready"));
  return <main className="min-h-screen bg-canvas px-5 py-12">
    <section className="panel mx-auto max-w-2xl p-6 sm:p-10">
      <span className="badge badge-signal">Configuration de Noosphere</span>
      <h1 className="mt-5 text-3xl font-semibold text-ink">L’IA de votre instance</h1>
      <p className="mt-3 text-sm leading-6 text-muted">Les connexions IA sont partagées par vos workspaces. Vous pouvez explorer Noosphere et préparer vos données avant de connecter un modèle.</p>
      {query.error ? <p role="alert" className="mt-5 text-sm text-danger">{connectionError(query.error)}</p> : null}
      {query.notice ? <p role="status" className="mt-5 text-sm text-success">{query.notice === "tested" ? "Le modèle a répondu au test. Vous pouvez le choisir comme modèle par défaut." : query.notice === "default" ? "Le modèle par défaut est prêt pour vos workspaces." : "Connexion enregistrée. Testez les modèles avant de les utiliser."}</p> : null}
      {state.skipped ? <p className="mt-5 text-sm text-muted">Vous avez choisi de configurer l’IA plus tard.</p> : null}
      <div className="mt-6 rounded-xl border border-line bg-canvas p-5">
        <h2 className="font-semibold">Connexion IA</h2>
        <p className="mt-2 text-sm text-muted">Un modèle doit être connecté et testé avant de lancer une recherche ou une génération.</p>
        {!state.isAdministrator ? <p className="mt-3 text-sm text-muted">Demandez à l’administrateur de l’instance de configurer une connexion IA. Votre rôle de workspace ne donne pas accès aux connexions partagées.</p> : null}
      </div>
      {ai ? <div className="mt-6 space-y-5">
        {ai.connections.map((connection) => <section key={connection.id} className="rounded-xl border border-line p-5">
          <h2 className="font-semibold">{connection.name}</h2>
          <p className="mt-1 text-xs text-muted">{connectionProviderLabels[connection.provider]} · {connection.provider === "codex-cli" ? "Compte ChatGPT isolé" : "Clé enregistrée et masquée"}</p>
          {connection.provider === "codex-cli" ? <div className="my-3 space-y-2 rounded-lg bg-canvas p-3 text-sm">
            <p>{connection.authentication?.state === "in_progress" ? "Connexion ChatGPT en cours. Terminez la connexion sur la machine hôte ; les tests sont suspendus pendant cette étape." : connection.authentication?.state === "connected" ? "Compte connecté. Testez le modèle pour valider son utilisation." : connection.authentication?.state === "expired" ? "Connexion expirée. Renouvelez la connexion ChatGPT, puis retestez le modèle." : connection.authentication?.state === "unavailable" ? "Configurez INSTANCE_CODEX_HOME sur l’API et les workers pour activer la connexion de service." : "Action requise : connectez votre compte ChatGPT."}</p>
            <p>Sur la machine qui héberge Noosphere, lancez la commande puis ouvrez le lien affiché par Codex :</p>
            <p className="text-xs font-medium">Développement local</p><code className="block break-all text-xs">bun run instance:codex:login {connection.id}</code>
            <p className="text-xs font-medium">Docker Compose, dans le conteneur API</p><code className="block break-all text-xs">bun dist/codex-login/instance-codex-login.js {connection.id}</code>
            <p>La même commande permet de renouveler la connexion. Revenez ensuite sur cette page et testez le modèle. Les identifiants restent dans un volume de service privé partagé avec les workers.</p>
          </div> : null}
          <ul className="mt-4 space-y-4">{connection.models.map((model) => <li key={model.model}>
            <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-sm">{model.model}</span><span className="badge">{model.status === "ready" ? "Test réussi" : model.status === "testing" ? "Test en cours" : model.status === "failed" ? "Test échoué" : "À tester"}</span>{ai.defaultModel?.connectionId === connection.id && ai.defaultModel.model === model.model ? <span className="badge badge-signal">Par défaut</span> : null}</div>
            {model.errorCode ? <p className="mt-2 text-sm text-danger">{connectionError(model.errorCode)}</p> : null}
            <div className="mt-2 flex flex-wrap gap-2"><form action={testConnectionAction.bind(null, connection.id, model.model)}><button className="button" type="submit">Tester {model.model}</button></form>{model.status === "ready" ? <form action={selectDefaultAction.bind(null, connection.id, model.model)}><button className="button" type="submit">Utiliser par défaut</button></form> : null}</div>
          </li>)}</ul>
          <details className="mt-5"><summary className="cursor-pointer text-sm font-medium">Modifier la connexion</summary><ConnectionForm connection={connection} /></details>
        </section>)}
        {ai.defaultModel ? <section className="rounded-xl border border-line p-5">
          <h2 className="font-semibold">Secours de l’instance</h2>
          <p className="mt-2 text-sm text-muted">Les workspaces en héritage utiliseront ce modèle si le modèle principal est indisponible. Sans secours, les tâches se mettent en pause. Les tâches déjà lancées conservent leur sélection.</p>
          {fallbackUnavailable ? <p role="alert" className="mt-2 text-sm text-danger">Le modèle de secours enregistré n’est plus disponible. Retestez-le ou choisissez un autre secours.</p> : null}
          <form className="mt-4 space-y-3" action={selectDefaultAction.bind(null, ai.defaultModel.connectionId, ai.defaultModel.model)}>
            <label htmlFor="instance-fallback" className="block text-sm">Modèle de secours</label>
              <select id="instance-fallback" name="fallback" className="input mt-1 w-full" defaultValue={ai.fallbackModel ? JSON.stringify({ connectionId: ai.fallbackModel.connectionId, model: ai.fallbackModel.model }) : ""}>
                <option value="">Aucun secours</option>
                {fallbackUnavailable && ai.fallbackModel ? <option value={JSON.stringify({ connectionId: ai.fallbackModel.connectionId, model: ai.fallbackModel.model })}>{ai.fallbackModel.model} · Indisponible</option> : null}
                {ai.connections.flatMap((connection) => connection.models.filter((model) => model.status === "ready" && !(connection.id === ai.defaultModel!.connectionId && model.model === ai.defaultModel!.model)).map((model) => <option key={`${connection.id}:${model.model}`} value={JSON.stringify({ connectionId: connection.id, model: model.model })}>{connection.name} · {model.model}</option>))}
              </select>
            <button className="button" type="submit">Enregistrer le secours</button>
          </form>
        </section> : null}
        <section className="rounded-xl border border-line p-5"><h2 className="font-semibold">Ajouter une connexion IA</h2><ConnectionForm /></section>
        <p className="text-xs text-muted">Tester un modèle effectue un appel court facturé selon votre fournisseur.</p>
      </div> : null}
      <div className="mt-7 flex flex-wrap gap-3">
        {state.isAdministrator ? <form action={skipSetupAction}><button className="button button-primary" type="submit">Configurer plus tard</button></form> : null}
        {!state.isAdministrator || state.skipped || ai?.defaultModel ? <Link className="button" href="/onboarding">Continuer vers mes workspaces</Link> : null}
      </div>
    </section>
  </main>;
}

function connectionError(code: string) {
  const messages: Record<string, string> = {
    AI_PROVIDER_DESTINATION_FORBIDDEN: "Cette destination est interdite. Utilisez une URL HTTPS publique sur le port 443 ; les adresses privées, locales et les redirections sont refusées.",
    AI_CONNECTION_AUTHENTICATION_IN_PROGRESS: "Une connexion ChatGPT est en cours. Terminez-la avant de tester le modèle.",
    AI_PROVIDER_AUTHENTICATION_FAILED: "La clé a été refusée. Vérifiez les identifiants et leurs droits.",
    AI_PROVIDER_QUOTA_EXHAUSTED: "Le quota ou la limite du fournisseur est atteint. Vérifiez votre compte avant de retester.",
    AI_PROVIDER_MODEL_UNAVAILABLE: "Ce modèle est introuvable ou inaccessible avec cette clé.",
    AI_PROVIDER_OUTPUT_INVALID: "Ce modèle n’a pas produit le format nécessaire aux recherches. Choisissez un modèle compatible avec les appels de fonctions.",
    AI_PROVIDER_TIMEOUT: "Le modèle n’a pas répondu à temps. Vous pouvez relancer le test.",
    AI_CONNECTION_CHANGED: "La connexion a changé pendant le test. Testez sa version actuelle.",
    AI_CONNECTION_NOT_VALIDATED: "Testez ce modèle avec succès avant de le choisir par défaut.",
    INSTANCE_ADMIN_REQUIRED: "Cette opération est réservée à l’administrateur de l’instance.",
    VALIDATION_FAILED: "Vérifiez le nom, la clé et les identifiants des modèles.",
  };
  return messages[code] ?? "La connexion n’est pas disponible. Vérifiez sa configuration et réessayez.";
}

const connectionProviderLabels = { "openai-api": "OpenAI", anthropic: "Anthropic", openrouter: "OpenRouter", "openai-compatible": "API compatible OpenAI", "kimi-code": "Kimi", "codex-cli": "Codex via ChatGPT" };
