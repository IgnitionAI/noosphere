import { redirect } from "next/navigation";
import { getSession, listWorkspaces } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  if (!(await getSession())) redirect("/login");
  const workspaces = await listWorkspaces();
  if (workspaces[0]) redirect(`/w/${workspaces[0].slug}/strategy/product-reading`);
  return (
    <main className="grid min-h-screen place-items-center bg-canvas p-5">
      <section className="panel max-w-lg p-8 text-center">
        <div className="badge badge-warning mx-auto w-fit">Configuration requise</div>
        <h1 className="mt-5 text-2xl font-semibold">Aucun workspace actif</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          Lancez <code className="rounded bg-slate-100 px-1.5 py-1">bun run bootstrap:owner</code>
          {" "}sur le serveur ou demandez une invitation à un owner.
        </p>
      </section>
    </main>
  );
}
