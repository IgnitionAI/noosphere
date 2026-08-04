import { ArrowLeft, ExternalLink, Mail, Phone, Send, UserRound } from "lucide-react";
import Link from "next/link";
import { getCampaign } from "@/lib/api";
import { prospectDetailHref } from "@/lib/prospect-navigation";
import { CampaignAutoRefresh } from "../campaign-auto-refresh";

export const metadata = { title: "Campagne ICP" };
export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; campaignId: string }>;
}) {
  const { workspaceSlug, campaignId } = await params;
  const campaign = await getCampaign(workspaceSlug, campaignId);
  const campaignPath = `/w/${workspaceSlug}/campaigns/${campaignId}`;
  const refreshing = ["sourcing", "enriching", "composing"].includes(campaign.automationStage);

  return (
    <>
      <CampaignAutoRefresh enabled={refreshing} />
      <Link className="mb-4 inline-flex items-center gap-1 text-xs font-semibold text-brand-blue" href={`/w/${workspaceSlug}/campaigns`}>
        <ArrowLeft size={14} /> Campagnes
      </Link>
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={campaign.automationStage === "attention" ? "badge badge-danger" : campaign.status === "active" ? "badge badge-success" : "badge"}>
              {automationLabel(campaign.automationStage, campaign.discoveryStatus)}
            </span>
            <span className={campaign.discoveryStatus === "completed" ? "badge badge-success" : campaign.discoveryStatus === "failed" ? "badge badge-danger" : "badge"}>
              {campaign.discoveryStatus === "running"
                ? "sourcing en cours"
                : campaign.discoveryStatus === "completed"
                  ? "sourcing terminé"
                  : campaign.discoveryStatus === "failed"
                    ? "sourcing legacy échoué"
                    : "faisabilité mesurée"}
            </span>
            {campaign.channel ? <span className="badge capitalize">{campaign.channel}</span> : null}
          </div>
          <h1 className="page-title">{campaign.icpName}</h1>
          <p className="mt-2 text-sm text-muted">
            Score de faisabilité {campaign.assessmentScore ?? 0}/100. {campaign.prospectCount} cibles actuellement affectées.
          </p>
        </div>
      </header>

      {campaign.automationStage === "attention" || campaign.discoveryStatus === "failed" ? (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
          {campaign.automationErrorMessage ?? campaign.discoveryErrorMessage ?? campaign.automationErrorCode ?? campaign.discoveryErrorCode ?? "L’autopilote est suspendu sur une exception fournisseur."}
        </div>
      ) : null}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="panel">
          <div className="panel-header">
            <h2 className="font-semibold">Prospects enrichis</h2>
            <span className="badge">{campaign.prospects.length}</span>
          </div>
          <div className="panel-body">
            {campaign.prospects.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">
                {campaign.discoveryStatus === "running"
                  ? "La recherche est en cours. Cette page se met à jour automatiquement."
                  : campaign.discoveryRunId
                    ? "Aucun profil suffisamment fiable n’a été retenu."
                    : "La campagne a été créée après le test de faisabilité. Le sourcing complet des cibles sera lancé par le pipeline propre à ce canal."}
              </p>
            ) : (
              <ul className="space-y-3">
                {campaign.prospects.map((prospect) => (
                  <li className="rounded-lg border border-line p-4" key={prospect.candidateId}>
                    <div className="flex flex-wrap items-start gap-3">
                      <span className="grid h-9 w-9 place-items-center rounded-full bg-slate-100"><UserRound size={16} /></span>
                      <div className="min-w-0 flex-1">
                        {prospect.contactId ? (
                          <Link className="block text-sm font-semibold hover:text-brand-blue" href={prospectDetailHref(workspaceSlug, prospect.contactId, campaignPath)}>
                            {prospect.fullName}
                          </Link>
                        ) : (
                          <strong className="block text-sm">{prospect.fullName}</strong>
                        )}
                        <span className="block text-xs text-muted">{[prospect.headline, prospect.companyName].filter(Boolean).join(" · ") || "Fonction à confirmer"}</span>
                      </div>
                      <span className={prospect.eligible ? "badge badge-success" : "badge"}>{prospect.eligible ? `${prospect.score ?? 0}/100` : prospect.state === "excluded" ? "exclu" : "candidat"}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      {prospect.linkedinUrl ? <Channel href={prospect.linkedinUrl} icon={ExternalLink} label="LinkedIn" /> : null}
                      {prospect.channels.email.value ? <Channel href={`mailto:${prospect.channels.email.value}`} icon={Mail} label={prospect.channels.email.value} /> : null}
                      {prospect.channels.whatsapp.value ? <Channel href={`https://wa.me/${prospect.channels.whatsapp.normalizedValue?.replace(/\D/g, "") ?? ""}`} icon={Phone} label={prospect.channels.whatsapp.value} /> : null}
                    </div>
                    {prospect.icpFit.matches.length ? (
                      <p className="mt-3 text-[11px] text-emerald-700">{prospect.icpFit.matches.join(" · ")}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <aside className="space-y-5">
          <section className="panel">
            <div className="panel-header"><h2 className="flex items-center gap-2 font-semibold"><Send size={15} /> Séquence préparée</h2></div>
            <div className="panel-body">
              <p className="text-xs text-muted">
                {campaign.steps.length} étapes {campaign.channel ?? "legacy"}. {campaign.sequenceVersionId ? "Version publiée automatiquement ; actions planifiées." : "Personnalisation automatique en cours."}
              </p>
              <ol className="mt-3 space-y-2">
                {campaign.steps.map((step) => (
                  <li className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs" key={step.position}>
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-slate-100 font-bold">{step.position}</span>
                    <span className="flex-1">{channelLabel(step.kind)}</span>
                    <span className="text-muted">J+{step.delayDays}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-[11px] leading-4 text-muted">Aucune validation intermédiaire : l’autopilote contrôle les identités, les suppressions, les quotas et suspend les relances dès qu’un prospect répond.</p>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

function Channel({ href, icon: Icon, label }: { href: string; icon: typeof Mail; label: string }) {
  return <a className="inline-flex max-w-full items-center gap-1 rounded border border-line px-2 py-1 text-brand-blue hover:border-brand-blue" href={href} rel="noreferrer" target="_blank"><Icon size={12} /><span className="truncate">{label}</span></a>;
}

function channelLabel(kind: string): string {
  return ({ manual_task: "Validation manuelle", linkedin_invite: "Invitation LinkedIn", linkedin_message: "Message LinkedIn", email: "Email", whatsapp: "WhatsApp" } as Record<string, string>)[kind] ?? kind;
}

function automationLabel(stage: string, discoveryStatus: string | null): string {
  if (stage === "sourcing") {
    if (discoveryStatus === "running") return "recherche en cours";
    if (discoveryStatus === "completed") return "recherche terminée";
    if (discoveryStatus === "failed") return "recherche échouée";
    return "recherche non lancée";
  }
  return ({
    enriching: "enrichissement et déduplication",
    composing: "personnalisation IA",
    scheduled: "envois planifiés",
    running: "campagne active",
    completed: "campagne terminée",
    attention: "exception autopilote",
  } as Record<string, string>)[stage] ?? "autopilote";
}
