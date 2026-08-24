import { BookOpenCheck, CalendarDays, CheckCircle2, FileText, Link2, Plus, Search, ShieldCheck } from "lucide-react";
import { notFound } from "next/navigation";
import {
  getSession,
  listKnowledgeClaims,
  listKnowledgeSources,
  listOffers,
  listResearchDocuments,
  listWorkspaces,
  type KnowledgeSourceStatus,
  type KnowledgeSourceType,
} from "@/lib/api";
import { createClaimAction, createSourceAction, validateClaimAction, validateSourceAction, withdrawSourceAction } from "./actions";

export const metadata = { title: "Sources de connaissance" };
export const dynamic = "force-dynamic";

export default async function KnowledgePage({ params, searchParams }: { params: Promise<{ workspaceSlug: string }>; searchParams: Promise<{ type?: string; status?: string; fresh?: string; notice?: string; error?: string }> }) {
  const [{ workspaceSlug }, query, session, workspaces] = await Promise.all([params, searchParams, getSession(), listWorkspaces()]);
  const workspace = workspaces.find((candidate) => candidate.slug === workspaceSlug);
  if (!session || !workspace) notFound();
  const canContribute = ["owner", "admin", "operator"].includes(workspace.role);
  const canApprove = workspace.role === "owner" || workspace.role === "admin";
  const type = isSourceType(query.type) ? query.type : undefined;
  const status = isSourceStatus(query.status) ? query.status : undefined;
  const fresh = query.fresh === "true" ? true : query.fresh === "false" ? false : undefined;
  const [sources, claims, offers, documents] = await Promise.all([
    listKnowledgeSources(workspaceSlug, { ...(type ? { type } : {}), ...(status ? { status } : {}), ...(fresh !== undefined ? { fresh } : {}) }),
    listKnowledgeClaims(workspaceSlug),
    canContribute ? listOffers(workspaceSlug).then((result) => result.data) : [],
    canContribute ? listResearchDocuments(workspaceSlug) : [],
  ]);
  const offerClaims = offers.flatMap((offer) => offer.claims.filter((claim) => claim.id).map((claim) => ({ id: claim.id!, label: `${offer.name} — ${claim.claim}` })));
  const createSource = createSourceAction.bind(null, workspaceSlug);
  const createClaim = createClaimAction.bind(null, workspaceSlug);

  return <div className="mx-auto max-w-7xl">
    <header className="border-b border-line pb-6"><div className="badge badge-signal w-fit"><BookOpenCheck size={13} /> Faits autorisés</div><h1 className="page-title mt-3">Sources de connaissance</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-muted">Les agents de campagne et le Setter n’utilisent que les claims validés adossés à une source fraîche. Un retrait agit immédiatement sur les prochaines générations, jamais sur les messages déjà envoyés.</p></header>
    {query.notice ? <p className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800" role="status">{query.notice}</p> : null}
    {query.error ? <p className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-danger" role="alert">{knowledgeError(query.error)}</p> : null}

    <section className="panel mt-6"><form className="grid gap-3 p-4 sm:grid-cols-4"><label className="text-xs font-semibold text-muted">Type<select className="control mt-1" defaultValue={type ?? ""} name="type"><option value="">Tous</option>{Object.entries(typeLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-xs font-semibold text-muted">Statut<select className="control mt-1" defaultValue={status ?? ""} name="status"><option value="">Tous</option>{Object.entries(statusLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-xs font-semibold text-muted">Fraîcheur<select className="control mt-1" defaultValue={query.fresh ?? ""} name="fresh"><option value="">Toutes</option><option value="true">Fraîches</option><option value="false">À revoir</option></select></label><div className="flex items-end"><button className="button w-full" type="submit"><Search size={14} /> Filtrer</button></div></form></section>

    <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(340px,0.75fr)]">
      <main className="space-y-6">
        <section className="panel"><div className="panel-header"><div><h2 className="font-semibold">Sources</h2><p className="mt-1 text-xs text-muted">Contenu produit et preuves avec date de fraîcheur.</p></div><span className="badge">{sources.length}</span></div>{sources.length ? <div className="divide-y divide-line">{sources.map((source) => <article className="p-4" key={source.id}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong>{source.title}</strong><span className="badge">{typeLabels[source.type]}</span><StatusBadge status={source.effectiveStatus} /></div><p className="mt-2 line-clamp-3 text-sm leading-6 text-muted">{source.content || "Document produit associé"}</p><p className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted"><span>{source.authorName}</span><span className="inline-flex items-center gap-1"><CalendarDays size={11} /> expire {source.freshnessUntil ? formatDate(source.freshnessUntil) : "sans date"}</span></p></div>{canApprove ? <div className="flex min-w-56 flex-col gap-2">{source.status === "draft" ? <form action={validateSourceAction.bind(null, workspaceSlug, source.id)}><button className="button button-primary w-full" type="submit"><CheckCircle2 size={13} /> Valider</button></form> : null}{source.status === "validated" ? <form action={withdrawSourceAction.bind(null, workspaceSlug, source.id)} className="flex gap-2"><input className="control min-w-0" name="reason" placeholder="Motif du retrait" required minLength={3} /><button className="button" type="submit">Retirer</button></form> : null}</div> : null}</div>{source.withdrawalReason ? <p className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-warning">Retirée : {source.withdrawalReason}</p> : null}</article>)}</div> : <Empty title="Aucune source" detail="Déposez une preuve ou un document produit pour autoriser des faits dans les messages." />}</section>

        <section className="panel"><div className="panel-header"><div><h2 className="font-semibold">Claims autorisés</h2><p className="mt-1 text-xs text-muted">Un claim validé redevient automatiquement « à re-sourcer » si toutes ses preuves expirent.</p></div><span className="badge">{claims.length}</span></div>{claims.length ? <div className="divide-y divide-line">{claims.map((claim) => <article className="p-4" key={claim.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{claim.claim}</strong><ClaimBadge status={claim.effectiveStatus} /></div><p className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted">{claim.sources.length ? claim.sources.map((source) => <span className="badge" key={source.id}><Link2 size={10} /> {source.title}</span>) : "Aucune source liée"}</p></div>{canApprove && claim.status === "draft" ? <form action={validateClaimAction.bind(null, workspaceSlug, claim.id)}><button className="button button-primary" type="submit">Valider le claim</button></form> : null}</div></article>)}</div> : <Empty title="Aucun claim" detail="Proposez un argument puis liez-le à une ou plusieurs sources." />}</section>
      </main>

      {canContribute ? <aside className="space-y-6"><section className="panel"><div className="panel-header"><h2 className="flex items-center gap-2 font-semibold"><Plus size={14} /> Déposer une source</h2></div><form action={createSource} className="space-y-3 p-4"><label className="block text-xs font-semibold text-muted">Type<select className="control mt-1" name="type" defaultValue="proof">{Object.entries(typeLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="block text-xs font-semibold text-muted">Titre<input className="control mt-1" name="title" required maxLength={500} /></label><label className="block text-xs font-semibold text-muted">Contenu<textarea className="control mt-1 min-h-28" name="content" placeholder="Aucune donnée personnelle de prospect." /></label>{documents.some((document) => document.status === "ready" || document.status === "partial") ? <label className="block text-xs font-semibold text-muted">Ou document déjà traité<select className="control mt-1" name="researchDocumentId"><option value="">Aucun</option>{documents.filter((document) => document.status === "ready" || document.status === "partial").map((document) => <option key={document.id} value={document.id}>{document.filename}{document.status === "partial" ? " (partiel)" : ""}</option>)}</select></label> : null}<label className="block text-xs font-semibold text-muted">Auteur<input className="control mt-1" name="authorName" required /></label><div className="grid grid-cols-2 gap-2"><label className="text-xs font-semibold text-muted">Publication<input className="control mt-1" name="publishedAt" type="date" required /></label><label className="text-xs font-semibold text-muted">Fraîche jusqu’au<input className="control mt-1" name="freshnessUntil" type="date" required /></label></div><button className="button button-signal w-full" type="submit">Déposer en brouillon</button></form></section>

        <section className="panel"><div className="panel-header"><h2 className="flex items-center gap-2 font-semibold"><ShieldCheck size={14} /> Proposer un claim</h2></div><form action={createClaim} className="space-y-3 p-4"><label className="block text-xs font-semibold text-muted">Claim<textarea className="control mt-1 min-h-24" name="claim" required /></label>{offerClaims.length ? <label className="block text-xs font-semibold text-muted">Claim d’offre associé<select className="control mt-1" name="offerClaimId"><option value="">Aucun</option>{offerClaims.map((claim) => <option key={claim.id} value={claim.id}>{claim.label}</option>)}</select></label> : null}<fieldset><legend className="text-xs font-semibold text-muted">Sources citées</legend><div className="mt-2 max-h-44 space-y-2 overflow-auto rounded-lg border border-line p-3">{sources.length ? sources.map((source) => <label className="flex items-start gap-2 text-xs" key={source.id}><input className="mt-0.5" name="sourceIds" type="checkbox" value={source.id} /><span>{source.title}<span className="block text-[10px] text-muted">{statusLabels[source.effectiveStatus]}</span></span></label>) : <span className="text-xs text-muted">Déposez d’abord une source.</span>}</div></fieldset><button className="button button-signal w-full" type="submit">Proposer le claim</button></form></section></aside> : null}
    </div>
  </div>;
}

const typeLabels: Record<KnowledgeSourceType,string> = { product_document: "Document produit", proof: "Preuve", customer_case: "Cas client", objection_response: "Objection / réponse" };
const statusLabels: Record<KnowledgeSourceStatus,string> = { draft: "Brouillon", validated: "Validée", expired: "Expirée", withdrawn: "Retirée" };
function StatusBadge({ status }: { status: KnowledgeSourceStatus }) { return <span className={status === "validated" ? "badge badge-success" : status === "expired" || status === "withdrawn" ? "badge badge-warning" : "badge"}>{statusLabels[status]}</span>; }
function ClaimBadge({ status }: { status: "draft" | "validated" | "needs_resourcing" }) { return <span className={status === "validated" ? "badge badge-success" : status === "needs_resourcing" ? "badge badge-warning" : "badge"}>{status === "needs_resourcing" ? "À re-sourcer" : status === "validated" ? "Validé" : "Brouillon"}</span>; }
function Empty({ title, detail }: { title: string; detail: string }) { return <div className="p-10 text-center"><FileText className="mx-auto text-slate-300" size={30} /><strong className="mt-3 block">{title}</strong><p className="mt-1 text-sm text-muted">{detail}</p></div>; }
function isSourceType(value?: string): value is KnowledgeSourceType { return ["product_document","proof","customer_case","objection_response"].includes(value ?? ""); }
function isSourceStatus(value?: string): value is KnowledgeSourceStatus { return ["draft","validated","expired","withdrawn"].includes(value ?? ""); }
function formatDate(value: string) { return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "Europe/Paris" }).format(new Date(value)); }
function knowledgeError(code: string) { return ({ KNOWLEDGE_PROSPECT_PII_DETECTED: "La source semble contenir les coordonnées personnelles d’un prospect.", KNOWLEDGE_CLAIM_SOURCE_INVALID: "Ce claim ne cite aucune source validée encore fraîche.", KNOWLEDGE_SOURCE_ALREADY_EXPIRED: "La date de fraîcheur est déjà dépassée.", KNOWLEDGE_SOURCE_TRANSITION_INVALID: "Cette transition n’est plus disponible.", KNOWLEDGE_WITHDRAWAL_REASON_REQUIRED: "Un motif de retrait est obligatoire.", VALIDATION_FAILED: "Les informations de la source sont incomplètes ou invalides." } as Record<string,string>)[code] ?? "L’opération n’a pas pu être appliquée."; }
