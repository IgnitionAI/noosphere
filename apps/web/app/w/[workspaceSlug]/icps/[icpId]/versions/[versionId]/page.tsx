import { ArrowLeft, CalendarDays, ExternalLink, Lock, ShieldCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CrmPermissionState } from "@/components/crm-states";
import { getIcp, getIcpVersion, OutboundApiError, type IcpVersion } from "@/lib/api";

export const metadata = { title: "Version ICP" };
export const dynamic = "force-dynamic";

export default async function IcpVersionPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; icpId: string; versionId: string }>;
}) {
  const { workspaceSlug, icpId, versionId } = await params;
  let version: IcpVersion;
  try {
    version = await getIcpVersion(workspaceSlug, versionId);
  } catch (error) {
    if (error instanceof OutboundApiError && error.status === 404) notFound();
    if (error instanceof OutboundApiError && (error.status === 401 || error.status === 403)) {
      return <CrmPermissionState resource="cette version ICP" />;
    }
    throw error;
  }

  let deletedAt: string | null = null;
  try {
    deletedAt = (await getIcp(workspaceSlug, version.icpId)).deletedAt;
  } catch (error) {
    if (error instanceof OutboundApiError && (error.status === 401 || error.status === 403)) {
      return <CrmPermissionState resource="cet ICP" />;
    }
    // A version remains readable even if a legacy backend cannot resolve its parent ICP.
    if (!(error instanceof OutboundApiError && error.status === 404)) throw error;
  }

  const contradictions = listValues(version.unresolvedContradictions);
  return (
    <>
      <header className="mb-6">
        <Link className="mb-4 inline-flex items-center gap-2 text-xs font-semibold text-muted" href={`/w/${workspaceSlug}/icps/${icpId}`}>
          <ArrowLeft size={14} /> Retour à l’ICP
        </Link>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2"><span className="badge badge-success"><Lock size={11} /> Version immuable</span><span className="badge badge-signal">v{version.version}</span></div>
            <h1 className="page-title mt-3">{version.name}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">Snapshot complet de la version publiée, en lecture seule.</p>
          </div>
          <span className="badge"><CalendarDays size={13} /> {formatDate(version.publishedAt)}</span>
        </div>
      </header>

      {deletedAt ? (
        <div className="mb-5 rounded-lg border border-warning/40 bg-amber-50 px-3 py-2 text-xs leading-5 text-warning" role="status">
          Cet snapshot appartient à un ICP supprimé. La version reste consultable pour l’historique,
          mais elle ne peut plus être republiée.
        </div>
      ) : null}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <main className="min-w-0 space-y-4">
          <Snapshot title="Critères de ciblage" value={version.criteria} />
          <div className="grid gap-4 md:grid-cols-2">
            <Snapshot title="Comité d’achat" value={version.buyingCommittee} />
            <Snapshot title="Problèmes" value={version.problems} />
            <Snapshot title="Signaux" value={version.signals} />
            <Snapshot title="Exclusions" value={version.exclusions} />
            <Snapshot title="Inconnues" value={version.unknowns} warning />
          </div>
          <section className={`panel ${contradictions.length ? "border-warning" : "border-success"}`}>
            <div className="panel-header"><h2 className="flex items-center gap-2 font-semibold">{contradictions.length ? <TriangleAlert className="text-warning" size={16} /> : <ShieldCheck className="text-success" size={16} />} Contradictions capturées</h2><span className="badge">{contradictions.length || "Aucune"}</span></div>
            <div className="panel-body">{contradictions.length ? <ul className="space-y-2 text-sm leading-6">{contradictions.map((item) => <li key={item}>• {item}</li>)}</ul> : <p className="text-sm text-muted">Aucune contradiction non résolue.</p>}</div>
          </section>
          <Snapshot title="Findings bloqués" value={version.blockedFindings} warning />
        </main>
        <aside className="space-y-4 xl:sticky xl:top-20">
          <section className="panel"><div className="panel-header"><h2 className="font-semibold">Publication</h2><span className="badge badge-success">Immuable</span></div><div className="panel-body space-y-3 text-sm"><Meta label="Auteur" value={version.publishedBy ? version.publishedBy.slice(0, 8) : "Non renseigné"} /><Meta label="Publiée le" value={formatDate(version.publishedAt)} /><Meta label="Créée le" value={formatDate(version.createdAt)} /></div></section>
          <section className="panel"><div className="panel-header"><h2 className="font-semibold">Provenance</h2></div><div className="panel-body space-y-2">{version.runId ? <Link className="button w-full justify-between" href={`/w/${workspaceSlug}/research/${version.runId}/report`}>Rapport source <ExternalLink size={13} /></Link> : <p className="text-xs text-muted">Republication canonique sans nouveau run.</p>}{version.runId ? <p className="break-all font-mono text-[11px] leading-5 text-muted">Run · {version.runId}</p> : null}{version.proposalId ? <p className="break-all font-mono text-[11px] leading-5 text-muted">Proposition · {version.proposalId}</p> : null}</div></section>
        </aside>
      </div>
    </>
  );
}

function Snapshot({ title, value, warning = false }: { title: string; value: unknown; warning?: boolean }) {
  const entries = objectEntries(value);
  const values = listValues(value);
  return <section className={`panel ${warning ? "border-warning/40" : ""}`}><div className="panel-header"><h2 className="font-semibold">{title}</h2></div><div className="panel-body">{entries.length ? <dl className="space-y-2 text-sm">{entries.map(([key, item]) => <div className="flex flex-col gap-1 border-b border-line pb-2 last:border-0 last:pb-0 sm:flex-row sm:justify-between" key={key}><dt className="text-xs text-muted">{key}</dt><dd className="break-words font-semibold sm:text-right">{formatValue(item)}</dd></div>)}</dl> : values.length ? <ul className="space-y-2 text-sm leading-6">{values.map((item) => <li key={item}>• {item}</li>)}</ul> : <p className="text-sm text-muted">Aucune donnée capturée.</p>}</div></section>;
}

function Meta({ label, value }: { label: string; value: string }) { return <div className="flex items-start justify-between gap-3 border-b border-line pb-2 last:border-0"><span className="text-xs text-muted">{label}</span><strong className="break-all text-right text-xs">{value}</strong></div>; }
function objectEntries(value: unknown): [string, unknown][] { return value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value as Record<string, unknown>) : []; }
function listValues(value: unknown): string[] { return Array.isArray(value) ? value.map(formatValue).filter(Boolean) : []; }
function formatValue(value: unknown): string { if (Array.isArray(value)) return value.map(formatValue).join(", "); if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${key}: ${formatValue(item)}`).join(" · "); return String(value ?? ""); }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Date inconnue" : new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(date); }
