import { Bot, ExternalLink, MessageCircle, MessageSquareText, PauseCircle, UserRound, X } from "lucide-react";
import Link from "next/link";
import { sendProspectMessageAction } from "@/app/w/[workspaceSlug]/prospects/actions";
import { setConversationAutomationAction } from "@/app/w/[workspaceSlug]/inbox/actions";
import { ConversationComposer } from "@/components/conversation-composer";
import { ProspectMemoryPanel } from "@/components/prospect-memory-panel";
import type { ProspectMemoryStatus, ProspectMemoryView, WorkspaceConversationDetail } from "@/lib/api";

export function WorkspaceConversationDrawer({
  conversation,
  workspaceSlug,
  closeHref,
  memoryStatus,
  memoryView,
}: {
  conversation: WorkspaceConversationDetail;
  workspaceSlug: string;
  closeHref: string;
  memoryStatus: ProspectMemoryStatus | null;
  memoryView: ProspectMemoryView | null;
}) {
  const send = sendProspectMessageAction.bind(
    null,
    workspaceSlug,
    conversation.contactId,
    conversation.id,
  );
  const setAutomation = setConversationAutomationAction.bind(null, workspaceSlug, conversation.id);
  return (
    <>
      <Link
        aria-label="Fermer la conversation"
        className="fixed inset-0 z-40 bg-navy/25 backdrop-blur-[1px]"
        href={closeHref}
        scroll={false}
      />
      <aside
        aria-label={`Conversation avec ${conversation.firstName} ${conversation.lastName}`}
        aria-modal="true"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[620px] flex-col border-l border-line bg-slate-50 shadow-2xl"
        data-testid="conversation-drawer"
        role="dialog"
      >
        <header className="border-b border-line bg-white p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-100"><UserRound size={17} /></span>
              <div className="min-w-0">
                <h2 className="truncate font-semibold">{conversation.firstName} {conversation.lastName}</h2>
                <p className="mt-1 truncate text-xs text-muted">
                  {conversation.accountName ?? "Compte associé"} · {channelLabel(conversation.channel)}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className={conversation.origin === "campaign" ? "badge badge-success" : "badge"}>
                    {conversation.origin === "campaign" ? conversation.campaignName ?? "Campagne" : "Hors campagne"}
                  </span>
                  <span className="badge">{automationLabel(conversation.automationMode)}</span>
                  <span className={conversation.source === "inbound" || conversation.source === "mixed" ? "badge badge-signal" : "badge"}>{sourceLabel(conversation.source)}</span>
                </div>
              </div>
            </div>
            <Link aria-label="Fermer" className="button h-8 min-h-8 w-8 p-0" href={closeHref} scroll={false}><X size={14} /></Link>
          </div>
          {conversation.subject ? <p className="mt-4 truncate text-sm font-semibold">{conversation.subject}</p> : null}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link className="button" href={`/w/${workspaceSlug}/prospects/${conversation.contactId}`}>
              <ExternalLink size={13} />Fiche prospect
            </Link>
            {conversation.kind === "message_thread" && conversation.campaignId ? (
              conversation.automationMode === "setter" ? (
                <form action={setAutomation}>
                  <input name="mode" type="hidden" value="human" />
                  <button className="button" type="submit"><PauseCircle size={13} />Reprendre la main</button>
                </form>
              ) : (
                <form action={setAutomation}>
                  <input name="mode" type="hidden" value="setter" />
                  <button className="button button-signal" type="submit"><Bot size={13} />Laisser agir le Setter</button>
                </form>
              )
            ) : conversation.kind === "message_thread" ? (
              <span className="text-[11px] text-muted">Aucune réponse automatique hors campagne.</span>
            ) : (
              <span className="text-[11px] text-muted">Interaction sociale en lecture seule · aucun message automatique.</span>
            )}
          </div>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
          {memoryStatus ? <ProspectMemoryPanel status={memoryStatus} view={memoryView} /> : null}
          {conversation.socialEvents.length ? (
            <section className="space-y-2" aria-label="Interactions sociales prouvées">
              <div className="flex items-center justify-between gap-2">
                <strong className="flex items-center gap-2 text-xs"><MessageSquareText size={14} />Interactions sociales prouvées</strong>
                <span className="badge badge-signal">{conversation.socialEvents.length}</span>
              </div>
              {conversation.socialEvents.map((event) => (
                <article className="rounded-xl border border-brand-blue/25 bg-blue-50 p-3" key={event.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
                    <span>{socialEventLabel(event.type)} · {event.actorName ?? `${conversation.firstName} ${conversation.lastName}`}</span>
                    <span>{formatDate(event.at)}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-5">{event.body || "Interaction sans texte exploitable."}</p>
                  <p className="mt-2 line-clamp-2 text-[11px] text-muted">Sur le post : {event.postText}</p>
                  <div className="mt-2 flex flex-wrap gap-3 text-[11px] font-semibold text-brand-blue">
                    <Link href={workspaceProofHref(workspaceSlug, event.proofHref)}>Voir la preuve</Link>
                    {event.postUrl ? <a href={event.postUrl} rel="noreferrer" target="_blank">Ouvrir le post</a> : null}
                  </div>
                </article>
              ))}
            </section>
          ) : null}
          {conversation.messages.length ? conversation.messages.map((message) => (
            <div className={`flex ${message.direction === "outbound" ? "justify-end" : "justify-start"}`} key={message.id}>
              <div className={`max-w-[88%] rounded-2xl border px-3 py-2 text-xs leading-5 ${message.direction === "outbound" ? "border-navy bg-navy text-white" : "border-line bg-white"}`}>
                <p className="whitespace-pre-wrap">{message.body}</p>
                <p className={`mt-1 text-[10px] ${message.direction === "outbound" ? "text-slate-300" : "text-muted"}`}>
                  {message.direction === "outbound" ? senderLabel(message.senderType) : "Contact"} · {formatDate(message.at)}
                </p>
              </div>
            </div>
          )) : conversation.kind === "message_thread" ? (
            <div className="py-16 text-center"><MessageCircle className="mx-auto text-muted" size={28} /><p className="mt-3 text-sm font-semibold">Conversation vide</p></div>
          ) : null}
        </div>

        {conversation.decision ? (
          <section className="border-t border-line bg-blue-50 px-4 py-3 sm:px-5">
            <div className="flex items-center justify-between gap-2">
              <strong className="flex items-center gap-2 text-xs"><Bot size={14} />Avis IA</strong>
              <span className="badge badge-signal">{Math.round(conversation.decision.confidence * 100)}%</span>
            </div>
            <p className="mt-2 text-xs"><strong>{conversation.decision.intent}</strong> · {conversation.decision.action}</p>
            <p className="mt-1 text-[11px] leading-4 text-muted">{conversation.decision.rationale}</p>
          </section>
        ) : null}

        {conversation.kind === "message_thread" ? <footer className="border-t border-line bg-white p-4 sm:p-5">
          {conversation.latestCommand && ["scheduled", "sending"].includes(conversation.latestCommand.status) ? (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {conversation.latestCommand.executionMode === "dry_run"
                ? "Prévisualisation en cours — aucun message ne sera envoyé. Vous pouvez fermer cette fenêtre."
                : "Message en cours de préparation ou d’envoi — vous pouvez fermer cette fenêtre."}
            </p>
          ) : null}
          {conversation.latestCommand?.status === "cancelled" && conversation.latestCommand.errorMessage ? (
            <p className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-xs text-muted">
              Le Setter n’a rien envoyé : {conversation.latestCommand.errorMessage}
            </p>
          ) : null}
          {conversation.latestCommand?.status === "failed" ? (
            <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              L’envoi a échoué{conversation.latestCommand.errorMessage ? ` : ${conversation.latestCommand.errorMessage}` : "."}
            </p>
          ) : null}
          <ConversationComposer
            commandStatus={conversation.latestCommand?.status ?? null}
            commandExecutionMode={conversation.latestCommand?.executionMode ?? null}
            generatedBody={conversation.latestCommand?.generatedBody ?? null}
            conversationId={conversation.id}
            sendAction={send}
            workspaceSlug={workspaceSlug}
          />
        </footer> : (
          <footer className="border-t border-line bg-white p-4 text-xs leading-5 text-muted sm:p-5">
            Ce signal Inbound est visible pour comprendre le prospect. Il n’ouvre pas de DM et ne déclenche aucune action automatique.
          </footer>
        )}
      </aside>
    </>
  );
}

function channelLabel(channel: WorkspaceConversationDetail["channel"]): string {
  return channel === "linkedin" ? "LinkedIn" : channel === "whatsapp" ? "WhatsApp" : "Email";
}

function automationLabel(mode: WorkspaceConversationDetail["automationMode"]): string {
  return mode === "setter" ? "Setter actif" : mode === "disabled" ? "Automatisation arrêtée" : "Pilotage humain";
}

function sourceLabel(source: WorkspaceConversationDetail["source"]): string {
  return source === "inbound" ? "Source Inbound" : source === "outbound" ? "Source Outbound" : source === "mixed" ? "Source mixte" : "Sans attribution";
}

function socialEventLabel(type: WorkspaceConversationDetail["socialEvents"][number]["type"]): string {
  return type === "comment" ? "Commentaire LinkedIn" : type === "reply" ? "Réponse LinkedIn" : "Mention LinkedIn";
}

function workspaceProofHref(workspaceSlug: string, href: string): string {
  return href.startsWith(`/w/${workspaceSlug}/`) ? href : `/w/${workspaceSlug}${href.startsWith("/") ? href : `/${href}`}`;
}

function senderLabel(senderType: string): string {
  return senderType === "ai" ? "Setter IA" : senderType === "human" ? "Vous" : "Autopilote";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(value));
}
