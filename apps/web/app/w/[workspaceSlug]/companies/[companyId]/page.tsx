import { ArrowLeft, Building2, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CrmPermissionState } from "@/components/crm-states";
import { getCompany, getSignalCollectionRun, listCompanySignals, listWorkspaces, OutboundApiError, type IntentSignal, type SignalCollectionRun } from "@/lib/api";
import { MutationForm } from "../../research/[runId]/report/mutation-form";
import { updateCompanyAction } from "../actions";
import { collectSignalsAction } from "../../signals-actions";
import { SignalsPanel } from "@/components/signals-panel";

export const metadata = { title: "Entreprise" };
export const dynamic = "force-dynamic";

export default async function CompanyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; companyId: string }>;
  searchParams: Promise<{ signalRunId?: string }>;
}) {
  const { workspaceSlug, companyId } = await params;
  const { signalRunId } = await searchParams;
  let company;
  try {
    [company] = await Promise.all([getCompany(workspaceSlug, companyId)]);
  } catch (error) {
    if (error instanceof OutboundApiError && error.status === 404) notFound();
    if (error instanceof OutboundApiError && (error.status === 401 || error.status === 403)) {
      return <CrmPermissionState resource="cette entreprise" />;
    }
    throw error;
  }
  let signals: IntentSignal[] = [];
  let signalRun: SignalCollectionRun | null = null;
  let signalAccess = true;
  try { signals = (await listCompanySignals(workspaceSlug, companyId, true)).data; }
  catch (error) { if (error instanceof OutboundApiError && (error.status === 401 || error.status === 403)) signalAccess = false; else throw error; }
  if (signalRunId && signalAccess) {
    try { signalRun = await getSignalCollectionRun(workspaceSlug, signalRunId); }
    catch (error) { if (!(error instanceof OutboundApiError && (error.status === 403 || error.status === 404))) throw error; }
  }
  const workspace = (await listWorkspaces()).find((item) => item.slug === workspaceSlug);
  const canEdit = workspace ? ["operator", "admin", "owner"].includes(workspace.role) : false;
  const canCollectSignals = workspace ? ["admin", "owner"].includes(workspace.role) : false;
  const update = updateCompanyAction.bind(null, workspaceSlug, companyId);
  const collect = collectSignalsAction.bind(null, workspaceSlug);
  const signalRequestKey = `company-signals:${companyId}:${company.createdAt}`;

  return (
    <>
      <header className="mb-6">
        <Link
          className="mb-4 inline-flex items-center gap-2 text-xs font-semibold text-muted"
          href={`/w/${workspaceSlug}/companies`}
        >
          <ArrowLeft size={14} />
          Retour aux entreprises
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-navy">
            <Building2 size={20} />
          </span>
          <div>
            <h1 className="page-title">{company.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {company.normalizedDomain ? <span className="badge">{company.normalizedDomain}</span> : null}
              <span className="badge">{company.source}</span>
            </div>
          </div>
        </div>
      </header>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="panel">
          <div className="panel-header">
            <h2 className="font-semibold">Contacts liés</h2>
            <span className="badge">{company.contacts.length}</span>
          </div>
          <div className="panel-body">
            {company.contacts.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">
                Aucun contact rattaché pour le moment.
              </p>
            ) : (
              <ul className="space-y-2">
                {company.contacts.map((contact) => (
                  <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3" key={contact.id}>
                    <div>
                      <Link className="text-sm font-semibold text-brand-blue" href={`/w/${workspaceSlug}/prospects/${contact.id}`}>
                        {contact.firstName} {contact.lastName}
                      </Link>
                      <p className="text-xs text-muted">
                        {contact.title ?? "—"}{contact.isCurrent ? " · emploi courant" : " · ancien emploi"}
                      </p>
                    </div>
                    <span className="badge">{contact.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <aside className="panel">
          <div className="panel-header">
            <h2 className="font-semibold">Fiche</h2>
          </div>
          <div className="panel-body space-y-2 text-sm">
            <Field label="Secteur" value={company.sector} />
            <Field
              label="Taille"
              value={
                company.employeeCountMin || company.employeeCountMax
                  ? `${company.employeeCountMin ?? "?"} – ${company.employeeCountMax ?? "?"} employés`
                  : null
              }
            />
            <Field label="Localisation" value={company.location} />
            {company.linkedinUrl ? (
              <a className="inline-flex items-center gap-1 text-xs font-semibold text-brand-blue" href={company.linkedinUrl} rel="noreferrer" target="_blank">
                Page LinkedIn <ExternalLink size={11} />
              </a>
            ) : null}
          </div>
        </aside>
      </div>
      {signalAccess ? <SignalsPanel canCollect={canCollectSignals} collectAction={collect} entityId={companyId} entityType="company" requestKey={signalRequestKey} run={signalRun} signals={signals} /> : <section className="panel mt-5" id="signals"><div className="panel-body text-sm text-muted">Les signaux ne sont pas accessibles avec vos droits.</div></section>}
      {canEdit ? (
        <section className="panel mt-5">
          <div className="panel-header">
            <h2 className="font-semibold">Modifier la fiche</h2>
          </div>
          <MutationForm action={update} className="panel-body grid gap-3 sm:grid-cols-2" successMessage="La fiche entreprise a été mise à jour.">
            <label className="text-xs font-semibold text-muted">
              Nom *
              <input className="control mt-1 w-full" name="name" required defaultValue={company.name} />
            </label>
            <label className="text-xs font-semibold text-muted">
              Domaine
              <input className="control mt-1 w-full" name="domain" defaultValue={company.normalizedDomain ?? ""} />
            </label>
            <label className="text-xs font-semibold text-muted">
              Secteur
              <input className="control mt-1 w-full" name="sector" defaultValue={company.sector ?? ""} />
            </label>
            <label className="text-xs font-semibold text-muted">
              Localisation
              <input className="control mt-1 w-full" name="location" defaultValue={company.location ?? ""} />
            </label>
            <label className="text-xs font-semibold text-muted">
              Effectif min
              <input className="control mt-1 w-full" min="0" name="employeeCountMin" type="number" defaultValue={company.employeeCountMin ?? ""} />
            </label>
            <label className="text-xs font-semibold text-muted">
              Effectif max
              <input className="control mt-1 w-full" min="0" name="employeeCountMax" type="number" defaultValue={company.employeeCountMax ?? ""} />
            </label>
            <label className="text-xs font-semibold text-muted sm:col-span-2">
              URL LinkedIn
              <input className="control mt-1 w-full" name="linkedinUrl" type="url" defaultValue={company.linkedinUrl ?? ""} />
            </label>
            <button className="button button-signal sm:col-span-2" type="submit">Enregistrer les modifications</button>
          </MutationForm>
        </section>
      ) : null}
    </>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <span className="text-xs text-muted">{label}</span>
      <p className="font-semibold">{value ?? "—"}</p>
    </div>
  );
}
