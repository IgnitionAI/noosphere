import { prospects, companies } from "./data.js";
import { icon, badge, button, pageHeader, metric, toolbar, scoreRing, drawerContent } from "./core.js";

const statusTone = s => s==="A répondu"||s==="Qualifié" ? "success" : s==="À valider"||s==="À enrichir" ? "warning" : s==="En séquence" ? "blue" : "";

export function prospectsPage() {
  return `
    ${pageHeader("Prospects", "Recherchez, enrichissez et priorisez les personnes qui correspondent à votre ICP.", `${button("Importer","Upload")}${button("Trouver des prospects","Radar","primary","onclick=\"location.href='discover.html'\"")}`)}
    <section class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">${metric("Total","8 462","+184 ce mois")}${metric("Forte intention","327","+41")}${metric("Emails vérifiés","76,8 %","+3,1 %")}${metric("En séquence","412","3 campagnes")}</section>
    <section class="panel overflow-hidden">
      ${toolbar("Nom, entreprise, poste ou signal", `<button class="btn">${icon("Columns3")}Colonnes</button><button class="btn">${icon("Download")}Exporter</button>`)}
      <div class="flex flex-wrap gap-2 border-b border-line px-3 py-2.5"><span class="text-xs font-semibold text-muted">Vues :</span>${["Tous","ICP RAG ≥ 80","Nouveaux signaux","À enrichir","À valider"].map((v,i)=>`<button class="badge ${i===0?"badge-signal":""}">${v}</button>`).join("")}</div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th><input type="checkbox" aria-label="Tout sélectionner"></th><th>Prospect</th><th>Score</th><th>Signal d’intention</th><th>Contact</th><th>Statut</th><th>Dernière activité</th><th></th></tr></thead>
      <tbody>${prospects.map((p,i)=>`<tr data-prospect="${i}"><td><input type="checkbox" aria-label="Sélectionner ${p.name}"></td><td><div class="identity"><span class="avatar ${p.score>90?"avatar-signal":""}">${p.initials}</span><span class="identity-main"><span class="identity-name">${p.name}</span><span class="identity-meta">${p.title} · ${p.company} · ${p.city}</span></span></div></td><td>${scoreRing(p.score)}</td><td><div class="max-w-[240px] font-medium">${p.signal}</div><div class="mt-1 text-[11px] text-muted">Source vérifiée</div></td><td><div class="text-xs">${p.email}</div><div class="mt-1">${badge(p.channel,p.channel==="LinkedIn"?"blue":"")}</div></td><td>${badge(p.status,statusTone(p.status))}</td><td class="text-xs text-muted">${p.last}</td><td><button class="btn icon-btn">${icon("MoreHorizontal")}</button></td></tr>`).join("")}</tbody></table></div>
      <div class="flex items-center justify-between border-t border-line p-3 text-xs text-muted"><span>1–7 sur 8 462 prospects</span><div class="flex gap-2">${button("Précédent","ChevronLeft")}${button("Suivant","ChevronRight")}</div></div>
    </section>`;
}

export function prospectDetailDrawer(index=0) {
  const p=prospects[index] || prospects[0];
  return drawerContent(p.name, `
    <div class="flex items-center gap-3"><span class="avatar avatar-lg avatar-signal">${p.initials}</span><div><div class="font-semibold">${p.title}</div><div class="text-sm text-muted">${p.company} · ${p.city}</div></div><div class="ml-auto">${scoreRing(p.score)}</div></div>
    <div class="mt-5 flex gap-2">${button("LinkedIn","Network")}${button("Email","Mail")}${button("Ajouter à une campagne","Plus","primary")}</div>
    <div class="mt-6 tabs"><button class="tab active">Vue</button><button class="tab">Historique</button><button class="tab">Données</button></div>
    <section class="mt-5"><h3 class="text-xs font-semibold uppercase tracking-wide text-muted">Pourquoi maintenant</h3><div class="mt-2 rounded-lg border border-[#d7f69b] bg-[#f6ffe5] p-3"><div class="font-semibold">${p.signal}</div><p class="mt-1 text-xs leading-5 text-muted">Signal observé récemment et compatible avec l’offre IgnitionRAG Entreprise.</p></div></section>
    <section class="mt-6"><h3 class="text-xs font-semibold uppercase tracking-wide text-muted">Identités vérifiées</h3><div class="mt-2 space-y-2"><div class="flex items-center gap-3 rounded-lg border border-line p-3">${icon("Network",17,"text-brandblue")}<span class="flex-1 text-sm">linkedin.com/in/${p.name.toLowerCase().replaceAll(" ","-")}</span>${badge("Certain","success")}</div><div class="flex items-center gap-3 rounded-lg border border-line p-3">${icon("Mail",17)}<span class="flex-1 text-sm">${p.email}</span>${badge(p.email==="—"?"Manquant":"97 %","success")}</div></div></section>
    <section class="mt-6"><h3 class="text-xs font-semibold uppercase tracking-wide text-muted">Parcours professionnel</h3><div class="mt-3 border-l-2 border-line pl-4"><div class="font-semibold">${p.title} · ${p.company}</div><div class="text-xs text-muted">2023 — aujourd’hui</div><div class="mt-4 font-medium text-muted">Head of Engineering · Nexora</div><div class="text-xs text-muted">2019 — 2023</div></div></section>
  `);
}

export function prospectDetailPage() {
  const p=prospects[0];
  return `
    <div class="mb-5"><a href="prospects.html" class="inline-flex items-center gap-2 text-xs font-semibold text-muted hover:text-ink">${icon("ArrowLeft",14)}Retour aux prospects</a></div>
    ${pageHeader(p.name, `${p.title} chez ${p.company}`, `${button("Enrichir","RefreshCw")}${button("Ajouter à une campagne","Plus","primary")}`)}
    <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div class="space-y-4">
        <section class="panel p-5"><div class="flex flex-wrap items-start gap-4"><span class="avatar avatar-lg avatar-signal">${p.initials}</span><div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><h2 class="text-lg font-semibold">${p.name}</h2>${badge("Identité certaine","success")}</div><p class="mt-1 text-muted">${p.title} · ${p.company} · ${p.city}</p><div class="mt-4 flex flex-wrap gap-2">${badge("RAG Entreprise","signal")}${badge("CTO","blue")}${badge("Fintech")}</div></div>${scoreRing(p.score)}</div></section>
        <section class="panel"><div class="panel-header"><h2 class="font-semibold">Intelligence prospect</h2>${button("Recalculer","Sparkles")}</div><div class="grid gap-0 md:grid-cols-3"><div class="border-b border-line p-5 md:border-b-0 md:border-r"><div class="text-xs text-muted">Fit entreprise</div><div class="mt-2 font-mono text-2xl font-semibold">96</div><p class="mt-2 text-xs leading-5 text-muted">Taille, secteur et maturité correspondent.</p></div><div class="border-b border-line p-5 md:border-b-0 md:border-r"><div class="text-xs text-muted">Fit persona</div><div class="mt-2 font-mono text-2xl font-semibold">93</div><p class="mt-2 text-xs leading-5 text-muted">Décisionnaire technique direct.</p></div><div class="p-5"><div class="text-xs text-muted">Intention</div><div class="mt-2 font-mono text-2xl font-semibold">91</div><p class="mt-2 text-xs leading-5 text-muted">${p.signal}.</p></div></div></section>
        <section class="panel"><div class="panel-header"><h2 class="font-semibold">Chronologie</h2></div><div class="p-5 space-y-5">${[["Aujourd’hui, 10:24","Profil enrichi","Email professionnel vérifié à 97 %."],["23 juil., 16:18","Signal détecté",p.signal+"."],["18 juil., 09:40","Post LinkedIn","Publication sur l’industrialisation des assistants internes."],["2 mai 2023","Changement de poste","Nommée CTO chez Finovox."]].map(([d,t,x])=>`<div class="flex gap-4"><div class="w-28 flex-none text-xs text-muted">${d}</div><div class="relative border-l border-line pl-4"><span class="absolute -left-1 top-1 h-2 w-2 rounded-full bg-navy"></span><div class="font-semibold">${t}</div><p class="mt-1 text-xs text-muted">${x}</p></div></div>`).join("")}</div></section>
      </div>
      <aside class="space-y-4">
        <section class="panel p-5"><h2 class="font-semibold">Coordonnées</h2><div class="mt-4 space-y-3"><div><div class="label">Email professionnel</div><div class="flex items-center justify-between"><span>${p.email}</span>${badge("Vérifié","success")}</div></div><div><div class="label">LinkedIn</div><a class="text-brandblue" href="#">Voir le profil externe</a></div><div><div class="label">WhatsApp</div><span class="text-muted">Non autorisé</span></div></div></section>
        <section class="panel p-5"><h2 class="font-semibold">Action recommandée</h2><p class="mt-2 text-sm leading-6 text-muted">Mentionner le recrutement IA, puis demander comment Finovox prévoit la gouvernance des nouveaux assistants.</p><button class="btn btn-signal mt-4 w-full">${icon("Sparkles")}Préparer une séquence</button></section>
        <section class="panel p-5"><h2 class="font-semibold">Provenance</h2><div class="mt-3 space-y-2 text-xs"><div class="flex justify-between"><span class="text-muted">LinkedIn</span><strong>23 juil.</strong></div><div class="flex justify-between"><span class="text-muted">Enrichissement</span><strong>24 juil.</strong></div><div class="flex justify-between"><span class="text-muted">Dernier scoring</span><strong>il y a 4 min</strong></div></div></section>
      </aside>
    </div>`;
}

export function companiesPage() {
  return `
    ${pageHeader("Entreprises", "Cartographiez vos comptes cibles, leurs signaux et les bons contacts.", `${button("Importer","Upload")}${button("Ajouter une entreprise","Plus","primary")}`)}
    <section class="panel overflow-hidden">${toolbar("Entreprise, domaine ou secteur", button("Carte des signaux","Radar"))}
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Entreprise</th><th>Fit ICP</th><th>Secteur</th><th>Taille</th><th>Signaux</th><th>Contacts</th><th>Statut</th><th></th></tr></thead><tbody>
      ${companies.map(c=>`<tr onclick="location.href='company-detail.html'"><td><div class="identity"><span class="avatar rounded-lg">${c.name.slice(0,2).toUpperCase()}</span><span class="identity-main"><span class="identity-name">${c.name}</span><span class="identity-meta">${c.domain} · ${c.city}</span></span></div></td><td>${scoreRing(c.fit)}</td><td>${c.industry}</td><td class="font-mono text-xs">${c.size}</td><td><span class="badge badge-signal">${icon("Radar",12)}${c.signals} actifs</span></td><td>${c.contacts}</td><td>${badge(c.status,c.status==="Prioritaire"?"success":c.status==="Compte cible"?"blue":"")}</td><td><button class="btn icon-btn">${icon("ChevronRight")}</button></td></tr>`).join("")}</tbody></table></div>
    </section>`;
}
