import { CheckCircle2, MessageCircle, Radio, ShieldCheck, Smartphone } from "lucide-react";
import { notFound } from "next/navigation";
import { getWhatsAppChannelConnection, listWorkspaces } from "@/lib/api";
import { saveWhatsAppAccount } from "./actions";

export const metadata = { title: "Canaux" };
export const dynamic = "force-dynamic";

export default async function ChannelSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const workspace = (await listWorkspaces()).find((item) => item.slug === workspaceSlug);
  if (!workspace || !["admin", "owner"].includes(workspace.role)) notFound();
  const connection = await getWhatsAppChannelConnection(workspaceSlug);
  const save = saveWhatsAppAccount.bind(null, workspaceSlug);

  return (
    <div className="mx-auto max-w-5xl">
      <header className="flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="badge badge-success w-fit"><MessageCircle size={13} /> Unipile WhatsApp</div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-navy">Compte d’envoi WhatsApp</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Choisissez le numéro utilisé par ce workspace pour vérifier les prospects, envoyer les campagnes et poursuivre les conversations.
          </p>
        </div>
        <span className={connection.selectedAccountId ? "badge badge-success" : "badge badge-warning"}>
          {connection.selectedAccountId ? "Prêt à prospecter" : connection.connected ? "Compte à sélectionner" : "À reconnecter"}
        </span>
      </header>

      <form action={save} className="mt-6 rounded-xl border border-line bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-emerald-600 text-white"><Smartphone size={18} /></span>
          <div>
            <h2 className="font-semibold text-navy">Numéros WhatsApp disponibles</h2>
            <p className="mt-1 text-xs leading-5 text-muted">Seuls les comptes Unipile actuellement connectés peuvent être utilisés.</p>
          </div>
        </div>

        <div className="mt-5 grid gap-3">
          {connection.accounts.length ? connection.accounts.map((account) => (
            <label
              className={`flex cursor-pointer items-center gap-4 rounded-xl border p-4 transition ${account.selected ? "border-emerald-400 bg-emerald-50" : account.healthy ? "border-line hover:border-emerald-300" : "cursor-not-allowed border-line bg-slate-50 opacity-60"}`}
              key={account.id}
            >
              <input
                defaultChecked={account.selected}
                disabled={!account.healthy}
                name="providerAccountId"
                required
                type="radio"
                value={account.id}
              />
              <span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-100 text-emerald-700"><MessageCircle size={18} /></span>
              <span className="min-w-0 flex-1">
                <strong className="block text-sm text-navy">{account.name}</strong>
                <span className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                  <Radio size={12} /> {account.healthy ? "Connecté via Unipile" : "Connexion à renouveler"}
                </span>
              </span>
              {account.selected ? <span className="badge badge-success"><CheckCircle2 size={12} /> Sélectionné</span> : null}
            </label>
          )) : (
            <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
              Aucun compte WhatsApp n’est connecté à Unipile.
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center justify-between gap-4 border-t border-line pt-4">
          <p className="flex items-start gap-2 text-xs leading-5 text-muted"><ShieldCheck className="mt-0.5 shrink-0" size={14} /> La clé Unipile reste côté serveur. Confirmer le numéro relance automatiquement l’évaluation WhatsApp des ICP sans importer les conversations personnelles.</p>
          <button className="button button-signal shrink-0" disabled={!connection.accounts.some((account) => account.healthy)} type="submit">
            {connection.selectedAccountId ? "Réévaluer WhatsApp" : "Utiliser ce numéro"}
          </button>
        </div>
      </form>

      {connection.selectedDisplayName ? (
        <section className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50/60 p-5">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="text-emerald-700" size={20} />
            <div><h2 className="font-semibold text-navy">Canal WhatsApp opérationnel</h2><p className="mt-1 text-sm text-emerald-900">Les prochaines campagnes utiliseront {connection.selectedDisplayName}.</p></div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
