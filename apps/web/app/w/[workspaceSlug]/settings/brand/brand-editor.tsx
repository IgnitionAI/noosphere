"use client";

import { Check, Globe2, ImageUp, LoaderCircle, Save, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { ContentBrandKit } from "@/lib/api";
import { generateWorkspaceBrandDirectionAction, importWorkspaceBrandLogoAction, updateWorkspaceBrandAction } from "./actions";

type Snapshot = ContentBrandKit["snapshot"];

export function BrandEditor({ workspaceSlug, initial }: { workspaceSlug: string; initial: Snapshot }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [brand, setBrand] = useState(initial);
  const [pending, setPending] = useState<"save" | "logo" | "direction" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setPending("save"); setNotice(null); setError(null);
    try {
      const updated = await updateWorkspaceBrandAction(workspaceSlug, brand);
      setBrand(updated.snapshot);
      setNotice("Identité enregistrée. Elle s’applique maintenant à l’Inbound et à l’Outbound.");
      router.refresh();
    } catch (cause) { setError(message(cause, "L’identité n’a pas pu être enregistrée.")); }
    finally { setPending(null); }
  }

  async function importLogo() {
    const file = fileInput.current?.files?.[0];
    if (!file) { setError("Sélectionnez un logo PNG, JPEG ou WebP."); return; }
    setPending("logo"); setNotice(null); setError(null);
    try {
      const data = new FormData(); data.set("logo", file);
      const updated = await importWorkspaceBrandLogoAction(workspaceSlug, data);
      setBrand(updated.snapshot);
      setNotice("Logo importé. Noosphere compose maintenant la direction visuelle.");
      if (fileInput.current) fileInput.current.value = "";
      const designed = await generateWorkspaceBrandDirectionAction(workspaceSlug, {
        landingPageUrl: updated.snapshot.websiteUrl,
        description: usableDescription(updated.snapshot.brandDescription),
        useLogo: true,
      });
      setBrand(designed.brandKit.snapshot);
      setNotice("Logo analysé et direction visuelle créée par l’agent.");
      router.refresh();
    } catch (cause) { setError(message(cause, "Le logo ou sa direction visuelle n’a pas pu être traité.")); }
    finally { setPending(null); }
  }

  async function generateDirection() {
    setPending("direction"); setNotice(null); setError(null);
    try {
      const designed = await generateWorkspaceBrandDirectionAction(workspaceSlug, {
        landingPageUrl: brand.websiteUrl,
        description: usableDescription(brand.brandDescription),
        useLogo: Boolean(brand.logo),
      });
      setBrand(designed.brandKit.snapshot);
      setNotice("Direction visuelle créée et enregistrée. Les contenus suivants utiliseront cette identité.");
      router.refresh();
    } catch (cause) { setError(message(cause, "La direction visuelle n’a pas pu être créée.")); }
    finally { setPending(null); }
  }

  function updateColor(key: keyof Snapshot["colors"], value: string) {
    setBrand({
      ...brand,
      colors: { ...brand.colors, [key]: value.toUpperCase() },
      paletteMetadata: { generatedBy: "manual", sources: ["manual"], rationale: null },
    });
  }

  return <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)]">
    <div className="space-y-6">
      <section className="panel p-5">
        <div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold text-navy">Fondations</h2><p className="mt-1 text-xs leading-5 text-muted">Donnez à Noosphere votre site, votre logo ou quelques mots. L’agent compose l’identité à partir des signaux disponibles.</p></div><span className="badge badge-success"><Check size={12} /> Inbound + Outbound</span></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Nom de marque"><input className="control mt-1" maxLength={120} onChange={(event) => setBrand({ ...brand, brandName: event.target.value })} value={brand.brandName} /></Field>
          <Field label="Signature"><input className="control mt-1" maxLength={180} onChange={(event) => setBrand({ ...brand, tagline: event.target.value || null })} placeholder="Votre promesse en une ligne" value={brand.tagline ?? ""} /></Field>
          <Field label="Site web"><input className="control mt-1" onChange={(event) => setBrand({ ...brand, websiteUrl: event.target.value || null })} placeholder="https://votre-marque.fr" type="url" value={brand.websiteUrl ?? ""} /></Field>
          <Field label="Typographie"><select className="control mt-1" onChange={(event) => setBrand({ ...brand, typography: event.target.value as Snapshot["typography"] })} value={brand.typography}><option value="inter">Inter</option><option value="space_grotesk">Space Grotesk</option><option value="system">Système</option></select></Field>
        </div>
        <Field label="Décrivez l’univers de la marque (optionnel)"><textarea className="control mt-1 min-h-24 resize-y" maxLength={2_000} onChange={(event) => setBrand({ ...brand, brandDescription: event.target.value || null })} placeholder="Ex. Une plateforme B2B sobre et premium, destinée aux directions juridiques. Elle doit inspirer confiance sans paraître institutionnelle." value={brand.brandDescription ?? ""} /></Field>
        <div className="mt-5 rounded-xl border border-dashed border-line bg-surface-subtle p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="grid h-20 w-28 shrink-0 place-items-center overflow-hidden rounded-xl border border-line bg-white p-2">{brand.logo ? <img alt={`Logo ${brand.brandName}`} className="max-h-full max-w-full object-contain" src={brand.logo.previewDataUrl} /> : <ImageUp className="text-muted" size={26} />}</div>
            <div className="min-w-0 flex-1"><strong className="block text-sm text-navy">{brand.logo?.sourceFileName ?? "Aucun logo importé"}</strong><p className="mt-1 text-xs text-muted">PNG, JPEG ou WebP · 5 Mo maximum. La transparence est conservée.</p><input accept="image/png,image/jpeg,image/webp" className="mt-3 block w-full text-xs text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-2 file:font-semibold file:text-navy" ref={fileInput} type="file" /></div>
            <div className="flex gap-2"><button className="button" disabled={Boolean(pending)} onClick={importLogo} type="button">{pending === "logo" ? <LoaderCircle className="animate-spin" size={15} /> : <ImageUp size={15} />} Importer</button>{brand.logo ? <button aria-label="Retirer le logo" className="button" disabled={Boolean(pending)} onClick={() => setBrand({ ...brand, logo: null })} type="button"><Trash2 size={15} /></button> : null}</div>
          </div>
        </div>
      </section>

      <section className="panel overflow-hidden">
        <div className="border-b border-line bg-surface-subtle p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><Sparkles className="text-brand-blue" size={17} /><h2 className="font-semibold text-navy">Direction visuelle intelligente</h2></div><p className="mt-1 max-w-2xl text-xs leading-5 text-muted">L’agent lit la landing page avec le crawler sécurisé, interprète les couleurs du logo et votre description, puis vérifie les contrastes avant d’enregistrer la palette.</p></div><button className="button button-primary shrink-0" disabled={Boolean(pending) || (!brand.websiteUrl && !brand.logo && !usableDescription(brand.brandDescription))} onClick={generateDirection} type="button">{pending === "direction" ? <LoaderCircle className="animate-spin" size={15} /> : <Sparkles size={15} />} Créer la direction</button></div></div>
        <div className="p-5">
          <div className="flex flex-wrap gap-2">{brand.websiteUrl ? <span className="badge"><Globe2 size={12} /> Landing page</span> : null}{brand.logo ? <span className="badge"><ImageUp size={12} /> Logo</span> : null}{brand.brandDescription ? <span className="badge"><Sparkles size={12} /> Description</span> : null}</div>
          {brand.paletteMetadata.rationale ? <p className="mt-4 rounded-xl border border-line bg-white p-4 text-sm leading-6 text-navy">{brand.paletteMetadata.rationale}</p> : <p className="mt-4 text-xs leading-5 text-muted">Ajoutez au moins une source. Plus l’agent dispose de signaux cohérents, plus la palette sera spécifique à votre marque.</p>}
          <div className="mt-5 grid grid-cols-4 overflow-hidden rounded-xl border border-line" aria-label="Palette actuelle">{([['primary','Principal'],['accent','Accent'],['background','Fond'],['text','Texte']] as const).map(([key, label]) => <div className="min-h-24 p-3" key={key} style={{ backgroundColor: brand.colors[key], color: key === "primary" ? brand.colors.background : key === "background" ? brand.colors.text : undefined }}><span className="text-[10px] font-bold uppercase tracking-[0.12em]">{label}</span><span className="mt-7 block font-mono text-[10px]">{brand.colors[key]}</span></div>)}</div>
          <details className="mt-5 rounded-xl border border-line"><summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-navy">Ajuster manuellement</summary><div className="grid gap-4 border-t border-line p-4 sm:grid-cols-2">{([['primary','Couleur principale'],['accent','Accent'],['background','Fond'],['text','Texte']] as const).map(([key, label]) => <label className="text-xs font-semibold text-muted" key={key}>{label}<span className="mt-1 flex items-center gap-2"><input aria-label={label} className="h-10 w-12 cursor-pointer rounded border border-line bg-white p-1" onChange={(event) => updateColor(key, event.target.value)} type="color" value={brand.colors[key]} /><input className="control font-mono uppercase" maxLength={7} onChange={(event) => updateColor(key, event.target.value)} value={brand.colors[key]} /></span></label>)}<Field label="Style des visuels"><select className="control mt-1" onChange={(event) => setBrand({ ...brand, imageStyle: event.target.value as Snapshot["imageStyle"] })} value={brand.imageStyle}><option value="editorial">Éditorial</option><option value="technical">Technique</option><option value="bold">Audacieux</option><option value="minimal">Minimal</option></select></Field></div></details>
        </div>
      </section>

      <section className="panel p-5"><h2 className="font-semibold text-navy">Voix de marque</h2><p className="mt-1 text-xs leading-5 text-muted">Des consignes courtes suffisent. Elles guident les posts, la prospection et les réponses sans jamais remplacer les règles de vérité.</p><div className="mt-5 grid gap-4">
        <ListField label="Le ton à adopter" value={brand.voice.traits} placeholder={'direct\nchaleureux\nexpert sans jargon'} onChange={(traits) => setBrand({ ...brand, voice: { ...brand.voice, traits } })} />
        <ListField label="Ce qu’il faut éviter" value={brand.voice.avoid} placeholder={'superlatifs\npromesses vagues\nton robotique'} onChange={(avoid) => setBrand({ ...brand, voice: { ...brand.voice, avoid } })} />
        <ListField label="Vocabulaire préféré (optionnel)" value={brand.voice.preferredVocabulary} placeholder={'recherche documentaire\npreuve résoluble'} onChange={(preferredVocabulary) => setBrand({ ...brand, voice: { ...brand.voice, preferredVocabulary } })} />
      </div></section>

      {notice ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800" role="status">{notice}</p> : null}
      {error ? <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-danger" role="alert">{error}</p> : null}
      <button className="button button-primary w-full sm:w-auto" disabled={Boolean(pending)} onClick={save} type="button">{pending === "save" ? <LoaderCircle className="animate-spin" size={15} /> : <Save size={15} />} Enregistrer l’identité</button>
    </div>

    <aside className="lg:sticky lg:top-6 lg:self-start"><div className="panel overflow-hidden"><div className="panel-header"><div><h2 className="font-semibold">Aperçu</h2><p className="mt-1 text-xs text-muted">Une image LinkedIn 4:5</p></div><span className="badge">Automatique</span></div><div className="p-4"><div className="aspect-[4/5] overflow-hidden rounded-xl p-7 shadow-sm" style={{ backgroundColor: brand.colors.primary, color: brand.colors.background }}><div className="flex items-start justify-between gap-4"><strong className="text-xs uppercase tracking-[0.2em]">{brand.brandName}</strong>{brand.logo ? <span className="grid h-12 w-20 place-items-center rounded-lg bg-white/95 p-2"><img alt="" className="max-h-full max-w-full object-contain" src={brand.logo.previewDataUrl} /></span> : null}</div><div className="mt-20"><span className="block h-1.5 w-16 rounded-full" style={{ backgroundColor: brand.colors.accent }} /><h3 className="mt-6 text-3xl font-black leading-tight">Une idée forte, immédiatement reconnaissable.</h3><p className="mt-5 text-sm leading-6 opacity-80">Noosphere applique votre identité sans vous demander de redesigner chaque contenu.</p></div><p className="mt-20 border-t border-white/20 pt-5 text-xs font-semibold">{brand.tagline ?? brand.brandName}</p></div></div></div><p className="mt-3 px-2 text-xs leading-5 text-muted">Le logo complet est utilisé dans les images et chaque page des carrousels. La voix guide aussi les messages et les réponses.</p></aside>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="text-xs font-semibold text-muted">{label}{children}</label>; }
function ListField({ label, value, placeholder, onChange }: { label: string; value: readonly string[]; placeholder: string; onChange: (value: string[]) => void }) { return <label className="text-xs font-semibold text-muted">{label}<textarea className="control mt-1 min-h-24 resize-y" onChange={(event) => onChange(event.target.value.split("\n").map((item) => item.trim()).filter(Boolean))} placeholder={placeholder} value={value.join("\n")} /><span className="mt-1 block text-[11px] font-normal">Une consigne par ligne.</span></label>; }
function message(cause: unknown, fallback: string) { return cause instanceof Error && cause.message ? cause.message : fallback; }
function usableDescription(value: string | null) { const normalized = value?.trim() ?? ""; return normalized.length >= 10 ? normalized : null; }
