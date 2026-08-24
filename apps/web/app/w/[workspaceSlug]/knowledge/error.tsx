"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <div className="panel p-8"><h1 className="text-xl font-bold">Impossible de charger les sources</h1><p className="mt-2 text-sm text-muted">La connaissance autorisée reste inchangée. Réessayez sans perdre votre contexte.</p><button className="button mt-4" onClick={reset}>Réessayer</button></div>; }
