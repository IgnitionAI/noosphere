import { FileSpreadsheet, History } from "lucide-react";
import { CrmPermissionState } from "@/components/crm-states";
import { listWorkspaces } from "@/lib/api";
import { ImportUploadForm } from "./upload-form";
import { uploadImportAction } from "./actions";

export const metadata = { title: "Imports CSV" };
export const dynamic = "force-dynamic";

export default async function ImportsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const workspace = (await listWorkspaces()).find((item) => item.slug === workspaceSlug);
  if (!workspace || workspace.role === "viewer") return <CrmPermissionState resource="les imports" />;
  const upload = uploadImportAction.bind(null, workspaceSlug);
  const canImport = ["operator", "admin", "owner"].includes(workspace.role);

  return (
    <>
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="page-title">Imports CSV</h1>
          <p className="mt-2 text-sm text-muted">Prévisualisez chaque ligne avant de créer des entreprises et contacts.</p>
        </div>
        <span className="badge">Aucun historique disponible</span>
      </header>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="panel">
          <div className="panel-header"><h2 className="flex items-center gap-2 font-semibold"><FileSpreadsheet className="text-brand-blue" size={16} /> Nouveau fichier</h2></div>
          <div className="panel-body">
            {canImport ? <ImportUploadForm action={upload} workspaceSlug={workspaceSlug} /> : (
              <p className="rounded-lg border border-warning/30 bg-amber-50 p-4 text-sm text-warning">Votre rôle peut consulter les rapports, mais ne peut pas importer de données.</p>
            )}
          </div>
        </section>
        <aside className="panel">
          <div className="panel-header"><h2 className="flex items-center gap-2 font-semibold"><History className="text-muted" size={16} /> Historique</h2></div>
          <div className="panel-body space-y-2 text-xs text-muted">
            <p>L’API d’import expose le rapport par identifiant, mais pas encore de liste des imports du workspace.</p>
            <p>Conservez le lien du rapport après chaque prévisualisation pour le retrouver.</p>
          </div>
        </aside>
      </div>
    </>
  );
}
