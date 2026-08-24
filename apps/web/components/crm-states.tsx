"use client";

import Link from "next/link";

export function CrmLoadingState({ resource }: { resource: string }) {
  return (
    <div className="panel animate-pulse p-8" role="status" aria-label={`Chargement des ${resource}`}>
      <div className="h-5 w-48 rounded bg-slate-200" />
      <div className="mt-4 h-4 w-full max-w-xl rounded bg-slate-100" />
      <div className="mt-2 h-4 w-4/5 rounded bg-slate-100" />
      <span className="sr-only">Chargement des {resource}…</span>
    </div>
  );
}

export function CrmEmptyState({
  title,
  description,
  href,
  action,
}: {
  title: string;
  description?: string | undefined;
  href?: string | undefined;
  action?: string | undefined;
}) {
  return (
    <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      {href && action ? (
        <Link className="button mt-4" href={href}>{action}</Link>
      ) : null}
    </div>
  );
}

export function CrmPermissionState({ resource }: { resource: string }) {
  return (
    <div className="panel border-warning p-6" role="alert">
      <h1 className="text-lg font-semibold text-ink">Accès refusé</h1>
      <p className="mt-2 text-sm text-muted">
        Vous n’avez pas la permission de consulter {resource} dans cet espace de travail.
      </p>
      <Link className="button mt-4" href="/">Retour à l’accueil</Link>
    </div>
  );
}

export function CrmNotFoundState({ resource, href }: { resource: string; href: string }) {
  return (
    <div className="panel p-6" role="alert">
      <h1 className="text-lg font-semibold text-ink">{resource} introuvable</h1>
      <p className="mt-2 text-sm text-muted">Cette fiche n’existe pas ou n’est plus accessible.</p>
      <Link className="button mt-4" href={href}>Retour à la liste</Link>
    </div>
  );
}

export function CrmErrorState({ resource, reset }: { resource: string; reset: () => void }) {
  return (
    <div className="panel border-danger p-6" role="alert">
      <h1 className="text-lg font-semibold text-ink">Impossible de charger {resource}</h1>
      <p className="mt-2 text-sm text-muted">
        Une erreur temporaire est survenue. Vous pouvez réessayer sans perdre votre contexte.
      </p>
      <button className="button mt-4" onClick={reset} type="button">Réessayer</button>
    </div>
  );
}
