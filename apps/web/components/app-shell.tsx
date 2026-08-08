"use client";

import {
  BarChart3,
  Bell,
  Building2,
  ChevronDown,
  FlaskConical,
  FileSpreadsheet,
  GitMerge,
  Inbox,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  Megaphone,
  Package,
  PlugZap,
  Search,
  Send,
  Settings,
  ShieldAlert,
  Target,
  Users,
  X,
  Radar,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { Session, Workspace } from "@/lib/api";

const futureNavigation = [
  ["Vue d’ensemble", LayoutDashboard],
  ["Inbox", Inbox],
  ["Analytics", BarChart3],
] as const;

export function AppShell({
  workspace,
  workspaces,
  session,
  children,
}: {
  workspace: Workspace;
  workspaces: readonly Workspace[];
  session: Session;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const productReadingHref = `/w/${workspace.slug}/strategy/product-reading`;
  const icpsHref = `/w/${workspace.slug}/icps`;
  const offersHref = `/w/${workspace.slug}/offers`;
  const messagingHref = `/w/${workspace.slug}/messaging`;
  const discoveryHref = `/w/${workspace.slug}/prospects/discover`;
  const suppressionsHref = `/w/${workspace.slug}/suppressions`;
  const approvalsHref = `/w/${workspace.slug}/approvals`;
  const aiSettingsHref = `/w/${workspace.slug}/settings/ai`;
  const productReadingActive = pathname.startsWith(productReadingHref);
  const icpsActive = pathname.startsWith(icpsHref);
  const offersActive = pathname.startsWith(offersHref);
  const messagingActive = pathname.startsWith(messagingHref);
  const crmNavigation = [
    [`/w/${workspace.slug}/prospects`, "Prospects", Users],
    [discoveryHref, "Découverte", Radar],
    [`/w/${workspace.slug}/companies`, "Entreprises", Building2],
    [`/w/${workspace.slug}/sequences`, "Séquences", Send],
    [suppressionsHref, "Suppressions", ShieldAlert],
    [`/w/${workspace.slug}/imports`, "Imports", FileSpreadsheet],
    [`/w/${workspace.slug}/duplicates`, "Doublons", GitMerge],
    [`/w/${workspace.slug}/campaigns`, "Campagnes", Megaphone],
    [approvalsHref, "Approbations", Inbox],
    [`/w/${workspace.slug}/integrations`, "Intégrations", PlugZap],
  ] as const;
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
          {workspaces.length > 1 ? (
            <div className="mt-2 space-y-1 rounded-lg border border-white/10 bg-navy-soft p-1.5">
              {workspaces.map((candidate) => (
                <Link
                  className="block rounded-md px-3 py-2 text-xs hover:bg-white/10"
                  href={`/w/${candidate.slug}/strategy/product-reading`}
                  key={candidate.id}
                >
                  {candidate.name}
                </Link>
              ))}
            </div>
          ) : null}
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
          <div className="mb-2 mt-6 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            Prospection
          </div>
          <div className="space-y-1">
            {crmNavigation.filter(([href]) => (href !== `/w/${workspace.slug}/imports` || workspace.role !== "viewer") && (href !== approvalsHref || workspace.role !== "viewer")).map(([href, label, Icon]) => (
              <Link
                aria-current={pathname.startsWith(href) ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium ${
                  pathname.startsWith(href)
                    ? "bg-white/10 text-white"
                    : "text-slate-300 hover:bg-white/5 hover:text-white"
                }`}
                href={href}
                key={label}
                onClick={() => setOpen(false)}
              >
                <Icon size={17} />
                {label}
              </Link>
            ))}
            {futureNavigation.map(([label, Icon]) => (
              <span
                aria-disabled="true"
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-slate-500"
                key={label}
              >
                <Icon size={17} />
                {label}
              </span>
            ))}
          </div>
          {["admin", "owner"].includes(workspace.role) ? (
            <>
              <div className="mb-2 mt-6 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Workspace
              </div>
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
            Produit → concurrents → propositions ICP sourcées.
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
          {children}
        </main>
      </div>
    </div>
  );
}
