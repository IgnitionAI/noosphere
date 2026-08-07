import { CalendarDays, FileSearch, History, Target } from "lucide-react";
import Link from "next/link";
import { CrmPermissionState } from "@/components/crm-states";
import { listIcps, OutboundApiError, type Icp } from "@/lib/api";

export const metadata = { title: "ICP" };
export const dynamic = "force-dynamic";

export default async function IcpsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  let icps: { data: Icp[] };
  try {
    icps = await listIcps(workspaceSlug);
  } catch (error) {
    if (error instanceof OutboundApiError && (error.status === 401 || error.status === 403)) {
      return <CrmPermissionState resource="les ICP" />;
    }
    throw error;
  }

  return (
    <>
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span className="badge badge-signal inline-flex items-center gap-1.5"><Target size={13} /> Intelligence</span>
          <h1 className="page-title mt-3">ICP</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Conteneurs canoniques des profils clients idéaux et historique de leurs versions
            publiées. Une republication crée un nouveau snapshot immuable.
          </p>
        </div>
        <span className="badge shrink-0 self-start">{icps.data.length} ICP{icps.data.length > 1 ? "s" : ""}</span>
      </header>

      <section className="panel overflow-hidden">
        <div className="panel-header">
          <div className="flex items-center gap-2"><History className="text-brand-blue" size={16} /><h2 className="font-semibold">ICP canoniques</h2></div>
          <span className="text-xs text-muted">Versions immuables</span>
        </div>
        {icps.data.length ? (
          <div className="overflow-x-auto">
            <table className="data-table min-w-[760px]">
              <thead><tr><th>ICP</th><th>Version courante</th><th>Versions</th><th>Création</th><th>Mise à jour</th><th className="text-right">Détail</th></tr></thead>
              <tbody>{icps.data.map((icp) => <IcpRow icp={icp} key={icp.id} workspaceSlug={workspaceSlug} />)}</tbody>
            </table>
          </div>
        ) : (
          <div className="panel-body py-12 text-center">
            <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-navy"><FileSearch size={20} /></span>
            <h2 className="mt-4 font-semibold">Aucun ICP canonique</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">Les ICP apparaîtront ici après leur première publication depuis un rapport.</p>
            <Link className="button button-primary mt-5" href={`/w/${workspaceSlug}/strategy/product-reading`}>Trouver mon ICP</Link>
          </div>
        )}
      </section>
    </>
  );
}

function IcpRow({ icp, workspaceSlug }: { icp: Icp; workspaceSlug: string }) {
  return (
    <tr>
      <td><Link className="font-semibold text-brand-blue" href={`/w/${workspaceSlug}/icps/${icp.id}`}>{icp.name}</Link><div className="break-all font-mono text-[11px] text-muted">{icp.id}</div></td>
      <td><span className="badge badge-success">v{icp.currentVersion}</span></td>
      <td><span className="text-sm">{icp.currentVersion} version{icp.currentVersion > 1 ? "s" : ""}</span></td>
      <td><span className="inline-flex items-center gap-2 text-sm"><CalendarDays className="text-muted" size={14} />{formatDate(icp.createdAt)}</span></td>
      <td className="text-sm text-muted">{formatDate(icp.updatedAt)}</td>
      <td className="text-right"><Link className="button button-primary whitespace-nowrap" href={`/w/${workspaceSlug}/icps/${icp.id}`}>Voir l’historique</Link></td>
    </tr>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date inconnue" : new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(date);
}
