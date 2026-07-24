import { icon, badge, button, pageHeader, panel } from "./core.js";

const knownCompetitors = ["OneTrust", "Holistic AI"];

function competitorSeed(name) {
  return `<span class="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-xs font-semibold" data-competitor-seed>
    ${name}<button type="button" class="text-muted hover:text-danger" data-remove-competitor aria-label="Retirer ${name}">${icon("X",13)}</button>
  </span>`;
}

export function productResearchBriefPage() {
  return `
    <div class="mb-5 flex flex-wrap items-center gap-2 text-xs font-semibold text-muted">
      <span class="inline-flex items-center gap-2 text-navy"><span class="grid h-5 w-5 place-items-center rounded-full bg-navy text-[10px] text-white">1</span>Brief</span>
      <span class="h-px w-7 bg-line"></span>
      <span class="inline-flex items-center gap-2"><span class="grid h-5 w-5 place-items-center rounded-full border border-line bg-white text-[10px]">2</span>Recherche</span>
      <span class="h-px w-7 bg-line"></span>
      <span class="inline-flex items-center gap-2"><span class="grid h-5 w-5 place-items-center rounded-full border border-line bg-white text-[10px]">3</span>Livrable ICP</span>
    </div>
    ${pageHeader("Commander une étude ICP", "Le deep agent analyse votre produit, recherche les concurrents et propose les marchés les plus crédibles.")}
    <div class="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <main class="space-y-4">
        ${panel("1. Produit à analyser", `
          <div class="grid gap-4 md:grid-cols-2">
            <label><span class="label">Site du produit</span><div class="relative">${icon("Globe2",16,"absolute left-3 top-2.5 text-muted")}<input class="input pl-9" value="https://preuvio.com"></div></label>
            <label><span class="label">Nom du produit</span><input class="input" value="Preuvio"></label>
          </div>
          <label class="mt-4 block"><span class="label">Ce que fait le produit</span><textarea class="textarea min-h-[104px]">Registre opérationnel des usages IA, cartographie des risques et collecte de preuves pour préparer les revues de gouvernance.</textarea><span class="help">Cette description guide la recherche, elle ne sera pas traitée comme une preuve.</span></label>
        `)}
        ${panel("2. Marché recherché", `
          <div class="grid gap-4 md:grid-cols-3">
            <label><span class="label">Géographie</span><select class="select"><option>France</option><option>Europe francophone</option><option>Union européenne</option><option>International</option></select></label>
            <label><span class="label">Langue des sources</span><select class="select"><option>Français + anglais</option><option>Français uniquement</option><option>Anglais uniquement</option></select></label>
            <label><span class="label">Type de vente</span><select class="select"><option>SaaS B2B + accompagnement</option><option>SaaS B2B</option><option>Service</option><option>Licence</option></select></label>
          </div>
        `)}
        ${panel("3. Concurrents déjà connus", `
          <p class="mb-3 text-xs text-muted">Facultatif. Le deep agent cherchera également des concurrents directs, adjacents et des alternatives manuelles.</p>
          <div class="flex flex-wrap gap-2" data-competitor-seeds>${knownCompetitors.map(competitorSeed).join("")}</div>
          <form class="mt-3 flex flex-col gap-2 sm:flex-row" data-competitor-form><input class="input min-w-0 flex-1" data-competitor-input placeholder="Nom ou URL d’un concurrent"><button class="btn" type="submit">${icon("Plus")}Ajouter</button></form>
        `)}
        ${panel("4. Documents internes", `
          <button type="button" class="flex w-full items-center justify-center gap-3 rounded-lg border border-dashed border-line bg-canvas p-7 text-sm font-semibold hover:border-navy" data-toast="Sélecteur de documents ouvert">${icon("UploadCloud",20)}Ajouter un pitch, une brochure ou une étude existante</button>
          <p class="mt-2 text-xs text-muted">Les documents internes seront clairement distingués des sources publiques.</p>
        `)}
        ${panel("5. Profondeur de l’étude", `
          <div class="grid gap-3 md:grid-cols-3" data-depth-options>
            ${[
              ["Rapide","15–25 sources","Première hypothèse en quelques minutes",false],
              ["Standard","30–60 sources","Concurrents, segments, personas et preuves",true],
              ["Approfondie","80+ sources","Recherche étendue et audit renforcé",false]
            ].map(([name,sources,description,active])=>`<button type="button" class="research-depth ${active ? "research-depth-active" : ""}" data-depth aria-pressed="${active}"><span class="flex items-center justify-between"><strong>${name}</strong>${active ? badge("Recommandé","signal") : ""}</span><span class="mt-3 block font-mono text-xs">${sources}</span><span class="mt-2 block text-left text-xs leading-5 text-muted">${description}</span></button>`).join("")}
          </div>
        `)}
      </main>
      <aside class="space-y-4 xl:sticky xl:top-20">
        <section class="panel">
          <div class="panel-header"><h2 class="font-semibold">Mission prête</h2>${badge("Standard","signal")}</div>
          <div class="panel-body">
            <div class="space-y-3 text-xs">
              ${[["Produit","Preuvio"],["Marché","France"],["Sources","FR + EN"],["Concurrents fournis","2"],["Profondeur","Standard"]].map(([key,value])=>`<div class="flex justify-between gap-3 border-b border-line pb-2"><span class="text-muted">${key}</span><strong class="text-right">${value}</strong></div>`).join("")}
            </div>
            <div class="mt-5 rounded-lg border border-line bg-canvas p-3 text-xs leading-5 text-muted">
              ${icon("ShieldCheck",16,"mb-2 text-success")}
              Les résultats resteront des propositions. Chaque affirmation importante devra citer une source ou être signalée comme hypothèse.
            </div>
          </div>
          <footer class="border-t border-line p-4">
            <a href="research-progress.html" class="btn btn-primary w-full">${icon("Radar")}Lancer l’étude ICP</a>
            <p class="mt-3 text-center text-[11px] text-muted">Aucun prospect ne sera recherché pendant cette mission.</p>
          </footer>
        </section>
      </aside>
    </div>`;
}

export function initProductResearchBrief() {
  const seeds = document.querySelector("[data-competitor-seeds]");
  const form = document.querySelector("[data-competitor-form]");
  const input = document.querySelector("[data-competitor-input]");
  seeds?.addEventListener("click", event => event.target.closest("[data-remove-competitor]")?.closest("[data-competitor-seed]")?.remove());
  form?.addEventListener("submit", event => {
    event.preventDefault();
    const value = input?.value.trim();
    if (!value || !seeds) return;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = competitorSeed(value);
    seeds.append(wrapper.firstElementChild);
    input.value = "";
    window.lucide?.createIcons();
  });
  document.querySelectorAll("[data-depth]").forEach(option => option.addEventListener("click", () => {
    document.querySelectorAll("[data-depth]").forEach(item => {
      item.classList.toggle("research-depth-active", item === option);
      item.setAttribute("aria-pressed", String(item === option));
    });
  }));
}

const stages = [
  ["Comprendre le produit","Terminé","18 éléments structurés","CheckCircle2","success"],
  ["Découvrir les concurrents","Terminé","14 candidats · 5 retenus","CheckCircle2","success"],
  ["Analyser le positionnement","Terminé","42 pages comparées","CheckCircle2","success"],
  ["Identifier les segments","En cours","6 segments · audit en cours","LoaderCircle","brandblue"],
  ["Synthétiser les ICP","À venir","Classement et critères opérationnels","Circle","muted"],
  ["Auditer les preuves","À venir","Contradictions et confiance","Circle","muted"]
];

const competitors = [
  ["OneTrust","Direct · Enterprise","Inventaire et gouvernance IA dans une plateforme trust plus large.","onetrust.com","Vérifié"],
  ["Holistic AI","Direct · Enterprise","Découverte, évaluation, monitoring et gouvernance du cycle de vie IA.","holisticai.com","Vérifié"],
  ["Credo AI","Direct · Enterprise","Gouvernance des agents, modèles et applications IA.","credo.ai","Vérifié"],
  ["Saidot","Direct · Mid-market","Gouvernance IA fondée sur un graphe de risques, politiques et contrôles.","saidot.ai","Vérifié"],
  ["Tableurs + conseil","Alternative manuelle","Registre et collecte de preuves gérés sans plateforme dédiée.","Sources multiples","À confirmer"]
];

export function researchProgressPage() {
  return `
    ${pageHeader("Étude ICP en cours", "Le rapport se construit par étapes. Les résultats déjà vérifiés restent disponibles si une source échoue.", `${button("Mettre en pause","Pause")}${button("Actualiser","RefreshCw","","data-toast='Progression actualisée'")}`)}
    <section class="mb-5 panel">
      <div class="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div><div class="flex flex-wrap items-center gap-2">${badge("RUN-2026-0724","blue")}${badge("Recherche standard")}${badge("4 / 6 étapes","signal")}</div><h2 class="mt-4 text-xl font-semibold">Preuvio · France</h2><p class="mt-2 max-w-3xl text-sm leading-6 text-muted">Analyse de la gouvernance opérationnelle des usages IA et des solutions concurrentes destinées aux organisations françaises et européennes.</p><div class="mt-5 progress h-2"><span style="width:68%;background:var(--signal)"></span></div></div>
        <div class="grid grid-cols-2 gap-3"><div class="metric"><div class="metric-label">Sources consultées</div><div class="metric-value">47</div></div><div class="metric"><div class="metric-label">Concurrents retenus</div><div class="metric-value">5</div></div></div>
      </div>
    </section>
    <div class="grid items-start gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
      <aside class="panel overflow-hidden" aria-live="polite">
        <div class="panel-header"><h2 class="font-semibold">Progression</h2><span class="text-xs text-muted">Dernière activité il y a 12 s</span></div>
        <div class="p-4">
          ${stages.map(([name,state,meta,ico,tone],index)=>`<div class="relative flex gap-3 pb-5 last:pb-0">${index < stages.length-1 ? '<span class="absolute left-[15px] top-8 h-[calc(100%-22px)] w-px bg-line"></span>' : ""}<span class="relative z-10 grid h-8 w-8 flex-none place-items-center rounded-full border border-line bg-white text-${tone}">${icon(ico,16,ico==="LoaderCircle"?"animate-spin":"")}</span><div class="min-w-0 pt-1"><div class="flex flex-wrap items-center gap-2"><strong class="text-sm">${name}</strong><span class="text-[10px] font-semibold uppercase text-${tone}">${state}</span></div><p class="mt-1 text-xs text-muted">${meta}</p></div></div>`).join("")}
        </div>
      </aside>
      <main class="space-y-4">
        ${panel("Concurrents qualifiés", `
          <div class="overflow-x-auto rounded-lg border border-line"><table class="data-table min-w-[760px]"><thead><tr><th>Concurrent</th><th>Relation</th><th>Positionnement observé</th><th>Source</th><th>Statut</th></tr></thead><tbody>${competitors.map(([name,relation,positioning,source,status])=>`<tr><td class="font-semibold">${name}</td><td>${relation}</td><td class="max-w-md text-xs leading-5 text-muted">${positioning}</td><td class="font-mono text-xs">${source}</td><td>${badge(status,status==="Vérifié"?"success":"warning")}</td></tr>`).join("")}</tbody></table></div>
        `)}
        ${panel("Résultats partiels", `
          <div class="grid gap-3 md:grid-cols-2">${[
            ["Building2","Marché enterprise bien couvert","Les plateformes établies ciblent surtout des programmes de gouvernance IA à grande échelle.","12 sources"],
            ["Boxes","Espace possible sur le mid-market","L’accompagnement initial et la collecte de preuves apparaissent moins standardisés.","8 sources"],
            ["Users","Comité d’achat transverse","Juridique, conformité, data, IT et sécurité participent selon la maturité.","15 sources"],
            ["FileCheck2","Preuve comme angle différenciant","Les inventaires et contrôles sont fréquents, le dossier partageable doit encore être comparé.","7 sources"]
          ].map(([ico,title,text,source])=>`<article class="rounded-lg border border-line p-4"><div class="flex items-start gap-3"><span class="grid h-9 w-9 flex-none place-items-center rounded-lg bg-slate-100 text-navy">${icon(ico,17)}</span><div><strong class="text-sm">${title}</strong><p class="mt-1 text-xs leading-5 text-muted">${text}</p><span class="mt-3 inline-flex font-mono text-[10px] text-brandblue">${source}</span></div></div></article>`).join("")}</div>
        `)}
        ${panel("Journal du deep agent", `
          <div class="space-y-3 font-mono text-[11px]">${[
            ["10:42:18","Evidence Reviewer","Contradiction détectée sur la taille de marché, affirmation écartée."],
            ["10:41:52","ICP Strategist","6 segments candidats regroupés depuis 24 observations."],
            ["10:40:31","Competitor Researcher","Saidot confirmé comme concurrent direct, source officielle ajoutée."],
            ["10:38:07","Product Analyst","Positionnement Preuvio structuré en 18 éléments."]
          ].map(([time,agent,message])=>`<div class="grid gap-1 rounded-lg border border-line bg-canvas p-3 sm:grid-cols-[70px_150px_minmax(0,1fr)]"><span class="text-muted">${time}</span><strong>${agent}</strong><span class="text-muted">${message}</span></div>`).join("")}</div>
        `)}
        <div class="flex flex-col gap-3 rounded-lg border border-signal bg-[#f6ffdf] p-4 sm:flex-row sm:items-center sm:justify-between"><div><strong>Le livrable partiel est consultable</strong><p class="mt-1 text-xs text-signal-ink/80">Les ICP seront encore ajustés après l’audit final des preuves.</p></div><a href="icp-builder.html" class="btn btn-signal">${icon("FileSearch")}Ouvrir le rapport partiel</a></div>
      </main>
    </div>`;
}
