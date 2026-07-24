import Link from "next/link";

export default function WorkspaceNotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-canvas p-5">
      <section className="panel max-w-md p-8 text-center">
        <div className="badge badge-warning mx-auto w-fit">Workspace indisponible</div>
        <h1 className="mt-5 text-2xl font-semibold">Accès introuvable</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          Ce workspace n’existe pas ou votre membership n’est plus actif.
        </p>
        <Link className="button button-primary mt-6" href="/">
          Revenir à mon workspace
        </Link>
      </section>
    </main>
  );
}
