import Link from "next/link";
import { notFound } from "next/navigation";
import { CrmPermissionState } from "@/components/crm-states";
import { MutationForm } from "../../research/[runId]/report/mutation-form";
import { getImport, listWorkspaces, OutboundApiError } from "@/lib/api";
import { ImportRefresh } from "../import-refresh";
import { applyImportAction } from "../actions";

export const metadata = { title: "Rapport d’import" };
export const dynamic = "force-dynamic";

export default async function ImportReportPage({ params }: { params: Promise<{ workspaceSlug: string; importId: string }> }) {
  const { workspaceSlug, importId } = await params;
  let batch;
  try {
    batch = await getImport(workspaceSlug, importId);
  } catch (error) {
    if (error instanceof OutboundApiError && error.status === 404) notFound();
    if (error instanceof OutboundApiError && (error.status === 401 || error.status === 403)) return <CrmPermissionState resource="ce rapport d’import" />;
    throw error;
  }
  const workspace = (await listWorkspaces()).find((item) => item.slug === workspaceSlug);
  const canApply = workspace ? ["operator", "admin", "owner"].includes(workspace.role) : false;
  const apply = applyImportAction.bind(null, workspaceSlug, importId);
  const canConfirm = canApply && batch.status === "previewed" && Boolean(batch.previewedAt);
  const isApplying = batch.status === "applying";
  const isCompleted = batch.status === "completed";

  return (
    <>
      <ImportRefresh active={isApplying} />
      <header className="mb-6">
        <Link className="mb-4 inline-flex text-xs font-semibold text-muted" href={`/w/${workspaceSlug}/imports`}>← Retour aux imports</Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="page-title">{batch.filename}</h1>
          <span className={`badge ${isCompleted ? "badge-success" : isApplying ? "badge" : ""}`}>{statusLabel(batch.status)}</span>
        </div>
        <p className="mt-2 text-sm text-muted">Prévisualisation et rapport ligne par ligne · créé le {formatDate(batch.createdAt)}</p>
      </header>

      <section className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(batch.totals).map(([key, value]) => <div className="panel p-4" key={key}><p className="text-xs text-muted">{totalLabel(key)}</p><p className="mt-1 text-2xl font-bold text-navy">{value}</p></div>)}
      </section>

      {canConfirm ? (
        <section className="panel mb-5 border-warning">
          <div className="panel-body flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><h2 className="font-semibold">Prêt à appliquer</h2><p className="mt-1 text-xs text-muted">Aucune ligne n’est créée avant votre confirmation explicite.</p></div>
            <MutationForm action={apply} confirmation="Confirmer l’application ? Les lignes valides seront créées et le traitement sera asynchrone." successMessage="Import lancé. Le rapport se mettra à jour automatiquement.">
              <button className="button button-signal" type="submit">Confirmer et appliquer</button>
            </MutationForm>
          </div>
        </section>
      ) : null}
      {isApplying ? <p className="mb-5 rounded-lg border border-line bg-white p-4 text-sm text-muted" role="status">Application en cours… Le rapport se rafraîchit automatiquement.</p> : null}
      {!canApply && !isCompleted ? <p className="mb-5 rounded-lg border border-warning/30 bg-amber-50 p-4 text-sm text-warning">Votre rôle peut consulter ce rapport, mais ne peut pas appliquer l’import.</p> : null}

      <section className="panel">
        <div className="panel-header"><h2 className="font-semibold">Lignes de l’import</h2></div>
        <div className="panel-body overflow-x-auto">
          {batch.rows.length === 0 ? <p className="py-8 text-center text-sm text-muted">Aucune ligne trouvée dans ce fichier.</p> : (
            <table className="data-table min-w-[760px]">
              <thead><tr><th>Ligne</th><th>Statut</th><th>Données</th><th>Raison</th><th>Cibles créées</th></tr></thead>
              <tbody>{batch.rows.map((row) => <tr key={row.id}><td>{row.lineNumber}</td><td><span className={`badge ${row.status === "created" ? "badge-success" : row.status === "invalid" || row.status === "suppressed" || row.status === "failed" ? "badge-danger" : ""}`}>{rowStatusLabel(row.status)}</span></td><td className="max-w-80 text-xs">{formatData(row.normalizedData ?? row.rawData)}</td><td className="max-w-64 text-xs text-muted">{reasonLabel(row.reason)}</td><td className="text-xs">{row.companyId || row.contactId ? `${row.companyId ? "entreprise" : ""}${row.companyId && row.contactId ? " + " : ""}${row.contactId ? "contact" : ""}` : "—"}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      </section>
    </>
  );
}

function statusLabel(status: string): string { return ({ uploaded: "Uploadé", previewed: "Prévisualisé", applying: "Application en cours", completed: "Terminé" })[status] ?? status; }
function rowStatusLabel(status: string): string { return ({ valid: "Valide", invalid: "Invalide", duplicate: "Doublon certain", suppressed: "Suppression active", created: "Créée", failed: "Échec" })[status] ?? status; }
function reasonLabel(reason: string | null): string { return ({ "firstName and lastName are required": "Prénom et nom obligatoires", "at least one identity is required": "Au moins une identité obligatoire", "suppression active": "Une suppression active bloque cette ligne", "existing identity or company": "Doublon avec une identité ou entreprise existante", "duplicate row in file": "Doublon dans le fichier" })[reason ?? ""] ?? reason ?? "—"; }
function totalLabel(value: string): string { return ({ total: "Total", valid: "Valides", invalid: "Invalides", duplicate: "Doublons", suppressed: "Suppressions", created: "Créées", failed: "Échecs" })[value] ?? value; }
function formatDate(value: string): string { return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function formatData(value: unknown): string { if (!value || typeof value !== "object") return "—"; return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${key}: ${String(item)}`).join(" · "); }
