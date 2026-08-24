import { ShieldCheck, Sparkles } from "lucide-react";
import { notFound } from "next/navigation";
import { getAiModelCatalog, getWorkspaceAiSettings, listWorkspaces } from "@/lib/api";
import { saveWorkspaceAiSettings } from "./actions";
import { ModelRoutingForm } from "./model-routing-form";

export const dynamic = "force-dynamic";

export default async function WorkspaceAiSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const workspace = (await listWorkspaces()).find(
    (candidate) => candidate.slug === workspaceSlug,
  );
  if (!workspace || !["admin", "owner"].includes(workspace.role)) notFound();
  const [settings, catalog] = await Promise.all([
    getWorkspaceAiSettings(workspaceSlug),
    getAiModelCatalog(workspaceSlug),
  ]);
  const save = saveWorkspaceAiSettings.bind(null, workspaceSlug);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="badge badge-signal w-fit">
            <Sparkles size={13} />
            Orchestration IA
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">
            Modèles IA
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Choisissez Kimi ou Codex une fois pour tout Noosphere, puis personnalisez uniquement les usages qui le nécessitent.
          </p>
        </div>
        <div className="badge">
          Source : {settings.source === "workspace" ? "workspace" : "VPS"}
        </div>
      </div>

      <form action={save} className="mt-6 space-y-6">
        <ModelRoutingForm catalog={catalog} settings={settings} />

        <div className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 text-emerald-600" size={18} />
            <p className="max-w-2xl text-xs leading-5 text-muted">
              Les authentifications Kimi et Codex restent sur le serveur. Cette page ne stocke que le fournisseur, le modèle, le niveau de réflexion et l’ordre des fallbacks.
            </p>
          </div>
          <button className="button button-signal shrink-0" type="submit">
            Enregistrer les modèles
          </button>
        </div>
      </form>
    </div>
  );
}
