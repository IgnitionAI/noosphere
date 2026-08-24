import Link from "next/link";
import {
  AtSign,
  CheckCircle2,
  ExternalLink,
  Mail,
  MessageCircle,
  Radio,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { notFound } from "next/navigation";
import {
  getChannelConnection,
  listWorkspaces,
  OutboundApiError,
  type ChannelConnection,
  type ChannelConnectionChannel,
} from "@/lib/api";
import { saveChannelAccount } from "./actions";

export const metadata = { title: "Canaux" };
export const dynamic = "force-dynamic";

const CHANNELS: readonly ChannelConnectionChannel[] = ["linkedin", "email", "whatsapp"];

interface ChannelState {
  readonly connection: ChannelConnection;
  readonly providerConfigured: boolean;
  readonly temporarilyUnavailable: boolean;
}

export default async function ChannelSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const workspace = (await listWorkspaces()).find((item) => item.slug === workspaceSlug);
  if (!workspace || !["admin", "owner"].includes(workspace.role)) notFound();
  const states = await Promise.all(CHANNELS.map((channel) => loadChannelConnection(workspaceSlug, channel)));
  const readyCount = states.filter(({ connection }) => selectedHealthyAccount(connection)).length;
  const providerConfigured = states.some((state) => state.providerConfigured);

  return (
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="badge badge-success w-fit"><Radio size={13} /> Comptes d’envoi</div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">Canaux connectés</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Vérifiez en un coup d’œil les comptes utilisés par Noosphere. Les clés et sessions restent côté serveur.
          </p>
        </div>
        <span className={readyCount === CHANNELS.length ? "badge badge-success" : "badge badge-warning"}>
          {readyCount}/{CHANNELS.length} canaux prêts
        </span>
      </header>

      {!providerConfigured ? (
        <section className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="status">
          <strong>Unipile n’est pas configuré sur ce serveur.</strong>
          <p className="mt-1 text-xs leading-5">Ajoutez la connexion serveur depuis l’administration pour rendre LinkedIn, l’email et WhatsApp disponibles.</p>
        </section>
      ) : null}

      <section className="mt-6 grid gap-5 lg:grid-cols-3" aria-label="Comptes par canal">
        {states.map((state) => (
          <ChannelCard key={state.connection.channel} state={state} workspaceSlug={workspaceSlug} />
        ))}
      </section>

      <section className="mt-6 flex items-start gap-3 rounded-xl border border-line bg-surface-subtle p-4 text-xs leading-5 text-muted">
        <ShieldCheck className="mt-0.5 shrink-0 text-signal" size={16} />
        <p>
          Noosphere utilise uniquement le compte sélectionné pour chaque canal. Une panne de synchronisation de contenu n’est jamais présentée comme une déconnexion du compte.
        </p>
      </section>
    </div>
  );
}

function ChannelCard({
  state,
  workspaceSlug,
}: {
  readonly state: ChannelState;
  readonly workspaceSlug: string;
}) {
  const { connection } = state;
  const selected = selectedHealthyAccount(connection);
  const save = saveChannelAccount.bind(null, workspaceSlug, connection.channel);
  const copy = channelCopy(connection.channel);
  const Icon = copy.icon;
  const status = selected
    ? { label: "Opérationnel", className: "badge badge-success" }
    : state.temporarilyUnavailable
      ? { label: "Vérification indisponible", className: "badge badge-warning" }
      : connection.connected
        ? { label: "Compte à sélectionner", className: "badge badge-warning" }
        : { label: "À connecter", className: "badge badge-warning" };

  return (
    <article className="flex min-h-[390px] flex-col rounded-2xl border border-line bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <span className={`grid h-11 w-11 place-items-center rounded-xl ${copy.iconClassName}`}><Icon size={20} /></span>
        <span className={status.className}>{status.label}</span>
      </div>
      <h2 className="mt-4 text-lg font-semibold text-ink">{copy.label}</h2>
      <p className="mt-1 min-h-10 text-xs leading-5 text-muted">{copy.description}</p>

      {state.temporarilyUnavailable ? (
        <div className="mt-5 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950" role="status">
          <TriangleAlert className="mt-0.5 shrink-0" size={15} />
          <span>Unipile n’a pas pu vérifier ce canal pour le moment. Le compte n’est pas marqué comme déconnecté.</span>
        </div>
      ) : connection.accounts.length ? (
        <form action={save} className="mt-5 flex flex-1 flex-col">
          <fieldset className="grid gap-2">
            <legend className="sr-only">Compte {copy.label}</legend>
            {connection.accounts.map((account) => (
              <label
                className={`flex items-center gap-3 rounded-xl border p-3 transition ${account.selected && account.healthy ? copy.selectedClassName : account.healthy ? "cursor-pointer border-line hover:border-signal/50" : "cursor-not-allowed border-line bg-slate-50 opacity-60"}`}
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
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm text-ink">{account.name}</strong>
                  <span className="mt-0.5 block text-[11px] text-muted">{account.healthy ? "Connecté via Unipile" : "Connexion à renouveler"}</span>
                </span>
                {account.selected && account.healthy ? <CheckCircle2 className="shrink-0 text-emerald-600" size={17} aria-label="Sélectionné" /> : null}
              </label>
            ))}
          </fieldset>
          <button className="button button-signal mt-auto w-full justify-center" disabled={!connection.accounts.some((account) => account.healthy)} type="submit">
            {selected ? "Mettre à jour le compte" : "Utiliser ce compte"}
          </button>
        </form>
      ) : (
        <div className="mt-5 flex flex-1 flex-col justify-between rounded-xl border border-dashed border-line p-4">
          <p className="text-sm leading-6 text-muted">Aucun compte {copy.label} connecté.</p>
          <Link className="button mt-5 w-full justify-center" href={`/w/${workspaceSlug}/integrations?channel=${connection.channel}#connect-account`}>
            Connecter {copy.label} <ExternalLink size={14} />
          </Link>
        </div>
      )}

      {selected ? (
        <p className="mt-4 flex items-center gap-2 text-xs font-medium text-emerald-700">
          <CheckCircle2 size={14} /> {selected.name} est utilisé par ce workspace
        </p>
      ) : null}
    </article>
  );
}

function selectedHealthyAccount(connection: ChannelConnection) {
  return connection.accounts.find((account) => account.selected && account.healthy) ?? null;
}

function channelCopy(channel: ChannelConnectionChannel) {
  if (channel === "linkedin") return {
    label: "LinkedIn",
    description: "Prospection, publications et conversations LinkedIn.",
    icon: AtSign,
    iconClassName: "bg-sky-100 text-sky-700",
    selectedClassName: "cursor-pointer border-sky-400 bg-sky-50",
  };
  if (channel === "email") return {
    label: "Email",
    description: "Séquences, relances et réponses depuis votre boîte professionnelle.",
    icon: Mail,
    iconClassName: "bg-violet-100 text-violet-700",
    selectedClassName: "cursor-pointer border-violet-400 bg-violet-50",
  };
  return {
    label: "WhatsApp",
    description: "Qualification et conversations WhatsApp professionnelles.",
    icon: MessageCircle,
    iconClassName: "bg-emerald-100 text-emerald-700",
    selectedClassName: "cursor-pointer border-emerald-400 bg-emerald-50",
  };
}

async function loadChannelConnection(
  workspaceSlug: string,
  channel: ChannelConnectionChannel,
): Promise<ChannelState> {
  try {
    return {
      connection: await getChannelConnection(workspaceSlug, channel),
      providerConfigured: true,
      temporarilyUnavailable: false,
    };
  } catch (error) {
    if (!(error instanceof OutboundApiError)) throw error;
    return {
      connection: emptyConnection(channel),
      providerConfigured: error.code !== "UNIPILE_NOT_CONFIGURED",
      temporarilyUnavailable: error.code !== "UNIPILE_NOT_CONFIGURED",
    };
  }
}

function emptyConnection(channel: ChannelConnectionChannel): ChannelConnection {
  return {
    channel,
    connected: false,
    selectedAccountId: null,
    selectedDisplayName: null,
    accounts: [],
  };
}
