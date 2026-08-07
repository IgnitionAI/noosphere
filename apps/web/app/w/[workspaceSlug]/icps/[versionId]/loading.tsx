export default function IcpVersionDetailLoading() {
  return (
    <div className="space-y-5" aria-label="Chargement de l’ICP">
      <div className="space-y-3">
        <div className="h-5 w-40 animate-pulse rounded-lg bg-slate-200" />
        <div className="h-10 w-96 max-w-full animate-pulse rounded-lg bg-slate-200" />
        <div className="h-5 w-full max-w-3xl animate-pulse rounded-lg bg-slate-200" />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          {[0, 1, 2].map((panel) => <div className="h-48 animate-pulse rounded-xl bg-white" key={panel} />)}
        </div>
        <div className="h-80 animate-pulse rounded-xl bg-white" />
      </div>
    </div>
  );
}
