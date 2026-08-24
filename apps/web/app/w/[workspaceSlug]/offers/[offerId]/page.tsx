import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  FileText,
  Lock,
  Package,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CrmEmptyState, CrmPermissionState } from "@/components/crm-states";
import {
  getOffer,
  listKnowledgeClaims,
  listWorkspaces,
  OutboundApiError,
  type Offer,
  type OfferDetail,
  type OfferVersion,
  type KnowledgeClaim,
} from "@/lib/api";
import { MutationForm } from "../../research/[runId]/report/mutation-form";
import { publishOfferAction, updateOfferAction } from "../actions";
import { OfferEditor } from "../offer-editor";

export const metadata = { title: "Offre" };
export const dynamic = "force-dynamic";

export default async function OfferDetailPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; offerId: string }>;
}) {
  const { workspaceSlug, offerId } = await params;
  let offer: OfferDetail;
  let role: string | undefined;
  let knowledgeClaims: readonly KnowledgeClaim[];
  try {
    [offer, role, knowledgeClaims] = await Promise.all([
      getOffer(workspaceSlug, offerId),
      listWorkspaces().then((workspaces) => workspaces.find((workspace) => workspace.slug === workspaceSlug)?.role),
      listKnowledgeClaims(workspaceSlug),
    ]);
  } catch (error) {
    if (error instanceof OutboundApiError && error.status === 404) notFound();
    if (error instanceof OutboundApiError && (error.status === 401 || error.status === 403)) {
      return <CrmPermissionState resource="cette offre" />;
    }
    throw error;
  }

  const canEdit = ["operator", "admin", "owner"].includes(role ?? "");
  const canPublish = ["admin", "owner"].includes(role ?? "");
  const missing = publicationMissing(offer);
  const update = updateOfferAction.bind(null, workspaceSlug, offer.id);
  const publish = publishOfferAction.bind(null, workspaceSlug, offer.id);
  const versions = [...offer.versions].sort((left, right) => right.version - left.version);
  const knowledgeStatuses = new Map(knowledgeClaims.filter((claim) => claim.offerClaimId).map((claim) => [claim.offerClaimId!, claim.effectiveStatus]));
  const needsResourcing = offer.claims.filter((claim) => claim.id && claim.validationStatus === "validated" && (knowledgeStatuses.get(claim.id) ?? "needs_resourcing") !== "validated");

  return (
    <>
      <header className="mb-6">
        <Link className="mb-4 inline-flex items-center gap-2 text-xs font-semibold text-muted" href={`/w/${workspaceSlug}/offers`}>
          <ArrowLeft size={14} /> Retour aux offres
        </Link>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="badge badge-signal"><Package size={12} /> {offer.category}</span>
              <span className={offer.status === "archived" ? "badge badge-warning" : "badge"}>
                {offer.status === "archived" ? "Archivée" : "Brouillon éditable"}
              </span>
              {offer.currentVersion ? <span className="badge badge-success">v{offer.currentVersion}</span> : null}
            </div>
            <h1 className="page-title mt-3">{offer.name}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              {offer.valueProposition || "Complétez la proposition de valeur avant de publier cette offre."}
            </p>
          </div>
          <Link className="button shrink-0" href={`/w/${workspaceSlug}/strategy/product-reading`}>
            <FileText size={14} /> Lecture produit
          </Link>
        </div>
      </header>

      <section className={`panel mb-5 ${missing.length ? "border-warning" : "border-success"}`}>
        <div className="panel-header">
          <div className="flex items-center gap-2">
            {missing.length ? <TriangleAlert className="text-warning" size={16} /> : <CheckCircle2 className="text-success" size={16} />}
            <h2 className="font-semibold">Préflight de publication</h2>
          </div>
          <span className={missing.length ? "badge badge-warning" : "badge badge-success"}>
            {missing.length ? "Incomplète" : "Prête"}
          </span>
        </div>
        <div className="panel-body">
          {missing.length ? (
            <ul className="space-y-1 text-sm leading-6 text-warning">
              {missing.map((reason) => <li key={reason}>• {reason}</li>)}
            </ul>
          ) : (
            <p className="text-sm text-muted">Les informations nécessaires sont présentes. La publication créera une version immuable.</p>
          )}
          {canPublish ? (
            missing.length ? (
              <p className="mt-3 text-xs font-semibold text-warning">Complétez le brouillon pour activer la publication.</p>
            ) : (
              <MutationForm
                action={publish}
                className="mt-4"
                confirmation={`Publier « ${offer.name} » en v${offer.currentVersion + 1} ? Cette version sera immuable.`}
                successMessage={`La version v${offer.currentVersion + 1} est publiée.`}
              >
                <button className="button button-signal" type="submit"><ShieldCheck size={15} /> Publier v{offer.currentVersion + 1}</button>
              </MutationForm>
            )
          ) : (
            <p className="mt-3 text-xs text-muted">
              Votre rôle peut consulter cette offre{canEdit ? " et modifier le brouillon" : ""}, mais seul un administrateur ou propriétaire peut publier.
            </p>
          )}
        </div>
      </section>

      {canEdit ? (
        <section className="panel mb-5">
          <div className="panel-header"><h2 className="font-semibold">Brouillon éditable</h2><span className="badge">Claims, preuves et règles</span></div>
          <div className="panel-body">{needsResourcing.length ? <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-warning"><TriangleAlert className="mr-1 inline" size={13} /> {needsResourcing.length} claim{needsResourcing.length > 1 ? "s" : ""} validé{needsResourcing.length > 1 ? "s" : ""} ne dispose{needsResourcing.length > 1 ? "nt" : ""} plus d’une source fraîche. Associez-les depuis Connaissance.</p> : null}<OfferEditor action={update} offer={offer} /></div>
        </section>
      ) : (
        <ReadOnlyDraft offer={offer} knowledgeStatuses={knowledgeStatuses} />
      )}

      <section className="panel">
        <div className="panel-header">
          <div className="flex items-center gap-2"><Lock className="text-brand-blue" size={16} /><h2 className="font-semibold">Publications immuables</h2></div>
          <span className="badge">{versions.length} version{versions.length > 1 ? "s" : ""}</span>
        </div>
        {versions.length ? (
          <div className="space-y-4 p-4 md:p-6">
            {versions.map((version) => <PublishedVersion key={version.id} version={version} knowledgeStatuses={knowledgeStatuses} />)}
          </div>
        ) : (
          <div className="panel-body"><CrmEmptyState title="Aucune publication" description="Le brouillon apparaîtra ici après sa première publication." /></div>
        )}
      </section>
    </>
  );
}

function ReadOnlyDraft({ offer, knowledgeStatuses }: { offer: Offer; knowledgeStatuses: Map<string, KnowledgeClaim["effectiveStatus"]> }) {
  return (
    <section className="panel mb-5">
      <div className="panel-header"><h2 className="font-semibold">Détails de l’offre</h2><span className="badge"><Lock size={11} /> Lecture seule</span></div>
      <div className="panel-body grid gap-4 md:grid-cols-2">
        <DetailField label="Proposition de valeur" value={offer.valueProposition} className="md:col-span-2" />
        <DetailField label="Cible" value={offer.targetAudience} />
        <DetailField label="Prix" value={formatUnknown(offer.pricing)} />
        <DetailField label="Règles commerciales" value={formatUnknown(offer.commercialRules)} />
        <DetailField label="Contraintes" value={formatUnknown(offer.constraints)} />
        <DetailField label="Objections" value={formatUnknown(offer.objections)} />
        <Claims claims={offer.claims} knowledgeStatuses={knowledgeStatuses} />
      </div>
    </section>
  );
}

function PublishedVersion({ version, knowledgeStatuses }: { version: OfferVersion; knowledgeStatuses: Map<string, KnowledgeClaim["effectiveStatus"]> }) {
  return (
    <article className="rounded-xl border border-line bg-slate-50/60 p-4 md:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><span className="badge badge-success">v{version.version}</span><h3 className="mt-2 font-semibold">{version.name}</h3></div>
        <div className="text-left text-xs text-muted sm:text-right"><div className="inline-flex items-center gap-1.5"><CalendarDays size={13} />{formatDate(version.publishedAt)}</div><div className="mt-1 break-all font-mono">{version.publishedBy ? `Par ${version.publishedBy.slice(0, 8)}` : "Auteur non renseigné"}</div></div>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <DetailField className="md:col-span-2" label="Proposition de valeur" value={version.valueProposition} />
        <DetailField label="Cible" value={version.targetAudience} />
        <DetailField label="Prix" value={formatUnknown(version.pricing)} />
        <DetailField label="Règles commerciales" value={formatUnknown(version.commercialRules)} />
        <DetailField label="Contraintes" value={formatUnknown(version.constraints)} />
        <DetailField label="Objections" value={formatUnknown(version.objections)} />
        <Claims claims={version.claims} knowledgeStatuses={knowledgeStatuses} />
      </div>
    </article>
  );
}

function Claims({ claims, knowledgeStatuses }: { claims: readonly Offer["claims"][number][]; knowledgeStatuses: Map<string, KnowledgeClaim["effectiveStatus"]> }) {
  return <div className="md:col-span-2"><h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Claims autorisés</h4>{claims.length ? <ul className="mt-2 space-y-2">{claims.map((claim, index) => { const knowledgeStatus = claim.id ? knowledgeStatuses.get(claim.id) : undefined; return <li className="flex flex-wrap items-start gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm" key={`${claim.id ?? claim.claim}-${index}`}><span className="min-w-0 flex-1">{claim.claim}</span><ClaimStatus status={claim.validationStatus} {...(knowledgeStatus ? { knowledgeStatus } : {})} />{claim.evidenceUri ? <a className="inline-flex items-center gap-1 text-xs font-semibold text-brand-blue" href={claim.evidenceUri} rel="noreferrer" target="_blank">Preuve <ExternalLink size={11} /></a> : <span className="text-xs text-muted">Sans preuve</span>}</li>; })}</ul> : <p className="mt-2 text-sm text-muted">Aucun claim renseigné.</p>}</div>;
}

function ClaimStatus({ status, knowledgeStatus }: { status: Offer["claims"][number]["validationStatus"]; knowledgeStatus?: KnowledgeClaim["effectiveStatus"] }) {
  const labels = { hypothesis: "Hypothèse", sourced: "Sourcé", validated: "Validé", invalidated: "Invalidé" } as const;
  if (status === "validated" && knowledgeStatus !== "validated") return <span className="badge badge-warning">À re-sourcer</span>;
  return <span className={`badge ${status === "validated" ? "badge-success" : status === "invalidated" ? "badge-warning" : ""}`}>{labels[status]}</span>;
}

function DetailField({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return <div className={className}><span className="text-xs text-muted">{label}</span><p className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold">{value || "Non renseigné"}</p></div>;
}

function publicationMissing(offer: Offer): string[] {
  const missing: string[] = [];
  if (!offer.name.trim()) missing.push("Nom de l’offre");
  if (!offer.valueProposition.trim()) missing.push("Proposition de valeur");
  if (!offer.claims.length) missing.push("Au moins un claim");
  if (offer.claims.some((claim) => claim.validationStatus === "invalidated")) missing.push("Supprimer ou corriger les claims invalidés");
  return missing;
}

function formatUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date inconnue" : new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(date);
}
