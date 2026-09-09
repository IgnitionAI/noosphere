import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, getInstanceSetup } from "@/lib/api";
import { skipSetupAction } from "./actions";

export const dynamic = "force-dynamic";
export default async function InstanceSetupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!await getSession()) redirect("/login");
  const [state, query] = await Promise.all([getInstanceSetup(), searchParams]);
  return <main className="min-h-screen bg-canvas px-5 py-12">
    <section className="panel mx-auto max-w-2xl p-6 sm:p-10">
      <span className="badge badge-signal">Configuration de Noosphere</span>
      <h1 className="mt-5 text-3xl font-semibold text-ink">L’IA de votre instance</h1>
      <p className="mt-3 text-sm leading-6 text-muted">Les connexions IA sont partagées par vos workspaces. Vous pouvez explorer Noosphere et préparer vos données avant de connecter un modèle.</p>
      {query.error ? <p role="alert" className="mt-5 text-sm text-danger">Le choix n’a pas pu être enregistré. Réessayez.</p> : null}
      {state.skipped ? <p className="mt-5 text-sm text-muted">Vous avez choisi de configurer l’IA plus tard.</p> : null}
      <div className="mt-6 rounded-xl border border-line bg-canvas p-5">
        <h2 className="font-semibold">Connexion IA</h2>
        <p className="mt-2 text-sm text-muted">Un modèle doit être connecté et testé avant de lancer une recherche ou une génération.</p>
        {!state.isAdministrator ? <p className="mt-3 text-sm text-muted">Demandez à l’administrateur de l’instance de configurer une connexion IA. Votre rôle de workspace ne donne pas accès aux connexions partagées.</p> : null}
      </div>
      <div className="mt-7 flex flex-wrap gap-3">
        {state.isAdministrator ? <form action={skipSetupAction}><button className="button button-primary" type="submit">Configurer plus tard</button></form> : null}
        {!state.isAdministrator || state.skipped ? <Link className="button" href="/onboarding">Continuer vers mes workspaces</Link> : null}
      </div>
    </section>
  </main>;
}
