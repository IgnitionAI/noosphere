"use client";

import { FileText, Image, Type } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ContentBrandKit, LinkedinContentFormat } from "@/lib/api";
import { updateBrandKitAction } from "./actions";

const formats: readonly { format: LinkedinContentFormat; label: string; detail: string; icon: typeof Type; fallback: number }[] = [
  { format: "linkedin_text", label: "Texte", detail: "Idées et prises de position", icon: Type, fallback: 6 },
  { format: "linkedin_image", label: "Image", detail: "Un message visuel mémorable", icon: Image, fallback: 4 },
  { format: "linkedin_document", label: "Carrousel", detail: "PDF éducatif de 3 à 9 pages", icon: FileText, fallback: 3 },
];

export function FormatControls({ workspaceSlug, initial }: { workspaceSlug: string; initial: ContentBrandKit["snapshot"] }) {
  const router = useRouter();
  const [brandKit, setBrandKit] = useState<ContentBrandKit["snapshot"]>({
    ...initial,
    enabledFormats: initial.enabledFormats.filter((format) => format !== "linkedin_video"),
    weeklyMix: { ...initial.weeklyMix, linkedin_video: 0 },
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = formats.reduce((sum, item) => sum + brandKit.weeklyMix[item.format], 0);

  function toggle(format: LinkedinContentFormat) {
    const enabled = brandKit.enabledFormats.includes(format);
    const nextFormats = enabled ? brandKit.enabledFormats.filter((item) => item !== format) : [...brandKit.enabledFormats, format];
    if (nextFormats.length === 0) return;
    const fallback = formats.find((item) => item.format === format)?.fallback ?? 1;
    setBrandKit({ ...brandKit, enabledFormats: nextFormats, weeklyMix: { ...brandKit.weeklyMix, [format]: enabled ? 0 : fallback } });
  }

  function setTarget(format: LinkedinContentFormat, value: number) {
    setBrandKit({ ...brandKit, weeklyMix: { ...brandKit.weeklyMix, [format]: Math.max(1, Math.min(14, value)) } });
  }

  async function save() {
    setPending(true);
    setError(null);
    try {
      await updateBrandKitAction(workspaceSlug, brandKit);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Les formats n’ont pas pu être enregistrés");
    } finally {
      setPending(false);
    }
  }

  return <div className="mt-4">
    <div className="grid gap-2 sm:grid-cols-3">
      {formats.map((item) => {
        const enabled = brandKit.enabledFormats.includes(item.format);
        const Icon = item.icon;
        return <article className={`rounded-xl border p-4 transition-colors ${enabled ? "border-navy bg-navy/[0.035]" : "border-line bg-surface-subtle opacity-70"}`} key={item.format}>
          <div className="flex items-start justify-between gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-ink shadow-sm"><Icon size={17} /></span><button aria-pressed={enabled} className={`rounded-full px-3 py-1 text-xs font-bold ${enabled ? "bg-navy text-white" : "bg-line text-muted"}`} disabled={pending} onClick={() => toggle(item.format)} type="button">{enabled ? "Actif" : "Inactif"}</button></div>
          <h3 className="mt-3 font-semibold text-ink">{item.label}</h3><p className="mt-1 min-h-10 text-xs leading-5 text-muted">{item.detail}</p>
          {enabled ? <label className="mt-3 flex items-center justify-between gap-3 text-xs font-semibold text-muted">Cible / semaine<input aria-label={`Cible ${item.label} par semaine`} className="input h-9 w-20 text-center" max={14} min={1} onChange={(event) => setTarget(item.format, Number(event.target.value))} type="number" value={brandKit.weeklyMix[item.format]} /></label> : null}
        </article>;
      })}
    </div>
    <div className="mt-4 flex flex-col gap-3 rounded-xl bg-surface-subtle p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold text-ink">Mix cible : {total} contenus / semaine</p><p className="mt-1 text-xs text-muted">Noosphere choisit le format qui sert le mieux chaque idée et rééquilibre le mix automatiquement.</p></div><button className="button button-primary shrink-0" disabled={pending || total > 14} onClick={save} type="button">{pending ? "Enregistrement…" : "Enregistrer le mix"}</button></div>
    {total > 14 ? <p className="mt-2 text-xs font-semibold text-danger" role="alert">Le total doit rester à 14 contenus maximum par semaine.</p> : null}
    {error ? <p className="mt-2 text-xs font-semibold text-danger" role="alert">{error}</p> : null}
  </div>;
}
