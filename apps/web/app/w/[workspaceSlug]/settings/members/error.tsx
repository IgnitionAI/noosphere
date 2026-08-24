"use client";

export default function WorkspaceMembersError({ reset }: { reset: () => void }) {
  return <section className="panel p-8"><h1 className="text-xl font-semibold text-ink">Impossible de charger l’équipe</h1><p className="mt-2 text-sm text-muted">Une erreur temporaire est survenue. Vos accès n’ont pas été modifiés.</p><button className="button button-primary mt-5" onClick={reset} type="button">Réessayer</button></section>;
}
