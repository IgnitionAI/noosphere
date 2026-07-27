import { ArrowLeft, Lock, Send } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getSequence,
  listSequenceVersions,
  listWorkspaces,
  OutboundApiError,
} from "@/lib/api";
import { StepsEditor } from "./steps-editor";

export const metadata = { title: "Séquence" };
export const dynamic = "force-dynamic";

export default async function SequenceDetailPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; sequenceId: string }>;
}) {
  const { workspaceSlug, sequenceId } = await params;
  let sequence;
  let versions;
  let role: string = "viewer";
  try {
    [sequence, versions] = await Promise.all([
      getSequence(workspaceSlug, sequenceId),
      listSequenceVersions(workspaceSlug, sequenceId),
    ]);
    const workspaces = await listWorkspaces();
    role = workspaces.find((workspace) => workspace.slug === workspaceSlug)?.role ?? "viewer";
  } catch (error) {
    if (error instanceof OutboundApiError && error.status === 404) notFound();
    throw error;
  }

  return (
    <>
      <header className="mb-6">
        <Link
          className="mb-4 inline-flex items-center gap-2 text-xs font-semibold text-muted"
          href={`/w/${workspaceSlug}/sequences`}
        >
          <ArrowLeft size={14} />
          Retour aux séquences
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-navy">
            <Send size={20} />
          </span>
          <div>
            <h1 className="page-title">{sequence.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className={`badge ${sequence.status === "published" ? "badge-success" : ""}`}>
                {sequence.status === "published" ? "publiée" : sequence.status === "draft" ? "brouillon" : "archivée"}
              </span>
              <span className="badge">{versions.data.length} version{versions.data.length > 1 ? "s" : ""}</span>
            </div>
          </div>
        </div>
        {sequence.description ? (
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">{sequence.description}</p>
        ) : null}
      </header>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="panel">
          <div className="panel-header">
            <h2 className="font-semibold">Étapes du brouillon</h2>
            <span className="badge">{sequence.steps.length}</span>
          </div>
          <div className="panel-body">
            <StepsEditor
              workspaceSlug={workspaceSlug}
              sequenceId={sequenceId}
              initialSteps={sequence.steps}
              canPublish={["admin", "owner"].includes(role)}
            />
          </div>
        </section>

        <aside className="panel">
          <div className="panel-header">
            <h2 className="flex items-center gap-2 font-semibold">
              <Lock size={14} className="text-success" />
              Versions publiées
            </h2>
          </div>
          <div className="panel-body space-y-3">
            {versions.data.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted">
                Aucune version publiée. La publication valide les contraintes de chaque canal.
              </p>
            ) : (
              versions.data.map((version) => (
                <details className="rounded-lg border border-line p-3" key={version.id}>
                  <summary className="cursor-pointer text-sm font-semibold">
                    v{version.version} · {version.publishedAt.slice(0, 10)}
                    <span className="badge ml-2">{version.steps.length} étapes</span>
                  </summary>
                  <ol className="mt-3 space-y-2">
                    {version.steps.map((step) => (
                      <li className="rounded-lg bg-canvas p-2 text-xs" key={step.position}>
                        <span className="badge mr-2">J+{step.delayDays}</span>
                        <strong>{step.kind.replaceAll("_", " ")}</strong>
                        {step.fallbackKind ? (
                          <span className="badge ml-2">repli {step.fallbackKind.replaceAll("_", " ")}</span>
                        ) : null}
                        <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-muted">{step.body}</p>
                      </li>
                    ))}
                  </ol>
                </details>
              ))
            )}
            <p className="text-[11px] leading-4 text-muted">
              Une version publiée est immuable : elle pourra être activée en campagne telle
              quelle, sans modification rétroactive.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
