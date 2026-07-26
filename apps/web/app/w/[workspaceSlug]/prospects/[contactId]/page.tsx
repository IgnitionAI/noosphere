import { ArrowLeft, Ban, Briefcase, Mail, Phone, Plus, TriangleAlert, UserRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getContact, listCompanies, OutboundApiError } from "@/lib/api";
import { addEmploymentAction, addIdentityAction, suppressContactAction } from "../actions";

export const metadata = { title: "Prospect" };
export const dynamic = "force-dynamic";

const IDENTITY_ICON: Record<string, typeof Mail> = {
  email: Mail,
  linkedin: UserRound,
  phone: Phone,
  whatsapp: Phone,
};

const VERIFICATION_BADGE: Record<string, { label: string; className: string }> = {
  unknown: { label: "non vérifié", className: "badge" },
  verified: { label: "vérifié", className: "badge badge-success" },
  invalid: { label: "invalide", className: "badge badge-danger" },
};

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; contactId: string }>;
}) {
  const { workspaceSlug, contactId } = await params;
  let contact;
  try {
    [contact] = await Promise.all([getContact(workspaceSlug, contactId)]);
  } catch (error) {
    if (error instanceof OutboundApiError && error.status === 404) notFound();
    throw error;
  }
  const companies = await listCompanies(workspaceSlug);
  const addIdentity = addIdentityAction.bind(null, workspaceSlug, contactId);
  const addEmployment = addEmploymentAction.bind(null, workspaceSlug, contactId);
  const suppress = suppressContactAction.bind(null, workspaceSlug, contactId);
  const suppressed = contact.status === "suppressed";

  return (
    <>
      <header className="mb-6">
        <Link
          className="mb-4 inline-flex items-center gap-2 text-xs font-semibold text-muted"
          href={`/w/${workspaceSlug}/prospects`}
        >
          <ArrowLeft size={14} />
          Retour aux prospects
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-navy">
            <UserRound size={20} />
          </span>
          <div>
            <h1 className="page-title">
              {contact.firstName} {contact.lastName}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className={`badge ${suppressed ? "badge-danger" : "badge-success"}`}>
                {suppressed ? "supprimé — inéligible" : "actif"}
              </span>
            </div>
          </div>
        </div>
        {suppressed ? (
          <p className="mt-3 flex items-center gap-2 rounded-lg border border-warning/30 bg-amber-50 p-3 text-xs text-warning">
            <TriangleAlert size={14} />
            Cette identité est supprimée de façon persistante : un réimport de ses
            coordonnées ne la rendra jamais éligible.
          </p>
        ) : null}
      </header>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <main className="min-w-0 space-y-4">
          <section className="panel">
            <div className="panel-header">
              <h2 className="font-semibold">Coordonnées</h2>
              <span className="badge">{contact.identities.length}</span>
            </div>
            <div className="panel-body space-y-2">
              {contact.identities.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted">Aucune coordonnée enregistrée.</p>
              ) : (
                contact.identities.map((identity) => {
                  const Icon = IDENTITY_ICON[identity.type] ?? Mail;
                  const badge = VERIFICATION_BADGE[identity.verificationStatus] ?? VERIFICATION_BADGE.unknown!;
                  return (
                    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3" key={identity.id}>
                      <Icon size={16} className="text-brand-blue" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{identity.value}</p>
                        <p className="text-[11px] text-muted">
                          {identity.type} · source {identity.source}
                        </p>
                      </div>
                      <span className={badge.className}>{badge.label}</span>
                    </div>
                  );
                })
              )}
              {!suppressed ? (
                <details className="pt-2">
                  <summary className="cursor-pointer text-sm font-semibold text-brand-blue">
                    <Plus size={13} className="mr-1 inline" />
                    Ajouter une coordonnée
                  </summary>
                  <form action={addIdentity} className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <select className="control sm:w-36" name="type" defaultValue="email">
                      <option value="email">Email</option>
                      <option value="linkedin">LinkedIn</option>
                      <option value="phone">Téléphone</option>
                      <option value="whatsapp">WhatsApp</option>
                    </select>
                    <input className="control min-w-0 flex-1" name="value" required />
                    <button className="button" type="submit">Ajouter</button>
                  </form>
                </details>
              ) : null}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2 className="flex items-center gap-2 font-semibold">
                <Briefcase size={15} className="text-brand-blue" />
                Emplois
              </h2>
              <span className="badge">{contact.employments.length}</span>
            </div>
            <div className="panel-body space-y-2">
              {contact.employments.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted">Aucun emploi enregistré.</p>
              ) : (
                contact.employments.map((employment) => (
                  <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3" key={employment.id}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{employment.title}</p>
                      <Link className="text-xs text-brand-blue" href={`/w/${workspaceSlug}/companies/${employment.companyId}`}>
                        {employment.companyName}
                      </Link>
                      <p className="text-[11px] text-muted">
                        {employment.startedOn ?? "?"} → {employment.isCurrent ? "aujourd’hui" : employment.endedOn ?? "?"}
                      </p>
                    </div>
                    {employment.isCurrent ? <span className="badge badge-success">courant</span> : <span className="badge">passé</span>}
                  </div>
                ))
              )}
              {!suppressed ? (
                <details className="pt-2">
                  <summary className="cursor-pointer text-sm font-semibold text-brand-blue">
                    <Plus size={13} className="mr-1 inline" />
                    Déclarer un nouvel employeur
                  </summary>
                  <form action={addEmployment} className="mt-3 space-y-2">
                    <select className="control w-full" name="companyId" required defaultValue="">
                      <option value="" disabled>Choisir une entreprise…</option>
                      {companies.data.map((company) => (
                        <option key={company.id} value={company.id}>{company.name}</option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <input className="control min-w-0 flex-1" name="title" placeholder="Intitulé du nouveau poste" required />
                      <button className="button" type="submit">Enregistrer</button>
                    </div>
                    <p className="text-[11px] leading-4 text-muted">
                      L’emploi courant actuel sera clôturé automatiquement — la personne reste
                      unique dans le CRM.
                    </p>
                  </form>
                </details>
              ) : null}
            </div>
          </section>
        </main>

        {!suppressed ? (
          <aside className="panel border-warning">
            <div className="panel-header">
              <h2 className="flex items-center gap-2 font-semibold">
                <Ban size={15} className="text-warning" />
                Zone sensible
              </h2>
            </div>
            <div className="panel-body">
              <p className="text-xs leading-5 text-muted">
                La suppression marque toutes les coordonnées de ce contact comme inéligibles,
                de façon persistante, y compris face à un futur réimport.
              </p>
              <form action={suppress} className="mt-3 space-y-2">
                <input className="control w-full" name="reason" placeholder="Motif (opposition, demande RGPD…)" />
                <button className="button w-full" type="submit">
                  <Ban size={14} />
                  Supprimer ce contact
                </button>
              </form>
            </div>
          </aside>
        ) : null}
      </div>
    </>
  );
}
