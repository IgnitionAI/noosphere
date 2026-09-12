"use client";

import { useActionState, useState } from "react";
import type { AiCapability, AiModelRoute, WorkspaceAiSettings } from "@/lib/api";
import { capabilities } from "./model-routing-form";

type SaveState = { message: string; error: boolean };
type AllowedModel = AiModelRoute & { readonly connectionName: string };

export function InstanceModelRoutingForm({ settings, save }: {
  settings: WorkspaceAiSettings;
  save: (previous: SaveState, data: FormData) => Promise<SaveState>;
}) {
  const [state, action, pending] = useActionState(save, { message: "", error: false });
  const [defaults, setDefaults] = useState(settings.defaultRoutes);
  const [overrides, setOverrides] = useState(settings.capabilityRoutes);
  const [replaceLegacyResearch, setReplaceLegacyResearch] = useState(false);
  const models = settings.availableModels ?? [];
  const effective = defaults.length ? defaults : settings.effectiveDefaultRoutes ?? [];
  return <form action={action} className="mt-6 space-y-6">
    <input type="hidden" name="modelRouting" value={JSON.stringify({ defaultRoutes: defaults, capabilityRoutes: overrides, replaceLegacyResearch })} />
    <section className="rounded-xl border border-line bg-white p-5 space-y-4">
      <h2 className="font-semibold">Modèle du workspace</h2>
      <RouteChoice label="Modèle du workspace" inherit="Hérité de l’instance" routes={defaults} models={models} onChange={setDefaults} />
      <p className="text-sm text-muted">Modèle effectif : {effective.map((route) => route.model).join(" → ") || "Aucun modèle configuré"}</p>
      {!defaults.length && effective.some((route) => route.connectionId && !models.some((model) => routeKey(model) === routeKey(route))) && <p role="alert" className="text-sm text-amber-700">Le modèle hérité n’est plus disponible. L’administrateur de l’instance doit le réactiver, ou vous pouvez choisir un autre modèle autorisé.</p>}
      {!models.length && <p className="text-sm text-muted">Vous pouvez explorer sans IA. L’administrateur de l’instance doit configurer et tester un modèle pour activer les fonctions IA.</p>}
    </section>
    <section className="rounded-xl border border-line bg-white p-5 space-y-5">
      <h2 className="font-semibold">Personnaliser par usage</h2>
      {settings.researchTierRoutes && <div className="rounded-lg border border-line p-4 space-y-2">
        <h3 className="font-medium">Modèles de recherche conservés</h3>
        <p className="text-sm">Recherche : {settings.researchTierRoutes.principal.map((route) => route.model).join(" → ")}. Synthèse : {settings.researchTierRoutes.executor.map((route) => route.model).join(" → ")}.</p>
        <p className="text-sm text-muted">Ces choix restent utilisés pour la recherche, même si vous changez les autres usages.</p>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={replaceLegacyResearch} onChange={(event) => setReplaceLegacyResearch(event.target.checked)} />Remplacer ces choix par le modèle de recherche défini ci-dessous</label>
      </div>}
      {capabilities.map(({ id, label, detail }) => <div key={id} className="space-y-2">
        <RouteChoice label={label} inherit="Utiliser le modèle du workspace" routes={overrides[id] ?? []} models={models} onChange={(routes) => setOverrides((current) => {
          const next: Partial<Record<AiCapability, readonly AiModelRoute[]>> = { ...current };
          if (routes.length) next[id] = routes; else delete next[id];
          return next;
        })} />
        <p className="text-xs text-muted">{detail}</p>
      </div>)}
    </section>
    <p className="text-xs text-muted">Les connexions et les clés sont gérées par l’administrateur de l’instance. Les modèles de secours sont facultatifs et utilisés dans l’ordre choisi.</p>
    {state.message && <p role={state.error ? "alert" : "status"} className="text-sm">{state.message}</p>}
    <button className="button button-signal" type="submit" disabled={pending}>{pending ? "Enregistrement…" : "Enregistrer les modèles"}</button>
  </form>;
}

function RouteChoice({ label, inherit, routes, models, onChange }: {
  label: string; inherit: string; routes: readonly AiModelRoute[]; models: readonly AllowedModel[];
  onChange: (routes: readonly AiModelRoute[]) => void;
}) {
  function select(index: number, key: string) {
    const chosen = models.find((model) => routeKey(model) === key);
    if (!chosen) { onChange(index === 0 ? [] : routes.filter((_, position) => position !== index)); return; }
    const { connectionName: _name, ...route } = chosen;
    onChange([...routes.slice(0, index), route, ...routes.slice(index + 1)]);
  }
  return <div className="space-y-2">
    {(routes.length ? routes : [undefined]).map((route, index) => {
      const missing = route && !models.some((model) => routeKey(model) === routeKey(route));
      const accessibleLabel = index === 0 ? label : `${label} — secours ${index}`;
      return <label className="block space-y-1 text-sm" key={index}>
        <span>{accessibleLabel}</span>
        <select className="w-full rounded-lg border border-line bg-white p-2" aria-label={accessibleLabel} value={route ? routeKey(route) : ""} onChange={(event) => select(index, event.target.value)}>
          <option value="">{index === 0 ? inherit : "Supprimer ce secours"}</option>
          {missing && <option value={routeKey(route)} disabled>{route.model} — indisponible, à remplacer</option>}
          {models.filter((model) => !routes.some((selected, position) => position !== index && routeKey(selected) === routeKey(model))).map((model) => <option key={routeKey(model)} value={routeKey(model)}>{model.connectionName} · {model.model} · {model.reasoningEffort}</option>)}
        </select>
        {missing && <span className="text-amber-700">Ce choix reste enregistré, mais ce modèle ne peut plus être appelé. Réactivez-le ou sélectionnez un autre modèle autorisé.</span>}
      </label>;
    })}
    {routes.length > 0 && routes.length < 3 && models.some((model) => !routes.some((route) => routeKey(route) === routeKey(model))) &&
      <button type="button" className="text-xs underline" onClick={() => {
        const candidate = models.find((model) => !routes.some((route) => routeKey(route) === routeKey(model)));
        if (candidate) select(routes.length, routeKey(candidate));
      }}>Ajouter un modèle de secours pour {label.toLowerCase()}</button>}
  </div>;
}

function routeKey(route: AiModelRoute) {
  return JSON.stringify([route.connectionId, route.provider, route.model, route.reasoningEffort]);
}
