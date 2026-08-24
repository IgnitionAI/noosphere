"use client";

import { Download, LoaderCircle } from "lucide-react";
import { useState } from "react";

export function ExportDownload({ workspaceSlug, exportId, downloadUrl }: {
  workspaceSlug: string;
  exportId: string;
  downloadUrl: string;
}) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setDownloading(true);
    setError(null);
    try {
      const response = await fetch(downloadUrl, {
        headers: { "x-workspace-slug": workspaceSlug },
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("DOWNLOAD_FAILED");
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `noosphere-export-${exportId}.json.gz`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setError("Le téléchargement a échoué. Rechargez la page puis réessayez.");
    } finally {
      setDownloading(false);
    }
  }

  return <div className="text-right">
    <button className="button button-primary" disabled={downloading} onClick={() => void download()} type="button">
      {downloading ? <LoaderCircle className="animate-spin" size={14} /> : <Download size={14} />}
      {downloading ? "Téléchargement…" : "Télécharger"}
    </button>
    {error ? <p className="mt-2 max-w-64 text-xs text-danger" role="alert">{error}</p> : null}
  </div>;
}
