import { icon, badge, button, pageHeader, panel } from "./core.js";

const segments = [
  ["Cabinets d’avocats", "En cours", "Scale"],
  ["Directions juridiques internes", "À faire", "Landmark"],
  ["Études notariales", "À faire", "Stamp"],
  ["Éditeurs juridiques", "À faire", "BookOpenText"],
  ["Cabinets de conseil", "À faire", "BriefcaseBusiness"],
  ["Équipes conformité de PME", "À faire", "ShieldCheck"]
];

const personaChoices = [
  ["Associé gérant", "Décideur économique"],
  ["Responsable innovation", "Champion métier"],
  ["DSI / Responsable IT", "Validation technique"],
  ["DPO / Compliance", "Influenceur risque"],
  ["Knowledge manager", "Utilisateur clé"]
];

const signalChoices = [
  ["Bot", "Déploiement récent d’un outil IA"],
  ["ClipboardCheck", "Questionnaire client ou audit fournisseur"],
  ["ShieldAlert", "Revue sécurité, RGPD ou AI Act"],
  ["Users", "Recrutement innovation, data ou conformité"],
  ["FileWarning", "Difficulté à rassembler les preuves"],
  ["Landmark", "Demande du comité de direction"]
];

const segmentDetails = {
  "Cabinets d’avocats": ["Cabinets d’avocats qui utilisent ou évaluent des outils d’IA et doivent documenter leurs usages, leurs accès aux données et leurs preuves de gouvernance.", "Cabinet d’avocats", "10 à 250 personnes"],
  "Directions juridiques internes": ["Équipes juridiques d’entreprises qui encadrent des usages IA internes ou évaluent les risques de fournisseurs intégrant de l’IA.", "Direction juridique interne", "250 à 5 000 employés"],
  "Études notariales": ["Études notariales qui utilisent des outils d’IA sur des documents sensibles et doivent clarifier les accès, validations et responsabilités.", "Étude notariale", "10 à 250 personnes"],
  "Éditeurs juridiques": ["Éditeurs qui intègrent l’IA dans la recherche, la rédaction ou l’enrichissement de contenus juridiques.", "Éditeur juridique", "50 à 1 000 employés"],
  "Cabinets de conseil": ["Cabinets qui utilisent l’IA dans leurs missions et doivent rassurer leurs clients sur les données, outils et contrôles.", "Cabinet de conseil", "10 à 500 personnes"],
  "Équipes conformité de PME": ["Responsables conformité de PME qui doivent établir un premier registre IA et réunir des preuves sans plateforme GRC lourde.", "PME avec équipe conformité", "50 à 2 000 employés"]
};

function segmentButton([name, state, ico], index) {
  return `<button type="button" class="builder-segment ${index === 0 ? "builder-segment-active" : ""}" data-builder-segment data-segment-name="${name}">
    <span class="grid h-8 w-8 flex-none place-items-center rounded-lg ${index === 0 ? "bg-navy text-white" : "bg-slate-100 text-navy"}">${icon(ico,15)}</span>
    <span class="min-w-0 flex-1 text-left"><strong class="block truncate text-xs">${name}</strong><span class="mt-1 block text-[10px] ${index === 0 ? "text-brandblue" : "text-muted"}" data-segment-state>${state}</span></span>
    ${index === 0 ? icon("ChevronRight",14,"text-muted") : ""}
  </button>`;
}

function personaOption([name, role], index) {
  return `<label class="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 hover:bg-slate-50">
    <input type="checkbox" ${index < 4 ? "checked" : ""} class="mt-0.5 accent-navy">
    <span><strong class="block text-sm">${name}</strong><span class="mt-1 block text-xs text-muted">${role}</span></span>
  </label>`;
}

function signalOption([ico, label], index) {
  return `<button type="button" class="criteria-chip ${index < 4 ? "criteria-chip-active" : ""}" data-toggle-criterion aria-pressed="${index < 4}">
    ${icon(ico,15)}<span>${label}</span>
  </button>`;
}

export function icpBuilderPage() {
  return `
    <div class="mb-5 flex flex-wrap items-center gap-2 text-xs font-semibold text-muted">
      <span class="inline-flex items-center gap-2 text-success">${icon("CheckCircle2",15)}Produit</span>
      <span class="h-px w-7 bg-line"></span>
      <span class="inline-flex items-center gap-2 text-success">${icon("CheckCircle2",15)}Segments</span>
      <span class="h-px w-7 bg-line"></span>
      <span class="inline-flex items-center gap-2 text-navy"><span class="grid h-5 w-5 place-items-center rounded-full bg-navy text-[10px] text-white">3</span>Affiner</span>
    </div>
    ${pageHeader("Affiner l’ICP", "Précisez les entreprises, les décideurs et les signaux qui rendent ce segment réellement prospectable.", button("Enregistrer le brouillon","Save","","data-toast='Brouillon enregistré'"))}

    <label class="mb-4 block xl:hidden"><span class="label">Segment en cours</span><select class="select" data-mobile-segment>${segments.map(([name], index) => `<option ${index === 0 ? "selected" : ""}>${name}</option>`).join("")}</select></label>

    <div class="grid items-start gap-5 xl:grid-cols-[250px_minmax(0,1fr)_310px]">
      <aside class="panel hidden p-3 xl:block">
        <div class="mb-3 flex items-center justify-between px-1"><span class="text-xs font-semibold uppercase tracking-wide text-muted">6 segments retenus</span><span class="badge"><span data-completed-count>0</span> / 6</span></div>
        <div class="space-y-2">${segments.map(segmentButton).join("")}</div>
        <a href="product-reading.html" class="btn mt-3 w-full">${icon("ArrowLeft")}Modifier les segments</a>
      </aside>

      <main class="min-w-0 space-y-4">
        <section class="panel">
          <div class="panel-header">
            <div><div class="text-xs font-semibold uppercase tracking-wide text-muted">ICP <span data-segment-position>1</span> sur 6</div><h2 class="mt-1 text-lg font-semibold" data-active-segment data-pretext>Cabinets d’avocats</h2></div>
            ${badge("Brouillon","warning")}
          </div>
          <div class="panel-body">
            <label><span class="label">Définition du segment</span><textarea class="textarea min-h-[86px]" data-segment-description>Cabinets d’avocats qui utilisent ou évaluent des outils d’IA et doivent documenter leurs usages, leurs accès aux données et leurs preuves de gouvernance.</textarea></label>
          </div>
        </section>

        ${panel("1. Entreprises à cibler", `
          <div class="grid gap-4 md:grid-cols-2">
            <label><span class="label">Géographie</span><select class="select"><option>France</option><option>France + Belgique + Luxembourg</option><option>Europe francophone</option></select></label>
            <label><span class="label">Taille de la structure</span><select class="select" data-segment-size><option>10 à 250 personnes</option><option>1 à 50 personnes</option><option>50 à 500 personnes</option><option>250 à 5 000 employés</option><option>50 à 1 000 employés</option><option>10 à 500 personnes</option><option>50 à 2 000 employés</option><option>500+ personnes</option></select></label>
            <label><span class="label">Type d’organisation</span><input class="input" value="Cabinet d’avocats" data-segment-type></label>
            <label><span class="label">Maturité recherchée</span><select class="select"><option>Utilise déjà au moins un outil IA</option><option>Évalue actuellement des outils IA</option><option>Projet IA annoncé</option></select></label>
          </div>
          <div class="mt-4"><span class="label">Spécialités prioritaires</span><div class="flex flex-wrap gap-2">${["Droit des affaires","Données & numérique","Social","Fiscal","Contentieux"].map((item,index)=>`<button type="button" class="criteria-chip ${index < 2 ? "criteria-chip-active" : ""}" data-toggle-criterion aria-pressed="${index < 2}">${item}</button>`).join("")}</div></div>
        `)}

        ${panel("2. Décideurs et influenceurs", `
          <p class="mb-4 text-xs text-muted">Sélectionnez les rôles qui participent réellement à l’achat ou à la validation.</p>
          <div class="grid gap-3 md:grid-cols-2">${personaChoices.map(personaOption).join("")}</div>
          <button type="button" class="btn mt-4" data-toast="Ajout d’un persona ouvert">${icon("Plus")}Ajouter un rôle</button>
        `)}

        ${panel("3. Problèmes à résoudre", `
          <div class="grid gap-4 md:grid-cols-2">
            <label><span class="label">Problème principal</span><textarea class="textarea min-h-[112px]">Les usages IA sont dispersés entre les équipes et il est difficile de savoir quelles données sont exposées, qui a validé l’outil et quelles preuves fournir à un client.</textarea></label>
            <label><span class="label">Résultat recherché</span><textarea class="textarea min-h-[112px]">Obtenir un registre clair, un plan d’action et un dossier de preuves partageable sans déployer une plateforme GRC complexe.</textarea></label>
          </div>
        `)}

        ${panel("4. Signaux d’intention", `
          <p class="mb-4 text-xs text-muted">Ces événements permettront ensuite de prioriser les comptes.</p>
          <div class="flex flex-wrap gap-2">${signalChoices.map(signalOption).join("")}</div>
        `)}

        ${panel("5. Exclusions", `
          <div class="grid gap-4 md:grid-cols-2">
            <label><span class="label">Exclure si…</span><textarea class="textarea min-h-[92px]">Aucun usage IA actuel ou prévu\nStructure individuelle sans équipe\nBesoin limité à une formation générale</textarea></label>
            <label><span class="label">Notes de qualification</span><textarea class="textarea min-h-[92px]" placeholder="Ajoutez les cas à traiter manuellement…"></textarea></label>
          </div>
        `)}
      </main>

      <aside class="space-y-4 xl:sticky xl:top-20">
        <section class="panel">
          <div class="panel-header"><h2 class="font-semibold">Résumé de l’ICP</h2>${badge("78 %","signal")}</div>
          <div class="panel-body">
            <div class="mb-4 progress"><span style="width:78%;background:var(--signal)"></span></div>
            <div class="space-y-3 text-xs">
              ${[
                ["Segment","Cabinets d’avocats"],
                ["Zone","France"],
                ["Taille","10 à 250 personnes"],
                ["Personas","4 sélectionnés"],
                ["Signaux","4 sélectionnés"],
                ["Exclusions","3 règles"]
              ].map(([key,value],index)=>`<div class="flex justify-between gap-3 border-b border-line pb-2"><span class="text-muted">${key}</span><strong class="text-right" ${index === 0 ? "data-summary-segment" : index === 2 ? "data-summary-size" : ""}>${value}</strong></div>`).join("")}
            </div>
            <div class="mt-5 rounded-lg border border-warning/30 bg-amber-50 p-3">
              <div class="flex items-center gap-2 text-xs font-semibold text-warning">${icon("CircleAlert",15)}À préciser</div>
              <ul class="mt-2 space-y-1 pl-4 text-xs leading-5 text-muted"><li class="list-disc">Budget ou capacité d’achat</li><li class="list-disc">Outils IA déjà utilisés</li></ul>
            </div>
          </div>
          <footer class="space-y-2 border-t border-line p-4">
            <button type="button" class="btn btn-primary w-full" data-next-segment>${icon("ArrowRight")}Enregistrer et passer au suivant</button>
            <button type="button" class="btn btn-ghost w-full" data-toast="ICP créé en brouillon">${icon("FilePlus2")}Créer seulement cet ICP</button>
          </footer>
        </section>
        <section class="rounded-xl border border-line bg-white p-4">
          <div class="flex gap-3"><span class="grid h-9 w-9 flex-none place-items-center rounded-lg bg-slate-100 text-navy">${icon("Info",17)}</span><p class="text-xs leading-5 text-muted">Aucune recherche ne démarre ici. Cet écran prépare uniquement les critères du futur sourcing.</p></div>
        </section>
      </aside>
    </div>`;
}

export function initIcpBuilder() {
  const buttons = [...document.querySelectorAll("[data-builder-segment]")];
  const title = document.querySelector("[data-active-segment]");
  const summary = document.querySelector("[data-summary-segment]");
  const summarySize = document.querySelector("[data-summary-size]");
  const mobile = document.querySelector("[data-mobile-segment]");
  const description = document.querySelector("[data-segment-description]");
  const type = document.querySelector("[data-segment-type]");
  const size = document.querySelector("[data-segment-size]");
  const position = document.querySelector("[data-segment-position]");
  const completedCount = document.querySelector("[data-completed-count]");

  const activate = name => {
    buttons.forEach(button => {
      const active = button.dataset.segmentName === name;
      button.classList.toggle("builder-segment-active", active);
      const iconBox = button.querySelector(".grid");
      iconBox?.classList.toggle("bg-navy", active);
      iconBox?.classList.toggle("text-white", active);
      iconBox?.classList.toggle("bg-slate-100", !active);
      iconBox?.classList.toggle("text-navy", !active);
      const state = button.querySelector("[data-segment-state]");
      if (state && button.dataset.complete !== "true") {
        state.textContent = active ? "En cours" : "À faire";
        state.classList.toggle("text-brandblue", active);
        state.classList.toggle("text-muted", !active);
      }
    });
    if (title) title.textContent = name;
    if (summary) summary.textContent = name;
    if (mobile && mobile.value !== name) mobile.value = name;
    const details = segmentDetails[name];
    if (details) {
      if (description) description.value = details[0];
      if (type) type.value = details[1];
      if (size) size.value = details[2];
      if (summarySize) summarySize.textContent = details[2];
    }
    if (position) position.textContent = String(buttons.findIndex(button => button.dataset.segmentName === name) + 1);
  };

  buttons.forEach(button => button.addEventListener("click", () => activate(button.dataset.segmentName)));
  mobile?.addEventListener("change", () => activate(mobile.value));

  document.querySelectorAll("[data-toggle-criterion]").forEach(button => button.addEventListener("click", () => {
    button.classList.toggle("criteria-chip-active");
    button.setAttribute("aria-pressed", String(button.classList.contains("criteria-chip-active")));
  }));

  document.querySelector("[data-next-segment]")?.addEventListener("click", () => {
    const current = buttons.findIndex(button => button.classList.contains("builder-segment-active"));
    const currentButton = buttons[current];
    if (currentButton && currentButton.dataset.complete !== "true") {
      currentButton.dataset.complete = "true";
      const state = currentButton.querySelector("[data-segment-state]");
      if (state) {
        state.textContent = "Terminé";
        state.classList.remove("text-muted", "text-brandblue");
        state.classList.add("text-success");
      }
      if (completedCount) completedCount.textContent = String(buttons.filter(button => button.dataset.complete === "true").length);
    }
    const next = buttons[Math.min(current + 1, buttons.length - 1)];
    if (next) activate(next.dataset.segmentName);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}
