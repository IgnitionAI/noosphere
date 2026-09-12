import { Sparkles } from "lucide-react";
import { notFound } from "next/navigation";
import { getWorkspaceAiSettings, listWorkspaces } from "@/lib/api";
import { saveWorkspaceAiSettings } from "./actions";
import { InstanceModelRoutingForm } from "./instance-model-routing-form";

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
  const settings = await getWorkspaceAiSettings(workspaceSlug);
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
            Utilisez le modèle de l’instance ou choisissez un modèle autorisé pour ce workspace et ses usages.
          </p>
        </div>
        <div className="badge">
          {settings.source === "workspace" ? "Choix du workspace" : "Hérité de l’instance"}
        </div>
      </div>

      <InstanceModelRoutingForm settings={settings} save={save} />

    </div>
  );
}
