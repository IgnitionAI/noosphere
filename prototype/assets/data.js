export const prospects = [
  { initials:"CM", name:"Claire Martin", title:"CTO", company:"Finovox", city:"Paris", score:94, signal:"Recrute 8 ingénieurs IA", channel:"LinkedIn", status:"À valider", email:"claire.martin@finovox.fr", last:"Il y a 12 min" },
  { initials:"YA", name:"Yanis Amrani", title:"Head of Data", company:"HabitatPulse", city:"Lyon", score:91, signal:"Levée Série B · 18 M€", channel:"Email", status:"En séquence", email:"yanis@habitatpulse.com", last:"Il y a 34 min" },
  { initials:"SB", name:"Sophie Bernard", title:"Directrice Data & IA", company:"Mutuelle Nova", city:"Nantes", score:88, signal:"Migration vers Azure AI", channel:"Email", status:"A répondu", email:"s.bernard@mutuellenova.fr", last:"Aujourd’hui, 09:42" },
  { initials:"TL", name:"Thomas Leroy", title:"VP Engineering", company:"Kinetix Retail", city:"Lille", score:84, signal:"Nouveau poste depuis 32 j", channel:"LinkedIn", status:"À enrichir", email:"—", last:"Hier, 17:10" },
  { initials:"AD", name:"Amina Diallo", title:"Chief Digital Officer", company:"Groupe Aster", city:"Paris", score:81, signal:"Interagit avec Dust", channel:"LinkedIn", status:"Qualifié", email:"amina.diallo@groupeaster.fr", last:"Hier, 15:28" },
  { initials:"PL", name:"Paul Leclerc", title:"Responsable Innovation", company:"Mediance", city:"Bordeaux", score:77, signal:"Appel d’offres GenAI", channel:"Email", status:"En séquence", email:"paul.leclerc@mediance.eu", last:"22 juil., 14:05" },
  { initials:"IN", name:"Inès Nguyen", title:"CTO", company:"Transmobilité", city:"Paris", score:73, signal:"A visité notre profil", channel:"LinkedIn", status:"Nouveau", email:"ines.nguyen@transmobilite.fr", last:"22 juil., 11:48" }
];

export const companies = [
  { name:"Finovox", domain:"finovox.fr", industry:"Fintech", size:"620", city:"Paris", signals:3, contacts:4, fit:96, status:"Prioritaire" },
  { name:"HabitatPulse", domain:"habitatpulse.com", industry:"Proptech", size:"1 240", city:"Lyon", signals:5, contacts:7, fit:93, status:"Prioritaire" },
  { name:"Mutuelle Nova", domain:"mutuellenova.fr", industry:"Assurance", size:"3 800", city:"Nantes", signals:2, contacts:9, fit:89, status:"Compte cible" },
  { name:"Kinetix Retail", domain:"kinetix-retail.eu", industry:"Retail", size:"870", city:"Lille", signals:2, contacts:3, fit:85, status:"Compte cible" },
  { name:"Groupe Aster", domain:"groupeaster.fr", industry:"Services", size:"4 600", city:"Paris", signals:4, contacts:12, fit:82, status:"En recherche" },
  { name:"Mediance", domain:"mediance.eu", industry:"Santé", size:"2 100", city:"Bordeaux", signals:1, contacts:5, fit:78, status:"À surveiller" }
];

export const campaigns = [
  { name:"CTO · RAG Entreprise · France", status:"Active", channel:"LinkedIn + Email", prospects:186, sent:94, replies:23, meetings:7, rate:"24,5 %", owner:"Salim", next:"32 actions aujourd’hui" },
  { name:"Head of Data · Agents métiers", status:"Validation", channel:"Email", prospects:74, sent:0, replies:0, meetings:0, rate:"—", owner:"Salim", next:"18 messages à valider" },
  { name:"Likers concurrents · Gouvernance IA", status:"Active", channel:"LinkedIn", prospects:93, sent:61, replies:11, meetings:3, rate:"18,0 %", owner:"Salim", next:"Relance dans 2 h" },
  { name:"Réseau 1er degré · IgnitionRAG", status:"Pause", channel:"LinkedIn", prospects:48, sent:35, replies:9, meetings:4, rate:"25,7 %", owner:"Salim", next:"Compte LinkedIn en pause" },
  { name:"DSI ETI · Audit GenAI", status:"Terminée", channel:"Email", prospects:120, sent:116, replies:18, meetings:5, rate:"15,5 %", owner:"Salim", next:"Terminée le 18 juil." }
];

export const conversations = [
  { initials:"SB", name:"Sophie Bernard", company:"Mutuelle Nova", time:"09:42", preview:"Oui, le sujet gouvernance nous concerne. Vous avez déjà travaillé avec...", status:"À répondre", unread:2, intent:"Intéressée" },
  { initials:"YA", name:"Yanis Amrani", company:"HabitatPulse", time:"Hier", preview:"Merci pour le message. On vient justement de reprendre notre stack data.", status:"Brouillon IA", unread:1, intent:"À qualifier" },
  { initials:"AD", name:"Amina Diallo", company:"Groupe Aster", time:"Hier", preview:"Mardi 14h peut fonctionner. Envoyez-moi une invitation.", status:"RDV proposé", unread:0, intent:"Rendez-vous" },
  { initials:"CM", name:"Claire Martin", company:"Finovox", time:"22 juil.", preview:"Pas maintenant, recontactez-moi en septembre.", status:"Snooze", unread:0, intent:"Plus tard" },
  { initials:"PL", name:"Paul Leclerc", company:"Mediance", time:"21 juil.", preview:"Pouvez-vous préciser ce que vous entendez par RAG gouverné ?", status:"À répondre", unread:0, intent:"Question" }
];

export const opportunities = [
  { company:"Mutuelle Nova", contact:"Sophie Bernard", title:"Pilote RAG conformité", value:"45 000 €", probability:70, next:"Atelier sécurité · 29 juil.", age:"8 j", stage:"Opportunité" },
  { company:"Groupe Aster", contact:"Amina Diallo", title:"Agents métier multi-départements", value:"82 000 €", probability:45, next:"Premier rendez-vous · 30 juil.", age:"3 j", stage:"Rendez-vous" },
  { company:"HabitatPulse", contact:"Yanis Amrani", title:"Audit architecture GenAI", value:"12 000 €", probability:25, next:"Qualifier budget", age:"1 j", stage:"Qualifié" },
  { company:"Mediance", contact:"Paul Leclerc", title:"IgnitionRAG entreprise", value:"60 000 €", probability:15, next:"Répondre à la question RAG", age:"2 j", stage:"Conversation" }
];

export const navGroups = [
  { label:"Piloter", items:[
    ["dashboard","Vue d’ensemble","LayoutDashboard","dashboard.html"],
    ["approvals","À valider","CircleCheckBig","approvals.html","6"],
    ["inbox","Inbox","MessagesSquare","inbox.html","3"],
    ["pipeline","Pipeline","Columns3","pipeline.html"]
  ]},
  { label:"Prospecter", items:[
    ["prospects","Prospects","Users","prospects.html"],
    ["companies","Entreprises","Building2","companies.html"],
    ["campaigns","Campagnes","Send","campaigns.html"],
    ["sequences","Séquences","ListTree","sequences.html"]
  ]},
  { label:"Intelligence", items:[
    ["product-reading","Trouver mon ICP","ScanSearch","product-reading.html"],
    ["offers","Offres","Package","offers.html"],
    ["icps","ICP","Target","icps.html"],
    ["knowledge","Connaissance","LibraryBig","knowledge.html"],
    ["ai-studio","Studio IA","Sparkles","ai-studio.html"],
    ["analytics","Analytics","ChartNoAxesCombined","analytics.html"]
  ]},
  { label:"Configurer", items:[
    ["integrations","Intégrations","Plug","integrations.html"],
    ["settings","Paramètres","Settings2","settings.html"],
    ["components","Composants","Blocks","components.html"]
  ]}
];
