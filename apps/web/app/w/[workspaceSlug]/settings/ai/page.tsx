import { Cpu, Gauge, ShieldCheck, Sparkles } from "lucide-react";
import { notFound } from "next/navigation";
import { getWorkspaceAiSettings, listWorkspaces } from "@/lib/api";
import { saveWorkspaceAiSettings } from "./actions";

const models = [
  {
    id: "k3",
    label: "Kimi K3",
    description: "Recherche profonde et raisonnement long.",
  },
  {
    id: "kimi-for-coding",
    label: "Kimi K2.7 Code",
    description: "Choix stable et disponible pour tous les abonnements.",
  },
  {
    id: "kimi-for-coding-highspeed",
    label: "Kimi K2.7 HighSpeed",
    description: "Réponses plus rapides avec une consommation de quota supérieure.",
  },
  {
    id: "k3-256k",
    label: "Kimi K3 256k",
    description: "Alias disponible sur certains comptes Kimi Code.",
  },
] as const;

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
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-navy">
            Modèles Kimi du workspace
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Le premier modèle est prioritaire. Les suivants sont utilisés uniquement
            lorsqu’un modèle est explicitement indisponible pour le compte.
          </p>
        </div>
        <div className="badge">
          Source : {settings.source === "workspace" ? "workspace" : "VPS"}
        </div>
      </div>

      <form action={save} className="mt-6 space-y-6">
        <ModelPolicyCard
          description="Analyse produit, découverte concurrentielle et audit des preuves."
          icon={<Cpu size={18} />}
          models={settings.researchModels}
          name="researchModel"
          title="Recherche approfondie"
        />
        <ModelPolicyCard
          description="Synthèse des segments et classement des propositions ICP."
          icon={<Gauge size={18} />}
          models={settings.synthesisModels}
          name="synthesisModel"
          title="Synthèse structurée"
        />

        <div className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 text-emerald-600" size={18} />
            <p className="max-w-2xl text-xs leading-5 text-muted">
              La clé Kimi reste exclusivement dans l’environnement du worker. Cette
              page ne stocke que les IDs et leur ordre de priorité.
            </p>
          </div>
          <button className="button button-signal shrink-0" type="submit">
            Enregistrer la politique
          </button>
        </div>
      </form>
    </div>
  );
}

function ModelPolicyCard({
  title,
  description,
  name,
  models: selectedModels,
  icon,
}: {
  title: string;
  description: string;
  name: string;
  models: readonly string[];
  icon: React.ReactNode;
}) {
  const values = [selectedModels[0] ?? "", selectedModels[1] ?? "", selectedModels[2] ?? ""];
  return (
    <section className="rounded-xl border border-line bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-navy text-signal">
          {icon}
        </span>
        <div>
          <h2 className="font-semibold text-navy">{title}</h2>
          <p className="mt-1 text-xs leading-5 text-muted">{description}</p>
        </div>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {values.map((value, index) => (
          <label className="block" key={`${name}-${index}`}>
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted">
              {index === 0 ? "Principal" : `Fallback ${index}`}
            </span>
            <select
              className="input w-full"
              defaultValue={value}
              name={name}
              required={index === 0}
            >
              {index > 0 ? <option value="">Aucun</option> : null}
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {models.map((model) => (
          <div className="rounded-lg bg-slate-50 px-3 py-2" key={model.id}>
            <div className="text-xs font-semibold text-navy">{model.label}</div>
            <div className="mt-0.5 text-[11px] leading-4 text-muted">{model.description}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
