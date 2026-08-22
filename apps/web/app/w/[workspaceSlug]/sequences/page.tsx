import { Plus, Send } from "lucide-react";
import Link from "next/link";
import { CrmPermissionState } from "@/components/crm-states";
import { listSequenceVersions, listSequences, listWorkspaces, OutboundApiError } from "@/lib/api";
import { MutationForm } from "../research/[runId]/report/mutation-form";
import { createSequenceAction } from "./actions";

export const metadata = { title: "Séquences" };
export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  draft: { label: "brouillon", className: "badge" },
  published: { label: "publiée", className: "badge badge-success" },
  archived: { label: "archivée", className: "badge" },
};

export default async function SequencesPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const workspace = (await listWorkspaces()).find((item) => item.slug === workspaceSlug);
  if (!workspace) return <CrmPermissionState resource="les séquences" />;
  let sequences;
  try { sequences = await listSequences(workspaceSlug); } catch (error) {
    if (error instanceof OutboundApiError && (error.status === 401 || error.status === 403)) return <CrmPermissionState resource="les séquences" />;
    throw error;
  }
  const versions = await Promise.all(sequences.data.map(async (sequence) => {
    try { return (await listSequenceVersions(workspaceSlug, sequence.id)).data; } catch { return []; }
  }));
  const create = createSequenceAction.bind(null, workspaceSlug);
  const canEdit = ["operator", "admin", "owner"].includes(workspace.role);

  return (
    <>
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="page-title">Séquences</h1>
          <p className="mt-2 text-sm text-muted">
            Playbooks multicanales versionnés : LinkedIn, email, WhatsApp et tâches manuelles.
          </p>
        </div>
        <span className="badge">{sequences.data.length} séquences</span>
      </header>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="panel">
          <div className="panel-body">
            {sequences.data.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">
                Aucune séquence. Composez votre premier playbook multicanal.
              </p>
            ) : (
              <ul className="space-y-2">
                {sequences.data.map((sequence, index) => {
                  const badge = STATUS_BADGE[sequence.status] ?? STATUS_BADGE.draft!;
                  return (
                    <li key={sequence.id}>
                      <Link
                        className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-4 hover:border-brand-blue"
                        href={`/w/${workspaceSlug}/sequences/${sequence.id}`}
                      >
                        <span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-ink">
                          <Send size={16} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <strong className="block truncate text-sm">{sequence.name}</strong>
                          <span className="block truncate text-xs text-muted">
                            {sequence.description ?? "—"}
                          </span>
                        </span>
                        <span className={badge.className}>{badge.label}</span>
                        {versions[index]?.length ? <span className="badge">v{versions[index]![0]!.version}</span> : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <aside className="panel">
          <div className="panel-header">
            <h2 className="flex items-center gap-2 font-semibold">
              <Plus size={15} className="text-brand-blue" />
              Nouvelle séquence
            </h2>
          </div>
          {canEdit ? <MutationForm action={create} className="panel-body space-y-3" successMessage="Brouillon créé.">
            <label className="block text-xs font-semibold text-muted">
              Nom *
              <input className="control mt-1 w-full" name="name" placeholder="Playbook cabinets juridiques" required />
            </label>
            <label className="block text-xs font-semibold text-muted">
              Description
              <textarea className="control mt-1 h-20 w-full" name="description" placeholder="Invitation LinkedIn, email J+3, tâche manuelle J+7" />
            </label>
            <button className="button button-signal w-full" type="submit">
              Créer le brouillon
            </button>
            <p className="text-[11px] leading-4 text-muted">
              Le brouillon est librement modifiable. La publication (admin/owner) crée une
              version immuable validée par canal.
            </p>
          </MutationForm> : <div className="panel-body"><p className="text-xs text-muted">Votre rôle permet la lecture, mais pas la création ou modification des séquences.</p></div>}
        </aside>
      </div>
    </>
  );
}
