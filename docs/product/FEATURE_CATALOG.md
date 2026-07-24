# Catalogue des features

## Légende

| Priorité | Sens |
|---|---|
| `P0` | indispensable à la première boucle de prospection utilisable |
| `P1` | nécessaire à la boucle multicanale et au pilotage commercial |
| `P2` | amélioration après validation de la boucle principale |
| `AI` | capacité différée jusqu’à la phase IA |

Les identifiants sont stables. Une feature peut être divisée en tâches
techniques sans changer son identifiant produit.

## Epic 1 — Socle multi-workspace

### F-001 — Authentification et sessions (`P0`)

**Valeur** : accéder à l’application avec une identité fiable.

**Périmètre** : connexion, déconnexion, récupération de session, protection des
routes, expiration et révocation.

**Critères d’acceptation**

- un utilisateur non connecté est redirigé vers `/login` ;
- une session valide ouvre le dernier workspace accessible ;
- une session révoquée ne permet plus aucune mutation ;
- les erreurs d’authentification ne révèlent pas l’existence d’un compte ;
- aucun secret de session n’est journalisé.

**Dépendances** : Better Auth, PostgreSQL.  
**Surface** : `/login`, shell applicatif.

### F-002 — Workspaces, membres et rôles (`P0`)

**Valeur** : isoler plusieurs organisations et répartir les responsabilités.

**Périmètre** : création, sélection, invitation, acceptation, rôles
`owner/admin/operator/reviewer/viewer`, désactivation d’un accès.

**Critères d’acceptation**

- un utilisateur peut appartenir à plusieurs workspaces ;
- chaque lecture et mutation est limitée au workspace de la route et de la
  session ;
- un membre ne peut pas s’attribuer un rôle supérieur ;
- le dernier owner actif ne peut pas être retiré ;
- une invitation expirée ou déjà consommée est refusée ;
- les changements de rôle sont audités.

**Dépendances** : F-001.  
**Surface** : `/onboarding`, `/w/[workspaceSlug]/settings`.

### F-003 — Audit, jobs et outbox (`P0`)

**Valeur** : rendre les traitements traçables, reprenables et sûrs.

**Périmètre** : journal d’audit, outbox transactionnelle, jobs PostgreSQL,
retries bornés, dead letters, idempotence et corrélation.

**Critères d’acceptation**

- un événement n’est jamais publié sans le changement d’état associé ;
- la relivraison d’un webhook ou job ne duplique pas son effet ;
- chaque mutation sensible conserve acteur, workspace, date et résultat ;
- un opérateur peut identifier et relancer un job en échec sans nouvel effet
  métier si le premier a réussi ;
- les logs excluent secrets et données personnelles non nécessaires.

**Dépendances** : F-001, F-002.  
**Surface** : health endpoints, administration technique.

### F-004 — Design system et shell applicatif (`P0`)

**Valeur** : fournir une navigation cohérente et réutilisable.

**Périmètre** : tokens, primitives shadcn/ui, AppShell, navigation filtrée par
rôle, états loading/empty/error/forbidden/provider-down et responsive.

**Critères d’acceptation**

- les 23 écrans du prototype possèdent une route ou une destination déclarée ;
- la navigation masque les actions interdites sans remplacer les contrôles
  serveur ;
- les pages principales sont utilisables à 375, 768, 1024 et 1440 px ;
- les composants métier ne sont pas introduits dans `components/ui` ;
- les états de chargement ne provoquent pas de déplacement majeur de layout.

**Dépendances** : F-001, F-002.

## Epic 2 — Stratégie commerciale

### F-010 — Offres et versions publiées (`P0`)

**Valeur** : formaliser ce qui est vendu et ce qui peut être affirmé.

**Périmètre** : offre brouillon, catégorie, proposition de valeur, claims,
preuves, objections, prix communicables, contraintes et publication immuable.

**Critères d’acceptation**

- une offre brouillon reste modifiable ;
- publier crée une version immuable numérotée ;
- une modification ultérieure ne change pas les campagnes existantes ;
- un claim peut référencer sa preuve et son statut de validation ;
- une offre incomplète ne peut pas être publiée.

**Dépendances** : F-002, F-003.  
**Surface** : `/w/[workspaceSlug]/offers`.

### F-011 — ICP et versions publiées (`P0`)

**Valeur** : définir précisément les entreprises et personnes à cibler.

**Périmètre** : critères d’inclusion/exclusion, personas, géographies, tailles,
technologies, signaux, pondérations et publication immuable.

**Critères d’acceptation**

- les critères obligatoires, souhaitables et exclusifs sont distingués ;
- les critères contradictoires sont signalés avant publication ;
- publier crée une version immuable exploitable par la découverte ;
- chaque prospect peut expliquer quels critères sont satisfaits ou absents ;
- une campagne n’utilise jamais un brouillon.

**Dépendances** : F-002, F-003.  
**Surface** : `/w/[workspaceSlug]/icps`.

### F-012 — Stratégie de message et politique de supervision (`P0`)

**Valeur** : encadrer le ton, les preuves, les CTA et les actions autorisées.

**Périmètre initial** : versions manuelles de stratégie et politique,
templates par canal, variables autorisées, règles d’approbation et escalade.

**Critères d’acceptation**

- une version publiée est immuable ;
- les variables inconnues ou non résolues bloquent l’approbation ;
- chaque canal possède ses longueurs, CTA et contraintes ;
- le premier contact et toute réponse restent soumis à validation humaine ;
- aucune génération par modèle n’est requise dans cette feature.

**Dépendances** : F-010, F-011.  
**Surface** : offres, séquences, campagne builder.

## Epic 3 — CRM et intelligence prospect

### F-020 — Entreprises (`P0`)

**Valeur** : disposer d’une fiche entreprise canonique et exploitable.

**Périmètre** : création, recherche, domaines, taille, secteur, localisation,
identifiants externes, contacts liés et historique.

**Critères d’acceptation**

- le domaine normalisé est unique par workspace lorsqu’il est connu ;
- une entreprise d’un autre workspace est invisible ;
- chaque champ enrichi conserve source, date et confiance ;
- la fiche expose contacts, signaux et campagnes liés ;
- les recherches sont paginées et filtrables.

**Dépendances** : F-002, F-003.  
**Surface** : entreprises et détail entreprise.

### F-021 — Contacts, identités et emplois (`P0`)

**Valeur** : suivre une personne malgré ses changements d’employeur.

**Périmètre** : identité canonique, emails, LinkedIn, téléphone/WhatsApp,
emplois historisés, préférence de canal et provenance.

**Critères d’acceptation**

- un changement d’emploi ne crée pas automatiquement une nouvelle personne ;
- chaque identité porte son statut de vérification ;
- le contact expose l’emploi courant et les emplois historiques ;
- les données inconnues restent distinguées des données invalides ;
- une identité supprimée ne peut pas redevenir éligible par réimport.

**Dépendances** : F-020.  
**Surface** : prospects et détail prospect.

### F-022 — Import manuel et CSV (`P0`)

**Valeur** : alimenter le CRM avant tout connecteur de sourcing.

**Périmètre** : création manuelle, import CSV prévisualisé, mapping, validation,
rapport de lignes acceptées/rejetées et traitement idempotent.

**Critères d’acceptation**

- aucun import n’est appliqué avant prévisualisation ;
- relancer le même fichier ne crée pas de doublons ;
- les erreurs sont rapportées par ligne sans annuler les lignes valides ;
- les suppressions sont contrôlées avant création d’identités ;
- la provenance `manual` ou `csv` est conservée.

**Dépendances** : F-020, F-021, F-024, F-026.

### F-023 — Découverte de prospects (`P0`)

**Valeur** : trouver des candidats correspondant à un ICP publié.

**Périmètre initial** : recherche via `ProspectSource`, critères explicites,
prévisualisation des candidats, provenance et import sélectionné.

**Critères d’acceptation**

- seule une ICPVersion publiée peut lancer une recherche ;
- les filtres envoyés au fournisseur sont enregistrés ;
- un candidat n’entre pas dans le CRM sans provenance ;
- les correspondances et écarts ICP sont visibles ;
- un fournisseur indisponible produit un état récupérable, pas une liste vide
  trompeuse.

**Dépendances** : F-011, F-020, F-021, F-026.  
**Surface** : `/w/[workspaceSlug]/prospects/discover`.

### F-024 — Déduplication et fusion réversible (`P0`)

**Valeur** : préserver un CRM propre sans perdre de données.

**Périmètre** : matching certain, candidats probables, revue, fusion auditée et
annulation.

**Critères d’acceptation**

- une identité certaine peut déclencher une fusion automatique ;
- un match probable exige une décision humaine ;
- le nom seul ne suffit jamais ;
- la fusion conserve toutes les sources et références ;
- l’annulation restaure les deux contacts et réaffecte leurs relations.

**Dépendances** : F-003, F-021.

### F-025 — Enrichissement et vérification (`P0`)

**Valeur** : compléter les profils et trouver des coordonnées professionnelles.

**Périmètre** : `ContactEnrichment`, recherche email professionnel, statut de
vérification, fraîcheur, confiance, coût et reprise asynchrone.

**Critères d’acceptation**

- l’utilisateur choisit ou comprend les données à enrichir ;
- un résultat n’écrase pas silencieusement une donnée plus fiable ;
- l’absence de résultat est distinguée d’une erreur fournisseur ;
- chaque valeur conserve fournisseur, date, preuve et confiance ;
- les coûts et quotas fournisseurs sont mesurables.

**Dépendances** : F-003, F-020, F-021, F-024.

### F-026 — Suppressions et éligibilité canal (`P0`)

**Valeur** : empêcher tout contact interdit, inapproprié ou techniquement
impossible.

**Périmètre** : suppression globale ou canal, empreintes persistantes, règles
d’éligibilité, justification et audit.

**Critères d’acceptation**

- une opposition générale bloque immédiatement toutes les nouvelles actions ;
- un blocage canal laisse uniquement les fallbacks explicitement autorisés ;
- le contrôle est répété à l’import, à l’enrollment et juste avant l’envoi ;
- une suppression survit à la fusion ou anonymisation ;
- seul un rôle autorisé peut lever une suppression, avec justification.

**Dépendances** : F-003, F-021.

### F-027 — Signaux entreprise et contact (`P1`)

**Valeur** : prioriser selon des événements observables.

**Périmètre** : recrutement, levée, changement de poste, activité disponible,
source, date d’observation, expiration et niveau de confiance.

**Critères d’acceptation**

- tout signal possède type, cible, source, date et confiance ;
- un signal expiré n’est plus présenté comme actuel ;
- un même événement fournisseur est dédupliqué ;
- les signaux peuvent filtrer une recherche et expliquer une priorité ;
- les données non disponibles via un fournisseur ne sont pas simulées.

**Dépendances** : F-020, F-021, F-023.

## Epic 4 — Campagnes et exécution

### F-030 — Séquences multicanales versionnées (`P0`)

**Valeur** : composer un playbook reproductible.

**Périmètre** : étapes linéaires, LinkedIn/email/WhatsApp/tâche manuelle, délais,
conditions, fenêtres, fallback, templates, validation et publication.

**Critères d’acceptation**

- une séquence brouillon est modifiable et prévisualisable ;
- une publication crée une SequenceVersion immuable ;
- chaque étape possède au moins un canal éligible ou une tâche manuelle ;
- une séquence invalide ou non approuvée ne peut pas être activée ;
- les fallbacks n’entraînent jamais deux envois pour la même étape logique.

**Dépendances** : F-012, F-026.  
**Surface** : séquences.

### F-031 — Campagne et snapshot immuable (`P0`)

**Valeur** : assembler offre, ICP, stratégie, politique et séquence dans une
unité mesurable.

**Périmètre** : création, builder, préflight, snapshot, activation, pause et
archivage.

**Critères d’acceptation**

- le builder n’accepte que des versions publiées ;
- le préflight vérifie population, canaux, comptes, suppressions et approbation ;
- l’activation fige toutes les références de versions ;
- une campagne active ne peut pas être modifiée rétroactivement ;
- pause et reprise ne recréent pas les actions déjà exécutées.

**Dépendances** : F-010, F-011, F-012, F-030, F-035.  
**Surface** : campagnes, builder et détail.

### F-032 — Population, priorité et enrollment (`P0`)

**Valeur** : sélectionner les bons prospects et maîtriser leur entrée en
campagne.

**Périmètre initial** : filtres déterministes, score pondéré par critères ICP,
explication, sélection manuelle, conflits et enrollment.

**Critères d’acceptation**

- chaque score est reproductible à partir de critères enregistrés ;
- l’explication distingue faits, données manquantes et exclusions ;
- un contact n’a qu’une séquence active par workspace ;
- les prospects supprimés ou sans canal valide sont exclus ;
- un conflit d’enrollment indique la campagne active concernée.

**Dépendances** : F-023, F-026, F-031.  
**Surface** : campagne builder, campagne détail, approvals.

### F-033 — File d’approbation (`P0`)

**Valeur** : superviser efficacement les actions sensibles.

**Périmètre** : lots, aperçu contextualisé, édition, validation, rejet,
justification, filtres et permissions.

**Critères d’acceptation**

- chaque item montre prospect, entreprise, canal, étape, contenu et preuves ;
- un reviewer peut modifier puis approuver un item ;
- un contenu obsolète après changement de données retourne en revue ;
- les décisions en lot ne masquent pas les items devenus invalides ;
- chaque décision est auditée.

**Dépendances** : F-031, F-032.  
**Surface** : `/w/[workspaceSlug]/approvals`.

### F-034 — Scheduler et actions d’outreach (`P0`)

**Valeur** : exécuter les séquences de façon fiable.

**Périmètre** : planification, fenêtres horaires, limites, état des actions,
attempts, retries, idempotence, pause et annulation.

**Critères d’acceptation**

- aucune action n’est envoyée sans approbation requise ;
- suppression, réponse et santé du compte sont revérifiées avant exécution ;
- une clé d’idempotence protège chaque action logique ;
- un rate limit décale l’action sans la dupliquer ;
- une action annulée ne peut plus être exécutée par un job déjà livré.

**Dépendances** : F-003, F-026, F-033, F-035.

### F-035 — Comptes connectés et santé fournisseurs (`P0`)

**Valeur** : connecter les canaux d’envoi et connaître leur capacité réelle.

**Périmètre** : connexion Unipile, comptes LinkedIn/email/WhatsApp, statut,
capacités, quotas, erreurs, reconnexion et webhooks.

**Critères d’acceptation**

- les secrets fournisseurs ne transitent jamais vers le navigateur ;
- les capacités sont lues du compte, pas supposées par canal ;
- un compte dégradé suspend ses actions sans bloquer les autres comptes ;
- les webhooks sont vérifiés, persistés et traités idempotemment ;
- la suppression d’un compte préserve l’historique des conversations.

**Dépendances** : F-002, F-003.  
**Surface** : `/w/[workspaceSlug]/integrations`.

## Epic 5 — Inbox et revenu

### F-040 — Inbox unifiée (`P1`)

**Valeur** : traiter les conversations multicanales depuis un seul écran.

**Périmètre** : conversations par canal/compte, vue regroupée par contact,
messages entrants/sortants, filtres, unread et assignation.

**Critères d’acceptation**

- les threads fournisseurs restent identifiables et ordonnés ;
- les événements reçus deux fois ne créent pas deux messages ;
- une conversation affiche la campagne et le prospect liés ;
- un message non rattaché est conservé dans une file de réconciliation ;
- les permissions workspace s’appliquent aux recherches et compteurs.

**Dépendances** : F-021, F-035.  
**Surface** : `/w/[workspaceSlug]/inbox`.

### F-041 — Suspension immédiate sur réponse (`P0`)

**Valeur** : éviter tout message automatique après une réponse.

**Périmètre** : traitement entrant prioritaire, suspension des enrollments,
annulation des actions futures et résolution de course.

**Critères d’acceptation**

- toute réponse entrante suspend les enrollments du contact avant traitement
  éditorial ;
- une action concurrente revérifie la suspension dans la transaction finale ;
- les actions futures sont annulées de manière idempotente ;
- l’opérateur voit la cause et l’heure de suspension ;
- la reprise exige une action humaine explicite.

**Dépendances** : F-003, F-034, F-040.

### F-042 — Réponse humaine et brouillons (`P1`)

**Valeur** : répondre vite tout en gardant le contrôle.

**Périmètre initial** : rédaction manuelle, brouillons, édition, approbation,
envoi idempotent, notes et feedback. La génération IA est différée.

**Critères d’acceptation**

- un brouillon n’est jamais envoyé sans action explicite du reviewer ;
- le contexte de conversation complet est visible pendant la rédaction ;
- une nouvelle réponse entrante invalide un brouillon devenu obsolète ;
- l’envoi utilise le même thread et compte lorsque le fournisseur le permet ;
- rejet, édition et approbation sont audités.

**Dépendances** : F-033, F-034, F-040, F-041.

### F-043 — Rendez-vous et calendrier (`P1`)

**Valeur** : convertir une conversation en rendez-vous traçable.

**Périmètre** : lien de réservation, proposition de créneaux, webhook calendrier,
meeting, participants, statut et rattachement.

**Critères d’acceptation**

- un rendez-vous est rattaché au contact, workspace et opportunité éventuelle ;
- un webhook relivré ne crée pas un second rendez-vous ;
- annulation et déplacement mettent à jour le même rendez-vous ;
- les fuseaux horaires sont explicites ;
- l’historique reste disponible après déconnexion du calendrier.

**Dépendances** : F-003, F-040.

### F-044 — Pipeline et opportunités (`P1`)

**Valeur** : suivre la prospection jusqu’au revenu gagné ou perdu.

**Périmètre** : étapes, opportunité, valeur, probabilité, owner, prochaine
action, clôture, motif de perte et historique.

**Critères d’acceptation**

- chaque changement d’étape ajoute un historique immuable ;
- gagné et perdu exigent les champs de clôture appropriés ;
- une opportunité conserve l’offre/version d’origine ;
- les montants possèdent une devise ;
- devis, contrat, facturation et delivery restent hors périmètre.

**Dépendances** : F-020, F-021, F-040, F-043.  
**Surface** : `/w/[workspaceSlug]/pipeline`.

## Epic 6 — Pilotage et administration

### F-050 — Sources de connaissance (`P1`)

**Valeur** : centraliser les preuves utilisables dans les messages.

**Périmètre initial** : sources, documents, claims, validation, fraîcheur,
statut d’indexation et liens vers offres. Pas de RAG requis.

**Critères d’acceptation**

- un claim cite au moins une source avant d’être marqué validé ;
- les sources expirées ou invalidées sont visibles ;
- retirer une source n’altère pas les campagnes déjà exécutées ;
- le contenu est isolé par workspace ;
- l’indexation reste derrière `KnowledgeRetriever`.

**Dépendances** : F-003, F-010.  
**Surface** : `/w/[workspaceSlug]/knowledge`.

### F-051 — Événements analytics et dashboards (`P1`)

**Valeur** : mesurer acquisition, exécution, réponse, rendez-vous et revenu.

**Périmètre** : taxonomie d’événements, projections, filtres campagne/ICP/rôle/
signal/canal/variante, attribution et export.

**Critères d’acceptation**

- intention, tentative, accepté, livré et répondu sont distincts ;
- les dénominateurs et périodes sont affichés ;
- les événements dupliqués ne gonflent pas les métriques ;
- chaque métrique est filtrée par workspace ;
- les résultats sont reproductibles sans modèle IA.

**Dépendances** : F-003, F-031, F-034, F-040, F-044.  
**Surface** : dashboard et analytics.

### F-052 — Onboarding guidé (`P1`)

**Valeur** : rendre un nouveau workspace opérationnel rapidement.

**Périmètre** : création workspace, première offre, premier ICP, import ou
connexion, checklist et reprise.

**Critères d’acceptation**

- l’onboarding peut être quitté et repris ;
- chaque étape montre le prérequis manquant ;
- le workspace reste utilisable sans connecter tous les canaux ;
- les données créées utilisent les mêmes cas d’usage que l’application ;
- le succès mène à une prochaine action explicite.

**Dépendances** : F-002, F-010, F-011, F-022, F-035.  
**Surface** : `/onboarding`.

### F-053 — Paramètres, sécurité et cycle de vie des données (`P1`)

**Valeur** : administrer le workspace sans intervention technique.

**Périmètre** : profil workspace, membres, politiques, rétention, export,
anonymisation, audit visible et préférences.

**Critères d’acceptation**

- seules les permissions requises exposent une section ;
- un export est généré en job et son accès expire ;
- anonymiser préserve les suppressions nécessaires ;
- une opération destructive demande confirmation et reste auditée ;
- les réglages ne changent pas rétroactivement les campagnes actives.

**Dépendances** : F-002, F-003, F-026.  
**Surface** : settings.

## Epic 7 — Capacités IA différées

### AI-100 — Scoring et explication assistés

Améliorer F-032 avec un modèle, sans remplacer les exclusions déterministes ni
la traçabilité des faits.

### AI-110 — Recherche et rédaction personnalisée

Produire des brouillons de premiers contacts à partir des versions de campagne,
des données réelles et de claims sourcés. Toute sortie reste en F-033.

### AI-120 — Classification et brouillon de réponse

Classer l’intention, proposer une réponse et détecter les sujets sensibles.
Toute réponse reste en F-042 avec approbation humaine.

### AI-130 — Retrieval et RAG

Implémenter `KnowledgeRetriever` avec PostgreSQL FTS, puis pgvector ou ParadeDB
uniquement après benchmark.

### AI-140 — Évaluation et optimisation

Conserver les `AIRun`, jeux d’évaluation, feedback, coûts et recommandations de
campagne. Aucune optimisation n’est appliquée automatiquement à une campagne
active.

## Hors périmètre fonctionnel initial

- facturation SaaS et plans ;
- devis, contrats, delivery et support client ;
- autonomie IA complète ;
- scraping contournant les capacités des fournisseurs ;
- warmup email maison ;
- workflow visuel arbitraire ;
- RAG ou ParadeDB sans besoin mesuré.
