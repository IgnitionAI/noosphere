"use client";

import { Check, FileText, LoaderCircle, UploadCloud, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { confirmDocumentUpload, getDocumentStatus, prepareDocumentUpload } from "./actions";

type UploadedDocument = {
  id: string;
  filename: string;
  status: "processing" | "ready" | "partial" | "ocr_required" | "failed";
  failureCode: string | null;
  warnings: readonly string[];
};

export function DocumentUpload({ workspaceSlug, initialDocuments }: {
  workspaceSlug: string;
  initialDocuments: readonly UploadedDocument[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<UploadedDocument[]>([...initialDocuments]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const pendingIds = documents.filter((document) => document.status === "processing").map((document) => document.id);
    if (!pendingIds.length) return;
    const interval = setInterval(() => {
      void Promise.all(pendingIds.map((id) => getDocumentStatus(workspaceSlug, id))).then((fresh) => {
        setDocuments((current) => current.map((document) => {
          const match = fresh.find((candidate) => candidate?.id === document.id);
          if (!match || ["uploading", "uploaded", "processing"].includes(match.status)) return document;
          if (!["ready", "partial", "ocr_required", "failed"].includes(match.status)) return document;
          return {
            ...document,
            status: match.status as UploadedDocument["status"],
            failureCode: match.failureCode,
            warnings: match.extractionWarnings,
          };
        }));
      }).catch(() => undefined);
    }, 2_000);
    return () => clearInterval(interval);
  }, [documents, workspaceSlug]);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const checksum = await sha256(file);
      const intent = await prepareDocumentUpload(workspaceSlug, {
        filename: file.name,
        contentType: file.type || "text/plain",
        sizeBytes: file.size,
        checksumSha256: checksum,
      });
      const uploadResponse = await fetch(intent.uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type || "text/plain" },
        body: file,
      });
      if (!uploadResponse.ok) throw new Error("Le stockage a refusé le fichier.");
      await confirmDocumentUpload(workspaceSlug, intent.document.id);
      setDocuments((current) => [
        ...current.filter((item) => item.id !== intent.document.id),
        { id: intent.document.id, filename: intent.document.filename, status: "processing", failureCode: null, warnings: [] },
      ]);
      for (let attempt = 0; attempt < 90; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        const document = await getDocumentStatus(workspaceSlug, intent.document.id);
        if (document?.status === "ready" || document?.status === "partial") {
          const completedStatus: UploadedDocument["status"] = document.status;
          setDocuments((current) =>
            current.map((item) =>
              item.id === intent.document.id
                ? { ...item, status: completedStatus, failureCode: document.failureCode, warnings: document.extractionWarnings }
                : item,
            ),
          );
          break;
        }
        if (document?.status === "ocr_required") {
          setDocuments((current) => current.map((item) => item.id === intent.document.id
            ? { ...item, status: "ocr_required", failureCode: document.failureCode, warnings: document.extractionWarnings }
            : item));
          throw new Error("Ce PDF est une image : un fichier avec du texte sélectionnable est nécessaire.");
        }
        if (document?.status === "failed") {
          setDocuments((current) =>
            current.map((item) =>
              item.id === intent.document.id ? { ...item, status: "failed", failureCode: document.failureCode, warnings: document.extractionWarnings } : item,
            ),
          );
          throw new Error("L’extraction du document a échoué.");
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Le document n’a pas pu être envoyé.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      {documents
        .filter((document) => document.status === "ready" || document.status === "partial")
        .map((document) => (
          <input key={document.id} name="internalDocumentIds" type="hidden" value={document.id} />
        ))}
      <input
        accept=".pdf,.docx,.pptx,.xlsx,.html,.md,.txt"
        className="sr-only"
        disabled={uploading || documents.length >= 20}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
        ref={inputRef}
        type="file"
      />
      <button
        className="flex w-full items-center justify-center gap-3 rounded-lg border border-dashed border-line bg-canvas p-7 text-sm font-semibold hover:border-slate-400"
        disabled={uploading || documents.length >= 20}
        onClick={() => inputRef.current?.click()}
        type="button"
      >
        {uploading ? <LoaderCircle className="animate-spin" size={20} /> : <UploadCloud size={20} />}
        {uploading ? "Envoi en cours…" : "Ajouter un pitch, une brochure ou une étude"}
      </button>
      {documents.length ? (
        <div className="mt-3 space-y-2">
          {documents.map((document) => (
            <div className="flex items-center gap-3 rounded-lg border border-line p-3" key={document.id}>
              <FileText className="text-brand-blue" size={17} />
              <span className="min-w-0 flex-1 truncate text-xs font-semibold">{document.filename}</span>
              <span className="inline-flex items-center gap-1 text-[11px] text-muted" title={documentFailureDetail(document)}>
                {document.status === "ready" || document.status === "partial" ? <Check size={13} /> : <LoaderCircle className={document.status === "processing" ? "animate-spin" : ""} size={13} />}
                {documentStatusLabel(document.status)}
              </span>
              <button
                aria-label={`Retirer ${document.filename}`}
                onClick={() => setDocuments((current) => current.filter((item) => item.id !== document.id))}
                type="button"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
      <p className="mt-2 text-xs text-muted">
        PDF avec texte, DOCX, PPTX, XLSX, HTML, Markdown ou texte · 50 Mio maximum · 20 documents.
      </p>
    </div>
  );
}

function documentFailureDetail(document: UploadedDocument): string {
  if (document.status === "ocr_required") return "Le fichier ne contient pas de texte sélectionnable et ne sera pas utilisé par l’IA.";
  if (document.status === "partial") return document.warnings.join(" · ") || "Une partie du document seulement a été extraite.";
  if (document.status === "failed") return document.failureCode ?? "Échec de l’extraction.";
  return "";
}

function documentStatusLabel(status: UploadedDocument["status"]): string {
  if (status === "ready") return "Prêt";
  if (status === "partial") return "Partiel";
  if (status === "ocr_required") return "OCR nécessaire";
  if (status === "failed") return "Échec";
  return "Indexation";
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
