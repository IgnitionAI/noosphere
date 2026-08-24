import { CheckSquare, ShieldAlert } from "lucide-react";
import { CrmEmptyState, CrmPermissionState } from "@/components/crm-states";
import { listApprovalItems, listWorkspaces, OutboundApiError } from "@/lib/api";
import { ApprovalQueue } from "./approval-queue";
import { bulkDecideApprovalItemsAction } from "./actions";

export const metadata = { title: "Approbations" };
export const dynamic = "force-dynamic";

export default async function ApprovalsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const workspace = (await listWorkspaces()).find((item) => item.slug === workspaceSlug);
  if (!workspace || workspace.role === "viewer") return <CrmPermissionState resource="la file d’approbations" />;
  let items;
  try {
    items = (await listApprovalItems(workspaceSlug, { limit: 100 })).data;
  } catch (error) {
    if (error instanceof OutboundApiError && (error.status === 401 || error.status === 403)) return <CrmPermissionState resource="la file d’approbations" />;
    throw error;
  }
  const canDecide = ["reviewer", "admin", "owner"].includes(workspace.role);
  const pending = items.filter((item) => item.status === "pending").length;
  const invalidated = items.filter((item) => item.status === "invalidated").length;
  const bulkAction = bulkDecideApprovalItemsAction.bind(null, workspaceSlug);

  return (
    <>
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="page-title">Approbations</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">Relisez les contenus avant envoi. L’original et toute modification restent visibles pour une décision tracée.</p>
        </div>
        <div className="flex flex-wrap gap-2"><span className="badge">{pending} à traiter</span>{invalidated ? <span className="badge badge-warning">{invalidated} invalidé(s)</span> : null}</div>
      </header>
      {!canDecide ? <p className="mb-5 rounded-lg border border-warning/30 bg-amber-50 p-3 text-xs text-warning">Votre rôle permet la lecture des items. Les décisions sont réservées aux reviewers, admins et owners.</p> : null}
      <section className="panel">
        <div className="panel-header"><h2 className="flex items-center gap-2 font-semibold"><CheckSquare className="text-brand-blue" size={16} /> File de revue</h2></div>
        <div className="panel-body">
          {items.length === 0 ? <CrmEmptyState title="File vide" description="Aucun contenu ne nécessite une approbation pour le moment." /> : <ApprovalQueue bulkAction={bulkAction} canDecide={canDecide} items={items} workspaceSlug={workspaceSlug} />}
        </div>
      </section>
      <p className="mt-4 flex items-start gap-2 text-xs text-muted"><ShieldAlert className="mt-0.5 shrink-0" size={14} /> Les items invalidés sont conservés pour audit mais exclus des décisions en lot.</p>
    </>
  );
}
