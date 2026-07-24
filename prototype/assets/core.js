import { navGroups } from "./data.js";

export const icon = (name, size=16, extra="") =>
  `<i data-lucide="${name}" class="${extra}" style="width:${size}px;height:${size}px" aria-hidden="true"></i>`;

export const initials = name => name.split(" ").map(v => v[0]).slice(0,2).join("").toUpperCase();

export function badge(label, tone="") {
  return `<span class="badge ${tone ? `badge-${tone}` : ""}">${label}</span>`;
}

export function button(label, iconName="", variant="", attrs="") {
  const type = /\btype=/.test(attrs) ? "" : `type="button"`;
  return `<button ${type} class="btn ${variant ? `btn-${variant}` : ""}" ${attrs}>${iconName ? icon(iconName) : ""}<span>${label}</span></button>`;
}

export function pageHeader(title, description, actions="") {
  return `<header class="page-header">
    <div><h1 class="page-title" contenteditable="true" data-pretext>${title}</h1><p class="page-description" contenteditable="true" data-pretext>${description}</p></div>
    ${actions ? `<div class="desktop-actions flex items-center gap-2">${actions}</div>` : ""}
  </header>`;
}

export function metric(label, value, meta="", tone="") {
  return `<article class="metric">
    <div class="metric-label">${label}</div>
    <div class="flex items-end justify-between gap-3">
      <div class="metric-value">${value}</div>
      ${meta ? `<span class="text-xs font-semibold ${tone === "down" ? "text-danger" : "text-success"}">${meta}</span>` : ""}
    </div>
  </article>`;
}

export function panel(title, body, action="", classes="") {
  return `<section class="panel ${classes}">
    ${title ? `<div class="panel-header"><h2 class="font-semibold">${title}</h2>${action}</div>` : ""}
    <div class="panel-body">${body}</div>
  </section>`;
}

export function toolbar(searchPlaceholder="Rechercher…", right="") {
  return `<div class="flex flex-wrap items-center justify-between gap-3 p-3 border-b border-line">
    <div class="flex min-w-0 flex-1 items-center gap-2" role="search">
      <div class="relative min-w-[220px] max-w-md flex-1">
        ${icon("Search",16,"absolute left-3 top-2.5 text-muted")}
        <input class="input pl-9" aria-label="Recherche" placeholder="${searchPlaceholder}">
      </div>
      ${button("Filtres","SlidersHorizontal")}
    </div>
    <div class="flex items-center gap-2">${right}</div>
  </div>`;
}

export function scoreRing(score) {
  return `<div class="score-ring" style="--score:${score}" aria-label="Score ${score} sur 100"><span>${score}</span></div>`;
}

function sidebar(active) {
  const groups = navGroups.map(group => `
    <div class="mt-5">
      <div class="px-3 mb-2 text-[10px] font-semibold uppercase tracking-[.12em] text-slate-500">${group.label}</div>
      <div class="space-y-1">${group.items.map(([key,label,ico,href,count]) => `
        <a href="${href}" ${active===key ? 'aria-current="page"' : ""} class="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition ${active===key ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"}">
          ${icon(ico,17)}<span class="flex-1">${label}</span>${count ? `<span class="rounded-full bg-signal px-2 py-0.5 text-[10px] font-bold text-signal-ink">${count}</span>` : ""}
        </a>`).join("")}</div>
    </div>`).join("");

  return `<aside id="sidebar" class="sidebar bg-navy text-white px-3 py-4">
    <div class="flex items-center gap-3 px-2">
      <div class="grid h-9 w-9 place-items-center rounded-lg bg-signal text-sm font-black text-signal-ink">IO</div>
      <div><div class="font-semibold tracking-tight">Ignition Outbound</div><div class="text-[11px] text-slate-400">Revenue workspace</div></div>
    </div>
    <button type="button" class="mt-5 flex w-full items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-2.5 text-left hover:bg-white/10" data-toast="Workspace switcher ouvert">
      <span class="avatar h-8 w-8 bg-white/10 text-white">IA</span>
      <span class="min-w-0 flex-1"><span class="block truncate text-xs font-semibold">IgnitionAI</span><span class="block truncate text-[10px] text-slate-400">Workspace principal</span></span>
      ${icon("ChevronsUpDown",14,"text-slate-400")}
    </button>
    <nav aria-label="Navigation principale">${groups}</nav>
    <div class="mt-6 rounded-lg border border-white/10 bg-white/[.04] p-3">
      <div class="flex items-center justify-between text-[11px]"><span class="text-slate-400">Actions aujourd’hui</span><span class="font-mono">68 / 120</span></div>
      <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div class="h-full w-[57%] rounded-full bg-signal"></div></div>
      <button class="mt-3 text-[11px] font-semibold text-signal" data-toast="Santé des comptes affichée">Voir la santé des comptes</button>
    </div>
  </aside>`;
}

function topbar() {
  return `<div class="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line bg-canvas/95 px-4 backdrop-blur md:px-8">
    <div class="flex items-center gap-3">
      <button class="btn icon-btn mobile-only" data-mobile-menu aria-label="Ouvrir la navigation">${icon("Menu")}</button>
      <button class="hidden h-9 min-w-[280px] items-center gap-2 rounded-lg border border-line bg-white px-3 text-left text-xs text-muted shadow-panel md:flex" data-toast="Commande rapide, ⌘ K">
        ${icon("Search",15)}<span class="flex-1">Rechercher partout</span><kbd class="rounded border border-line bg-slate-50 px-1.5 py-0.5 font-mono text-[10px]">⌘ K</kbd>
      </button>
    </div>
    <div class="flex items-center gap-2">
      <button class="btn icon-btn" data-toast="Aucune alerte critique" aria-label="Notifications">${icon("Bell")}</button>
      <button class="flex items-center gap-2 rounded-lg p-1.5 hover:bg-white" data-toast="Menu du profil">
        <span class="avatar bg-navy text-white">SL</span><span class="hidden text-left md:block"><span class="block text-xs font-semibold">Salim</span><span class="block text-[10px] text-muted">Owner</span></span>${icon("ChevronDown",14,"hidden md:block")}
      </button>
    </div>
  </div>`;
}

export function appShell(active, content, options={}) {
  if (options.bare) return content;
  return `<div class="app-grid">
    ${sidebar(active)}
    <div class="page-wrap">${topbar()}${options.fullBleed ? content : `<main class="page-main">${content}</main>`}</div>
  </div>
  <div id="drawerBackdrop" class="drawer-backdrop" data-close-drawer></div>
  <aside id="drawer" class="drawer" aria-label="Détail"></aside>
  <div id="toast" class="toast" role="status"></div>`;
}

export function drawerContent(title, body, actions="") {
  return `<div class="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white p-4">
    <div><div class="text-xs text-muted">Détail</div><h2 class="text-lg font-semibold">${title}</h2></div>
    <button class="btn icon-btn" data-close-drawer aria-label="Fermer">${icon("X")}</button>
  </div>
  <div class="p-5">${body}</div>
  ${actions ? `<div class="sticky bottom-0 flex gap-2 border-t border-line bg-white p-4">${actions}</div>` : ""}`;
}

export function initUI() {
  if (window.lucide) window.lucide.createIcons();
  document.addEventListener("click", event => {
    const toastTarget = event.target.closest("[data-toast]");
    if (toastTarget) showToast(toastTarget.dataset.toast);

    if (event.target.closest("[data-mobile-menu]")) document.querySelector("#sidebar")?.classList.toggle("open");
    if (event.target.closest("[data-close-drawer]")) closeDrawer();

    const tab = event.target.closest(".tab");
    if (tab) {
      tab.parentElement.querySelectorAll(".tab").forEach(v => v.classList.remove("active"));
      tab.classList.add("active");
    }
  });
}

export function openDrawer(html) {
  document.querySelector("#drawer").innerHTML = html;
  document.querySelector("#drawer").classList.add("open");
  document.querySelector("#drawerBackdrop").classList.add("open");
  if (window.lucide) window.lucide.createIcons();
}

export function closeDrawer() {
  document.querySelector("#drawer")?.classList.remove("open");
  document.querySelector("#drawerBackdrop")?.classList.remove("open");
}

export function showToast(message) {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("open");
  window.clearTimeout(window.__toastTimer);
  window.__toastTimer = window.setTimeout(() => toast.classList.remove("open"), 2200);
}

export async function initPretext() {
  try {
    const { prepare, layout } = await import("https://esm.sh/@chenglou/pretext");
    await document.fonts.ready;
    const prepared = new Map();
    const refresh = el => prepared.set(el, prepare(el.textContent || "", getComputedStyle(el).font));
    document.querySelectorAll("[data-pretext]").forEach(el => {
      refresh(el);
      if (el.contentEditable === "true") new MutationObserver(() => { refresh(el); relayout(); }).observe(el,{characterData:true,subtree:true,childList:true});
    });
    function relayout() {
      for (const [el, handle] of prepared) {
        const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
        const { height } = layout(handle, Math.max(el.clientWidth, 1), lineHeight);
        if (height) el.style.minHeight = `${height}px`;
      }
    }
    new ResizeObserver(relayout).observe(document.body);
    relayout();
  } catch (_) {
    // The prototype remains fully usable offline; Pretext is progressive enhancement.
  }
}
