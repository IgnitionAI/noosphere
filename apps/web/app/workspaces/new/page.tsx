import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, listWorkspaces } from "@/lib/api";
import { createWorkspaceAction } from "../actions";
import { WorkspaceForm } from "../workspace-form";

export const metadata = { title: "Nouveau workspace" };
export const dynamic = "force-dynamic";

export default async function NewWorkspacePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!(await getSession())) redirect("/login?next=/workspaces/new");
  const [query, workspaces] = await Promise.all([searchParams, listWorkspaces()]);
  const back = workspaces[0] ? `/w/${workspaces[0].slug}/strategy/product-reading` : "/onboarding";
  const create = createWorkspaceAction.bind(null, "/workspaces/new");
  return <main className="grid min-h-screen place-items-center bg-canvas p-5"><section className="w-full max-w-lg"><Link className="mb-4 inline-flex items-center gap-2 text-xs font-semibold text-muted hover:text-navy" href={back}><ArrowLeft size={14} /> Retour</Link><div className="panel p-7 sm:p-8"><div className="badge badge-signal w-fit">Multi-workspace</div><h1 className="mt-4 text-2xl font-semibold text-navy">Créer un workspace</h1><p className="mt-2 text-sm leading-6 text-muted">Vous en devenez owner. Les données, membres et campagnes restent isolés des autres workspaces.</p>{query.error ? <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-danger">{query.error === "WORKSPACE_SLUG_UNAVAILABLE" ? "Ce slug n’est pas disponible." : "Le workspace n’a pas pu être créé."}</p> : null}<WorkspaceForm action={create} /></div></section></main>;
}
