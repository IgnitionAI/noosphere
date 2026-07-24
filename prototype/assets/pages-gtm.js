import { companies, prospects } from "./data.js";
import { icon, badge, button, pageHeader, metric, panel, scoreRing } from "./core.js";

const detectedSegments = [
  ["Scale", "Cabinets d’avocats", "Structurer les usages IA, les accès et les preuves pour les dossiers clients."],
  ["Landmark", "Directions juridiques internes", "Piloter les risques et répondre aux exigences internes de gouvernance."],
  ["Stamp", "Études notariales", "Documenter les outils utilisés sur des données et actes sensibles."],
  ["BookOpenText", "Éditeurs juridiques", "Encadrer les produits enrichis par IA et la provenance des contenus."],
  ["BriefcaseBusiness", "Cabinets de conseil", "Rassurer les clients sur les usages IA intégrés aux missions."],
  ["ShieldCheck", "Équipes conformité de PME", "Centraliser le registre, les risques et les preuves sans déployer un GRC lourd."]
];

function segmentOption([ico, name, rationale]) {
  return `<article class="segment-option segment-option-selected" data-icp-segment>
    <button type="button" class="segment-toggle" aria-pressed="true" aria-label="Écarter ${name}">
      <span class="segment-check">${icon("Check",15)}</span>
    </button>
    <span class="grid h-10 w-10 flex-none place-items-center rounded-lg bg-slate-100 text-navy">${icon(ico,18)}</span>
    <span class="min-w-0 flex-1">
      <span class="segment-name" contenteditable="true" data-pretext>${name}</span>
      <span class="mt-1 block text-xs leading-5 text-muted">${rationale}</span>
    </span>
    <button type="button" class="btn icon-btn btn-ghost h-8 w-8 flex-none" data-remove-segment aria-label="Supprimer ${name}">${icon("X",15)}</button>
  </article>`;
}

export function productReadingPage() {
  return `
    <div class="mb-5 flex flex-wrap items-center gap-2 text-xs font-semibold text-muted">
      <span class="inline-flex items-center gap-2 text-success">${icon("CheckCircle2",15)}Produit</span>
      <span class="h-px w-7 bg-line"></span>
      <span class="inline-flex items-center gap-2 text-navy"><span class="grid h-5 w-5 place-items-center rounded-full bg-navy text-[10px] text-white">2</span>Segments</span>
      <span class="h-px w-7 bg-line"></span>
      <span class="inline-flex items-center gap-2"><span class="grid h-5 w-5 place-items-center rounded-full border border-line bg-white text-[10px]">3</span>Affiner</span>
    </div>
    ${pageHeader("Trouver votre ICP", "Décrivez le produit. Nous suggérons les types d’organisations qui pourraient l’acheter.")}
    <div class="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
      <aside class="space-y-4">
        <section class="panel">
          <div class="panel-header"><div><div class="text-xs font-semibold uppercase tracking-wide text-muted">Produit analysé</div><h2 class="mt-1 font-semibold">Preuvio</h2></div>${badge("Terminé","success")}</div>
          <div class="panel-body space-y-4">
            <label><span class="label">Site du produit</span><div class="relative">${icon("Globe2",16,"absolute left-3 top-2.5 text-muted")}<input class="input pl-9" value="https://preuvio.com" aria-label="Site du produit"></div></label>
            <label><span class="label">Description</span><textarea class="textarea min-h-[124px]">Registre opérationnel des usages IA, cartographie des risques et collecte de preuves pour préparer les revues de gouvernance.</textarea></label>
            <button type="button" class="btn w-full" data-run-product-analysis data-toast="Analyse relancée · les corrections sont conservées">${icon("RefreshCw")}Relancer l’analyse</button>
          </div>
        </section>
        <section class="rounded-xl border border-signal/70 bg-[#f6ffdf] p-4">
          <div class="flex items-start gap-3">
            <span class="grid h-9 w-9 flex-none place-items-center rounded-lg bg-signal text-signal-ink">${icon("Lightbulb",18)}</span>
            <div><strong class="text-sm">Un premier tri, pas une vérité</strong><p class="mt-1 text-xs leading-5 text-signal-ink/80">Retenez les marchés intéressants. Vous préciserez ensuite la taille, les rôles et les signaux pour chacun.</p></div>
          </div>
        </section>
      </aside>
      <section class="panel overflow-hidden">
        <div class="panel-header items-start">
          <div><div class="flex items-center gap-2"><h2 class="font-semibold">Segments détectés</h2>${badge("6 suggestions","signal")}</div><p class="mt-1 text-xs text-muted">Tous sont sélectionnés. Cliquez sur la coche pour écarter un segment.</p></div>
          <div class="text-right"><strong class="font-mono text-xl"><span data-segment-count>6</span>/6</strong><span class="block text-[10px] uppercase tracking-wide text-muted">retenus</span></div>
        </div>
        <div class="panel-body">
          <div class="grid gap-3 lg:grid-cols-2" data-segment-list>
            ${detectedSegments.map(segmentOption).join("")}
          </div>
          <form class="mt-4 flex flex-col gap-2 rounded-lg border border-dashed border-line bg-canvas p-3 sm:flex-row" data-add-segment-form>
            <div class="relative min-w-0 flex-1">${icon("Plus",16,"absolute left-3 top-2.5 text-muted")}<input class="input pl-9" data-add-segment-input placeholder="Ajouter un autre segment…" aria-label="Nouveau segment"></div>
            <button type="submit" class="btn">Ajouter</button>
          </form>
        </div>
        <footer class="flex flex-col gap-3 border-t border-line bg-slate-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p class="text-xs text-muted"><strong class="text-ink">Étape suivante :</strong> préciser les entreprises et décideurs de chaque segment.</p>
          <a href="icp-builder.html" class="btn btn-primary" data-deepen-segments>${icon("ArrowRight")}Approfondir les 6 segments</a>
        </footer>
      </section>
    </div>`;
}

export function initProductReading() {
  const list = document.querySelector("[data-segment-list]");
  const deepen = document.querySelector("[data-deepen-segments]");
  const form = document.querySelector("[data-add-segment-form]");
  const input = document.querySelector("[data-add-segment-input]");
  if (!list || !deepen) return;

  const refresh = () => {
    const options = [...list.querySelectorAll("[data-icp-segment]")];
    const selected = options.filter(option => option.classList.contains("segment-option-selected")).length;
    const count = document.querySelector("[data-segment-count]");
    if (count) {
      count.textContent = String(selected);
      count.nextSibling.textContent = `/${options.length}`;
    }
    const label = selected ? `Approfondir ${selected === 1 ? "ce segment" : `les ${selected} segments`}` : "Sélectionnez un segment";
    deepen.innerHTML = `${icon("ArrowRight")}${label}`;
    deepen.setAttribute("aria-disabled", selected ? "false" : "true");
    deepen.classList.toggle("pointer-events-none", !selected);
    deepen.classList.toggle("opacity-50", !selected);
    window.lucide?.createIcons();
  };

  list.addEventListener("click", event => {
    const option = event.target.closest("[data-icp-segment]");
    if (!option || event.target.closest("[contenteditable]")) return;
    if (event.target.closest("[data-remove-segment]")) {
      option.remove();
      refresh();
      return;
    }
    if (!event.target.closest(".segment-toggle")) return;
    option.classList.toggle("segment-option-selected");
    const pressed = option.classList.contains("segment-option-selected");
    option.querySelector(".segment-toggle")?.setAttribute("aria-pressed", String(pressed));
    refresh();
  });

  form?.addEventListener("submit", event => {
    event.preventDefault();
    const value = input?.value.trim();
    if (!value) return;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = segmentOption(["Target", value, "Segment ajouté manuellement, à approfondir."]);
    list.append(wrapper.firstElementChild);
    input.value = "";
    refresh();
    window.lucide?.createIcons();
  });
}

export function offersPage() {
  const offers=[
    ["IgnitionRAG Entreprise","Service + licence","v3","Publié","3 campagnes","45–120 k€"],
    ["Audit architecture GenAI","Service","v2","Publié","1 campagne","12 k€"],
    ["Agents métiers multi-départements","Service + SaaS","v1","Publié","1 campagne","60–180 k€"],
    ["Formation gouvernance IA","Service","v1","Brouillon","0 campagne","8–20 k€"]
  ];
  return `
    ${pageHeader("Offres", "Versionnez ce que vous vendez, les preuves autorisées et les limites commerciales.", button("Nouvelle offre","Plus","primary"))}
    <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section class="panel overflow-hidden"><div class="table-wrap"><table class="data-table"><thead><tr><th>Offre</th><th>Version</th><th>Statut</th><th>Campagnes</th><th>Valeur</th><th></th></tr></thead><tbody>${offers.map(([name,type,v,status,camps,value],i)=>`<tr><td><div class="flex items-center gap-3"><span class="grid h-9 w-9 place-items-center rounded-lg ${i===0?"bg-signal text-signal-ink":"bg-slate-100"}">${icon("Package",17)}</span><div><div class="font-semibold">${name}</div><div class="text-xs text-muted">${type}</div></div></div></td><td>${badge(v)}</td><td>${badge(status,status==="Publié"?"success":"warning")}</td><td>${camps}</td><td class="font-mono text-xs">${value}</td><td><button class="btn icon-btn">${icon("ChevronRight")}</button></td></tr>`).join("")}</tbody></table></div></section>
      <aside class="space-y-4">${panel("IgnitionRAG Entreprise · v3", `<div class="flex gap-2">${badge("Publié","success")}${badge("Immuable")}</div><p class="mt-4 text-sm leading-6">Déployer des assistants RAG gouvernés, traçables et intégrables au SI dans des environnements sensibles.</p><div class="mt-5 space-y-3 text-xs">${[["Type","Service + licence"],["Cible","ETI 500–5 000"],["Valeur","45–120 k€"],["Claims validés","8 / 8"],["Preuves","5 documents"]].map(([k,v])=>`<div class="flex justify-between border-b border-line pb-2"><span class="text-muted">${k}</span><strong>${v}</strong></div>`).join("")}</div><button class="btn mt-5 w-full">${icon("Copy")}Créer une nouvelle version</button>`)}
      ${panel("Claims autorisés", `<div class="space-y-2">${["Déploiement en environnement privé","Contrôle d’accès par collection","Traçabilité des sources","Intégration au SI existant"].map(x=>`<div class="flex items-start gap-2 text-xs">${icon("CheckCircle2",14,"mt-0.5 text-success")}<span>${x}</span></div>`).join("")}</div><button class="mt-4 text-xs font-semibold text-brandblue">Voir les 8 claims</button>`)}</aside>
    </div>`;
}

export function icpsPage() {
  const criteria=[
    ["Taille entreprise","500 à 5 000 employés","+18","Inclusion"],
    ["Géographie","France","+8","Inclusion"],
    ["Poste","CTO, Head of Data, CDO","+24","Inclusion"],
    ["Maturité","POC IA ou plateforme data","+16","Inclusion"],
    ["Signal","Recrutement IA, levée, gouvernance","+22","Boost"],
    ["Agence / ESN concurrente","Oui","—100","Exclusion"]
  ];
  return `
    ${pageHeader("ICP", "Définissez qui cibler, qui exclure et les signaux qui changent la priorité.", `${button("Comparer les versions","GitCompare")}${button("Nouvel ICP","Plus","primary")}`)}
    <div class="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_320px]">
      <aside class="panel p-3"><div class="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">ICP publiés</div>${[["CTO / Head of Data · ETI France","v4","Actif"],["DSI · Industrie régulée","v2","Actif"],["Fondateurs SaaS B2B","v1","Pause"]].map(([name,v,status],i)=>`<button class="mb-2 w-full rounded-lg border p-3 text-left ${i===0?"border-navy bg-slate-50":"border-line"}"><div class="flex justify-between gap-2"><strong class="text-sm">${name}</strong>${badge(v)}</div><div class="mt-2 text-xs text-muted">${status}</div></button>`).join("")}${button("Dupliquer l’ICP","Copy","","style='width:100%'")}</aside>
      <section class="panel"><div class="panel-header"><div><h2 class="font-semibold">CTO / Head of Data · ETI France</h2><p class="mt-1 text-xs text-muted">Version 4 · publiée le 14 juillet</p></div>${badge("Immuable","success")}</div><div class="panel-body"><p class="rounded-lg border border-line bg-canvas p-3 text-sm leading-6">Décideurs techniques d’ETI françaises qui doivent industrialiser des usages GenAI, avec un signal récent lié à l’équipe, au financement ou à la gouvernance.</p><div class="mt-5 overflow-hidden rounded-lg border border-line"><table class="data-table min-w-0"><thead><tr><th>Dimension</th><th>Valeur</th><th>Poids</th><th>Règle</th></tr></thead><tbody>${criteria.map(([d,v,w,r])=>`<tr><td class="font-semibold">${d}</td><td>${v}</td><td class="font-mono text-xs">${w}</td><td>${badge(r,r==="Exclusion"?"danger":r==="Boost"?"signal":"")}</td></tr>`).join("")}</tbody></table></div><button class="btn mt-5">${icon("Copy")}Créer v5 depuis cette version</button></div></section>
      <aside class="space-y-4">${panel("Population estimée", `<div class="font-mono text-3xl font-semibold">4 820</div><p class="mt-1 text-xs text-muted">profils accessibles avant enrichissement</p><div class="mt-4 progress"><span style="width:72%;background:var(--signal)"></span></div><div class="mt-3 text-xs text-muted">327 avec un signal fort récent</div>`)}
      ${panel("Performance observée", `<div class="space-y-3 text-xs">${[["Réponse","24,5 %"],["Positive","11,8 %"],["Rendez-vous","3,7 %"],["Pipeline attribué","127 k€"]].map(([k,v])=>`<div class="flex justify-between border-b border-line pb-2"><span class="text-muted">${k}</span><strong class="font-mono">${v}</strong></div>`).join("")}</div>`)}</aside>
    </div>`;
}

export function discoverPage() {
  return `
    <div class="mb-5"><a href="prospects.html" class="inline-flex items-center gap-2 text-xs font-semibold text-muted">${icon("ArrowLeft",14)}Retour aux prospects</a></div>
    ${pageHeader("Trouver des prospects", "Décrivez la cible ou partez d’un ICP publié. L’IA explique chaque sélection.", `${button("Enregistrer la recherche","Save")}${button("Lancer la recherche","Radar","primary")}`)}
    <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section class="space-y-4">
        ${panel("1. Point de départ", `<div class="grid gap-3 md:grid-cols-2"><label><span class="label">ICP</span><select class="select"><option>CTO / Head of Data · ETI France · v4</option></select></label><label><span class="label">Offre</span><select class="select"><option>IgnitionRAG Entreprise · v3</option></select></label></div>`)}
        ${panel("2. Sources et signaux", `<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">${[
          ["Search","Recherche dans la cible","Canal principal",true],["ThumbsUp","Interactions concurrent","Likes et commentaires",true],["BriefcaseBusiness","Changements de poste","90 derniers jours",true],["TrendingUp","Levées de fonds","12 derniers mois",true],["Users","Recrutements","Data, IA, plateforme",true],["Eye","Visites du profil","Compte LinkedIn",false]
        ].map(([ico,title,meta,on])=>`<label class="rounded-lg border p-3 ${on?"border-navy bg-slate-50":"border-line"}"><div class="flex items-start justify-between gap-2"><span class="grid h-8 w-8 place-items-center rounded-lg ${on?"bg-navy text-white":"bg-slate-100"}">${icon(ico,16)}</span><input type="checkbox" ${on?"checked":""} class="accent-navy"></div><strong class="mt-3 block text-sm">${title}</strong><span class="mt-1 block text-xs text-muted">${meta}</span></label>`).join("")}</div>`)}
        ${panel("3. Ajustement en langage naturel", `<label><span class="label">Ce que vous cherchez précisément</span><textarea class="textarea">Prioriser les CTO et Head of Data qui recrutent une équipe IA ou parlent de gouvernance. Exclure les agences, cabinets de conseil et entreprises de moins de 500 salariés.</textarea></label><div class="mt-3 flex items-center gap-2 text-xs text-success">${icon("CheckCircle2",15)}Les critères sont compatibles avec l’ICP v4.</div>`)}
      </section>
      <aside class="space-y-4">${panel("Estimation", `<div class="grid grid-cols-2 gap-3"><div><div class="text-xs text-muted">Profils trouvés</div><div class="mt-1 font-mono text-2xl font-semibold">386</div></div><div><div class="text-xs text-muted">Score ≥ 80</div><div class="mt-1 font-mono text-2xl font-semibold">94</div></div><div><div class="text-xs text-muted">Emails probables</div><div class="mt-1 font-mono text-2xl font-semibold">71</div></div><div><div class="text-xs text-muted">Coût estimé</div><div class="mt-1 font-mono text-2xl font-semibold">18 €</div></div></div>`)}
      ${panel("Échantillon", `<div class="space-y-3">${prospects.slice(0,3).map(p=>`<div class="flex items-center gap-3"><span class="avatar">${p.initials}</span><span class="min-w-0 flex-1"><strong class="block truncate text-xs">${p.name}</strong><span class="block truncate text-[11px] text-muted">${p.title} · ${p.company}</span></span>${scoreRing(p.score)}</div>`).join("")}</div><a href="prospects.html" class="mt-4 block text-xs font-semibold text-brandblue">Prévisualiser les 94 profils</a>`)}</aside>
    </div>`;
}

export function companyDetailPage() {
  const c=companies[0];
  return `
    <div class="mb-5"><a href="companies.html" class="inline-flex items-center gap-2 text-xs font-semibold text-muted">${icon("ArrowLeft",14)}Retour aux entreprises</a></div>
    ${pageHeader(c.name, `${c.industry} · ${c.size} employés · ${c.city}`, `${button("Enrichir","RefreshCw")}${button("Trouver des contacts","UserSearch","primary")}`)}
    <section class="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">${metric("Fit ICP","96 / 100","Prioritaire")}${metric("Contacts connus","4","2 décideurs")}${metric("Signaux actifs","3","+1 cette semaine")}${metric("Pipeline","0 €","Pas encore d’opp.")}</section>
    <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div class="space-y-4">${panel("Signaux récents", `<div class="space-y-3">${[["Recrutement","8 postes Data & IA ouverts","23 juil.","signal"],["Technologie","Migration d’une partie de la stack vers Azure AI","18 juil.","blue"],["Croissance","Ouverture d’un bureau à Lyon","2 juil.",""]].map(([type,title,date,tone])=>`<div class="flex items-start gap-3 rounded-lg border border-line p-3"><span class="grid h-9 w-9 place-items-center rounded-lg ${tone==="signal"?"bg-signal":tone==="blue"?"bg-indigo-50 text-brandblue":"bg-slate-100"}">${icon(type==="Recrutement"?"Users":type==="Technologie"?"Cpu":"TrendingUp",17)}</span><span class="flex-1"><strong>${title}</strong><span class="mt-1 block text-xs text-muted">${type} · ${date} · source vérifiée</span></span></div>`).join("")}</div>`)}
      ${panel("Contacts clés", `<div class="table-wrap"><table class="data-table min-w-0"><thead><tr><th>Contact</th><th>Score</th><th>Relation</th><th>Statut</th></tr></thead><tbody>${prospects.slice(0,4).map((p,i)=>`<tr><td><div class="identity"><span class="avatar">${p.initials}</span><span><span class="identity-name">${p.name}</span><span class="identity-meta">${p.title}</span></span></div></td><td>${scoreRing(p.score-i*4)}</td><td>${["Décideur","Champion potentiel","Influenceur","Utilisateur"][i]}</td><td>${badge(p.status,i===2?"success":"")}</td></tr>`).join("")}</tbody></table></div>`)}
      </div>
      <aside class="space-y-4">${panel("Informations", `<div class="space-y-3 text-xs">${[["Domaine",c.domain],["LinkedIn","linkedin.com/company/finovox"],["Secteur",c.industry],["Taille",c.size],["Pays","France"],["Technologies","Azure, Databricks, OpenAI"]].map(([k,v])=>`<div class="flex justify-between gap-3 border-b border-line pb-2"><span class="text-muted">${k}</span><strong class="text-right">${v}</strong></div>`).join("")}</div>`)}
      ${panel("Action recommandée", `<p class="text-sm leading-6 text-muted">Approcher Claire Martin sur la gouvernance des nouveaux assistants, puis identifier le responsable plateforme data.</p><button class="btn btn-signal mt-4 w-full">${icon("Sparkles")}Préparer l’approche</button>`)}</aside>
    </div>`;
}
