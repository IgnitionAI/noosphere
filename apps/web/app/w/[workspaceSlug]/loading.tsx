export default function WorkspaceLoading() {
  return (
    <div aria-busy="true" aria-label="Chargement du cockpit">
      <div className="h-8 w-44 animate-pulse rounded bg-slate-200" />
      <div className="mt-3 h-4 w-full max-w-xl animate-pulse rounded bg-slate-200" />
      <div className="mx-auto my-5 h-12 w-full max-w-[620px] animate-pulse rounded-full bg-slate-200" />
      <div className="h-24 animate-pulse rounded-xl bg-navy/15" />
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((key) => <div className="h-24 animate-pulse rounded-xl bg-white" key={key} />)}</div>
    </div>
  );
}
