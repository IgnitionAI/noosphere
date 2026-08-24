"use client";

import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  AiCapability,
  AiModelCatalog,
  AiModelRoute,
  AiProviderId,
  AiReasoningEffort,
  WorkspaceAiSettings,
} from "@/lib/api";

const capabilities: readonly { id: AiCapability; label: string; detail: string }[] = [
  { id: "icp_research", label: "Recherche ICP", detail: "Analyse du produit, marché et segments" },
  { id: "content_strategy", label: "Stratégie éditoriale", detail: "Piliers, angle et cadence Inbound" },
  { id: "content_idea", label: "Recherche d’idées", detail: "Sujets sourcés et dédupliqués" },
  { id: "content_brief", label: "Brief de contenu", detail: "Structure et preuves du post" },
  { id: "content_writer", label: "Rédaction", detail: "Première version des posts et messages" },
  { id: "content_audit", label: "Audit des preuves", detail: "Vérification des faits et affirmations" },
  { id: "content_critic", label: "Critique éditoriale", detail: "Qualité, naturel et anti-générique" },
  { id: "brand_direction", label: "Identité de marque", detail: "Palette, voix et direction visuelle" },
  { id: "channel_strategy", label: "Stratégie de sourcing", detail: "Sources et requêtes adaptées à chaque canal" },
  { id: "prospect_decision", label: "Décision prospect", detail: "Score, canal et prochaine action" },
  { id: "message_generation", label: "Messages de prospection", detail: "Premier contact et relances" },
  { id: "setter", label: "Setter IA", detail: "Réponses et qualification des conversations" },
  { id: "evaluation", label: "Évaluation", detail: "Contrôle automatique de la qualité" },
] as const;

const providerLabels: Record<AiProviderId, string> = {
  "kimi-code": "Kimi",
  "codex-cli": "Codex",
  "openai-api": "OpenAI API",
};

const effortLabels: Record<AiReasoningEffort, string> = {
  low: "Minimal",
  medium: "Moyen",
  high: "Élevé",
  xhigh: "Très élevé",
  max: "Maximum",
  ultra: "Ultra",
};

export function ModelRoutingForm({
  catalog,
  settings,
}: {
  catalog: AiModelCatalog;
  settings: WorkspaceAiSettings;
}) {
  const fallbackRoute = firstAvailableRoute(catalog);
  const [defaultRoutes, setDefaultRoutes] = useState<readonly AiModelRoute[]>(
    settings.defaultRoutes.length ? settings.defaultRoutes : [fallbackRoute],
  );
  const [overrides, setOverrides] = useState<Partial<Record<AiCapability, readonly AiModelRoute[]>>>(
    settings.capabilityRoutes,
  );
  const [newCapability, setNewCapability] = useState<AiCapability | "">("");
  const primary = defaultRoutes[0] ?? fallbackRoute;
  const availableCapabilities = capabilities.filter((capability) => !overrides[capability.id]);
  const serialized = JSON.stringify({ defaultRoutes, capabilityRoutes: overrides });

  function updatePrimary(route: AiModelRoute) {
    setDefaultRoutes([route, ...defaultRoutes.slice(1)]);
  }

  function addFallback() {
    if (defaultRoutes.length >= 3) return;
    setDefaultRoutes([...defaultRoutes, fallbackRoute]);
  }

  function addOverride() {
    if (!newCapability) return;
    setOverrides((current) => ({ ...current, [newCapability]: [primary] }));
    setNewCapability("");
  }

  return (
    <>
      <input name="modelRouting" type="hidden" value={serialized} />

      <section className="panel">
        <div className="panel-header items-start">
          <div>
            <h2 className="font-semibold text-ink">Modèle utilisé partout</h2>
            <p className="mt-1 text-xs leading-5 text-muted">
              Ce choix s’applique à toute l’IA. Vous pouvez personnaliser certains usages plus bas.
            </p>
          </div>
          <span className="badge badge-success">Global</span>
        </div>
        <div className="p-4 sm:p-5">
          <RouteEditor catalog={catalog} id="global" onChange={updatePrimary} route={primary} />
        </div>
      </section>

      <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="État des fournisseurs">
        {catalog.providers.map((provider) => (
          <div className="rounded-xl border border-line bg-white p-4" key={provider.provider}>
            <div className="flex items-center justify-between gap-3">
              <strong className="text-sm text-ink">{providerLabels[provider.provider]}</strong>
              <ProviderStatus status={provider.status} />
            </div>
            <p className="mt-2 text-xs text-muted">
              {provider.models.length} modèle{provider.models.length > 1 ? "s" : ""} disponible{provider.models.length > 1 ? "s" : ""}
            </p>
          </div>
        ))}
      </section>

      <details className="panel mt-6" open={Object.keys(overrides).length > 0 || defaultRoutes.length > 1}>
        <summary className="flex min-h-12 list-none items-center justify-between gap-4 px-4 py-3 font-semibold text-ink">
          Réglages avancés
          <span className="text-xs font-normal text-muted">Fallbacks et modèles par usage</span>
        </summary>
        <div className="border-t border-line p-4 sm:p-5">
          <section>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-ink">Bascule automatique</h3>
                <p className="mt-1 text-xs text-muted">Si le fournisseur principal est indisponible ou hors quota.</p>
              </div>
              <button className="button" disabled={defaultRoutes.length >= 3} onClick={addFallback} type="button">
                <Plus size={14} /> Ajouter un fallback
              </button>
            </div>
            {defaultRoutes.length > 1 ? (
              <div className="mt-4 space-y-3">
                {defaultRoutes.slice(1).map((route, index) => (
                  <div className="rounded-lg border border-line bg-slate-50 p-3" key={`fallback-${index}`}>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <strong className="text-xs text-ink">Fallback {index + 1}</strong>
                      <button
                        aria-label={`Supprimer le fallback ${index + 1}`}
                        className="button min-h-9 px-2.5"
                        onClick={() => setDefaultRoutes(defaultRoutes.filter((_, routeIndex) => routeIndex !== index + 1))}
                        type="button"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <RouteEditor
                      catalog={catalog}
                      id={`fallback-${index}`}
                      onChange={(next) => setDefaultRoutes(defaultRoutes.map((item, routeIndex) => routeIndex === index + 1 ? next : item))}
                      route={route}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-muted">Aucun fallback : une erreur sera remontée si le modèle global est indisponible.</p>
            )}
          </section>

          <section className="mt-6 border-t border-line pt-6">
            <div>
              <h3 className="text-sm font-semibold text-ink">Modèles par usage</h3>
              <p className="mt-1 text-xs text-muted">Laissez vide pour conserver le choix global.</p>
            </div>

            <div className="mt-4 space-y-3">
              {capabilities.flatMap((capability) => {
                const route = overrides[capability.id]?.[0];
                if (!route) return [];
                return [(
                  <div className="rounded-lg border border-line bg-white p-4" key={capability.id}>
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <strong className="block text-sm text-ink">{capability.label}</strong>
                        <span className="mt-0.5 block text-[11px] text-muted">{capability.detail}</span>
                      </div>
                      <button
                        aria-label={`Utiliser à nouveau le modèle global pour ${capability.label}`}
                        className="button min-h-9 px-2.5"
                        onClick={() => setOverrides((current) => {
                          const next = { ...current };
                          delete next[capability.id];
                          return next;
                        })}
                        title="Revenir au modèle global"
                        type="button"
                      >
                        <RotateCcw size={14} />
                      </button>
                    </div>
                    <RouteEditor
                      catalog={catalog}
                      id={`capability-${capability.id}`}
                      onChange={(next) => setOverrides((current) => ({ ...current, [capability.id]: [next] }))}
                      route={route}
                    />
                  </div>
                )];
              })}
            </div>

            {availableCapabilities.length ? (
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">Usage à personnaliser</span>
                  <select className="control" onChange={(event) => setNewCapability(event.target.value as AiCapability | "")} value={newCapability}>
                    <option value="">Choisir un usage à personnaliser</option>
                    {availableCapabilities.map((capability) => <option key={capability.id} value={capability.id}>{capability.label}</option>)}
                  </select>
                </label>
                <button className="button" disabled={!newCapability} onClick={addOverride} type="button">
                  <Plus size={14} /> Personnaliser
                </button>
              </div>
            ) : null}
          </section>
        </div>
      </details>
    </>
  );
}

function RouteEditor({
  catalog,
  id,
  route,
  onChange,
}: {
  catalog: AiModelCatalog;
  id: string;
  route: AiModelRoute;
  onChange: (route: AiModelRoute) => void;
}) {
  const provider = catalog.providers.find((item) => item.provider === route.provider);
  const models = provider?.models ?? [];
  const model = models.find((item) => item.id === route.model);
  const efforts = model?.reasoningEfforts.length ? model.reasoningEfforts : [route.reasoningEffort];
  const providerOptions = useMemo(() => catalog.providers.filter((item) => item.models.length > 0 || item.provider === route.provider), [catalog.providers, route.provider]);

  function changeProvider(nextProviderId: AiProviderId) {
    const nextProvider = catalog.providers.find((item) => item.provider === nextProviderId);
    const nextModel = nextProvider?.models[0];
    if (!nextModel) return;
    onChange({
      provider: nextProviderId,
      model: nextModel.id,
      reasoningEffort: recommendedEffort(nextProviderId, nextModel.reasoningEfforts),
    });
  }

  function changeModel(modelId: string) {
    const nextModel = models.find((item) => item.id === modelId);
    if (!nextModel) return;
    onChange({
      ...route,
      model: modelId,
      reasoningEffort: nextModel.reasoningEfforts.includes(route.reasoningEffort)
        ? route.reasoningEffort
        : recommendedEffort(route.provider, nextModel.reasoningEfforts),
    });
  }

  return (
    <div className="grid gap-3 md:grid-cols-3">
      <label className="text-xs font-semibold text-muted" htmlFor={`${id}-provider`}>
        Fournisseur
        <select className="control mt-1.5" id={`${id}-provider`} onChange={(event) => changeProvider(event.target.value as AiProviderId)} value={route.provider}>
          {providerOptions.map((item) => <option disabled={!item.models.length} key={item.provider} value={item.provider}>{providerLabels[item.provider]}</option>)}
        </select>
      </label>
      <label className="text-xs font-semibold text-muted" htmlFor={`${id}-model`}>
        Modèle
        <select className="control mt-1.5" id={`${id}-model`} onChange={(event) => changeModel(event.target.value)} value={route.model}>
          {!model ? <option value={route.model}>{route.model} (configuration actuelle)</option> : null}
          {models.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
        </select>
      </label>
      <label className="text-xs font-semibold text-muted" htmlFor={`${id}-effort`}>
        Réflexion
        <select
          className="control mt-1.5"
          id={`${id}-effort`}
          onChange={(event) => onChange({ ...route, reasoningEffort: event.target.value as AiReasoningEffort })}
          value={route.reasoningEffort}
        >
          {!efforts.includes(route.reasoningEffort) ? <option value={route.reasoningEffort}>{effortLabels[route.reasoningEffort]}</option> : null}
          {efforts.map((effort) => <option key={effort} value={effort}>{effortLabels[effort]}</option>)}
        </select>
      </label>
    </div>
  );
}

function ProviderStatus({ status }: { status: AiModelCatalog["providers"][number]["status"] }) {
  const label = {
    healthy: "Prêt",
    degraded: "Catalogue dégradé",
    quota_exhausted: "Quota épuisé",
    authentication_required: "Connexion requise",
    unavailable: "Non configuré",
  }[status];
  const className = status === "healthy"
    ? "badge badge-success"
    : status === "quota_exhausted" || status === "authentication_required"
      ? "badge badge-warning"
      : "badge";
  return <span className={className}>{label}</span>;
}

function firstAvailableRoute(catalog: AiModelCatalog): AiModelRoute {
  for (const provider of catalog.providers) {
    const model = provider.models[0];
    if (!model) continue;
    return {
      provider: provider.provider,
      model: model.id,
      reasoningEffort: recommendedEffort(provider.provider, model.reasoningEfforts),
    };
  }
  return { provider: "kimi-code", model: "k3", reasoningEffort: "max" };
}

function recommendedEffort(
  provider: AiProviderId,
  efforts: readonly AiReasoningEffort[],
): AiReasoningEffort {
  const preferred = provider === "codex-cli" ? "xhigh" : provider === "kimi-code" ? "max" : "high";
  if (efforts.includes(preferred)) return preferred;
  if (efforts.includes("medium")) return "medium";
  return efforts[0] ?? "medium";
}
