import { ArrowLeft, CalendarDays, CheckCircle2, ExternalLink, History, Lock, Plus, Target } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CrmEmptyState, CrmPermissionState } from "@/components/crm-states";
import { getIcp, listWorkspaces, OutboundApiError, type IcpDetail, type IcpVersion } from "@/lib/api";
import { MutationForm } from "../../research/[runId]/report/mutation-form";
import { publishCanonicalIcp } from "./actions";

export const metadata = { title: "ICP" };
export const dynamic = "force-dynamic";

export default async function IcpDetailPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; icpId: string }>;
}) {
  const { workspaceSlug, icpId } = await params;
  let icp: IcpDetail;
  let canPublish = false;
  try {
    [icp, canPublish] = await Promise.all([
      getIcp(workspaceSlug, icpId),
      listWorkspaces().then((workspaces) => {
        const workspace = workspaces.find((candidate) => candidate.slug === workspaceSlug);
        return workspace ? ["admin", "owner"].includes(workspace.role) : false;
      }),
    ]);
  } catch (error) {
    if (error instanceof OutboundApiError && error.status === 404) notFound();
    if (error instanceof OutboundApiError && (error.status === 401 || error.status === 403)) {
      return <CrmPermissionState resource="cet ICP" />;
    }
    throw error;
  }

  const versions = [...icp.versions].sort((left, right) => right.version - left.version);
  const publish = publishCanonicalIcp.bind(null, workspaceSlug, icp.id);

  return (
    <>
      <header className="mb-6">
        <Link className="mb-4 inline-flex items-center gap-2 text-xs font-semibold text-muted" href={`/w/${workspaceSlug}/icps`}>
          <ArrowLeft size={14} /> Retour aux ICP
        </Link>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="badge badge-signal"><Target size={12} /> ICP canonique</span>
              <span className="badge"><Lock size={11} /> Versions immuables</span>
            </div>
            <h1 className="page-title mt-3">{icp.name}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Conteneur canonique et historique complet des versions publiées. Chaque snapshot
              reste consultable sans modifier les versions précédentes.
            </p>
          </div>
          {canPublish && !icp.deletedAt ? (
            <MutationForm
              action={publish}
              confirmation={`Publier une nouvelle version de « ${icp.name} » ? Le snapshot courant sera conservé et une version v${icp.currentVersion + 1} sera créée.`}
              successMessage="La nouvelle version ICP est publiée."
            >
              <button className="button button-signal whitespace-nowrap" type="submit">
                <Plus size={15} /> Publier une nouvelle version
              </button>
            </MutationForm>
          ) : null}
        </div>
        {icp.deletedAt ? (
          <div className="mt-4 rounded-lg border border-warning/40 bg-amber-50 px-3 py-2 text-xs leading-5 text-warning" role="status">
            Cet ICP a été supprimé. Son historique reste consultable, mais aucune nouvelle version ne peut être publiée.
          </div>
        ) : null}
      </header>

      <section className="panel mb-5">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <History className="text-brand-blue" size={16} />
            <h2 className="font-semibold">Historique des versions</h2>
          </div>
          <span className="badge">{versions.length} version{versions.length > 1 ? "s" : ""}</span>
        </div>
        {versions.length ? (
          <div className="overflow-x-auto">
            <table className="data-table min-w-[760px]">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Nom du snapshot</th>
                  <th>Publication</th>
                  <th>Auteur</th>
                  <th>Provenance</th>
                  <th className="text-right">Fiche</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((version) => (
                  <VersionRow key={version.id} icpId={icp.id} version={version} workspaceSlug={workspaceSlug} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="panel-body">
            <CrmEmptyState
              title="Aucune version publiée"
              description="Publiez une version depuis un rapport de recherche pour alimenter cet ICP."
              href={`/w/${workspaceSlug}/strategy/product-reading`}
              action="Trouver mon ICP"
            />
          </div>
        )}
      </section>

      <div className="grid gap-5 md:grid-cols-3">
        <MetadataCard label="Version courante" value={`v${icp.currentVersion}`} />
        <MetadataCard label="Créé le" value={formatDate(icp.createdAt)} />
        <MetadataCard label="Mis à jour le" value={formatDate(icp.updatedAt)} />
      </div>
    </>
  );
}

function VersionRow({
  icpId,
  version,
  workspaceSlug,
}: {
  icpId: string;
  version: IcpVersion;
  workspaceSlug: string;
}) {
  return (
    <tr>
      <td><span className="badge badge-success">v{version.version}</span></td>
      <td>
        <strong>{version.name}</strong>
        {version.proposalId ? <div className="break-all font-mono text-[11px] text-muted">Proposition · {version.proposalId.slice(0, 8)}</div> : null}
      </td>
      <td>
        <span className="inline-flex items-center gap-2 text-sm"><CalendarDays className="text-muted" size={14} />{formatDate(version.publishedAt)}</span>
      </td>
      <td><span className="break-all font-mono text-xs text-muted">{version.publishedBy ? version.publishedBy.slice(0, 8) : "Non renseigné"}</span></td>
      <td>
        {version.runId ? (
          <Link className="inline-flex items-center gap-1 text-xs font-semibold text-brand-blue" href={`/w/${workspaceSlug}/research/${version.runId}/report`}>
            Rapport source <ExternalLink size={11} />
          </Link>
        ) : <span className="text-xs text-muted">Republication canonique</span>}
      </td>
      <td className="text-right">
        <Link className="button button-primary whitespace-nowrap" href={`/w/${workspaceSlug}/icps/${icpId}/versions/${version.id}`}>
          Voir le snapshot
        </Link>
      </td>
    </tr>
  );
}

function MetadataCard({ label, value }: { label: string; value: string }) {
  return <section className="panel p-4"><span className="text-xs text-muted">{label}</span><strong className="mt-1 block text-sm">{value}</strong></section>;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date inconnue" : new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(date);
}
