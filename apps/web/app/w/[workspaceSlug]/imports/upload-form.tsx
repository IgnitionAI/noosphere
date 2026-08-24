"use client";

import { LoaderCircle, Upload, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

type UploadAction = (formData: FormData) => Promise<{ id: string }>;
const TARGETS = [
  ["firstName", "Prénom (obligatoire)"],
  ["lastName", "Nom (obligatoire)"],
  ["email", "Email"],
  ["linkedin", "LinkedIn"],
  ["phone", "Téléphone"],
  ["whatsapp", "WhatsApp"],
  ["companyName", "Entreprise"],
  ["domain", "Domaine"],
  ["title", "Poste"],
  ["startedOn", "Date de début"],
] as const;

export function ImportUploadForm({ workspaceSlug, action }: { workspaceSlug: string; action: UploadAction }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [filename, setFilename] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function selectFile(file: File | undefined) {
    if (!file) return;
    setFilename(file.name);
    setError("");
    void file.text().then((content) => {
      const nextHeaders = parseCsvHeader(content);
      setHeaders(nextHeaders);
      const nextMapping: Record<string, string> = {};
      for (const [target] of TARGETS) {
        const found = nextHeaders.find((header) => normalizeHeader(header) === normalizeHeader(target) || normalizeHeader(header).replaceAll("_", "") === normalizeHeader(target).replaceAll("_", ""));
        if (found) nextMapping[target] = found;
      }
      setMapping(nextMapping);
    }).catch(() => setError("Impossible de lire ce fichier."));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (!data.get("file")) {
      setError("Sélectionnez un fichier CSV.");
      return;
    }
    if (!mapping.firstName || !mapping.lastName) {
      setError("Mappez au minimum les colonnes prénom et nom.");
      return;
    }
    data.set("mapping", JSON.stringify(mapping));
    setError("");
    startTransition(async () => {
      try {
        const result = await action(data);
        router.push(`/w/${workspaceSlug}/imports/${result.id}`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "L’import n’a pas pu être créé.");
      }
    });
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <label
        className="block cursor-pointer rounded-xl border-2 border-dashed border-line p-6 text-center transition hover:border-brand-blue"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (inputRef.current) inputRef.current.files = event.dataTransfer.files;
          selectFile(event.dataTransfer.files[0]);
        }}
      >
        <Upload className="mx-auto text-brand-blue" size={22} />
        <span className="mt-2 block text-sm font-semibold">Déposez un CSV ou choisissez un fichier</span>
        <span className="mt-1 block text-xs text-muted">10 Mo maximum · aucune ligne n’est créée avant confirmation</span>
        <input ref={inputRef} className="sr-only" name="file" onChange={(event) => selectFile(event.target.files?.[0])} required type="file" accept=".csv,text/csv" />
      </label>
      {filename ? <p className="text-sm font-semibold text-ink">{filename}</p> : null}
      {headers.length ? (
        <fieldset className="space-y-3 rounded-lg border border-line p-3">
          <legend className="px-1 text-xs font-semibold text-muted">Mapping des colonnes</legend>
          <p className="text-xs text-muted">Les champs prénom, nom et au moins une identité sont nécessaires à chaque ligne valide.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {TARGETS.map(([target, label]) => (
              <label className="text-xs font-semibold text-muted" key={target}>
                {label}
                <select className="control mt-1 w-full" value={mapping[target] ?? ""} onChange={(event) => setMapping((current) => ({ ...current, [target]: event.target.value }))}>
                  <option value="">Non mappé</option>
                  {headers.map((header) => <option key={header} value={header}>{header}</option>)}
                </select>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {error ? <p className="flex items-start gap-2 rounded-lg border border-danger/30 bg-red-50 p-3 text-xs text-danger" role="alert"><TriangleAlert className="mt-0.5 shrink-0" size={14} />{error}</p> : null}
      <button className="button button-signal w-full" disabled={isPending} type="submit">
        {isPending ? <><LoaderCircle className="animate-spin" size={15} /> Préparation de la prévisualisation…</> : "Prévisualiser l’import"}
      </button>
    </form>
  );
}

function parseCsvHeader(content: string): string[] {
  const firstLine = content.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < firstLine.length; index += 1) {
    const character = firstLine[index];
    if (character === '"') { quoted = !quoted; continue; }
    if (character === "," && !quoted) { fields.push(current.trim()); current = ""; continue; }
    current += character;
  }
  fields.push(current.trim());
  return fields.filter(Boolean);
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}
