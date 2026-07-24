export default function WorkspaceLoading() {
  return (
    <div className="space-y-5" aria-label="Chargement">
      <div className="h-9 w-72 animate-pulse rounded-lg bg-slate-200" />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="h-[520px] animate-pulse rounded-xl bg-white" />
        <div className="h-80 animate-pulse rounded-xl bg-white" />
      </div>
    </div>
  );
}
