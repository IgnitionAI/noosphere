import { Plus, Send } from "lucide-react";
import Link from "next/link";
import { listSequences } from "@/lib/api";
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
  const sequences = await listSequences(workspaceSlug);
  const create = createSequenceAction.bind(null, workspaceSlug);

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
                {sequences.data.map((sequence) => {
                  const badge = STATUS_BADGE[sequence.status] ?? STATUS_BADGE.draft!;
                  return (
                    <li key={sequence.id}>
                      <Link
                        className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-4 hover:border-brand-blue"
                        href={`/w/${workspaceSlug}/sequences/${sequence.id}`}
                      >
                        <span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-navy">
                          <Send size={16} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <strong className="block truncate text-sm">{sequence.name}</strong>
                          <span className="block truncate text-xs text-muted">
                            {sequence.description ?? "—"}
                          </span>
                        </span>
                        <span className={badge.className}>{badge.label}</span>
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
          <form action={create} className="panel-body space-y-3">
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
          </form>
        </aside>
      </div>
    </>
  );
}
