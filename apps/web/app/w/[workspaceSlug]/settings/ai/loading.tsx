export default function LoadingWorkspaceAiSettings() {
  return (
    <div className="mx-auto max-w-5xl" aria-busy="true" aria-label="Chargement des modèles IA">
      <div className="h-8 w-48 animate-pulse rounded bg-slate-200" />
      <div className="mt-3 h-4 max-w-2xl animate-pulse rounded bg-slate-200" />
      <div className="panel mt-6 p-5">
        <div className="h-5 w-52 animate-pulse rounded bg-slate-200" />
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {[0, 1, 2].map((item) => <div className="h-16 animate-pulse rounded-lg bg-slate-100" key={item} />)}
        </div>
      </div>
    </div>
  );
}
