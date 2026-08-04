import { CalendarCheck, Clock3, KeyRound, Link2, ShieldCheck, Webhook } from "lucide-react";
import { notFound } from "next/navigation";
import { getCalendarConnection, listWorkspaces } from "@/lib/api";
import { disconnectCalendarConnection, saveCalendarConnection } from "./actions";

export const metadata = { title: "Agenda" };
export const dynamic = "force-dynamic";

export default async function CalendarSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const workspace = (await listWorkspaces()).find((item) => item.slug === workspaceSlug);
  if (!workspace || !["admin", "owner"].includes(workspace.role)) notFound();
  const connection = await getCalendarConnection(workspaceSlug);
  const save = saveCalendarConnection.bind(null, workspaceSlug);
  const disconnect = disconnectCalendarConnection.bind(null, workspaceSlug);

  return (
    <div className="mx-auto max-w-5xl">
      <header className="flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="badge badge-signal w-fit"><CalendarCheck size={13} /> Rendez-vous automatiques</div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-navy">Agenda du Setter IA</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            K3 lit les disponibilités réelles, propose des créneaux et réserve celui choisi par le prospect. Le lien Cal.com reste disponible en secours.
          </p>
        </div>
        <span className={connection.connected && connection.automationReady ? "badge badge-success" : "badge badge-warning"}>
          {connection.connected && connection.automationReady ? "Setter autonome" : connection.connected ? "Lien seul" : "À connecter"}
        </span>
      </header>

      <form action={save} className="mt-6 rounded-xl border border-line bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-navy text-signal"><Link2 size={18} /></span>
          <div>
            <h2 className="font-semibold text-navy">Lien de réservation Cal.com</h2>
            <p className="mt-1 text-xs leading-5 text-muted">Le lien est personnalisé et signé séparément pour chaque prospect.</p>
          </div>
        </div>
        <label className="mt-5 block">
          <span className="mb-1.5 block text-xs font-semibold">URL publique de réservation</span>
          <input
            className="control w-full"
            defaultValue={connection.connected ? connection.bookingUrl : ""}
            name="bookingUrl"
            placeholder="https://cal.com/votre-equipe/demo"
            required
            type="url"
          />
        </label>
        <label className="mt-4 block">
          <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold"><KeyRound size={13} /> Clé API Cal.com</span>
          <input
            autoComplete="new-password"
            className="control w-full"
            name="apiKey"
            placeholder={connection.connected && connection.apiConfigured ? "Clé déjà configurée — laissez vide pour la conserver" : "cal_…"}
            type="password"
          />
          <span className="mt-1.5 block text-[11px] leading-5 text-muted">
            Optionnelle pour un événement public. Si elle est fournie, elle est validée côté serveur puis chiffrée, sans jamais être renvoyée au navigateur ni inscrite dans les logs.
          </span>
        </label>
        <div className="mt-4 flex justify-end">
          <button className="button button-signal" type="submit">{connection.connected ? "Mettre à jour" : "Connecter l’agenda"}</button>
        </div>
      </form>

      {connection.connected ? (
        <section className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50/50 p-5">
          <div className="flex items-start gap-3">
            <Webhook className="mt-0.5 text-emerald-700" size={19} />
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-navy">Automatisation Cal.com</h2>
              {connection.automationReady ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <StatusValue icon={<CalendarCheck size={15} />} label="Type de rendez-vous" value={connection.eventType?.title ?? "Configuré"} />
                  <StatusValue icon={<Clock3 size={15} />} label="Fuseau horaire" value={connection.timeZone ?? "Europe/Paris"} />
                  <StatusValue icon={<KeyRound size={15} />} label="API" value={connection.apiConfigured ? "Clé validée" : "Mode public Cal.com"} />
                  <StatusValue icon={<Webhook size={15} />} label="Webhook" value={connection.webhookRegistered ? "Créé automatiquement" : "À enregistrer"} />
                </div>
              ) : (
                <p className="mt-2 text-xs leading-5 text-amber-800">Ajoutez une clé API pour que le Setter propose et réserve de vrais créneaux.</p>
              )}
              <WebhookValue label="URL de réception" value={connection.webhookUrl} />
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-white/80 p-3 text-xs leading-5 text-emerald-900">
                <ShieldCheck className="mt-0.5 shrink-0" size={15} />
                Les événements sont signés, dédupliqués et isolés par workspace. Les relances s’arrêtent dès que le rendez-vous est réservé.
              </div>
            </div>
          </div>
          <form action={disconnect} className="mt-4 flex justify-end">
            <button className="button text-red-700" type="submit">Déconnecter</button>
          </form>
        </section>
      ) : null}
    </div>
  );
}

function WebhookValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-4">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <code className="block overflow-x-auto rounded-lg border border-line bg-white px-3 py-2 text-xs">
        {value}
      </code>
    </div>
  );
}

function StatusValue({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-white/80 p-3">
      <div className="flex items-center gap-2 text-emerald-700">{icon}<span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span></div>
      <p className="mt-1.5 text-sm font-medium text-navy">{value}</p>
    </div>
  );
}
