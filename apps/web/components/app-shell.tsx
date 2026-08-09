"use client";

import {
  Bell,
  BarChart3,
  BookOpenCheck,
  CalendarDays,
  ChevronDown,
  FlaskConical,
  FileSpreadsheet,
  GitMerge,
  Inbox,
  Megaphone,
  Menu,
  MessageCircle,
  MessageSquareText,
  Kanban,
  Search,
  Settings,
  ShieldAlert,
  Target,
  UsersRound,
  X,
  Radar,
  Package,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { AccountHealthAlert, Session, Workspace } from "@/lib/api";

export function AppShell({
  workspace,
  workspaces,
  session,
  healthAlerts = [],
  children,
}: {
  workspace: Workspace;
  workspaces: readonly Workspace[];
  session: Session;
  healthAlerts?: readonly (AccountHealthAlert & { readonly acknowledgeAction?: (formData: FormData) => Promise<void> })[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const productReadingHref = `/w/${workspace.slug}/strategy/product-reading`;
  const icpsHref = `/w/${workspace.slug}/icps`;
  const offersHref = `/w/${workspace.slug}/offers`;
  const knowledgeHref = `/w/${workspace.slug}/knowledge`;
  const aiStudioHref = `/w/${workspace.slug}/ai-studio`;
  const messagingHref = `/w/${workspace.slug}/messaging`;
  const analyticsHref = `/w/${workspace.slug}/analytics`;
  const inboxHref = `/w/${workspace.slug}/inbox`;
  const campaignsHref = `/w/${workspace.slug}/campaigns`;
  const prospectsHref = `/w/${workspace.slug}/prospects`;
  const pipelineHref = `/w/${workspace.slug}/pipeline`;
  const aiSettingsHref = `/w/${workspace.slug}/settings/ai`;
  const calendarSettingsHref = `/w/${workspace.slug}/settings/calendar`;
  const channelSettingsHref = `/w/${workspace.slug}/settings/channels`;
  const memberSettingsHref = `/w/${workspace.slug}/settings/members`;
  const workspaceSettingsHref = `/w/${workspace.slug}/settings`;
  const productReadingActive = pathname.startsWith(productReadingHref);
  const icpsActive = pathname.startsWith(icpsHref);
  const offersActive = pathname.startsWith(offersHref);
  const knowledgeActive = pathname.startsWith(knowledgeHref);
  const aiStudioActive = pathname.startsWith(aiStudioHref);
  const messagingActive = pathname.startsWith(messagingHref);
  const analyticsActive = pathname.startsWith(analyticsHref);
  const initials = session.user.name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      {open ? (
        <button
          aria-label="Fermer la navigation"
          className="fixed inset-0 z-40 bg-navy/35 lg:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[260px] overflow-y-auto bg-navy px-3 py-4 text-white transition-transform lg:sticky lg:top-0 lg:h-screen lg:w-auto ${
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="flex items-center gap-3 px-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-signal text-sm font-black text-signal-ink">
            IO
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold tracking-tight">Ignition Outbound</div>
            <div className="text-[11px] text-slate-400">Revenue workspace</div>
          </div>
          <button className="lg:hidden" onClick={() => setOpen(false)} type="button">
            <X size={18} />
          </button>
        </div>

        <details className="group relative mt-5">
          <summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-2.5 hover:bg-white/10">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-xs font-bold">
              {workspace.name.slice(0, 2).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold">{workspace.name}</span>
              <span className="block truncate text-[10px] capitalize text-slate-400">
                {workspace.role}
              </span>
            </span>
            <ChevronDown className="text-slate-400 group-open:rotate-180" size={14} />
          </summary>
          <div className="mt-2 space-y-1 rounded-lg border border-white/10 bg-navy-soft p-1.5">
            {workspaces.length > 1
              ? workspaces.map((candidate) => (
                <Link
                  className="block rounded-md px-3 py-2 text-xs hover:bg-white/10"
                  href={`/w/${candidate.slug}/strategy/product-reading`}
                  key={candidate.id}
                >
                  {candidate.name}
                </Link>
              ))
              : null}
            <Link className="flex items-center gap-2 rounded-md border-t border-white/10 px-3 py-2 pt-2.5 text-xs text-signal hover:bg-white/10" href="/workspaces/new"><Plus size={13} /> Nouveau workspace</Link>
          </div>
        </details>

        <nav aria-label="Navigation principale">
          <div className="mb-2 mt-6 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            Stratégie
          </div>
          <Link
            aria-current={productReadingActive ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium ${
              productReadingActive
                ? "bg-white/10 text-white"
                : "text-slate-300 hover:bg-white/5 hover:text-white"
            }`}
            href={productReadingHref}
            onClick={() => setOpen(false)}
          >
            <FlaskConical size={17} />
            Trouver mon ICP
            <span className="ml-auto rounded-full bg-signal px-2 py-0.5 text-[9px] font-bold text-signal-ink">
              LIVE
            </span>
          </Link>
          <Link
            aria-current={icpsActive ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium ${
              icpsActive
                ? "bg-white/10 text-white"
                : "text-slate-300 hover:bg-white/5 hover:text-white"
            }`}
            href={icpsHref}
            onClick={() => setOpen(false)}
          >
            <Target size={17} />
            ICP
          </Link>
          <Link
            aria-current={offersActive ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium ${
              offersActive
                ? "bg-white/10 text-white"
                : "text-slate-300 hover:bg-white/5 hover:text-white"
            }`}
            href={offersHref}
            onClick={() => setOpen(false)}
          >
            <Package size={17} />
            Offres
          </Link>
          <Link
            aria-current={knowledgeActive ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium ${
              knowledgeActive
                ? "bg-white/10 text-white"
                : "text-slate-300 hover:bg-white/5 hover:text-white"
            }`}
            href={knowledgeHref}
            onClick={() => setOpen(false)}
          >
            <BookOpenCheck size={17} />
            Connaissance
          </Link>
          {workspace.role === "owner" || workspace.role === "admin" || workspace.role === "operator" ? <Link
            aria-current={aiStudioActive ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium ${
              aiStudioActive
                ? "bg-white/10 text-white"
                : "text-slate-300 hover:bg-white/5 hover:text-white"
            }`}
            href={aiStudioHref}
            onClick={() => setOpen(false)}
          >
            <ShieldAlert size={17} />
            AI Studio
          </Link> : null}
          <Link
            aria-current={messagingActive ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium ${
              messagingActive
                ? "bg-white/10 text-white"
                : "text-slate-300 hover:bg-white/5 hover:text-white"
            }`}
            href={messagingHref}
            onClick={() => setOpen(false)}
          >
            <MessageSquareText size={17} />
            Messages & supervision
          </Link>
          <Link
            aria-current={analyticsActive ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium ${
              analyticsActive
                ? "bg-white/10 text-white"
                : "text-slate-300 hover:bg-white/5 hover:text-white"
            }`}
            href={analyticsHref}
            onClick={() => setOpen(false)}
          >
            <BarChart3 size={17} />
            Analytics
          </Link>
          <div className="mb-2 mt-6 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            Prospection
          </div>
          <div className="space-y-1">
            <Link
              aria-current={pathname.startsWith(inboxHref) ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium ${
                pathname.startsWith(inboxHref)
                  ? "bg-white/10 text-white"
                  : "text-slate-300 hover:bg-white/5 hover:text-white"
              }`}
              href={inboxHref}
              onClick={() => setOpen(false)}
            >
              <Inbox size={17} />
              Messagerie
            </Link>
            <Link
              aria-current={pathname.startsWith(campaignsHref) ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium ${
                pathname.startsWith(campaignsHref)
                  ? "bg-white/10 text-white"
                  : "text-slate-300 hover:bg-white/5 hover:text-white"
              }`}
              href={campaignsHref}
              onClick={() => setOpen(false)}
            >
              <Megaphone size={17} />
              Campagnes
            </Link>
            <Link
              aria-current={pathname.startsWith(prospectsHref) ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium ${
                pathname.startsWith(prospectsHref)
                  ? "bg-white/10 text-white"
                  : "text-slate-300 hover:bg-white/5 hover:text-white"
              }`}
              href={prospectsHref}
              onClick={() => setOpen(false)}
            >
              <UsersRound size={17} />
              Prospects
            </Link>
            <Link
              aria-current={pathname.startsWith(pipelineHref) ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium ${
                pathname.startsWith(pipelineHref)
                  ? "bg-white/10 text-white"
                  : "text-slate-300 hover:bg-white/5 hover:text-white"
              }`}
              href={pipelineHref}
              onClick={() => setOpen(false)}
            >
              <Kanban size={17} />
              Pipeline
            </Link>
          </div>
          <div className="mb-2 mt-6 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            Workspace
          </div>
          <Link
            aria-current={pathname.startsWith(memberSettingsHref) ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium ${
              pathname.startsWith(memberSettingsHref)
                ? "bg-white/10 text-white"
                : "text-slate-300 hover:bg-white/5 hover:text-white"
            }`}
            href={memberSettingsHref}
            onClick={() => setOpen(false)}
          >
            <UsersRound size={17} />
            Équipe
          </Link>
          <Link
            aria-current={pathname === workspaceSettingsHref ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium ${
              pathname === workspaceSettingsHref
                ? "bg-white/10 text-white"
                : "text-slate-300 hover:bg-white/5 hover:text-white"
            }`}
            href={workspaceSettingsHref}
            onClick={() => setOpen(false)}
          >
            <SlidersHorizontal size={17} />
            Paramètres
          </Link>
          {["admin", "owner"].includes(workspace.role) ? (
            <>
              <Link
                aria-current={pathname.startsWith(channelSettingsHref) ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium ${
                  pathname.startsWith(channelSettingsHref)
                    ? "bg-white/10 text-white"
                    : "text-slate-300 hover:bg-white/5 hover:text-white"
                }`}
                href={channelSettingsHref}
                onClick={() => setOpen(false)}
              >
                <MessageCircle size={17} />
                Canaux
              </Link>
              <Link
                aria-current={pathname.startsWith(calendarSettingsHref) ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium ${
                  pathname.startsWith(calendarSettingsHref)
                    ? "bg-white/10 text-white"
                    : "text-slate-300 hover:bg-white/5 hover:text-white"
                }`}
                href={calendarSettingsHref}
                onClick={() => setOpen(false)}
              >
                <CalendarDays size={17} />
                Agenda
              </Link>
              <Link
                aria-current={pathname.startsWith(aiSettingsHref) ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium ${
                  pathname.startsWith(aiSettingsHref)
                    ? "bg-white/10 text-white"
                    : "text-slate-300 hover:bg-white/5 hover:text-white"
                }`}
                href={aiSettingsHref}
                onClick={() => setOpen(false)}
              >
                <Settings size={17} />
                Modèles IA
              </Link>
            </>
          ) : null}
        </nav>

        <div className="mt-8 rounded-lg border border-white/10 bg-white/[0.04] p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-signal">
            <Target size={15} />
            Boucle actuelle
          </div>
          <p className="mt-2 text-[11px] leading-5 text-slate-400">
            ICP → campagnes → prospects → conversations → rendez-vous.
          </p>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line bg-canvas/95 px-4 backdrop-blur md:px-8">
          <div className="flex items-center gap-3">
            <button
              aria-label="Ouvrir la navigation"
              className="button h-9 w-9 p-0 lg:hidden"
              onClick={() => setOpen(true)}
              type="button"
            >
              <Menu size={17} />
            </button>
            <div className="hidden h-9 min-w-[280px] items-center gap-2 rounded-lg border border-line bg-white px-3 text-xs text-muted md:flex">
              <Search size={15} />
              <span className="flex-1">Rechercher partout</span>
              <kbd className="rounded border border-line bg-slate-50 px-1.5 py-0.5 font-mono text-[10px]">
                ⌘ K
              </kbd>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button aria-label="Notifications" className="button h-9 w-9 p-0" type="button">
              <Bell size={16} />
            </button>
            <div className="flex items-center gap-2 rounded-lg p-1.5">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-navy text-[11px] font-bold text-white">
                {initials}
              </span>
              <span className="hidden text-left md:block">
                <span className="block max-w-36 truncate text-xs font-semibold">
                  {session.user.name}
                </span>
                <span className="block text-[10px] capitalize text-muted">{workspace.role}</span>
              </span>
              <Settings className="hidden text-muted md:block" size={14} />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1680px] px-4 py-6 sm:px-6 md:px-8 md:py-8">
          {healthAlerts.length ? (
            <div className="mb-5 space-y-2" aria-label="Alertes de santé des comptes">
              {healthAlerts.map((alert) => (
                <div className="flex flex-col gap-3 rounded-lg border border-danger/30 bg-red-50 px-4 py-3 text-sm text-danger sm:flex-row sm:items-center sm:justify-between" key={alert.id} role="alert">
                  <div className="flex min-w-0 items-start gap-2">
                    <ShieldAlert className="mt-0.5 shrink-0" size={16} />
                    <p><strong>Compte d’envoi dégradé.</strong> {alert.reasonMessage || "Les actions de ce compte sont suspendues isolément."} <Link className="font-semibold underline" href={`/w/${workspace.slug}/integrations`}>Voir l’impact</Link></p>
                  </div>
                  {alert.acknowledgeAction ? <form action={alert.acknowledgeAction}><button className="button shrink-0 border-danger/30 bg-white text-danger hover:bg-red-100" type="submit">Acquitter</button></form> : null}
                </div>
              ))}
            </div>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}
