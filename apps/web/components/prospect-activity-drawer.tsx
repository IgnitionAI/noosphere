import { Bot, BriefcaseBusiness, CalendarCheck, MessageCircle, Sparkles, X } from "lucide-react";
import Link from "next/link";
import type { ProspectActivity, ProspectViewDetail } from "@/lib/api";
import { sendProspectMessageAction } from "@/app/w/[workspaceSlug]/prospects/actions";
import { ConversationComposer } from "@/components/conversation-composer";

export function ProspectActivityDrawer({
  prospect,
  workspaceSlug,
  closeHref,
}: {
  prospect: ProspectViewDetail;
  workspaceSlug: string;
  closeHref: string;
}) {
  const conversation = prospect.conversation;
  const send = conversation
    ? sendProspectMessageAction.bind(null, workspaceSlug, prospect.id, conversation.id)
    : null;
  const channel = conversation?.channel ?? prospect.activity.at(-1)?.channel ?? null;
  return (
    <>
      <Link
        aria-label="Fermer la fiche prospect"
        className="fixed inset-0 z-40 bg-navy/25 backdrop-blur-[1px]"
        href={closeHref}
        scroll={false}
      />
      <aside
        aria-label={`Fiche prospect de ${prospect.firstName} ${prospect.lastName}`}
        aria-modal="true"
        className="fixed inset-y-0 right-0 z-50 w-full max-w-[560px] space-y-4 overflow-y-auto border-l border-line bg-slate-50 p-3 shadow-2xl sm:p-5"
        data-testid="prospect-drawer"
        role="dialog"
      >
        <section className="panel overflow-hidden">
          <div className="panel-header">
            <div className="min-w-0">
              <h2 className="truncate font-semibold">{prospect.firstName} {prospect.lastName}</h2>
              <p className="mt-1 truncate text-xs text-muted">{prospect.currentEmployment?.companyName ?? prospect.icpMatches[0]?.companyName ?? "Entreprise à confirmer"}</p>
            </div>
            <Link className="button h-8 min-h-8 w-8 p-0" href={closeHref} scroll={false} aria-label="Fermer"><X size={14} /></Link>
          </div>

          <div className="space-y-4 p-4">
            {prospect.aiOpinion ? (
              <div className="rounded-xl border border-violet-200 bg-violet-50/70 p-4">
                <div className="flex items-center justify-between gap-2">
                  <strong className="flex items-center gap-2 text-xs"><Sparkles size={14} />Avis IA du prospect</strong>
                  {prospect.aiOpinion.score !== null ? <span className="badge badge-signal">{prospect.aiOpinion.score}/100</span> : null}
                </div>
                <p className="mt-3 text-xs leading-5">{prospect.aiOpinion.summary}</p>
                {prospect.aiOpinion.recommendedAngle ? <p className="mt-3 rounded-lg bg-white/80 p-2 text-[11px] leading-4"><strong>Angle recommandé :</strong> {prospect.aiOpinion.recommendedAngle}</p> : null}
                {prospect.aiOpinion.risks.length ? <p className="mt-2 text-[11px] text-amber-800"><strong>À vérifier :</strong> {prospect.aiOpinion.risks.join(" · ")}</p> : null}
              </div>
            ) : null}

            {prospect.meeting ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
                <div className="flex items-center justify-between gap-2">
                  <strong className="flex items-center gap-2 text-xs"><CalendarCheck size={14} />Rendez-vous</strong>
                  <span className={prospect.meeting.status === "cancelled" ? "badge badge-warning" : "badge badge-success"}>{meetingStatusLabel(prospect.meeting.status)}</span>
                </div>
                <p className="mt-3 text-sm font-semibold">{formatDate(prospect.meeting.startAt)}</p>
                {prospect.meeting.meetingUrl ? <a className="mt-3 inline-flex text-xs font-semibold text-blue-700 underline" href={prospect.meeting.meetingUrl} rel="noreferrer" target="_blank">Ouvrir le rendez-vous</a> : null}
                {prospect.opportunity?.nextAction ? <p className="mt-3 text-[11px] leading-4 text-muted">{prospect.opportunity.nextAction}</p> : null}
              </div>
            ) : prospect.opportunity ? (
              <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 text-xs">
                <strong>Opportunité · {prospect.opportunity.stage}</strong>
                {prospect.opportunity.nextAction ? <p className="mt-2 leading-5 text-muted">{prospect.opportunity.nextAction}</p> : null}
              </div>
            ) : null}

            <div>
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold"><BriefcaseBusiness size={13} />ICP correspondants</p>
              <div className="flex flex-wrap gap-2">
                {prospect.icpMatches.map((match) => <span className="badge" key={`${match.campaignId}:${match.candidateId}`}>{match.icpName} · {match.channel}</span>)}
              </div>
            </div>
          </div>
        </section>

        <section className="panel overflow-hidden">
          <div className="panel-header">
            <h2 className="flex items-center gap-2 font-semibold"><MessageCircle size={15} />Messages & relances</h2>
            {channel ? <span className="badge capitalize">{channel}</span> : null}
          </div>
          {prospect.activity.length ? (
            <>
              <div className="max-h-[390px] space-y-3 overflow-y-auto bg-slate-50/70 p-4">
                {prospect.activity.map((item) => (
                  <div className={`flex ${item.direction === "outbound" ? "justify-end" : "justify-start"}`} key={`${item.source}:${item.id}`}>
                    <div className={`max-w-[88%] rounded-xl border px-3 py-2 text-xs leading-5 ${activityBubbleClass(item)}`}>
                      {item.subject ? <p className="mb-1 font-semibold">{item.subject}</p> : null}
                      <p className="whitespace-pre-wrap">{item.body ?? pendingActivityLabel(item.stepKind)}</p>
                      {item.errorMessage ? <p className="mt-2 text-[10px] text-red-700">{item.errorMessage}</p> : null}
                      <p className={`mt-1 text-[10px] ${item.direction === "outbound" && item.status === "sent" ? "text-slate-300" : "text-muted"}`}>{activityStatusLabel(item)} · {formatDate(item.occurredAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
              {conversation?.decision ? (
                <div className="border-t border-line bg-blue-50 p-4">
                  <div className="flex items-center justify-between gap-2"><strong className="flex items-center gap-2 text-xs"><Bot size={14} />Avis IA sur la conversation</strong><span className="badge badge-signal">{Math.round(conversation.decision.confidence * 100)}%</span></div>
                  <p className="mt-2 text-xs"><strong>{conversation.decision.intent}</strong> · {conversation.decision.action}</p>
                  <p className="mt-1 text-[11px] leading-4 text-muted">{conversation.decision.rationale}</p>
                </div>
              ) : null}
              {conversation ? (
                <div className="space-y-3 border-t border-line p-4">
                  {conversation.latestCommand && ["scheduled", "sending"].includes(conversation.latestCommand.status) ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Message en cours de préparation ou d’envoi…</p> : null}
                  <ConversationComposer
                    conversationId={conversation.id}
                    sendAction={send!}
                    workspaceSlug={workspaceSlug}
                  />
                </div>
              ) : (
                <div className="border-t border-line bg-blue-50 p-4 text-xs text-navy">Premier contact envoyé. Les relances restent automatiques et le Setter IA prendra la main dès la première réponse.</div>
              )}
            </>
          ) : (
            <div className="panel-body py-8 text-center"><MessageCircle className="mx-auto text-muted" size={22} /><p className="mt-3 text-sm font-semibold">Aucun message envoyé</p><p className="mt-2 text-xs text-muted">Le premier contact sera généré et envoyé automatiquement par la campagne.</p></div>
          )}
        </section>
      </aside>
    </>
  );
}

function activityBubbleClass(item: ProspectActivity): string {
  if (item.direction === "inbound") return "border-line bg-white";
  if (item.status === "sent") return "border-navy bg-navy text-white";
  if (item.status === "failed") return "border-red-200 bg-red-50 text-red-900";
  if (item.status === "scheduled" || item.status === "executing") return "border-amber-200 bg-amber-50 text-amber-950";
  return "border-line bg-slate-100 text-muted";
}

function activityStatusLabel(item: ProspectActivity): string {
  if (item.direction === "inbound") return "Prospect";
  if (item.source === "conversation") return item.senderType === "ai" ? "Setter IA" : "Vous";
  return ({ sent: "Autopilote · envoyé", scheduled: "Relance planifiée", executing: "Envoi en cours", failed: "Échec", cancelled: "Annulé", skipped: "Ignoré" } as Record<string, string>)[item.status] ?? item.status;
}

function pendingActivityLabel(stepKind: string | null): string {
  return ({ linkedin_invite: "Invitation LinkedIn en préparation", linkedin_message: "Message LinkedIn en préparation", email: "Email en préparation", whatsapp: "Message WhatsApp en préparation" } as Record<string, string>)[stepKind ?? ""] ?? "Message en préparation";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(value));
}

function meetingStatusLabel(status: string): string {
  return ({ requested: "Demandé", booked: "Réservé", cancelled: "Annulé", no_show: "Absent", completed: "Terminé" } as Record<string, string>)[status] ?? status;
}
