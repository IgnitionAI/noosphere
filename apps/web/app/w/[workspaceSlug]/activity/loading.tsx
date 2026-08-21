export default function ActivityLoading() {
  return <div aria-busy="true" aria-label="Chargement de l’activité" aria-live="polite">
    <div className="h-5 w-36 animate-pulse rounded bg-slate-200" />
    <div className="mt-4 h-9 w-72 max-w-full animate-pulse rounded bg-slate-200" />
    <div className="mx-auto mt-8 h-12 w-[620px] max-w-full animate-pulse rounded-full bg-slate-200" />
    <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }, (_, index) => <div className="h-24 animate-pulse rounded-xl border border-line bg-white" key={index} />)}
    </section>
    <section className="mt-4 grid gap-4 xl:grid-cols-2">
      <div className="h-80 animate-pulse rounded-xl border border-line bg-white" />
      <div className="h-80 animate-pulse rounded-xl border border-line bg-white" />
    </section>
  </div>;
}
