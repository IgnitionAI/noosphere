import { prospects, campaigns, conversations } from "./data.js";
import { icon, badge, button, pageHeader, metric, panel, scoreRing } from "./core.js";

export function dashboardPage() {
  const activity = [
    ["Message LinkedIn accepté","Claire Martin · Finovox","12 min","MessageCircle","success"],
    ["Prospect à forte intention détecté","Yanis Amrani · HabitatPulse","34 min","Radar","signal"],
    ["Réponse reçue","Sophie Bernard · Mutuelle Nova","48 min","Mail","blue"],
    ["Campagne mise en pause","Réseau 1er degré · IgnitionRAG","1 h","PauseCircle","warning"],
    ["Rendez-vous confirmé","Amina Diallo · Groupe Aster","2 h","CalendarCheck","success"]
  ];
  return `
    ${pageHeader("Bonjour Salim.", "Voici ce qui mérite ton attention aujourd’hui.", button("Lancer une campagne","Plus","primary"))}
    <section class="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      ${metric("Prospects actifs","412","+18 cette semaine")}
      ${metric("Réponses à traiter","3","2 prioritaires")}
      ${metric("Rendez-vous ce mois","11","+37 %")}
      ${metric("Pipeline pondéré","61,4 k€","+9,2 k€")}
    </section>
    <section class="mb-6 grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
      ${panel("À faire maintenant", `
        <div class="space-y-3">
          ${[
            ["Valider 6 messages personnalisés","La campagne Head of Data attend avant son lancement.","6","approvals.html"],
            ["Répondre à Sophie Bernard","Intérêt confirmé pour la gouvernance RAG.","8 min","inbox.html"],
            ["Vérifier le compte LinkedIn principal","Le quota de connexions atteint 83 %.","2 min","integrations.html"]
          ].map(([title,meta,effort,href],i)=>`<a href="${href}" class="flex items-center gap-3 rounded-lg border border-line p-3 hover:bg-canvas">
            <span class="grid h-9 w-9 place-items-center rounded-lg ${i===0?"bg-signal text-signal-ink":"bg-slate-100 text-navy"}">${icon(i===0?"CircleCheckBig":i===1?"Reply":"ShieldAlert",18)}</span>
            <span class="min-w-0 flex-1"><span class="block font-semibold">${title}</span><span class="mt-1 block text-xs text-muted">${meta}</span></span>
            <span class="text-xs font-semibold text-muted">${effort}</span>${icon("ChevronRight",16,"text-muted")}
          </a>`).join("")}
        </div>`, `<a class="text-xs font-semibold text-brandblue" href="approvals.html">Tout voir</a>`)}
      ${panel("Objectif de la semaine", `
        <div class="flex items-center justify-between"><div><div class="font-mono text-3xl font-semibold">7 / 10</div><div class="mt-1 text-xs text-muted">rendez-vous qualifiés</div></div><div class="grid h-16 w-16 place-items-center rounded-full border-[7px] border-signal border-r-slate-200 font-mono text-xs">70%</div></div>
        <div class="mt-5 progress"><span style="width:70%;background:var(--signal)"></span></div>
        <div class="mt-3 flex justify-between text-xs text-muted"><span>3 campagnes actives</span><span>4 jours restants</span></div>
      `)}
    </section>
    <section class="grid gap-4 xl:grid-cols-[1fr_1fr]">
      ${panel("Campagnes en cours", `
        <div class="space-y-4">${campaigns.slice(0,3).map(c=>`
          <a href="campaign-detail.html" class="block rounded-lg border border-line p-3 hover:bg-canvas">
            <div class="flex items-start justify-between gap-3"><div><div class="font-semibold">${c.name}</div><div class="mt-1 text-xs text-muted">${c.next}</div></div>${badge(c.status,c.status==="Active"?"success":c.status==="Validation"?"warning":"")}</div>
            <div class="mt-3 grid grid-cols-3 gap-3 text-xs"><div><span class="text-muted">Envoyés</span><strong class="ml-1">${c.sent}</strong></div><div><span class="text-muted">Réponses</span><strong class="ml-1">${c.replies}</strong></div><div><span class="text-muted">RDV</span><strong class="ml-1">${c.meetings}</strong></div></div>
          </a>`).join("")}</div>`, `<a class="text-xs font-semibold text-brandblue" href="campaigns.html">Ouvrir</a>`)}
      ${panel("Activité en direct", `<div class="relative space-y-1">${activity.map(([title,meta,time,ico,tone])=>`
        <div class="flex gap-3 py-2.5"><span class="grid h-8 w-8 place-items-center rounded-full ${tone==="signal"?"bg-signal":tone==="success"?"bg-emerald-50 text-success":tone==="warning"?"bg-amber-50 text-warning":"bg-indigo-50 text-brandblue"}">${icon(ico,15)}</span>
        <span class="min-w-0 flex-1"><span class="block text-sm font-medium">${title}</span><span class="block truncate text-xs text-muted">${meta}</span></span><time class="text-[11px] text-muted">${time}</time></div>`).join("")}</div>`)}
    </section>`;
}

export function approvalsPage() {
  const queue = prospects.slice(0,5);
  return `
    ${pageHeader("À valider", "Les décisions qui nécessitent encore un regard humain.", `${button("Tout rejeter","X")}${button("Approuver la sélection","Check","signal")}`)}
    <div class="mb-5 tabs"><button class="tab active">Messages <span class="ml-1 rounded-full bg-navy px-1.5 text-[10px] text-white">6</span></button><button class="tab">Réponses IA 2</button><button class="tab">Fusions 3</button></div>
    <div class="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <section class="panel overflow-hidden">
        <div class="border-b border-line p-3"><input class="input" placeholder="Filtrer la file de validation"></div>
        ${queue.map((p,i)=>`<button class="w-full border-b border-line p-4 text-left hover:bg-canvas ${i===0?"bg-[#f4fbe7]":""}">
          <div class="flex items-center gap-3"><span class="avatar ${i===0?"avatar-signal":""}">${p.initials}</span><span class="min-w-0 flex-1"><span class="block truncate font-semibold">${p.name}</span><span class="block truncate text-xs text-muted">${p.title} · ${p.company}</span></span>${scoreRing(p.score)}</div>
          <div class="mt-3 flex items-center justify-between"><span class="badge badge-blue">${p.channel}</span><span class="text-[11px] text-muted">${p.last}</span></div>
        </button>`).join("")}
      </section>
      <section class="panel min-w-0">
        <div class="panel-header"><div><h2 class="font-semibold">Premier message LinkedIn</h2><p class="mt-1 text-xs text-muted">Claire Martin · CTO chez Finovox</p></div><div class="flex gap-2">${button("Rejeter","X")}${button("Approuver","Check","signal")}</div></div>
        <div class="grid gap-0 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div class="border-r border-line p-5">
            <label class="label">Message proposé</label>
            <div class="rounded-lg border border-line bg-canvas p-4 text-[15px] leading-7" contenteditable="true" data-pretext>Bonjour Claire, j’ai vu que Finovox recrutait huit profils IA alors que vous consolidez votre plateforme. Nous accompagnons des équipes data qui veulent industrialiser leurs assistants sans multiplier les briques ni perdre la gouvernance. Est-ce que le sujet est déjà cadré chez vous ?</div>
            <div class="mt-3 flex items-center justify-between text-xs text-muted"><span>394 caractères · ton direct</span><button class="font-semibold text-brandblue" data-toast="Nouvelle variante générée">Générer une variante</button></div>
            <div class="mt-6"><label class="label">Séquence approuvée avec ce message</label>
              <div class="space-y-2">${[["J0","Invitation LinkedIn","Sans note"],["J+1","Premier message","Ce message"],["J+4","Email de valeur","Cas gouvernance"],["J+9","Relance LinkedIn","Question courte"]].map(([day,step,meta])=>`<div class="flex items-center gap-3 rounded-lg border border-line p-3"><span class="w-10 font-mono text-xs font-semibold">${day}</span><span class="flex-1 font-medium">${step}</span><span class="text-xs text-muted">${meta}</span></div>`).join("")}</div>
            </div>
          </div>
          <aside class="p-5">
            <div class="text-xs font-semibold uppercase tracking-wide text-muted">Pourquoi elle</div>
            <div class="mt-3 flex items-center gap-3"><span class="avatar avatar-lg avatar-signal">CM</span><div><div class="font-semibold">Claire Martin</div><div class="text-xs text-muted">CTO · Finovox</div></div></div>
            <div class="mt-5 space-y-3">${[["Fit ICP","94 / 100"],["Signal","8 recrutements IA"],["Taille","620 employés"],["Preuve","Annonce carrière, 23 juil."],["Email","Vérifié à 97 %"]].map(([k,v])=>`<div class="flex justify-between gap-3 border-b border-line pb-2 text-xs"><span class="text-muted">${k}</span><strong class="text-right">${v}</strong></div>`).join("")}</div>
            <div class="mt-5 rounded-lg border border-[#d7f69b] bg-[#f6ffe5] p-3 text-xs leading-5"><strong>Claim utilisé</strong><br>« Industrialiser les assistants sans perdre la gouvernance », validé dans l’offre RAG Entreprise.</div>
          </aside>
        </div>
      </section>
    </div>`;
}

export function componentsPage() {
  return `
    ${pageHeader("Bibliothèque de composants", "Référence visuelle pour l’intégration shadcn/Next.js. Tous les états principaux sont visibles.")}
    <div class="grid gap-4 xl:grid-cols-2">
      ${panel("Actions", `<div class="flex flex-wrap gap-2">${button("Primaire","Plus","primary")}${button("Signal IA","Sparkles","signal")}${button("Secondaire","Filter")}${button("Fantôme","MoreHorizontal","ghost")}${button("Supprimer","Trash2","danger")}</div>`)}
      ${panel("Badges et statuts", `<div class="flex flex-wrap gap-2">${badge("Active","success")}${badge("Validation","warning")}${badge("Erreur","danger")}${badge("LinkedIn","blue")}${badge("Score élevé","signal")}${badge("Brouillon")}</div>`)}
      ${panel("Champs", `<div class="grid gap-4 sm:grid-cols-2"><label><span class="label">Nom de campagne</span><input class="input" value="CTO · RAG Entreprise"></label><label><span class="label">Canal</span><select class="select"><option>LinkedIn + Email</option></select></label><label class="sm:col-span-2"><span class="label">Consigne IA</span><textarea class="textarea">Rester direct, citer uniquement les claims validés.</textarea><span class="help">La consigne sera versionnée avec la campagne.</span></label></div>`)}
      ${panel("Navigation et choix", `<div class="space-y-4"><div class="tabs"><button class="tab active">Vue</button><button class="tab">Données</button><button class="tab">Historique</button></div><label class="flex items-center gap-2"><input type="checkbox" checked class="h-4 w-4 accent-navy"> <span>Approuver toute la séquence</span></label><label class="flex items-center gap-2"><input type="radio" checked class="h-4 w-4 accent-navy"> <span>Validation humaine</span></label></div>`)}
      ${panel("Identité et scoring", `<div class="flex flex-wrap gap-6"><div class="identity"><span class="avatar avatar-signal">CM</span><span class="identity-main"><span class="identity-name">Claire Martin</span><span class="identity-meta">CTO · Finovox</span></span></div><div class="flex items-center gap-2">${scoreRing(94)}<div><div class="font-semibold">Très bon fit</div><div class="text-xs text-muted">5 preuves disponibles</div></div></div></div>`)}
      ${panel("États système", `<div class="space-y-4"><div class="rounded-lg border border-danger/20 bg-red-50 p-3 text-sm text-danger"><strong>Compte LinkedIn en pause.</strong> Les actions prévues ont été suspendues.</div><div class="rounded-lg border border-warning/20 bg-amber-50 p-3 text-sm text-warning"><strong>Validation requise.</strong> Six messages attendent une décision.</div><div class="rounded-lg border border-success/20 bg-emerald-50 p-3 text-sm text-success"><strong>Synchronisé.</strong> Dernier webhook reçu il y a 2 minutes.</div><div class="space-y-2"><div class="skeleton h-4 w-4/5"></div><div class="skeleton h-4 w-3/5"></div></div></div>`)}
    </div>`;
}

export function loginPage() {
  return `<main class="grid min-h-screen place-items-center bg-canvas p-5">
    <section class="w-full max-w-[420px]">
      <div class="mb-8 flex justify-center"><div class="grid h-11 w-11 place-items-center rounded-xl bg-navy font-black text-signal">IO</div></div>
      <div class="panel p-7"><h1 class="text-center text-2xl font-semibold tracking-tight">Se connecter à Ignition Outbound</h1><p class="mt-2 text-center text-sm text-muted">Pilotez vos prospects, campagnes et conversations.</p>
        <form class="mt-7 space-y-4" onsubmit="event.preventDefault();location.href='dashboard.html'"><label><span class="label">Email professionnel</span><input class="input" type="email" value="salim@ignitionai.fr"></label>${button("Recevoir un code de connexion","Mail","primary","style='width:100%' type='submit'")}</form>
        <div class="my-5 flex items-center gap-3 text-xs text-muted"><span class="h-px flex-1 bg-line"></span>ou<span class="h-px flex-1 bg-line"></span></div>
        <div class="grid grid-cols-2 gap-2">${button("Google","Globe2")}${button("Microsoft","PanelsTopLeft")}</div>
        <p class="mt-6 text-center text-[11px] leading-5 text-muted">Accès réservé aux membres invités du workspace.</p>
      </div>
    </section>
  </main>`;
}
