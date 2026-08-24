"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="panel border-danger/30 p-6"><h1 className="font-semibold text-danger">La file d’approbations est indisponible</h1><p className="mt-2 text-sm text-muted">{errorMessage()}</p><button className="button mt-4" onClick={reset} type="button">Réessayer</button></div>;
}

function errorMessage(): string {
  return "Impossible de charger les items. Vérifiez vos droits ou réessayez.";
}
