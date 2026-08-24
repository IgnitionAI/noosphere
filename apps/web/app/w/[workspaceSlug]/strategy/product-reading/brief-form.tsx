"use client";

import {
  ChevronDown,
  Globe2,
  LoaderCircle,
  Plus,
  Radar,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useActionState, useState } from "react";
import type { ProductResearchBrief, ResearchDocument } from "@/lib/api";
import {
  createResearchMission,
  type CreateMissionState,
} from "./actions";
import { DocumentUpload } from "./document-upload";

const depths = [
  {
    value: "quick",
    name: "Rapide",
    sources: "15–25 sources",
    description: "Première hypothèse et concurrents majeurs.",
  },
  {
    value: "standard",
    name: "Standard",
    sources: "30–60 sources",
    description: "Concurrents, segments, personas et preuves.",
  },
  {
    value: "deep",
    name: "Approfondie",
    sources: "80+ sources",
    description: "Recherche étendue et audit renforcé.",
  },
] as const;

const sourceLabels: Record<string, string> = {
  "fr,en": "FR + EN",
  fr: "FR",
  en: "EN",
};

const supportedGeographies = [
  "France",
  "Europe francophone",
  "Union européenne",
  "International",
] as const;

function languageSelection(languages: readonly string[] | undefined): string {
  if (!languages?.length) return "fr,en";
  if (languages.includes("fr") && languages.includes("en")) return "fr,en";
  if (languages.includes("fr")) return "fr";
  if (languages.includes("en")) return "en";
  return "fr,en";
}

export function BriefForm({
  workspaceSlug,
  initialBrief,
  initialDocuments,
}: {
  workspaceSlug: string;
  initialBrief?: ProductResearchBrief | null;
  initialDocuments: readonly ResearchDocument[];
}) {
  const action = createResearchMission.bind(null, workspaceSlug);
  const [state, formAction, pending] = useActionState<CreateMissionState, FormData>(
    action,
    { error: null },
  );
  const [competitors, setCompetitors] = useState<string[]>([
    ...(initialBrief?.knownCompetitors ?? []),
  ]);
  const [competitorDraft, setCompetitorDraft] = useState("");
  const [depth, setDepth] = useState<"quick" | "standard" | "deep">(
    initialBrief?.depth ?? "standard",
  );
  const [geography, setGeography] = useState(initialBrief?.geography ?? "France");
  const [languages, setLanguages] = useState(languageSelection(initialBrief?.languages));
  const [audienceGoal, setAudienceGoal] = useState<
    "end_customers" | "channel_partners" | "both"
  >(initialBrief?.audienceGoal ?? "end_customers");

  function addCompetitor() {
    const value = competitorDraft.trim();
    if (!value || competitors.some((competitor) => competitor.toLowerCase() === value.toLowerCase())) {
      return;
    }
    setCompetitors((current) => [...current, value]);
    setCompetitorDraft("");
  }

  return (
    <form action={formAction}>
      {competitors.map((competitor) => (
        <input key={competitor} name="knownCompetitors" type="hidden" value={competitor} />
      ))}
      <input name="depth" type="hidden" value={depth} />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2 className="font-semibold">Quel produit voulez-vous vendre ?</h2>
                {initialBrief ? (
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                    <Sparkles size={13} />
                    Prérempli depuis votre dernière étude
                  </p>
                ) : null}
              </div>
              <span className="badge">Requis</span>
            </div>
            <div className="panel-body">
              <div className="grid gap-4 md:grid-cols-2">
                <label>
                  <span className="mb-2 block text-xs font-semibold text-ink">
                    Site du produit
                  </span>
                  <div className="relative">
                    <Globe2 className="absolute left-3 top-2.5 text-muted" size={17} />
                    <input
                      className="control control-icon"
                      defaultValue={initialBrief?.productUrl ?? ""}
                      name="productUrl"
                      placeholder="https://…"
                      required
                      type="url"
                    />
                  </div>
                </label>
                <label>
                  <span className="mb-2 block text-xs font-semibold text-ink">
                    Nom du produit
                  </span>
                  <input
                    className="control"
                    defaultValue={initialBrief?.productName ?? ""}
                    maxLength={200}
                    name="productName"
                    placeholder="Nom du produit ou service"
                    required
                  />
                </label>
              </div>
              <label className="mt-4 block">
                <span className="mb-2 block text-xs font-semibold text-ink">
                  Ce que fait le produit
                </span>
                <textarea
                  className="control min-h-28 resize-y"
                  defaultValue={initialBrief?.description ?? ""}
                  maxLength={20_000}
                  name="description"
                  placeholder="Problème résolu, clients actuels, différenciation et mode de vente…"
                />
                <span className="mt-2 block text-xs text-muted">
                  Cette description guide la recherche ; elle ne sera pas traitée comme une preuve.
                </span>
              </label>
            </div>
            <footer className="border-t border-line p-4">
              <div className="sm:flex sm:items-center sm:justify-between sm:gap-4">
                <p className="mb-3 text-xs leading-5 text-muted sm:mb-0 sm:max-w-xl">
                  L’IA trouve les ICP, crée les campagnes utiles puis lance la prospection
                  automatiquement.
                </p>
                <button
                  className="button button-primary w-full flex-none sm:w-auto"
                  disabled={pending}
                  type="submit"
                >
                  {pending ? <LoaderCircle className="animate-spin" size={17} /> : <Radar size={17} />}
                  {pending ? "Lancement en cours…" : "Lancer mon ICP"}
                </button>
              </div>
              {state.error ? (
                <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-danger">
                  {state.error}
                </p>
              ) : null}
            </footer>
          </section>

          <details className="group rounded-xl border border-line bg-white">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 sm:p-5">
              <div>
                <h2 className="font-semibold">Options avancées</h2>
                <p className="mt-1 text-xs leading-5 text-muted">
                  Marché, concurrents, documents internes et profondeur de recherche.
                </p>
              </div>
              <ChevronDown
                className="flex-none text-muted transition-transform group-open:rotate-180"
                size={18}
              />
            </summary>
            <div className="space-y-4 border-t border-line bg-canvas/40 p-3 sm:p-4">
          <section className="panel">
            <div className="panel-header">
              <h2 className="font-semibold">Marché recherché</h2>
            </div>
            <div className="panel-body grid gap-4 md:grid-cols-3">
              <label>
                <span className="mb-2 block text-xs font-semibold text-ink">Géographie</span>
                <select
                  className="control"
                  name="geography"
                  onChange={(event) => setGeography(event.target.value)}
                  value={geography}
                >
                  {!supportedGeographies.includes(
                    geography as (typeof supportedGeographies)[number],
                  ) ? <option>{geography}</option> : null}
                  {supportedGeographies.map((option) => <option key={option}>{option}</option>)}
                </select>
              </label>
              <label>
                <span className="mb-2 block text-xs font-semibold text-ink">
                  Langue des sources
                </span>
                <select
                  className="control"
                  name="languages"
                  onChange={(event) => setLanguages(event.target.value)}
                  value={languages}
                >
                  <option value="fr,en">Français + anglais</option>
                  <option value="fr">Français uniquement</option>
                  <option value="en">Anglais uniquement</option>
                </select>
              </label>
              <label>
                <span className="mb-2 block text-xs font-semibold text-ink">Type de vente</span>
                <select
                  className="control"
                  defaultValue={initialBrief?.salesMotion ?? "hybrid"}
                  name="salesMotion"
                >
                  <option value="hybrid">SaaS + accompagnement</option>
                  <option value="saas">SaaS B2B</option>
                  <option value="service">Service</option>
                  <option value="license">Licence</option>
                </select>
              </label>
              <label>
                <span className="mb-2 block text-xs font-semibold text-ink">
                  Objectif de l’étude
                </span>
                <select
                  className="control"
                  defaultValue={initialBrief?.researchObjective ?? "qualified_conversations"}
                  name="researchObjective"
                >
                  <option value="qualified_conversations">Conversations qualifiées</option>
                  <option value="fast_revenue">Revenu le plus rapide</option>
                  <option value="strategic_market">Marché stratégique</option>
                </select>
              </label>
              <label>
                <span className="mb-2 block text-xs font-semibold text-ink">
                  Acheteurs recherchés
                </span>
                <select
                  className="control"
                  name="audienceGoal"
                  onChange={(event) =>
                    setAudienceGoal(
                      event.target.value as "end_customers" | "channel_partners" | "both",
                    )
                  }
                  value={audienceGoal}
                >
                  <option value="end_customers">Clients finaux — recommandé</option>
                  <option value="channel_partners">Partenaires et intégrateurs</option>
                  <option value="both">Clients finaux + partenaires</option>
                </select>
              </label>
              <label className="md:col-span-3">
                <span className="mb-2 block text-xs font-semibold text-ink">
                  Contraintes d’achat
                </span>
                <textarea
                  className="control min-h-20 resize-y"
                  defaultValue={initialBrief?.buyerConstraints ?? ""}
                  maxLength={5_000}
                  name="buyerConstraints"
                  placeholder="Ex. privilégier les structures sans équipe IA interne, avec des documents propriétaires et un sponsor métier."
                />
                <span className="mt-2 block text-xs text-muted">
                  Les équipes qui préfèrent construire en interne sont exclues automatiquement des ICP finaux.
                </span>
              </label>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2 className="font-semibold">Concurrents déjà connus</h2>
              <span className="text-xs text-muted">Facultatif</span>
            </div>
            <div className="panel-body">
              <p className="mb-3 text-xs leading-5 text-muted">
                Le deep agent cherchera également les concurrents directs, adjacents et les
                alternatives manuelles.
              </p>
              <div className="flex flex-wrap gap-2">
                {competitors.map((competitor) => (
                  <span className="badge min-h-8 bg-white px-3" key={competitor}>
                    {competitor}
                    <button
                      aria-label={`Retirer ${competitor}`}
                      className="text-muted hover:text-danger"
                      onClick={() =>
                        setCompetitors((current) => current.filter((item) => item !== competitor))
                      }
                      type="button"
                    >
                      <X size={13} />
                    </button>
                  </span>
                ))}
              </div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  className="control min-w-0 flex-1"
                  onChange={(event) => setCompetitorDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addCompetitor();
                    }
                  }}
                  placeholder="Nom ou URL d’un concurrent"
                  value={competitorDraft}
                />
                <button className="button" onClick={addCompetitor} type="button">
                  <Plus size={16} />
                  Ajouter
                </button>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2 className="font-semibold">Documents internes</h2>
              <span className="badge">Facultatif</span>
            </div>
            <div className="panel-body">
              <DocumentUpload
                workspaceSlug={workspaceSlug}
                initialDocuments={initialDocuments
                  .filter((document) => ["uploading", "uploaded", "processing", "ready", "partial", "ocr_required", "failed"].includes(document.status))
                  .map((document) => ({
                    id: document.id,
                    filename: document.filename,
                    status: document.status === "uploaded" || document.status === "uploading" ? "processing" : document.status,
                    failureCode: document.failureCode,
                    warnings: document.extractionWarnings,
                  }))}
              />
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2 className="font-semibold">Profondeur de l’étude</h2>
            </div>
            <div className="panel-body grid gap-3 md:grid-cols-3">
              {depths.map((option) => {
                const active = depth === option.value;
                return (
                  <button
                    aria-pressed={active}
                    className={`min-h-36 rounded-[10px] border p-4 text-left transition ${
                      active
                        ? "border-navy bg-[#fafbf8] shadow-[inset_0_-3px_0_var(--color-signal)]"
                        : "border-line bg-white hover:border-slate-400"
                    }`}
                    key={option.value}
                    onClick={() => setDepth(option.value)}
                    type="button"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <strong>{option.name}</strong>
                      {option.value === "standard" ? (
                        <span className="badge badge-signal">Recommandé</span>
                      ) : null}
                    </span>
                    <span className="mt-3 block font-mono text-xs">{option.sources}</span>
                    <span className="mt-2 block text-xs leading-5 text-muted">
                      {option.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
            </div>
          </details>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-20">
          <section className="panel">
            <div className="panel-header">
              <h2 className="font-semibold">Mission prête</h2>
              <span className="badge badge-signal capitalize">{depth}</span>
            </div>
            <div className="panel-body">
              <div className="space-y-3 text-xs">
                {[
                  ["Marché", geography],
                  ["Sources", sourceLabels[languages] ?? languages],
                  [
                    "Acheteurs",
                    audienceGoal === "end_customers"
                      ? "Clients finaux"
                      : audienceGoal === "channel_partners"
                        ? "Partenaires"
                        : "Clients + partenaires",
                  ],
                  ["Concurrents fournis", String(competitors.length)],
                  ["Profondeur", depths.find((item) => item.value === depth)?.name ?? depth],
                ].map(([key, value]) => (
                  <div className="flex justify-between gap-3 border-b border-line pb-2" key={key}>
                    <span className="text-muted">{key}</span>
                    <strong className="text-right">{value}</strong>
                  </div>
                ))}
              </div>
              <div className="mt-5 rounded-lg border border-line bg-canvas p-3 text-xs leading-5 text-muted">
                <ShieldCheck className="mb-2 text-success" size={17} />
                Chaque affirmation devra citer une source ou rester explicitement une hypothèse.
              </div>
            </div>
          </section>
        </aside>
      </div>
    </form>
  );
}
