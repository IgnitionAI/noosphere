import { icon, badge, button, pageHeader, panel } from "./core.js";

export function integrationsPage() {
  const accounts=[
    ["LinkedIn","Salim Laimeche","Unipile","Connecté","68 / 120 actions","Network"],
    ["Email","salim@ignitionai.fr","Unipile","Connecté","31 / 80 emails","Mail"],
    ["WhatsApp","IgnitionAI Business","Unipile","Restreint","Continuité uniquement","MessageCircle"],
    ["Calendrier","Google Calendar","Google","Connecté","Synchro il y a 4 min","CalendarDays"]
  ];
  return `
    ${pageHeader("Intégrations", "Connectez les canaux d’envoi, les sources de prospects et les services d’enrichissement.", button("Connecter un compte","Plus","primary"))}
    <section class="mb-7"><h2 class="mb-3 text-xs font-semibold uppercase tracking-[.08em] text-muted">Comptes de communication</h2><div class="grid gap-4 lg:grid-cols-2">${accounts.map(([type,name,provider,status,usage,ico])=>`<article class="panel p-5"><div class="flex items-start gap-4"><span class="grid h-11 w-11 place-items-center rounded-lg bg-navy text-white">${icon(ico,20)}</span><div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><h3 class="font-semibold">${name}</h3>${badge(status,status==="Connecté"?"success":"warning")}</div><p class="mt-1 text-xs text-muted">${type} via ${provider}</p><div class="mt-4 flex items-center justify-between text-xs"><span class="text-muted">${usage}</span><button class="font-semibold text-brandblue">Configurer</button></div></div></div></article>`).join("")}</div></section>
    <section><h2 class="mb-3 text-xs font-semibold uppercase tracking-[.08em] text-muted">Enrichissement et infrastructure</h2><div class="grid gap-4 lg:grid-cols-3">${[
      ["Contact Finder","Recherche email professionnel","2 fournisseurs · fallback actif","SearchCheck","Connecté"],
      ["Email Verifier","Validation et catch-all","97,2 % vérifiés ce mois","BadgeCheck","Connecté"],
      ["Stockage documents","S3 compatible","38 documents · 284 Mo","Database","Connecté"],
      ["Modèles IA","Génération et scoring","2 routes de modèles configurées","Sparkles","Connecté"],
      ["ParadeDB","Recherche hybride optionnelle","Non nécessaire au volume actuel","ScanSearch","Désactivé"],
      ["Webhooks","Événements sortants","0 destination configurée","Webhook","À configurer"]
    ].map(([name,desc,meta,ico,status])=>`<article class="panel p-5"><div class="flex items-start justify-between"><span class="grid h-10 w-10 place-items-center rounded-lg bg-slate-100">${icon(ico,19)}</span>${badge(status,status==="Connecté"?"success":status==="Désactivé"?"":"warning")}</div><h3 class="mt-4 font-semibold">${name}</h3><p class="mt-1 text-xs text-muted">${desc}</p><p class="mt-4 border-t border-line pt-3 text-xs text-muted">${meta}</p></article>`).join("")}</div></section>`;
}

export function settingsPage() {
  return `
    ${pageHeader("Paramètres", "Gérez le workspace, les membres, la sécurité et les règles d’outreach.")}
    <div class="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)]">
      <aside class="panel h-max p-2">${["Général","Membres et rôles","Envoi et limites","Suppression","Sécurité","Audit","Données"].map((x,i)=>`<button class="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium ${i===0?"bg-navy text-white":"hover:bg-canvas"}">${icon(["Settings2","Users","Gauge","ShieldBan","ShieldCheck","ScrollText","Database"][i],16)}${x}</button>`).join("")}</aside>
      <div class="space-y-4">
        ${panel("Workspace", `<div class="grid gap-4 md:grid-cols-2"><label><span class="label">Nom</span><input class="input" value="IgnitionAI"></label><label><span class="label">Slug</span><input class="input" value="ignitionai"></label><label><span class="label">Fuseau horaire</span><select class="select"><option>Europe/Paris</option></select></label><label><span class="label">Langue</span><select class="select"><option>Français</option></select></label></div><div class="mt-5 flex justify-end">${button("Enregistrer","Save","primary")}</div>`)}
        ${panel("Identité commerciale", `<div class="grid gap-4 md:grid-cols-2"><label><span class="label">Nom affiché</span><input class="input" value="Salim Laimeche"></label><label><span class="label">Entreprise</span><input class="input" value="IgnitionAI"></label><label class="md:col-span-2"><span class="label">Signature email</span><textarea class="textarea">Salim Laimeche\nIgnitionAI · Solutions IA d’entreprise</textarea></label></div>`)}
        ${panel("Comportement de l’IA", `<div class="space-y-4">${[
          ["Recherche et scoring automatiques","Les prospects peuvent être enrichis et scorés sans validation.",true],
          ["Premiers messages soumis à validation","Aucun premier contact ne part sans approbation.",true],
          ["Réponses IA soumises à validation","Chaque réponse est relue en V1.",true],
          ["Négociation commerciale autonome","Prix, conditions et objections sensibles sont escaladés.",false]
        ].map(([title,meta,on])=>`<label class="flex items-start justify-between gap-4 border-b border-line pb-4"><span><strong class="block text-sm">${title}</strong><span class="mt-1 block text-xs text-muted">${meta}</span></span><input type="checkbox" ${on?"checked":""} class="mt-1 h-4 w-4 accent-navy"></label>`).join("")}</div>`)}
        ${panel("Zone de danger", `<div class="flex flex-wrap items-center justify-between gap-4"><div><div class="font-semibold">Supprimer le workspace</div><p class="mt-1 text-xs text-muted">Les suppressions de contact resteront conservées sous forme d’empreintes.</p></div>${button("Supprimer","Trash2","danger")}</div>`)}
      </div>
    </div>`;
}

export function onboardingPage() {
  return `<main class="min-h-screen bg-canvas">
    <header class="flex h-16 items-center justify-between border-b border-line bg-white px-5 md:px-10"><div class="flex items-center gap-3"><span class="grid h-9 w-9 place-items-center rounded-lg bg-navy font-black text-signal">IO</span><strong>Ignition Outbound</strong></div><span class="text-xs text-muted">Étape 2 sur 4</span></header>
    <div class="mx-auto max-w-5xl px-5 py-10">
      <div class="mb-8 grid grid-cols-4 gap-2">${["Workspace","Offre","ICP","Connexions"].map((s,i)=>`<div><div class="h-1.5 rounded-full ${i<2?"bg-navy":"bg-line"}"></div><div class="mt-2 text-[11px] font-semibold ${i===1?"text-ink":"text-muted"}">${s}</div></div>`).join("")}</div>
      <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section class="panel p-7"><div class="mb-6 grid h-11 w-11 place-items-center rounded-lg bg-signal text-signal-ink">${icon("Package",20)}</div><h1 class="text-2xl font-semibold tracking-tight">Que vendez-vous ?</h1><p class="mt-2 text-sm leading-6 text-muted">L’IA utilisera cette offre pour chercher les bons signaux, scorer les prospects et rédiger des messages vérifiables.</p><div class="mt-7 grid gap-3 sm:grid-cols-3">${["Service","SaaS","Licence"].map((x,i)=>`<button class="rounded-lg border p-4 text-left ${i===0?"border-navy bg-slate-50": "border-line"}"><strong>${x}</strong><span class="mt-1 block text-xs text-muted">${["Mission, audit ou intégration","Abonnement logiciel","Logiciel déployé chez le client"][i]}</span></button>`).join("")}</div><label class="mt-6 block"><span class="label">Nom de l’offre</span><input class="input" value="IgnitionRAG Entreprise"></label><label class="mt-4 block"><span class="label">Proposition de valeur</span><textarea class="textarea">Déployer des assistants RAG gouvernés, traçables et intégrables au SI dans des environnements sensibles.</textarea></label><div class="mt-6 flex justify-between">${button("Retour","ArrowLeft")}${button("Continuer vers l’ICP","ArrowRight","primary")}</div></section>
        <aside class="panel h-max p-5"><div class="flex items-center gap-2 font-semibold text-signal-ink">${icon("Sparkles",17)}Pré-remplissage IA</div><p class="mt-2 text-xs leading-5 text-muted">Nous pouvons analyser votre site et vos documents pour proposer les premières versions. Rien ne sera publié sans validation.</p><button class="btn btn-signal mt-4 w-full">${icon("WandSparkles")}Analyser ignitionai.fr</button><div class="mt-5 border-t border-line pt-4 text-xs text-muted">Vous pourrez créer plusieurs offres versionnées après l’onboarding.</div></aside>
      </div>
    </div>
  </main>`;
}
