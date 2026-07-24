import { campaigns, prospects } from "./data.js";
import { icon, badge, button, pageHeader, metric, panel, toolbar } from "./core.js";

const tone=s=>s==="Active"?"success":s==="Validation"?"warning":s==="Pause"?"danger":"";

export function campaignsPage() {
  return `
    ${pageHeader("Campagnes", "Une campagne vend une offre versionnée à un ICP versionné, avec une séquence approuvée.", button("Nouvelle campagne","Plus","primary","onclick=\"location.href='campaign-builder.html'\""))}
    <section class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">${metric("Actives","3","412 prospects")}${metric("En validation","1","18 messages")}${metric("Réponse moyenne","21,2 %","+4,7 %")}${metric("RDV générés","19","ce mois")}</section>
    <section class="panel overflow-hidden">${toolbar("Rechercher une campagne", `<div class="tabs"><button class="tab active">Toutes</button><button class="tab">Actives</button><button class="tab">Brouillons</button></div>`)}
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Campagne</th><th>Statut</th><th>Canaux</th><th>Prospects</th><th>Envoyés</th><th>Réponses</th><th>RDV</th><th>Taux</th><th></th></tr></thead><tbody>
      ${campaigns.map(c=>`<tr onclick="location.href='campaign-detail.html'"><td><div class="font-semibold">${c.name}</div><div class="mt-1 text-xs text-muted">${c.next} · ${c.owner}</div></td><td>${badge(c.status,tone(c.status))}</td><td>${c.channel}</td><td class="font-mono text-xs">${c.prospects}</td><td class="font-mono text-xs">${c.sent}</td><td class="font-mono text-xs">${c.replies}</td><td class="font-mono text-xs">${c.meetings}</td><td class="font-mono text-xs">${c.rate}</td><td><button class="btn icon-btn">${icon("MoreHorizontal")}</button></td></tr>`).join("")}</tbody></table></div>
    </section>`;
}

export function campaignBuilderPage() {
  const steps=["Fondations","Ciblage","Prospects","Séquence","Validation"];
  return `
    <div class="mb-5"><a href="campaigns.html" class="inline-flex items-center gap-2 text-xs font-semibold text-muted">${icon("ArrowLeft",14)}Quitter le builder</a></div>
    ${pageHeader("Nouvelle campagne", "Configurez la campagne, puis approuvez son snapshot avant tout envoi.", `${button("Enregistrer le brouillon","Save")}${button("Continuer","ArrowRight","primary")}`)}
    <div class="mb-6 flex overflow-x-auto rounded-lg border border-line bg-white">${steps.map((s,i)=>`<div class="flex min-w-[150px] flex-1 items-center gap-2 border-r border-line px-4 py-3 last:border-r-0 ${i===0?"bg-[#f4fbe7]":""}"><span class="grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold ${i===0?"bg-navy text-white":"bg-slate-100 text-muted"}">${i+1}</span><span class="text-xs font-semibold">${s}</span></div>`).join("")}</div>
    <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section class="panel">
        <div class="panel-header"><div><h2 class="font-semibold">1. Fondations de la campagne</h2><p class="mt-1 text-xs text-muted">Ces versions deviendront immuables après activation.</p></div>${badge("Brouillon")}</div>
        <div class="panel-body space-y-6">
          <label><span class="label">Nom de la campagne</span><input class="input" value="CTO · RAG Entreprise · Q3"></label>
          <div class="grid gap-4 md:grid-cols-2">
            <label><span class="label">Offre publiée</span><select class="select"><option>IgnitionRAG Entreprise · v3</option><option>Audit architecture GenAI · v2</option></select><span class="help">Service + licence · valeur 45–120 k€</span></label>
            <label><span class="label">ICP publié</span><select class="select"><option>CTO / Head of Data · ETI France · v4</option></select><span class="help">500–5 000 employés · France</span></label>
          </div>
          <div class="grid gap-4 md:grid-cols-2">
            <label><span class="label">Stratégie de message</span><select class="select"><option>Direct · preuve et question · v2</option></select></label>
            <label><span class="label">Politique IA</span><select class="select"><option>Supervisée · validation obligatoire · v1</option></select></label>
          </div>
          <div><span class="label">Objectif</span><div class="grid gap-2 sm:grid-cols-3">${[["CalendarCheck","Rendez-vous","Qualifier puis réserver un échange"],["Reply","Réponse","Démarrer une conversation"],["Download","Ressource","Partager un contenu ciblé"]].map(([ico,title,meta],i)=>`<button class="rounded-lg border p-4 text-left ${i===0?"border-navy bg-slate-50":"border-line"}"><span class="mb-3 grid h-8 w-8 place-items-center rounded-lg ${i===0?"bg-navy text-white":"bg-slate-100"}">${icon(ico)}</span><strong class="block">${title}</strong><span class="mt-1 block text-xs leading-5 text-muted">${meta}</span></button>`).join("")}</div></div>
        </div>
      </section>
      <aside class="space-y-4">
        ${panel("Résumé du snapshot", `<div class="space-y-3 text-xs">${[["Offre","IgnitionRAG v3"],["ICP","CTO ETI France v4"],["Messages","Direct v2"],["IA","Supervisée v1"],["Séquence","À sélectionner"]].map(([k,v])=>`<div class="flex justify-between gap-3 border-b border-line pb-2"><span class="text-muted">${k}</span><strong class="text-right">${v}</strong></div>`).join("")}</div>`)}
        ${panel("Contrôle avant activation", `<div class="space-y-2 text-xs">${[["check","Offre publiée"],["check","ICP publié"],["check","Claims validés"],["circle","Séquence manquante"],["circle","Compte expéditeur à choisir"]].map(([state,label])=>`<div class="flex items-center gap-2 ${state==="check"?"text-success":"text-muted"}">${icon(state==="check"?"CheckCircle2":"Circle",15)}${label}</div>`).join("")}</div>`)}
      </aside>
    </div>`;
}

export function campaignDetailPage() {
  return `
    <div class="mb-5"><a href="campaigns.html" class="inline-flex items-center gap-2 text-xs font-semibold text-muted">${icon("ArrowLeft",14)}Toutes les campagnes</a></div>
    ${pageHeader("CTO · RAG Entreprise · France", "LinkedIn + Email · activée le 15 juillet par Salim", `${button("Mettre en pause","Pause")}${button("Ajouter des prospects","UserPlus","primary")}`)}
    <div class="mb-5 flex flex-wrap items-center gap-2">${badge("Active","success")}${badge("IgnitionRAG v3","signal")}${badge("ICP CTO ETI v4","blue")}<span class="text-xs text-muted">Snapshot #CMP-2026-0715</span></div>
    <section class="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">${metric("Prospects","186","+14")}${metric("Envoyés","94","50,5 %")}${metric("Réponses","23","24,5 %")}${metric("Rendez-vous","7","30,4 % rép.")}${metric("Pipeline","127 k€","3 opp.")}</section>
    <div class="mb-5 tabs"><button class="tab active">Performance</button><button class="tab">Prospects</button><button class="tab">Séquence</button><button class="tab">Activité</button><button class="tab">Configuration</button></div>
    <div class="grid gap-4 xl:grid-cols-[1.3fr_.7fr]">
      ${panel("Progression de la séquence", `<div class="space-y-5">${[
        ["Invitation LinkedIn",146,119,"81,5 %"],["Premier message",119,94,"79,0 %"],["Email de valeur",72,51,"70,8 %"],["Relance LinkedIn",38,23,"60,5 %"],["Dernière relance",12,7,"58,3 %"]
      ].map(([name,reached,done,rate])=>`<div><div class="mb-2 flex justify-between text-xs"><span class="font-semibold">${name}</span><span class="text-muted">${done}/${reached} · ${rate}</span></div><div class="progress"><span style="width:${(done/reached)*100}%"></span></div></div>`).join("")}</div>`)}
      ${panel("Ce qui fonctionne", `<div class="space-y-3"><div class="rounded-lg border border-[#d7f69b] bg-[#f6ffe5] p-3"><div class="text-xs font-semibold text-signal-ink">Signal le plus performant</div><div class="mt-1 font-semibold">Recrutement d’une équipe IA</div><p class="mt-1 text-xs text-muted">31 % de réponses, 6,5 points au-dessus de la moyenne.</p></div><div class="rounded-lg border border-line p-3"><div class="text-xs text-muted">Persona</div><div class="mt-1 font-semibold">Head of Data</div><p class="mt-1 text-xs text-muted">8 réponses sur 25 contacts.</p></div><button class="btn w-full">${icon("Sparkles")}Appliquer à une future campagne</button></div>`)}
    </div>
    <section class="panel mt-4 overflow-hidden"><div class="panel-header"><h2 class="font-semibold">Prospects récents</h2><a href="prospects.html" class="text-xs font-semibold text-brandblue">Voir tous</a></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Prospect</th><th>Étape</th><th>État</th><th>Dernière action</th><th>Prochaine action</th></tr></thead><tbody>${prospects.slice(0,5).map((p,i)=>`<tr><td><div class="identity"><span class="avatar">${p.initials}</span><span><span class="identity-name">${p.name}</span><span class="identity-meta">${p.company}</span></span></div></td><td>${["Premier message","Email de valeur","Conversation","Invitation","Relance LinkedIn"][i]}</td><td>${badge(p.status,i===2?"success":i===0?"warning":"blue")}</td><td class="text-xs text-muted">${p.last}</td><td class="text-xs">${["Validation requise","Demain, 09:10","Suspendue sur réponse","Aujourd’hui, 16:42","Dans 2 jours"][i]}</td></tr>`).join("")}</tbody></table></div></section>`;
}

export function sequencesPage() {
  const seqs=[
    ["LinkedIn → Email · valeur","v4","4 étapes","3 campagnes","Publié"],
    ["Email court · audit GenAI","v2","3 étapes","1 campagne","Publié"],
    ["Réseau chaud LinkedIn","v3","5 étapes","1 campagne","Publié"],
    ["WhatsApp après rendez-vous","v1","2 étapes","0 campagne","Brouillon"]
  ];
  return `
    ${pageHeader("Séquences", "Des playbooks multicanaux linéaires, conditionnels et versionnés.", button("Nouvelle séquence","Plus","primary"))}
    <div class="grid gap-4 lg:grid-cols-2">${seqs.map(([name,v,steps,camps,status],i)=>`<article class="panel p-5"><div class="flex items-start justify-between gap-4"><div><div class="flex items-center gap-2"><h2 class="font-semibold">${name}</h2>${badge(v)}</div><p class="mt-1 text-xs text-muted">${steps} · ${camps}</p></div>${badge(status,status==="Publié"?"success":"warning")}</div>
      <div class="mt-5 flex items-center gap-1">${["Network","Clock","Mail","Clock","MessageCircle"].slice(0,i===3?3:5).map((ico,j)=>`<span class="grid h-9 w-9 place-items-center rounded-lg ${j%2===0?"bg-navy text-white":"bg-slate-100 text-muted"}">${icon(ico,16)}</span>${j<4?'<span class="h-px w-3 bg-line"></span>':""}`).join("")}</div>
      <div class="mt-5 flex gap-2">${button("Ouvrir","ArrowUpRight")}${button("Dupliquer","Copy")}</div></article>`).join("")}</div>`;
}
