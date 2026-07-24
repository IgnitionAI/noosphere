import { BriefForm } from "./brief-form";

export const metadata = { title: "Trouver mon ICP" };

export default async function ProductReadingPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-2 text-xs font-semibold text-muted">
        <span className="inline-flex items-center gap-2 text-navy">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-navy text-[10px] text-white">
            1
          </span>
          Brief
        </span>
        <span className="h-px w-7 bg-line" />
        <span className="inline-flex items-center gap-2">
          <span className="grid h-5 w-5 place-items-center rounded-full border border-line bg-white text-[10px]">
            2
          </span>
          Recherche
        </span>
        <span className="h-px w-7 bg-line" />
        <span className="inline-flex items-center gap-2">
          <span className="grid h-5 w-5 place-items-center rounded-full border border-line bg-white text-[10px]">
            3
          </span>
          Livrable ICP
        </span>
      </div>
      <header className="mb-6">
        <h1 className="page-title">Commander une étude ICP</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Le deep agent analysera votre produit, recherchera les concurrents et proposera les
          marchés les plus crédibles avec leurs preuves.
        </p>
      </header>
      <BriefForm workspaceSlug={workspaceSlug} />
    </>
  );
}
