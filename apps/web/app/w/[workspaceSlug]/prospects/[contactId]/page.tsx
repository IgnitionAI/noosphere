import { ArrowLeft, Ban, Briefcase, Mail, Phone, Plus, TriangleAlert, UserRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CrmPermissionState } from "@/components/crm-states";
import { getContact, listCompanies, listContactMerges, listWorkspaces, OutboundApiError } from "@/lib/api";
import { MutationForm } from "../../research/[runId]/report/mutation-form";
import { addEmploymentAction, addIdentityAction, suppressContactAction, undoContactMergeAction, updateContactAction } from "../actions";

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
    if (error instanceof OutboundApiError && (error.status === 401 || error.status === 403)) {
      return <CrmPermissionState resource="ce prospect" />;
    }
    throw error;
  }
  let companies;
  try {
    companies = await listCompanies(workspaceSlug, { limit: 50 });
  } catch (error) {
    if (error instanceof OutboundApiError && (error.status === 401 || error.status === 403)) {
      return <CrmPermissionState resource="les entreprises" />;
    }
    throw error;
  }
  let merges;
  try {
    merges = await listContactMerges(workspaceSlug, contactId);
  } catch (error) {
    if (error instanceof OutboundApiError && (error.status === 401 || error.status === 403)) {
      return <CrmPermissionState resource="l’historique des fusions" />;
    }
    throw error;
  }
  const addIdentity = addIdentityAction.bind(null, workspaceSlug, contactId);
  const addEmployment = addEmploymentAction.bind(null, workspaceSlug, contactId);
  const suppress = suppressContactAction.bind(null, workspaceSlug, contactId);
  const update = updateContactAction.bind(null, workspaceSlug, contactId);
  const undo = undoContactMergeAction.bind(null, workspaceSlug, contactId);
  const workspace = (await listWorkspaces()).find((item) => item.slug === workspaceSlug);
  const canEdit = workspace ? ["operator", "admin", "owner"].includes(workspace.role) : false;
  const suppressed = contact.status === "suppressed";
  const currentCompanyId = contact.employments.find((employment) => employment.isCurrent)?.companyId;

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
              {canEdit && !suppressed ? (
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
              {canEdit && !suppressed ? (
                <details className="pt-2">
                  <summary className="cursor-pointer text-sm font-semibold text-brand-blue">
                    <Plus size={13} className="mr-1 inline" />
                    Déclarer un nouvel employeur
                  </summary>
                  <MutationForm action={addEmployment} className="mt-3 space-y-2" confirmation="Confirmer le changement d’employeur ? L’emploi courant sera clôturé automatiquement." successMessage="Le nouvel emploi a été enregistré.">
                    <select className="control w-full" name="companyId" required defaultValue="">
                      <option value="" disabled>Choisir une entreprise…</option>
                      {companies.data.filter((company) => company.id !== currentCompanyId).map((company) => (
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
                  </MutationForm>
                </details>
              ) : null}
            </div>
          </section>
        </main>

        {canEdit && !suppressed ? (
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
              <MutationForm action={suppress} className="mt-3 space-y-2" confirmation="Confirmer la suppression persistante de ce contact ?" successMessage="Le contact a été supprimé.">
                <input className="control w-full" name="reason" placeholder="Motif (opposition, demande RGPD…)" />
                <button className="button w-full" type="submit">
                  <Ban size={14} />
                  Supprimer ce contact
                </button>
              </MutationForm>
            </div>
          </aside>
        ) : null}
      </div>
      {canEdit ? (
        <section className="panel mt-5">
          <div className="panel-header">
            <h2 className="font-semibold">Modifier le contact</h2>
          </div>
          <MutationForm action={update} className="panel-body grid gap-3 sm:grid-cols-2" successMessage="La fiche contact a été mise à jour.">
            <label className="text-xs font-semibold text-muted">
              Prénom *
              <input className="control mt-1 w-full" name="firstName" required defaultValue={contact.firstName} />
            </label>
            <label className="text-xs font-semibold text-muted">
              Nom *
              <input className="control mt-1 w-full" name="lastName" required defaultValue={contact.lastName} />
            </label>
            <label className="text-xs font-semibold text-muted">
              Canal préféré
              <select className="control mt-1 w-full" name="preferredChannel" defaultValue={contact.preferredChannel ?? ""}>
                <option value="">Non défini</option>
                <option value="email">Email</option>
                <option value="linkedin">LinkedIn</option>
                <option value="phone">Téléphone</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-muted">
              Photo (URL)
              <input className="control mt-1 w-full" name="photoUrl" type="url" defaultValue={contact.photoUrl ?? ""} />
            </label>
            <button className="button button-signal sm:col-span-2" type="submit">Enregistrer les modifications</button>
          </MutationForm>
        </section>
      ) : null}
      {merges.length ? (
        <section className="panel mt-5">
          <div className="panel-header"><h2 className="font-semibold">Historique des fusions</h2><span className="badge">{merges.length}</span></div>
          <div className="panel-body space-y-3">
            {merges.map((merge) => (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3" key={merge.id}>
                <div className="text-xs"><p className="font-semibold">{merge.status === "active" ? "Fusion active" : "Fusion annulée"}</p><p className="mt-1 text-muted">{formatMergeDate(merge.mergedAt)} · contact conservé {merge.survivorContactId === contactId ? "ici" : "ailleurs"}</p></div>
                {canEdit && merge.status === "active" ? <MutationForm action={undo} confirmation="Annuler cette fusion ? Les deux fiches, identités, emplois et suppressions seront restaurés." successMessage="La fusion a été annulée."><button className="button" type="submit">Annuler la fusion</button></MutationForm> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function formatMergeDate(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
