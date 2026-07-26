import { Building2, Plus } from "lucide-react";
import Link from "next/link";
import { listCompanies } from "@/lib/api";
import { createCompanyAction } from "./actions";

export const metadata = { title: "Entreprises" };
export const dynamic = "force-dynamic";

export default async function CompaniesPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ search?: string }>;
}) {
  const { workspaceSlug } = await params;
  const { search } = await searchParams;
  const companies = await listCompanies(workspaceSlug, search);
  const create = createCompanyAction.bind(null, workspaceSlug);

  return (
    <>
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="page-title">Entreprises</h1>
          <p className="mt-2 text-sm text-muted">
            Fiches canoniques alimentées par la recherche ICP, l’import et le sourcing.
          </p>
        </div>
        <span className="badge">{companies.data.length} entreprises</span>
      </header>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="panel">
          <div className="panel-header">
            <form className="flex flex-1 gap-2" action={`/w/${workspaceSlug}/companies`} method="get">
              <input
                className="control min-w-0 flex-1"
                name="search"
                placeholder="Rechercher une entreprise…"
                defaultValue={search ?? ""}
              />
              <button className="button" type="submit">Filtrer</button>
            </form>
          </div>
          <div className="panel-body overflow-x-auto">
            {companies.data.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">
                Aucune entreprise pour le moment. Créez la première fiche ou lancez une
                recherche ICP.
              </p>
            ) : (
              <table className="data-table min-w-[640px]">
                <thead>
                  <tr>
                    <th>Entreprise</th>
                    <th>Domaine</th>
                    <th>Secteur</th>
                    <th>Taille</th>
                    <th>Localisation</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.data.map((company) => (
                    <tr key={company.id}>
                      <td className="font-semibold">
                        <Link className="text-brand-blue" href={`/w/${workspaceSlug}/companies/${company.id}`}>
                          {company.name}
                        </Link>
                      </td>
                      <td>{company.normalizedDomain ?? "—"}</td>
                      <td>{company.sector ?? "—"}</td>
                      <td>
                        {company.employeeCountMin || company.employeeCountMax
                          ? `${company.employeeCountMin ?? "?"} – ${company.employeeCountMax ?? "?"}`
                          : "—"}
                      </td>
                      <td>{company.location ?? "—"}</td>
                      <td><span className="badge">{company.source}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <aside className="panel">
          <div className="panel-header">
            <h2 className="flex items-center gap-2 font-semibold">
              <Plus size={15} className="text-brand-blue" />
              Nouvelle entreprise
            </h2>
          </div>
          <form action={create} className="panel-body space-y-3">
            <label className="block text-xs font-semibold text-muted">
              Nom *
              <input className="control mt-1 w-full" name="name" required />
            </label>
            <label className="block text-xs font-semibold text-muted">
              Domaine
              <input className="control mt-1 w-full" name="domain" placeholder="example.com" />
            </label>
            <label className="block text-xs font-semibold text-muted">
              Secteur
              <input className="control mt-1 w-full" name="sector" placeholder="LegalTech" />
            </label>
            <label className="block text-xs font-semibold text-muted">
              Localisation
              <input className="control mt-1 w-full" name="location" placeholder="Paris" />
            </label>
            <button className="button button-signal w-full" type="submit">
              <Building2 size={15} />
              Créer la fiche
            </button>
            <p className="text-[11px] leading-4 text-muted">
              Le domaine est normalisé et unique par workspace : un doublon renvoie vers la
              fiche existante.
            </p>
          </form>
        </aside>
      </div>
    </>
  );
}
