import { ShieldAlert, ShieldCheck } from "lucide-react";
import { CursorPagination } from "@/components/cursor-pagination";
import { CrmEmptyState, CrmPermissionState } from "@/components/crm-states";
import { listSuppressions, listWorkspaces, OutboundApiError, type Suppression } from "@/lib/api";
import { cursorStackValue, paginationHref, parseCursorStack } from "@/lib/crm-pagination";
import { MutationForm } from "../research/[runId]/report/mutation-form";
import { createSuppressionAction, liftSuppressionAction } from "./actions";

export const metadata = { title: "Suppressions" };
export const dynamic = "force-dynamic";

export default async function SuppressionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { workspaceSlug } = await params;
  const { cursor } = await searchParams;
  const cursorStack = parseCursorStack(cursor);
  const currentCursor = cursorStack.at(-1);
  let response;
  try {
    response = await listSuppressions(workspaceSlug, {
      ...(currentCursor ? { cursor: currentCursor } : {}),
      limit: 50,
    });
  } catch (error) {
    if (error instanceof OutboundApiError && (error.status === 401 || error.status === 403)) {
      return <CrmPermissionState resource="les suppressions" />;
    }
    throw error;
  }
  const workspace = (await listWorkspaces()).find((item) => item.slug === workspaceSlug);
  const canCreate = workspace ? ["operator", "admin", "owner"].includes(workspace.role) : false;
  const canLift = workspace ? ["admin", "owner"].includes(workspace.role) : false;
  const activeSuppressions = response.data.filter((suppression) => !suppression.liftedAt);
  const pathname = `/w/${workspaceSlug}/suppressions`;
  const previousHref = cursorStack.length
    ? paginationHref(pathname, { cursor: cursorStackValue(cursorStack.slice(0, -1)) })
    : undefined;
  const nextHref = response.nextCursor
    ? paginationHref(pathname, { cursor: cursorStackValue([...cursorStack, response.nextCursor]) })
    : undefined;
  const create = createSuppressionAction.bind(null, workspaceSlug);

  return (
    <>
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="page-title">Suppressions</h1>
          <p className="mt-2 text-sm text-muted">
            Une suppression globale bloque la création et l’import. Une suppression par canal
            limite uniquement les sollicitations sur ce canal.
          </p>
        </div>
        <span className="badge">{activeSuppressions.length} actives</span>
      </header>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="panel">
          <div className="panel-header flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-semibold"><ShieldAlert className="text-warning" size={16} /> Suppressions actives</h2>
            <span className="badge">{activeSuppressions.length}</span>
          </div>
          <div className="panel-body overflow-x-auto">
            {activeSuppressions.length === 0 ? (
              <CrmEmptyState title="Aucune suppression active" description="Les nouvelles oppositions enregistrées apparaîtront ici." />
            ) : (
              <table className="data-table min-w-[760px]">
                <thead><tr><th>Identité</th><th>Canal</th><th>Empreinte</th><th>Motif</th><th>Date</th><th>Auteur</th><th>Actions</th></tr></thead>
                <tbody>{activeSuppressions.map((suppression) => (
                  <SuppressionRow canLift={canLift} key={suppression.id} suppression={suppression} workspaceSlug={workspaceSlug} />
                ))}</tbody>
              </table>
            )}
          </div>
          <CursorPagination nextHref={nextHref} page={cursorStack.length + 1} previousHref={previousHref} />
        </section>

        {canCreate ? (
          <aside className="panel">
            <div className="panel-header"><h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="text-brand-blue" size={16} /> Ajouter une suppression</h2></div>
            <MutationForm action={create} className="panel-body space-y-3" successMessage="La suppression a été enregistrée.">
              <label className="block text-xs font-semibold text-muted">Type d’identité
                <select className="control mt-1 w-full" name="identityType" defaultValue="email">
                  <option value="email">Email</option><option value="linkedin">LinkedIn</option><option value="phone">Téléphone</option><option value="whatsapp">WhatsApp</option>
                </select>
              </label>
              <label className="block text-xs font-semibold text-muted">Valeur à protéger *
                <input className="control mt-1 w-full" name="value" required placeholder="email@example.com" />
              </label>
              <label className="block text-xs font-semibold text-muted">Portée de la suppression
                <select className="control mt-1 w-full" name="channel" defaultValue="global">
                  <option value="global">Tous les canaux</option><option value="email">Email</option><option value="linkedin">LinkedIn</option><option value="whatsapp">WhatsApp</option>
                </select>
              </label>
              <p className="-mt-1 text-[11px] leading-4 text-muted">
                « Tous les canaux » bloque aussi la création/import ; une portée canal ne bloque
                pas la création du contact.
              </p>
              <label className="block text-xs font-semibold text-muted">Motif
                <textarea className="control mt-1 min-h-20 w-full" name="reason" maxLength={2000} placeholder="Opposition, demande RGPD…" />
              </label>
              <button className="button button-signal w-full" type="submit">Enregistrer la suppression</button>
            </MutationForm>
          </aside>
        ) : null}
      </div>
    </>
  );
}

function SuppressionRow({
  suppression,
  canLift,
  workspaceSlug,
}: {
  suppression: Suppression;
  canLift: boolean;
  workspaceSlug: string;
}) {
  const lift = liftSuppressionAction.bind(null, workspaceSlug, suppression.id);
  return (
    <tr>
      <td className="font-semibold">{suppression.identityType ?? "—"}</td>
      <td><span className="badge">{channelLabel(suppression.channel)}</span></td>
      <td className="font-mono text-xs">{suppression.normalizedValue ?? "—"}</td>
      <td className="max-w-52 text-xs">{suppression.reason ?? "—"}</td>
      <td className="whitespace-nowrap text-xs">{formatDate(suppression.createdAt)}</td>
      <td className="max-w-40 truncate font-mono text-[11px]">{suppression.createdBy ?? "—"}</td>
      <td>
        {canLift ? (
          <MutationForm action={lift} className="min-w-52 space-y-2" confirmation="Confirmer le levage de cette suppression ?" successMessage="La suppression a été levée.">
            <label className="block text-xs text-muted">Justification obligatoire
              <input aria-label="Justification du levage" className="control mt-1 w-full" name="justification" minLength={3} required placeholder="Motif du levage" />
            </label>
            <button className="button" type="submit">Lever la suppression</button>
          </MutationForm>
        ) : <span className="text-xs text-muted">Owner/admin requis</span>}
      </td>
    </tr>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(value));
}

function channelLabel(channel: Suppression["channel"]): string {
  return channel === "global" ? "Tous les canaux" : `${channel} seulement`;
}
