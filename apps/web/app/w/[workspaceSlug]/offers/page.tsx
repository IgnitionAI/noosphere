import { CalendarDays, FilePlus2, Package, Plus } from "lucide-react";
import Link from "next/link";
import { CrmEmptyState, CrmPermissionState } from "@/components/crm-states";
import { listOffers, listWorkspaces, OutboundApiError, type Offer } from "@/lib/api";
import { createOfferAction } from "./actions";

export const metadata = { title: "Offres" };
export const dynamic = "force-dynamic";

export default async function OffersPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  let offers: { data: Offer[] };
  let canEdit = false;
  try {
    [offers, canEdit] = await Promise.all([
      listOffers(workspaceSlug),
      listWorkspaces().then((workspaces) => {
        const workspace = workspaces.find((candidate) => candidate.slug === workspaceSlug);
        return workspace ? ["operator", "admin", "owner"].includes(workspace.role) : false;
      }),
    ]);
  } catch (error) {
    if (error instanceof OutboundApiError && (error.status === 401 || error.status === 403)) return <CrmPermissionState resource="les offres" />;
    throw error;
  }
  const create = createOfferAction.bind(null, workspaceSlug);
  return <>
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><span className="badge badge-signal inline-flex items-center gap-1.5"><Package size={13} /> Go-to-market</span><h1 className="page-title mt-3">Offres</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Versionnez ce que vous vendez, les preuves autorisées et les limites commerciales.</p></div><span className="badge shrink-0 self-start">{offers.data.length} offre{offers.data.length > 1 ? "s" : ""}</span></header>
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="panel overflow-hidden"><div className="panel-header"><div className="flex items-center gap-2"><Package className="text-brand-blue" size={16} /><h2 className="font-semibold">Catalogue des offres</h2></div><span className="text-xs text-muted">Brouillons et versions</span></div>{offers.data.length ? <div className="overflow-x-auto"><table className="data-table min-w-[760px]"><thead><tr><th>Offre</th><th>Version</th><th>Statut</th><th>Claims</th><th>Dernière mise à jour</th><th className="text-right">Détail</th></tr></thead><tbody>{offers.data.map((offer) => <OfferRow key={offer.id} offer={offer} workspaceSlug={workspaceSlug} />)}</tbody></table></div> : <div className="panel-body"><CrmEmptyState title="Aucune offre" description={canEdit ? "Créez votre première offre ou partez d’une proposition de valeur issue de la lecture produit." : "Aucune offre n’est disponible dans cet espace."} href={canEdit ? "#nouvelle-offre" : undefined} action={canEdit ? "Créer une offre" : undefined} /></div>}</section>
      {canEdit ? <aside className="panel" id="nouvelle-offre"><div className="panel-header"><h2 className="flex items-center gap-2 font-semibold"><Plus size={15} className="text-brand-blue" /> Nouvelle offre</h2></div><form action={create} className="panel-body space-y-3"><label className="block text-xs font-semibold text-muted">Nom de l’offre *<input className="control mt-1" name="name" required placeholder="Ex. IgnitionRAG Entreprise" /></label><label className="block text-xs font-semibold text-muted">Catégorie<select className="control mt-1" name="category" defaultValue="service"><option value="service">Service</option><option value="saas">SaaS</option><option value="licence">Licence</option><option value="autre">Autre</option></select></label><label className="block text-xs font-semibold text-muted">Cible<textarea className="control mt-1 min-h-20" name="targetAudience" placeholder="À qui s’adresse-t-elle ?" /></label><button className="button button-signal w-full" type="submit"><FilePlus2 size={15} /> Créer le brouillon</button><p className="text-[11px] leading-4 text-muted">Vous pourrez compléter les claims, preuves, prix et objections sur la fiche.</p></form></aside> : <aside className="panel border-warning p-5"><h2 className="font-semibold">Lecture seule</h2><p className="mt-2 text-sm leading-6 text-muted">Votre rôle permet de consulter les offres. Un operator, administrateur ou propriétaire peut créer et modifier un brouillon.</p></aside>}
    </div>
    <p className="mt-5 text-xs text-muted">Besoin de clarifier votre positionnement ? <Link className="font-semibold text-brand-blue" href={`/w/${workspaceSlug}/strategy/product-reading`}>Revenir à la lecture produit</Link>.</p>
  </>;
}

function OfferRow({ offer, workspaceSlug }: { offer: Offer; workspaceSlug: string }) {
  return <tr><td><Link className="font-semibold text-brand-blue" href={`/w/${workspaceSlug}/offers/${offer.id}`}>{offer.name}</Link><div className="mt-1 text-xs text-muted">{offer.category}</div></td><td><span className={offer.currentVersion ? "badge badge-success" : "badge"}>{offer.currentVersion ? `v${offer.currentVersion}` : "Brouillon"}</span></td><td><span className={offer.status === "archived" ? "badge badge-warning" : "badge"}>{offer.status === "archived" ? "Archivée" : "Brouillon actif"}</span></td><td>{offer.claims.length ? `${offer.claims.length} claim${offer.claims.length > 1 ? "s" : ""}` : "Aucun"}</td><td><span className="inline-flex items-center gap-2 text-xs text-muted"><CalendarDays size={13} />{formatDate(offer.updatedAt)}</span></td><td className="text-right"><Link className="button button-primary whitespace-nowrap" href={`/w/${workspaceSlug}/offers/${offer.id}`}>Ouvrir</Link></td></tr>;
}

function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Date inconnue" : new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(date); }
