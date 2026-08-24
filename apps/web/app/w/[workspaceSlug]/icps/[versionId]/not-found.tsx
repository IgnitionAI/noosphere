import Link from "next/link";

export default function IcpVersionNotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <section className="panel w-full max-w-lg p-8 text-center">
        <div className="badge badge-warning mx-auto w-fit">ICP introuvable</div>
        <h1 className="mt-5 text-2xl font-semibold">Cet ICP canonique n’est plus accessible</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          La version n’existe pas dans ce workspace ou son identifiant est incorrect.
        </p>
        <Link className="button button-primary mt-6" href="..">
          Retour aux ICP
        </Link>
      </section>
    </div>
  );
}
