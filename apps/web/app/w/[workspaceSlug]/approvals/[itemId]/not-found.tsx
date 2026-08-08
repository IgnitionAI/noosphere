import Link from "next/link";

export default function NotFound() {
  return <div className="panel p-8"><h1 className="font-semibold text-navy">Item introuvable</h1><p className="mt-2 text-sm text-muted">Cet item d’approbation n’existe plus dans cet espace.</p><Link className="button mt-4 inline-flex" href="..">Retour à la file</Link></div>;
}
