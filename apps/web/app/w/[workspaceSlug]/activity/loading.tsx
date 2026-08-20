export default function ActivityLoading() {
  return (
    <div aria-busy="true" aria-label="Chargement de l’activité">
      <div className="h-8 w-52 animate-pulse rounded bg-slate-200" />
      <div className="mt-3 h-4 w-full max-w-xl animate-pulse rounded bg-slate-200" />
      <div className="mx-auto my-5 h-12 w-full max-w-[620px] animate-pulse rounded-full bg-slate-200" />
      <section className="panel p-5"><div className="h-5 w-48 animate-pulse rounded bg-slate-200" /><div className="mt-4 h-16 animate-pulse rounded bg-slate-100" /><div className="mt-3 h-16 animate-pulse rounded bg-slate-100" /></section>
    </div>
  );
}
