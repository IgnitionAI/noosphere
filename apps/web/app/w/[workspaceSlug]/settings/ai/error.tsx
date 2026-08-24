"use client";

export default function WorkspaceAiSettingsError({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto max-w-5xl">
      <section className="rounded-xl border border-red-200 bg-red-50 p-5" role="alert">
        <h1 className="text-lg font-semibold text-danger">Les modèles IA ne peuvent pas être chargés</h1>
        <p className="mt-2 text-sm text-red-800">Vérifiez la connexion des fournisseurs, puis réessayez. La configuration actuelle n’a pas été modifiée.</p>
        <button className="button mt-4" onClick={reset} type="button">Réessayer</button>
      </section>
    </div>
  );
}
