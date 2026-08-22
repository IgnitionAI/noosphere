"use client";

import {
  ArrowRight,
  CalendarCheck2,
  ChevronDown,
  Inbox,
  Home,
  Menu,
  Plus,
  Settings,
  ShieldAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { AccountHealthAlert, Session, Workspace, WorkspaceOnboardingProgress } from "@/lib/api";
import { NoosphereMark } from "./noosphere-mark";
import { ThemeSwitcher } from "./theme-switcher";

export function AppShell({
  workspace,
  workspaces,
  session,
  healthAlerts = [],
  onboardingProgress = null,
  children,
}: {
  workspace: Workspace;
  workspaces: readonly Workspace[];
  session: Session;
  healthAlerts?: readonly (AccountHealthAlert & { readonly acknowledgeAction?: (formData: FormData) => Promise<void> })[];
  onboardingProgress?: WorkspaceOnboardingProgress | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const baseHref = `/w/${workspace.slug}`;
  const todayHref = baseHref;
  const conversationsHref = `${baseHref}/inbox`;
  const callsHref = `${baseHref}/appointments`;
  const settingsHref = `${baseHref}/settings`;
  const todayActive = pathname === baseHref || pathname === `${baseHref}/`;
  const callsActive = pathname.startsWith(callsHref) || pathname.startsWith(`${baseHref}/pipeline`);
  const settingsActive = pathname.startsWith(settingsHref)
    || pathname.startsWith(`${baseHref}/offers`)
    || pathname.startsWith(`${baseHref}/knowledge`)
    || pathname.startsWith(`${baseHref}/ai-studio`);
  const currentSection = pathname.startsWith(conversationsHref)
    ? "Messages"
    : callsActive
      ? "Appels"
      : settingsActive
        ? "Configuration"
        : todayActive
          ? "Accueil"
          : "Détails";
  const initials = session.user.name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[236px_minmax(0,1fr)]">
      <a className="skip-link" href="#main-content">Aller au contenu</a>
      {open ? (
        <button aria-label="Fermer la navigation" className="fixed inset-0 z-40 bg-navy/35 lg:hidden" onClick={() => setOpen(false)} type="button" />
      ) : null}

      <aside className={`fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col overflow-y-auto bg-nav px-3 py-4 text-white transition-transform lg:sticky lg:top-0 lg:h-screen lg:w-auto ${open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}>
        <div className="flex items-center gap-3 px-2">
          <NoosphereMark className="h-9 w-9" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-[15px] font-semibold tracking-[-0.02em]">Noosphere</div>
            <div className="text-[10px] text-slate-400">Intelligence de croissance</div>
          </div>
          <button aria-label="Fermer" className="grid h-11 w-11 place-items-center rounded-lg hover:bg-white/10 lg:hidden" onClick={() => setOpen(false)} type="button"><X size={18} /></button>
        </div>

        <details className="group relative mt-5">
          <summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-2.5 hover:bg-white/10">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-xs font-bold">{workspace.name.slice(0, 2).toUpperCase()}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold">{workspace.name}</span>
              <span className="block truncate text-[10px] capitalize text-slate-400">{workspace.role}</span>
            </span>
            <ChevronDown className="text-slate-400 group-open:rotate-180" size={14} />
          </summary>
          <div className="mt-2 space-y-1 rounded-lg border border-white/10 bg-nav-soft p-1.5">
            {workspaces.length > 1 ? workspaces.map((candidate) => (
            <Link className="flex min-h-11 items-center rounded-md px-3 py-2 text-xs hover:bg-white/10" href={`/w/${candidate.slug}`} key={candidate.id}>{candidate.name}</Link>
            )) : null}
            <Link className="flex min-h-11 items-center gap-2 rounded-md border-t border-white/10 px-3 py-2 pt-2.5 text-xs text-signal hover:bg-white/10" href="/workspaces/new"><Plus size={13} /> Nouveau workspace</Link>
          </div>
        </details>

        <nav aria-label="Navigation principale" className="mt-7 space-y-1">
          <NavItem active={todayActive} href={todayHref} icon={Home} label="Accueil" onClick={() => setOpen(false)} />
          <NavItem active={pathname.startsWith(conversationsHref)} href={conversationsHref} icon={Inbox} label="Messages" onClick={() => setOpen(false)} />
          <NavItem active={callsActive} href={callsHref} icon={CalendarCheck2} label="Appels" onClick={() => setOpen(false)} />
        </nav>

        <div className="mt-auto border-t border-white/10 pt-4">
          <p className="px-3 pt-3 text-[10px] leading-4 text-slate-500">Créer la demande. Capter les signaux.<br />Remplir l’agenda.</p>
        </div>
      </aside>

      <div className="min-w-0 pb-20 lg:pb-0">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line bg-[var(--app-header)] px-4 backdrop-blur sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <button aria-label="Ouvrir la navigation" className="button h-11 w-11 p-0 lg:hidden" onClick={() => setOpen(true)} type="button"><Menu size={17} /></button>
            <div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{workspace.name}</p><p className="font-display text-sm font-semibold text-ink">{currentSection}</p></div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeSwitcher />
            <Link aria-label="Ouvrir la configuration du workspace" className="flex min-h-11 items-center gap-2 rounded-lg p-1.5 transition hover:bg-surface-subtle" href={settingsHref}>
              <span className="grid h-8 w-8 place-items-center rounded-full bg-navy text-[11px] font-bold text-white">{initials}</span>
              <span className="hidden text-left md:block"><span className="block max-w-36 truncate text-xs font-semibold">{session.user.name}</span><span className="block text-[10px] capitalize text-muted">{workspace.role}</span></span>
              <Settings className="hidden text-muted md:block" size={14} />
            </Link>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 md:px-8 md:py-8" id="main-content" tabIndex={-1}>
          {onboardingProgress && !onboardingProgress.completed ? (
            <Link className="mb-5 flex items-center justify-between gap-4 rounded-lg border border-brand-blue/25 bg-blue-50 px-4 py-3 text-sm text-ink" href={`/onboarding?workspace=${workspace.slug}#${onboardingProgress.currentStep ?? "workspace"}`}>
              <span><strong>Terminer la configuration</strong><span className="ml-2 text-muted">Étape {Math.min(onboardingProgress.completedCount + 1, 7)}/7</span></span><ArrowRight size={16} />
            </Link>
          ) : null}
          {healthAlerts.length ? (
            <div aria-label="Alertes de santé des comptes" className="mb-5 space-y-2">
              {healthAlerts.map((alert) => (
                <div className="flex flex-col gap-3 rounded-lg border border-danger/30 bg-red-50 px-4 py-3 text-sm text-danger sm:flex-row sm:items-center sm:justify-between" key={alert.id} role="alert">
                  <div className="flex min-w-0 items-start gap-2"><ShieldAlert className="mt-0.5 shrink-0" size={16} /><p><strong>Compte à reconnecter.</strong> {alert.reasonMessage || "Les actions de ce compte sont suspendues isolément."} <Link className="font-semibold underline" href={`${settingsHref}/channels`}>Corriger</Link></p></div>
                  {alert.acknowledgeAction ? <form action={alert.acknowledgeAction}><button className="button shrink-0 border-danger/30 bg-white text-danger hover:bg-red-100" type="submit">Acquitter</button></form> : null}
                </div>
              ))}
            </div>
          ) : null}
          {children}
        </main>

        <nav aria-label="Navigation mobile" className="fixed inset-x-3 bottom-3 z-40 grid grid-cols-3 rounded-2xl border border-line bg-[var(--app-header)] p-1 shadow-xl backdrop-blur lg:hidden">
          <MobileNavItem active={todayActive} href={todayHref} icon={Home} label="Accueil" />
          <MobileNavItem active={pathname.startsWith(conversationsHref)} href={conversationsHref} icon={Inbox} label="Messages" />
          <MobileNavItem active={callsActive} href={callsHref} icon={CalendarCheck2} label="Appels" />
        </nav>
      </div>
    </div>
  );
}

function NavItem({ icon: Icon, label, href, active, onClick }: { icon: LucideIcon; label: string; href: string; active: boolean; onClick: () => void }) {
  return <Link aria-current={active ? "page" : undefined} className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium ${active ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"}`} href={href} onClick={onClick}><Icon size={17} />{label}</Link>;
}

function MobileNavItem({ icon: Icon, label, href, active }: { icon: LucideIcon; label: string; href: string; active: boolean }) {
  return <Link aria-current={active ? "page" : undefined} className={`flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-2 text-[10px] font-semibold ${active ? "bg-navy text-white" : "text-muted"}`} href={href}><Icon size={16} /><span className="max-w-full truncate">{label}</span></Link>;
}
