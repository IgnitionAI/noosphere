export default function IcpVersionsLoading() {
  return (
    <div className="space-y-5" aria-label="Chargement des ICP publiés">
      <div className="space-y-3">
        <div className="h-6 w-28 animate-pulse rounded-lg bg-slate-200" />
        <div className="h-10 w-64 animate-pulse rounded-lg bg-slate-200" />
        <div className="h-5 w-full max-w-2xl animate-pulse rounded-lg bg-slate-200" />
      </div>
      <section className="panel overflow-hidden">
        <div className="h-14 animate-pulse border-b border-line bg-slate-50" />
        <div className="space-y-3 p-5">
          {[0, 1, 2].map((row) => (
            <div className="h-16 animate-pulse rounded-lg bg-slate-100" key={row} />
          ))}
        </div>
      </section>
    </div>
  );
}
