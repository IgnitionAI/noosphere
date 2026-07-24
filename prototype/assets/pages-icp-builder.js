import { icon, badge, button, pageHeader, panel } from "./core.js";

const sourceCards = [
  ["S01","OneTrust · AI Governance","Source officielle","Inventaire central, ownership et contrôles sur le cycle de vie IA.","onetrust.com/solutions/ai-governance","success"],
  ["S02","Holistic AI · Platform","Source officielle","Découverte, évaluation, monitoring et gouvernance IA à l’échelle enterprise.","holisticai.com","success"],
  ["S03","Credo AI · Product","Source officielle","Gouvernance des agents, modèles et applications avec suivi du cycle de vie.","credo.ai/product","success"],
  ["S04","Saidot · Product","Source officielle","Graphe de risques, politiques et contrôles pour gouverner les systèmes IA.","saidot.ai/product","success"],
  ["D01","Description fournie · Preuvio","Document interne","Registre opérationnel, risques et collecte de preuves pour la gouvernance.","Brief de mission","blue"]
];

const icpOptions = [
  ["ICP principal","PME et ETI déjà utilisatrices d’IA","Fort","78 %"],
  ["ICP secondaire","Cabinets de conseil et intégrateurs","Moyen","64 %"],
  ["ICP exploratoire","Professions juridiques structurées","À valider","51 %"]
];

function evidenceRef(id) {
  return `<button type="button" class="evidence-ref" data-evidence="${id}" aria-label="Voir la preuve ${id}">${id}</button>`;
}

export function icpBuilderPage() {
  return `
    ${pageHeader("Rapport ICP · Preuvio", "Proposition produite par le deep agent à partir des concurrents, sources publiques et informations fournies.", `${button("Relancer une recherche","Search","","data-toast='Nouvelle instruction de recherche ouverte'")}${button("Publier l’ICP principal","CheckCircle2","primary","data-toast='ICP principal publié en version 1'")}`)}
    <div class="mb-5 flex flex-wrap items-center gap-2">${badge("Livrable v1","blue")}${badge("Audit des preuves terminé","success")}${badge("47 sources consultées")}${badge("5 concurrents retenus")}</div>

    <div class="grid items-start gap-5 xl:grid-cols-[220px_minmax(0,1fr)_330px]">
      <aside class="panel hidden p-3 xl:block xl:sticky xl:top-20">
        <div class="mb-3 px-2 text-xs font-semibold uppercase tracking-wide text-muted">Sommaire</div>
        <nav class="space-y-1 text-xs" aria-label="Sections du rapport">
          ${[
            ["Synthèse","FileText"],["Concurrents","TableProperties"],["ICP proposés","Target"],["ICP principal","Building2"],["Comité d’achat","Users"],["Problèmes & signaux","Radar"],["Exclusions","ShieldX"],["Inconnues","CircleHelp"]
          ].map(([label,ico],index)=>`<a href="#report-${index}" class="flex items-center gap-2 rounded-lg px-3 py-2 font-semibold ${index===0?"bg-slate-100 text-navy":"text-muted hover:bg-slate-50 hover:text-ink"}">${icon(ico,15)}${label}</a>`).join("")}
        </nav>
        <a href="research-progress.html" class="btn mt-4 w-full">${icon("Activity")}Voir la recherche</a>
      </aside>

      <main class="min-w-0 space-y-4">
        <section class="panel" id="report-0">
          <div class="panel-header"><h2 class="font-semibold">Synthèse exécutive</h2>${badge("Confiance élevée","success")}</div>
          <div class="panel-body">
            <p class="max-w-prose text-sm leading-7" contenteditable="true" data-pretext>Preuvio semble mieux différencié lorsqu’il est présenté comme une première couche opérationnelle de gouvernance IA pour les organisations qui ont déjà des usages, mais pas encore de programme enterprise structuré. Les concurrents étudiés couvrent fortement l’inventaire, le risque et les contrôles à grande échelle. L’opportunité à tester porte sur un démarrage assisté, centré sur la collecte de preuves et un dossier partageable.</p>
            <div class="mt-4 flex flex-wrap gap-2">${evidenceRef("S01")}${evidenceRef("S02")}${evidenceRef("S03")}${evidenceRef("S04")}${evidenceRef("D01")}</div>
            <div class="mt-5 grid gap-3 sm:grid-cols-3">
              <div class="rounded-lg border border-line p-3"><span class="text-xs text-muted">Recommandation</span><strong class="mt-1 block">Cibler le mid-market actif sur l’IA</strong></div>
              <div class="rounded-lg border border-line p-3"><span class="text-xs text-muted">Angle différenciant</span><strong class="mt-1 block">Preuves prêtes à partager</strong></div>
              <div class="rounded-lg border border-line p-3"><span class="text-xs text-muted">Risque principal</span><strong class="mt-1 block">Budget et urgence à valider</strong></div>
            </div>
          </div>
        </section>

        ${panel("Carte concurrentielle", `
          <div id="report-1" class="overflow-x-auto rounded-lg border border-line"><table class="data-table min-w-[760px]"><thead><tr><th>Acteur</th><th>Segment apparent</th><th>Promesse observée</th><th>Relation</th><th>Preuve</th></tr></thead><tbody>${[
            ["OneTrust","Enterprise","Gouvernance IA intégrée à une plateforme trust","Direct",evidenceRef("S01")],
            ["Holistic AI","Enterprise","Découvrir, évaluer, surveiller et gouverner l’IA","Direct",evidenceRef("S02")],
            ["Credo AI","Enterprise régulé","Gouverner agents, modèles et applications","Direct",evidenceRef("S03")],
            ["Saidot","Mid-market / Enterprise","Gouvernance guidée par graphe de risques et contrôles","Direct",evidenceRef("S04")],
            ["Tableurs + conseil","PME / ETI","Registre et preuves assemblés manuellement","Alternative","À confirmer"]
          ].map(row=>`<tr>${row.map((cell,index)=>`<td class="${index===0?"font-semibold":index===2?"text-xs leading-5 text-muted":""}">${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
          <p class="mt-3 text-xs text-muted">Les segments sont inférés depuis les positionnements observés. Ils ne prouvent pas la composition réelle du portefeuille client.</p>
        `)}

        <section class="panel" id="report-2">
          <div class="panel-header"><div><h2 class="font-semibold">ICP proposés</h2><p class="mt-1 text-xs text-muted">Classés par cohérence produit et qualité des preuves.</p></div>${badge("3 propositions","signal")}</div>
          <div class="panel-body grid gap-3 lg:grid-cols-3" data-icp-proposals>
            ${icpOptions.map(([rank,name,confidence,score],index)=>`<button type="button" class="icp-proposal ${index===0?"icp-proposal-active":""}" data-icp-proposal aria-pressed="${index===0}"><span class="flex items-center justify-between gap-2">${badge(rank,index===0?"signal":"")}<strong class="font-mono text-sm">${score}</strong></span><strong class="mt-4 block text-left">${name}</strong><span class="mt-2 block text-left text-xs text-muted">Confiance ${confidence.toLowerCase()}</span></button>`).join("")}
          </div>
        </section>

        <section class="panel" id="report-3">
          <div class="panel-header"><div><div class="text-xs font-semibold uppercase tracking-wide text-muted">Recommandation principale</div><h2 class="mt-1 text-lg font-semibold">PME et ETI déjà utilisatrices d’IA</h2></div>${badge("78 %","signal")}</div>
          <div class="panel-body">
            <div class="grid gap-4 md:grid-cols-2">
              ${[
                ["Géographie","France, puis Europe francophone","D01"],
                ["Taille","50 à 2 000 employés","D01"],
                ["Maturité","Plusieurs usages GenAI déjà actifs","D01"],
                ["Contexte","Gouvernance encore dispersée","S01"],
                ["Type d’achat","SaaS accompagné ou audit initial","D01"],
                ["Priorité","Revue client, audit ou comité à venir","Hypothèse"]
              ].map(([key,value,source])=>`<div class="rounded-lg border border-line p-3"><span class="text-xs text-muted">${key}</span><strong class="mt-1 block" contenteditable="true">${value}</strong><div class="mt-2">${source.startsWith("S")||source.startsWith("D")?evidenceRef(source):badge(source,"warning")}</div></div>`).join("")}
            </div>
          </div>
        </section>

        ${panel("Comité d’achat", `
          <div id="report-4" class="grid gap-3 md:grid-cols-2">${[
            ["CEO / Direction générale","Sponsor économique","Veut réduire le risque sans lancer un programme lourd."],
            ["DSI / CTO","Décideur technique","Valide les accès, intégrations et responsabilités."],
            ["Head of AI / Data","Champion","Porte les usages et cherche à accélérer leur validation."],
            ["Compliance / DPO","Influenceur risque","Évalue les preuves, obligations et données exposées."]
          ].map(([persona,role,need])=>`<article class="rounded-lg border border-line p-4"><div class="flex items-start gap-3"><span class="grid h-9 w-9 flex-none place-items-center rounded-lg bg-slate-100 text-navy">${icon("UserRound",17)}</span><div><strong>${persona}</strong><span class="mt-1 block text-xs font-semibold text-brandblue">${role}</span><p class="mt-2 text-xs leading-5 text-muted">${need}</p></div></div></article>`).join("")}</div>
        `)}

        ${panel("Problèmes et signaux", `
          <div id="report-5" class="grid gap-5 md:grid-cols-2"><div><h3 class="text-xs font-semibold uppercase tracking-wide text-muted">Problèmes probables</h3><ul class="mt-3 space-y-3">${[
            "Usages IA dispersés et ownership incomplet",
            "Données et accès difficiles à cartographier",
            "Preuves longues à réunir pour une revue",
            "Outils enterprise perçus comme trop lourds"
          ].map(item=>`<li class="flex gap-2 text-sm">${icon("CircleDot",14,"mt-1 text-brandblue")}<span>${item}</span></li>`).join("")}</ul></div><div><h3 class="text-xs font-semibold uppercase tracking-wide text-muted">Signaux à tester</h3><ul class="mt-3 space-y-3">${[
            "Lancement d’un Copilot, RAG ou agent interne",
            "Questionnaire assurance d’un client enterprise",
            "Audit, revue sécurité ou comité de direction",
            "Recrutement AI, Data, DPO ou Compliance"
          ].map(item=>`<li class="flex gap-2 text-sm">${icon("Radar",14,"mt-1 text-success")}<span>${item}</span></li>`).join("")}</ul></div></div>
          <div class="mt-4 flex flex-wrap gap-2">${evidenceRef("S01")}${evidenceRef("D01")}${badge("Signaux à valider","warning")}</div>
        `)}

        ${panel("Exclusions et inconnues", `
          <div class="grid gap-4 md:grid-cols-2"><div id="report-6"><h3 class="text-xs font-semibold uppercase tracking-wide text-muted">Exclure ou déprioriser</h3><ul class="mt-3 space-y-2 text-sm"><li>• Aucun usage IA actif ou prévu</li><li>• Besoin limité à une formation générale</li><li>• Programme GRC/AI governance déjà mature</li><li>• Structure sans owner technique ou métier</li></ul></div><div id="report-7"><h3 class="text-xs font-semibold uppercase tracking-wide text-muted">Encore inconnu</h3><ul class="mt-3 space-y-2 text-sm"><li>• Budget minimal réellement disponible</li><li>• Urgence moyenne du problème</li><li>• Taux d’usage mensuel attendu</li><li>• Segment au meilleur cycle de vente</li></ul></div></div>
          <div class="mt-4 rounded-lg border border-warning/30 bg-amber-50 p-3 text-xs leading-5 text-warning">${icon("TriangleAlert",15,"mr-2 inline")}Ces inconnues doivent être validées par des conversations marché, pas complétées automatiquement par le modèle.</div>
        `)}
      </main>

      <aside class="space-y-4 xl:sticky xl:top-20">
        <section class="panel">
          <div class="panel-header"><h2 class="font-semibold">Preuves</h2>${badge("5 visibles","success")}</div>
          <div class="p-3 space-y-2">${sourceCards.map(([id,title,type,excerpt,url,tone],index)=>`<button type="button" class="source-card ${index===0?"source-card-active":""}" data-source-card data-source-id="${id}"><span class="flex items-center justify-between gap-2"><strong class="font-mono text-[10px] text-brandblue">${id}</strong>${badge(type,tone)}</span><strong class="mt-2 block text-left text-xs">${title}</strong><span class="mt-2 block text-left text-[11px] leading-5 text-muted">${excerpt}</span><span class="mt-2 block truncate text-left font-mono text-[10px] text-muted">${url}</span></button>`).join("")}</div>
        </section>
        <section class="rounded-xl border border-signal bg-[#f6ffdf] p-4">
          <div class="flex gap-3"><span class="grid h-9 w-9 flex-none place-items-center rounded-lg bg-signal text-signal-ink">${icon("ShieldCheck",17)}</span><div><strong class="text-sm">Evidence Reviewer</strong><p class="mt-1 text-xs leading-5 text-signal-ink/80">4 affirmations ont été reformulées et 2 chiffres non confirmés ont été retirés du rapport.</p></div></div>
        </section>
      </aside>
    </div>`;
}

export function initIcpBuilder() {
  document.querySelectorAll("[data-icp-proposal]").forEach(option => option.addEventListener("click", () => {
    document.querySelectorAll("[data-icp-proposal]").forEach(item => {
      item.classList.toggle("icp-proposal-active", item === option);
      item.setAttribute("aria-pressed", String(item === option));
    });
  }));
  document.querySelectorAll("[data-source-card]").forEach(card => card.addEventListener("click", () => {
    document.querySelectorAll("[data-source-card]").forEach(item => item.classList.toggle("source-card-active", item === card));
    document.querySelector(`[data-evidence="${card.dataset.sourceId}"]`)?.scrollIntoView({ behavior:"smooth", block:"center" });
  }));
  document.querySelectorAll("[data-evidence]").forEach(reference => reference.addEventListener("click", () => {
    const card = document.querySelector(`[data-source-id="${reference.dataset.evidence}"]`);
    document.querySelectorAll("[data-source-card]").forEach(item => item.classList.remove("source-card-active"));
    card?.scrollIntoView({ behavior:"smooth", block:"center" });
    card?.classList.add("source-card-active");
  }));
}
