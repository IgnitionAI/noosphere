import { UserRoundPlus, Users } from "lucide-react";
import Link from "next/link";
import { listCompanies, listContacts } from "@/lib/api";
import { createContactAction } from "./actions";

export const metadata = { title: "Prospects" };
export const dynamic = "force-dynamic";

export default async function ProspectsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ search?: string }>;
}) {
  const { workspaceSlug } = await params;
  const { search } = await searchParams;
  const [contacts, companies] = await Promise.all([
    listContacts(workspaceSlug, search),
    listCompanies(workspaceSlug),
  ]);
  const create = createContactAction.bind(null, workspaceSlug);

  return (
    <>
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="page-title">Prospects</h1>
          <p className="mt-2 text-sm text-muted">
            Une identité canonique par personne, suivie malgré ses changements d’employeur.
          </p>
        </div>
        <span className="badge">{contacts.data.length} contacts</span>
      </header>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="panel">
          <div className="panel-header">
            <form className="flex flex-1 gap-2" action={`/w/${workspaceSlug}/prospects`} method="get">
              <input
                className="control min-w-0 flex-1"
                name="search"
                placeholder="Rechercher un prospect…"
                defaultValue={search ?? ""}
              />
              <button className="button" type="submit">Filtrer</button>
            </form>
          </div>
          <div className="panel-body overflow-x-auto">
            {contacts.data.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">
                Aucun prospect pour le moment. Créez le premier contact ou attendez la
                découverte ICP.
              </p>
            ) : (
              <table className="data-table min-w-[560px]">
                <thead>
                  <tr>
                    <th>Nom</th>
                    <th>Emploi courant</th>
                    <th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.data.map((contact) => (
                    <tr key={contact.id}>
                      <td className="font-semibold">
                        <Link className="text-brand-blue" href={`/w/${workspaceSlug}/prospects/${contact.id}`}>
                          {contact.firstName} {contact.lastName}
                        </Link>
                      </td>
                      <td className="text-xs text-muted">
                        {contact.currentEmployment
                          ? `${contact.currentEmployment.title} · ${contact.currentEmployment.companyName}`
                          : "—"}
                      </td>
                      <td>
                        <span className={`badge ${contact.status === "suppressed" ? "badge-danger" : ""}`}>
                          {contact.status === "suppressed" ? "supprimé" : "actif"}
                        </span>
                      </td>
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
              <UserRoundPlus size={15} className="text-brand-blue" />
              Nouveau prospect
            </h2>
          </div>
          <form action={create} className="panel-body space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs font-semibold text-muted">
                Prénom *
                <input className="control mt-1 w-full" name="firstName" required />
              </label>
              <label className="block text-xs font-semibold text-muted">
                Nom *
                <input className="control mt-1 w-full" name="lastName" required />
              </label>
            </div>
            <label className="block text-xs font-semibold text-muted">
              Email professionnel
              <input className="control mt-1 w-full" name="email" type="email" placeholder="jean@example.com" />
            </label>
            <label className="block text-xs font-semibold text-muted">
              URL LinkedIn
              <input className="control mt-1 w-full" name="linkedin" placeholder="https://linkedin.com/in/…" />
            </label>
            <label className="block text-xs font-semibold text-muted">
              Entreprise (emploi courant)
              <select className="control mt-1 w-full" name="companyId" defaultValue="">
                <option value="">— Aucune —</option>
                {companies.data.map((company) => (
                  <option key={company.id} value={company.id}>{company.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold text-muted">
              Intitulé de poste
              <input className="control mt-1 w-full" name="title" placeholder="Managing Partner" />
            </label>
            <button className="button button-signal w-full" type="submit">
              <Users size={15} />
              Créer le contact
            </button>
          </form>
        </aside>
      </div>
    </>
  );
}
