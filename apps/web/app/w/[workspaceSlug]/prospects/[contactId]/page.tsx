import { ArrowLeft, Ban, Bot, Briefcase, Fingerprint, MessageCircleMore, Plus, ShieldCheck, TriangleAlert, UserRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CrmPermissionState } from "@/components/crm-states";
import { getContact, getContactEnrichment, getEnrichmentJob, getProspectView, getSignalCollectionRun, listCalendarBookings, listCompanies, listContactMerges, listContactSignals, listWorkspaces, OutboundApiError, type EnrichmentJobDetail, type EnrichmentObservation, type IntentSignal, type SignalCollectionRun } from "@/lib/api";
import { MutationForm } from "../../research/[runId]/report/mutation-form";
import { prospectCampaignIdFromReturnTo, resolveProspectReturn } from "@/lib/prospect-navigation";
import { addEmploymentAction, addIdentityAction, anonymizeContactAction, enrichContactAction, requestProspectDryRunAction, retryEnrichmentJobAction, suppressContactAction, undoContactMergeAction, updateContactAction } from "../actions";
import { EnrichmentPanel } from "./enrichment-panel";
import { collectSignalsAction } from "../../signals-actions";
import { SignalsPanel } from "@/components/signals-panel";
import { CalendarBookingsPanel } from "@/components/calendar-bookings-panel";

export const metadata = { title: "Prospect" };
export const dynamic = "force-dynamic";

export default async function ContactDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; contactId: string }>;
  searchParams: Promise<{ returnTo?: string; enrichmentJobId?: string; signalRunId?: string }>;
}) {
  const { workspaceSlug, contactId } = await params;
  const { returnTo, enrichmentJobId, signalRunId } = await searchParams;
  const returnLink = resolveProspectReturn(workspaceSlug, returnTo);
  const returnCampaignId = prospectCampaignIdFromReturnTo(workspaceSlug, returnTo);
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
  let observations: EnrichmentObservation[] = [];
  const prospectView = await getProspectView(workspaceSlug, contactId);
  let enrichmentJob: EnrichmentJobDetail | null = null;
  let enrichmentAccess = true;
  let signals: IntentSignal[] = [];
  let signalRun: SignalCollectionRun | null = null;
  let signalAccess = true;
  if (contact.status !== "suppressed") {
    try {
      observations = (await getContactEnrichment(workspaceSlug, contactId)).data;
    } catch (error) {
      if (error instanceof OutboundApiError && (error.status === 401 || error.status === 403)) enrichmentAccess = false;
      else throw error;
    }
    if (enrichmentJobId && enrichmentAccess) {
      try { enrichmentJob = await getEnrichmentJob(workspaceSlug, enrichmentJobId); }
      catch (error) { if (!(error instanceof OutboundApiError && (error.status === 403 || error.status === 404))) throw error; }
    }
    try { signals = (await listContactSignals(workspaceSlug, contactId, true)).data; }
    catch (error) { if (error instanceof OutboundApiError && (error.status === 401 || error.status === 403)) signalAccess = false; else throw error; }
    if (signalRunId && signalAccess) {
      try { signalRun = await getSignalCollectionRun(workspaceSlug, signalRunId); }
      catch (error) { if (!(error instanceof OutboundApiError && (error.status === 403 || error.status === 404))) throw error; }
    }
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
  const addEmployment = addEmploymentAction.bind(null, workspaceSlug, contactId);
  const suppress = suppressContactAction.bind(null, workspaceSlug, contactId);
  const anonymize = anonymizeContactAction.bind(null, workspaceSlug, contactId);
  const update = updateContactAction.bind(null, workspaceSlug, contactId);
  const undo = undoContactMergeAction.bind(null, workspaceSlug, contactId);
  const enrich = enrichContactAction.bind(null, workspaceSlug, contactId);
  const collect = collectSignalsAction.bind(null, workspaceSlug);
  const retry = enrichmentJob?.status === "failed" ? retryEnrichmentJobAction.bind(null, workspaceSlug, contactId, enrichmentJob.id) : null;
  const addIdentity = addIdentityAction.bind(null, workspaceSlug, contactId);
  const requestDryRun = requestProspectDryRunAction.bind(null, workspaceSlug, contactId, returnCampaignId);
  const workspace = (await listWorkspaces()).find((item) => item.slug === workspaceSlug);
  const canEdit = workspace ? ["operator", "admin", "owner"].includes(workspace.role) : false;
  const canAdminister = workspace ? ["admin", "owner"].includes(workspace.role) : false;
  const suppressed = contact.status === "suppressed";
  const currentCompanyId = contact.employments.find((employment) => employment.isCurrent)?.companyId;
  const requestKey = `contact-enrichment:${contactId}:${contact.updatedAt ?? contact.createdAt ?? "v1"}`;
  const signalRequestKey = `contact-signals:${contactId}:${contact.updatedAt ?? contact.createdAt ?? "v1"}`;
  const calendarBookings = await listCalendarBookings(workspaceSlug, { contactId, limit: 50 }).catch(() => []);

  return (
    <>
      <header className="mb-6">
        <Link
          className="mb-4 inline-flex items-center gap-2 text-xs font-semibold text-muted"
          href={returnLink.href}
        >
          <ArrowLeft size={14} />
          {returnLink.label}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-ink">
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
          {prospectView ? (
            <>
            <section className="panel">
              <div className="panel-header">
                <h2 className="flex items-center gap-2 font-semibold"><Bot size={15} className="text-brand-blue" /> Pilotage agentique</h2>
                <span className="badge">{prospectView.decisions.length} décision(s)</span>
              </div>
              <div className="panel-body">
                {prospectView.nextDecision ? (
                  <div className="rounded-lg border border-brand-blue/20 bg-blue-50/40 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="text-sm">Prochaine action : {prospectDecisionLabel(prospectView.nextDecision.proposedAction)}</strong>
                      <span className={prospectView.nextDecision.status === "awaiting_approval" ? "badge badge-warning" : "badge badge-success"}>{prospectView.nextDecision.status}</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-ink">{prospectView.nextDecision.reason}</p>
                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted">
                      <span>Prévue {formatDecisionDate(prospectView.nextDecision.dueAt)}</span>
                      <span>Tentative {prospectView.nextDecision.attempts}/{prospectView.nextDecision.maxAttempts}</span>
                      <span className="font-mono">{prospectView.nextDecision.correlationId}</span>
                    </div>
                    {prospectView.nextDecision.lastErrorMessage ? <p className="mt-2 text-xs text-danger">{prospectView.nextDecision.lastErrorMessage}</p> : null}
                  </div>
                ) : (
                  <p className="text-sm text-muted">Aucune action agentique en attente. Le dernier événement a clôturé ou suspendu le cycle actuel.</p>
                )}
                {prospectView.decisions[0] ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-semibold text-brand-blue">Voir la dernière décision et son audit</summary>
                    <div className="mt-2 rounded-lg border border-line p-3 text-xs">
                      <p><strong>{prospectDecisionLabel(prospectView.decisions[0].proposedAction)}</strong> · {prospectView.decisions[0].status}</p>
                      <p className="mt-1 leading-5 text-muted">{prospectView.decisions[0].reason}</p>
                      {prospectView.decisions[0].lastErrorCode ? <p className="mt-1 text-danger">{prospectView.decisions[0].lastErrorCode}</p> : null}
                    </div>
                  </details>
                ) : null}
                {canEdit && !suppressed ? (
                  <MutationForm action={requestDryRun} className="mt-4 flex flex-col gap-2 sm:flex-row" successMessage="La réévaluation dry-run a été planifiée.">
                    <input className="control min-w-0 flex-1" name="reason" placeholder="Raison de la réévaluation (optionnel)" />
                    <button className="button" type="submit">Réévaluer maintenant · dry-run</button>
                  </MutationForm>
                ) : null}
              </div>
            </section>
            <section className="panel">
              <div className="panel-header">
                <h2 className="flex items-center gap-2 font-semibold"><MessageCircleMore size={15} className="text-brand-blue" /> Signaux sociaux prouvés</h2>
                <span className={prospectView.socialSignalAssessment.socialBoost > 0 ? "badge badge-success" : "badge"}>
                  +{prospectView.socialSignalAssessment.socialBoost} social
                </span>
              </div>
              <div className="panel-body space-y-3">
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg border border-line p-3"><p className="text-[11px] uppercase tracking-wide text-muted">Score ICP</p><strong className="mt-1 block text-xl">{prospectView.socialSignalAssessment.baseScore ?? "—"}</strong></div>
                  <div className="rounded-lg border border-line p-3"><p className="text-[11px] uppercase tracking-wide text-muted">Preuves sociales</p><strong className="mt-1 block text-xl">{prospectView.socialSignalAssessment.eligibleSignals.length}</strong></div>
                  <div className="rounded-lg border border-brand-blue/20 bg-blue-50/40 p-3"><p className="text-[11px] uppercase tracking-wide text-muted">Score effectif</p><strong className="mt-1 block text-xl text-brand-blue">{prospectView.socialSignalAssessment.effectiveScore ?? "—"}</strong></div>
                </div>
                {prospectView.socialSignalAssessment.openLinkedinConversation ? (
                  <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-amber-50 p-3 text-xs leading-5 text-warning">
                    <ShieldCheck className="mt-0.5 shrink-0" size={14} />
                    Une conversation LinkedIn est déjà ouverte. La policy annule tout nouveau DM froid et conserve le fil existant comme seule surface de réponse.
                  </p>
                ) : null}
                {prospectView.socialSignalAssessment.eligibleSignals.length ? (
                  <div className="space-y-2">
                    {prospectView.socialSignalAssessment.eligibleSignals.map((signal) => (
                      <div className="rounded-lg border border-line p-3" key={signal.id}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <strong className="text-xs">{socialSignalLabel(signal.type)} prouvé · +{signal.contribution}</strong>
                          <span className="badge badge-success">identité {Math.round(signal.identityConfidence * 100)}%</span>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-ink">{signal.summary}</p>
                        <Link className="mt-2 inline-flex text-[11px] font-semibold text-brand-blue" href={`/w/${workspaceSlug}${signal.proofHref}`}>Voir la preuve et la règle</Link>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-muted">Aucun commentaire, réponse ou mention récente avec identité exacte. Le score ICP reste inchangé.</p>}
                {prospectView.socialSignalAssessment.ignoredSignals.length ? (
                  <details>
                    <summary className="cursor-pointer text-xs font-semibold text-muted">{prospectView.socialSignalAssessment.ignoredSignals.length} signal(aux) sans effet</summary>
                    <div className="mt-2 space-y-2">
                      {prospectView.socialSignalAssessment.ignoredSignals.map((signal) => (
                        <div className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 p-3 text-xs" key={signal.id}>
                          <span>{signal.explanation}</span>
                          <Link className="shrink-0 font-semibold text-brand-blue" href={`/w/${workspaceSlug}${signal.proofHref}`}>Preuve</Link>
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
                <p className="text-[11px] leading-4 text-muted">Une réaction seule ne modifie jamais le score et ne crée aucune action automatique.</p>
              </div>
            </section>
            </>
          ) : null}
          {enrichmentAccess ? <EnrichmentPanel addIdentityAction={addIdentity} canEnrich={canEdit} contact={contact} enrichAction={enrich} job={enrichmentJob} observations={observations} requestKey={requestKey} retryAction={retry} workspaceSlug={workspaceSlug} /> : <section className="panel"><div className="panel-header"><h2 className="font-semibold">Coordonnées</h2></div><div className="panel-body text-sm text-muted">Les coordonnées enrichies ne sont pas accessibles avec vos droits.</div></section>}
          <CalendarBookingsPanel bookings={calendarBookings} canMutate={canEdit} workspaceSlug={workspaceSlug} />

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

        <aside className="space-y-4">
          {canEdit && !suppressed ? <section className="panel border-warning">
            <div className="panel-header">
              <h2 className="flex items-center gap-2 font-semibold">
                <Ban size={15} className="text-warning" />
                Zone sensible
              </h2>
            </div>
            <div className="panel-body">
              <p className="text-xs leading-5 text-muted">
                Cette action bloque durablement toutes les coordonnées de ce contact, notamment
                son numéro WhatsApp. La recherche automatique ne pourra pas le réimporter dans ce workspace.
              </p>
              <MutationForm action={suppress} className="mt-3 space-y-2" confirmation="Confirmer la suppression persistante de ce contact ?" successMessage="Le contact a été supprimé.">
                <input className="control w-full" name="reason" placeholder="Motif (opposition, demande RGPD…)" />
                <button className="button w-full" type="submit">
                  <Ban size={14} />
                  Ne plus contacter ce prospect
                </button>
              </MutationForm>
            </div>
          </section> : null}
          {canAdminister ? <section className="panel border-danger/30"><div className="panel-header"><h2 className="flex items-center gap-2 font-semibold"><Fingerprint size={15} className="text-danger" /> Anonymisation irréversible</h2></div><div className="panel-body"><p className="text-xs leading-5 text-muted">Remplace le nom et toutes les coordonnées sans réécrire les faits historiques. Les empreintes de suppression restent actives afin qu’un réimport demeure bloqué.</p><MutationForm action={anonymize} className="mt-3 space-y-2" successMessage="Le contact a été anonymisé."><label className="block text-xs font-semibold text-muted">Saisissez ANONYMISER<input className="control mt-1" name="confirmation" pattern="ANONYMISER" required /></label><button className="button w-full text-danger" type="submit"><Fingerprint size={14} /> Anonymiser définitivement</button></MutationForm></div></section> : null}
        </aside>
      </div>
      {!suppressed && signalAccess ? <SignalsPanel canCollect={workspace ? ["admin", "owner"].includes(workspace.role) : false} collectAction={collect} entityId={contactId} entityType="contact" requestKey={signalRequestKey} run={signalRun} signals={signals} /> : null}
      {canEdit && !suppressed ? (
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

function prospectDecisionLabel(value: string | null): string {
  return ({ send: "envoyer", wait: "attendre", research: "rechercher", pause: "mettre en pause", stop: "arrêter", handoff: "transmettre" } as Record<string, string>)[value ?? ""] ?? "à déterminer";
}

function socialSignalLabel(value: "comment" | "reply" | "mention"): string {
  return value === "reply" ? "Réponse" : value === "mention" ? "Mention" : "Commentaire";
}

function formatDecisionDate(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(value));
}

function formatMergeDate(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
