import { redirect } from "next/navigation";
import { getSession, listWorkspaces } from "@/lib/api";
import { createWorkspaceAction } from "../workspaces/actions";
import { WorkspaceForm } from "../workspaces/workspace-form";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!(await getSession())) redirect("/login");
  const [workspaces, query] = await Promise.all([listWorkspaces(), searchParams]);
  if (workspaces[0]) redirect(`/w/${workspaces[0].slug}/strategy/product-reading`);
  const create = createWorkspaceAction.bind(null, "/onboarding");
  return (
    <main className="grid min-h-screen place-items-center bg-canvas p-5">
      <section className="panel w-full max-w-lg p-8">
        <div className="badge badge-signal w-fit">Première configuration</div>
        <h1 className="mt-5 text-2xl font-semibold">Créez votre workspace</h1>
        <p className="mt-3 text-sm leading-6 text-muted">Il contiendra vos offres, ICP, prospects et campagnes. Vous pourrez inviter l’équipe ensuite.</p>
        {query.error ? <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-danger">Impossible de créer le workspace. Vérifiez son nom puis réessayez.</p> : null}
        <WorkspaceForm action={create} />
      </section>
    </main>
  );
}
