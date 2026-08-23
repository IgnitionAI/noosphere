# Prospect 360 — mémoire durable et context engineering

**Statut :** APPROVED — design validé par le produit et la revue multi-agent
**Date :** 2026-08-23
**Portée :** agents Outbound, Setter, qualification, appels et signaux Inbound de Noosphere

## Résumé

Noosphere remplace la fenêtre conversationnelle limitée aux messages récents par une mémoire durable centrée sur le prospect. Cette mémoire réunit les conversations LinkedIn, email et WhatsApp, les appels, campagnes, interactions Inbound et changements CRM, sans conserver d'état critique dans une instance d'agent ou une session CLI.

Les événements métier existants restent les sources de vérité. Un job durable et idempotent construit une projection versionnée `ProspectMemorySnapshot`. À chaque invocation, un `ContextAssembler` produit une vue adaptée à la capacité demandée : noyau factuel, mémoire relationnelle, événements récents et épisodes anciens récupérés de manière ciblée.

La mémoire peut produire une recommandation candidate, mais `prospect_decisions` reste l'unique registre de prochaine action. Les policies déterministes restent souveraines pour les opt-out, canaux, quotas, horaires et exceptions.

## Compréhension validée

- Une mémoire Prospect 360 centrale réunit LinkedIn, email, WhatsApp, appels, campagnes et interactions.
- Seules les données observées deviennent des faits ; les conclusions IA restent des hypothèses identifiées et sourcées.
- Les identités sont rapprochées prudemment, automatiquement lorsque les preuves sont fortes, avec fusion réversible.
- L'historique reste immuable tandis qu'une projection expose l'état courant.
- Tous les agents partagent le même noyau factuel, avec des vues contextuelles par tâche et un budget de tokens adaptatif.
- Chaque événement significatif déclenche un job durable. En cas de retard, l'agent reçoit le dernier résumé valide complété par les événements récents non intégrés.
- La mémoire recommande la prochaine action, mais la policy déterministe décide. Une contradiction, l'oubli d'un refus, la perte d'un engagement ou une relance après opt-out sont des échecs bloquants.

## Hypothèses

- PostgreSQL, les jobs durables et l'outbox existants restent les primitives standard.
- Les tables métier actuelles restent les sources fonctionnelles. Un journal mémoire minimal capture leurs mutations pertinentes ; ce lot ne transforme pas toute l'application en event sourcing.
- Les derniers messages restent une fenêtre récente utile, mais ne constituent plus la mémoire principale.
- Les workers et repositories peuvent être long-lived s'ils ne conservent aucun état prospect mutable.
- Chaque invocation Kimi ou Codex reste transiente et reçoit un contexte explicite reconstruit pour le job.
- La rétention est configurable par workspace.
- Les opt-out et obligations légales sont conservés durablement.
- Une suppression de contenu personnel rend volontairement la reconstruction historique impossible. Seule l'empreinte pseudonymisée et corrélable du registre F-026 peut survivre pour faire respecter un opt-out.
- L'enveloppe V1 cible 20 workspaces, 100 000 prospects actifs, 5 millions d'événements mémoire, 10 événements/s soutenus et 100 événements/s en pointe. Ces valeurs sont des hypothèses de benchmark, pas des limites produit.

## Architecture retenue

### 1. Identité unifiée

Le Prospect 360 rassemble les identifiants LinkedIn, emails, téléphones, identifiants provider, entreprise et relations connues. Une liaison automatique exige plusieurs signaux concordants.

Les données ne sont jamais physiquement déplacées lors d'une fusion. Chaque événement reste attaché à son identité source. Une table de liens versionnés compose la vue Prospect 360 avec `validFrom`, `validTo`, preuves et règle de rapprochement. Séparer deux profils consiste à fermer le lien : les événements créés pendant la période restent attribués à leur identité source et les projections concernées sont reconstruites. Les opérations touchant plusieurs prospects acquièrent leurs verrous dans un ordre stable.

### 2. Journal factuel immuable

Chaque mutation couverte ajoute dans sa transaction un événement mémoire minimal. Celui-ci possède un `sequenceId` monotone attribué par PostgreSQL, indépendant des timestamps provider. Le watermark est exclusivement ce `sequenceId`. `occurredAt` décrit le temps métier, `observedAt` l'ingestion et ne servent jamais de curseur.

L'unicité `(workspaceId, sourceKind, sourceId, sourceVersion)` assure la déduplication. Un backfill ancien reçoit un nouveau `sequenceId` et sera donc traité. Une correction porte `supersedesEventId`, `validFrom` et, si nécessaire, `validTo`. Les échéances sont stockées en UTC avec leur fuseau d'origine.

Une matrice de couverture versionnée relie chaque mutation autoritative — message entrant/sortant, appel, interaction, changement de contact, décision, campagne, suppression — au type d'événement mémoire attendu. Les chemins d'écriture directs non couverts doivent être migrés ou explicitement exclus avant activation. Le topic outbox possède son propre curseur de consommateur ; sa consommation ne marque pas l'événement comme traité pour les autres abonnés.

### 3. État courant déterministe

Cette projection expose les informations confirmées actuellement applicables : identité professionnelle, entreprise, rôle, langue, canaux disponibles, consentement, opt-out, statut relationnel, rendez-vous et campagnes actives.

Les champs critiques sont calculés à partir des règles métier et ne dépendent pas d'une interprétation libre du modèle.

### 4. Mémoire relationnelle synthétique

Une synthèse IA versionnée organise :

- besoins confirmés ;
- objections ouvertes, traitées ou dépassées ;
- engagements pris par chaque partie ;
- sujets déjà expliqués ;
- éléments à ne pas répéter ;
- questions ouvertes ;
- ton recommandé ;
- recommandation candidate et date minimale, sans autorité d'exécution ;
- contradictions et informations manquantes.

Chaque élément sémantique référence un extrait exact borné et les événements qui le justifient. Une référence prouve la provenance, pas la justesse de l'interprétation : celle-ci est évaluée sur un corpus labellisé. Les hypothèses sont stockées séparément avec confiance, preuves et expiration.

### 5. Mémoire épisodique récupérable

Les messages et événements anciens pourront être indexés pour retrouver un détail ponctuel. La V1 utilise d'abord les sources structurées et les recherches SQL bornées ; l'index sémantique n'est activé que si l'évaluation démontre un défaut de rappel. Une récupération enrichit le contexte, mais ne peut jamais déterminer seule qu'une action est sûre. Tout résultat conserve son identifiant source et son niveau de confiance.

## Cycle de reconstruction

1. Une mutation présente dans la matrice de couverture persiste son événement mémoire et une demande `prospect_memory.refresh` dans la même transaction.
2. Les demandes rapprochées d'un même prospect sont coalescées.
3. Le worker charge le dernier snapshot et son watermark.
4. Il récupère les événements postérieurs au watermark.
5. Il normalise les faits déterministes.
6. Le modèle produit une nouvelle synthèse relationnelle structurée.
7. Un validateur contrôle les références, les invariants critiques et l'absence de régression.
8. La nouvelle version et son watermark sont publiés atomiquement.

Le job lit un `targetSequenceId` au démarrage et ne publie que jusqu'à cette borne. Tout événement concurrent reçoit un `sequenceId` supérieur et déclenche le passage suivant. Le lock et la contrainte d'unicité empêchent deux versions concurrentes pour le même prospect.

Si le modèle échoue, le dernier snapshot reste actif. Le `ContextAssembler` retire les événements déjà couverts (`sequenceId <= watermark`), calcule d'abord un overlay déterministe sur le delta, puis joint le delta comme contenu externe non synthétisé. Un opt-out ou refus explicite détecté dans ce delta force immédiatement `STOP`; une contradiction ambiguë force `WAIT` jusqu'à la reconstruction. Le delta ne peut donc pas silencieusement supplanter une règle critique.

Le traitement est sérialisé logiquement par prospect, sans conserver de transaction ni advisory lock pendant l'appel modèle :

1. une transaction courte acquiert le lock, réserve une lease et lit `baseSnapshotVersion`, `targetSequenceId` et `privacyEpoch` ;
2. l'inférence s'exécute hors transaction ;
3. une transaction courte reprend le lock et publie seulement si les trois valeurs sont encore valides ;
4. sinon le résultat est jeté et un nouveau job reprend les événements courants.

La lease dure deux minutes avec heartbeat toutes les trente secondes. L'inférence dispose d'une deadline de soixante secondes. Après trois tentatives avec backoff 15 s, 60 s puis 5 min, le job devient `failed` et une exception opérateur est créée. Un crash ne perd aucun événement commité (RPO 0) ; le lease reaper rend le job reprenable en moins de cinq minutes (RTO worker). Plusieurs prospects peuvent être reconstruits en parallèle. Quitter une page, fermer un drawer ou interrompre une requête navigateur ne modifie jamais le job serveur.

## Contrat du snapshot

### Métadonnées

- identifiants workspace et prospect ;
- numéro de version ;
- watermark et plage d'événements intégrée ;
- date de génération ;
- modèle, prompt et policy ;
- hash canonique du résultat pour déduplication, sans prétention de chaîne d'intégrité.

### Vérité actuelle

- identité, entreprise, poste, localisation et langue ;
- canaux disponibles et état de chaque compte ;
- consentement, opt-out et restrictions ;
- campagnes, rendez-vous et statut relationnel actifs.

### Mémoire commerciale

- besoins et informations confirmés ;
- objections avec état et références ;
- engagements avec auteur, échéance et état ;
- sujets traités et éléments à ne pas répéter ;
- questions ouvertes ;
- recommandation candidate, justification, date minimale et expiration ;
- référence éventuelle vers la décision durable active, qui reste autoritative.

### Synthèse IA

- résumé relationnel compact ;
- tonalité recommandée ;
- hypothèses séparées ;
- contradictions et données manquantes.

## Invariants

- Chaque fait normalisé possède une référence source résoluble tant que la source est légalement conservée.
- Chaque assertion IA possède un extrait exact borné et une référence source ; cela garantit la traçabilité, pas la vérité sémantique.
- Un opt-out provient exclusivement des règles déterministes.
- Une hypothèse ne devient jamais silencieusement un fait.
- Une correction explicite supplante l'état courant antérieur sans effacer l'historique.
- Un engagement issu d'une décision ou tâche structurée ne disparaît pas lors d'une reconstruction. Les engagements extraits du langage naturel restent des assertions sémantiques évaluées.
- Une recommandation candidate possède une durée de validité et ne concurrence jamais `prospect_decisions`.
- Si une règle critique ou un fait structuré régresse, le nouveau snapshot est rejeté. Une régression sémantique est mesurée par l'évaluation, pas déclarée détectable parfaitement.
- La suppression d'un prospect invalide et retire toutes ses projections dérivées conformément à la politique de rétention.

## Assemblage du contexte

Le `ContextAssembler` applique l'ordre de priorité suivant :

1. sécurité et policy ;
2. objectif et limites du job ;
3. vérité actuelle ;
4. décision durable active issue de `prospect_decisions` ;
5. mémoire commerciale ;
6. conversation récente et delta post-watermark du thread concerné ;
7. épisodes anciens récupérés pour une question précise.

Les faits du delta sont résolus par `sequenceId`, `supersedesEventId` et validité temporelle. Les événements externes sont étiquetés `untrusted_content`, délimités comme données et ne peuvent jamais devenir des instructions système ou outil.

### Vues par capacité

- **Setter :** conversation, refus, engagements, objections et tonalité.
- **Rédaction Outbound :** offre, ICP, preuves prospect et contacts antérieurs.
- **Scoring :** faits vérifiés et signaux, sans prose inutile.
- **Préparation d'appel :** chronologie, personnes, besoins, promesses et questions ouvertes.
- **Amélioration manuelle :** brouillon utilisateur et contexte pertinent, sans droit d'envoi.
- **Agents Inbound :** signaux agrégés et attribution ; pas de conversations privées individuelles sans nécessité explicite.

Le budget est adaptatif. Les épisodes les moins pertinents sont retirés en premier. Les règles critiques sont représentées par des flags structurés bornés. Les engagements actifs et corrections sont dédupliqués et plafonnés par récence et statut ; si l'ensemble critique dépasse encore le budget, l'action automatique échoue en sécurité au lieu de tronquer silencieusement.

Chaque invocation enregistre un `context receipt` composé uniquement d'identifiants source, hashes, versions de renderer, requêtes de récupération normalisées, exclusions et compteurs de tokens. Aucun contenu personnel n'est recopié dans le receipt. La traçabilité est garantie tant que les sources sont conservées ; après effacement, le système assume explicitement de ne plus pouvoir reproduire le contexte.

### Mode dégradé borné

Le delta servi directement est limité à 200 événements et sept jours. Un snapshot âgé de plus de vingt-quatre heures, un delta dépassant l'une de ces bornes ou un budget de contexte dépassé interdit toute réponse automatique relationnelle et retourne `WAIT_MEMORY_STALE`. Les flags déterministes — opt-out, suppression, compte et canal — restent applicables indépendamment du modèle. Les actions manuelles peuvent consulter le thread brut selon leurs permissions, mais elles ne sont pas présentées comme une décision du Setter.

Le retour à l'état nominal vise un retard p95 inférieur à soixante secondes et un rattrapage complet inférieur à six heures après rétablissement du fournisseur. Tant que ce gate n'est pas atteint, l'automatisation concernée reste arrêtée de manière localisée.

## Contrat d'expérience utilisateur

La mémoire travaille en arrière-plan et ne crée aucune étape à configurer. Quand elle est saine, aucun panneau technique n'est affiché. Lorsqu'un état affecte une action, l'interface doit répondre sans ambiguïté à trois questions : **le travail continue-t-il, un message a-t-il été envoyé, que va-t-il se passer ensuite ?**

| État interne | Restitution utilisateur obligatoire |
|---|---|
| `queued` ou `running` | « Contexte en cours de mise à jour. Vous pouvez quitter cette page. Aucun message n'est envoyé par cette mise à jour. » |
| snapshot valide | Aucun bruit par défaut ; « Contexte à jour » et date accessibles dans le détail |
| `WAIT_MEMORY_STALE` | « Réponse automatique en pause : le contexte doit être actualisé. Aucun message envoyé. Reprise automatique après mise à jour. » |
| `WAIT_MEMORY_BUDGET` | « Réponse automatique en pause : limite IA atteinte. Aucun message envoyé. » avec l'heure de nouvelle tentative |
| `STOP` | Motif métier en langage clair, confirmation « Aucun message envoyé » et conversation arrêtée |
| `failed` | « Mise à jour du contexte échouée. Aucun message envoyé. Nouvelle tentative automatique » ou action opérateur si les retries sont épuisés |

L'état du job est durable et rechargé au retour sur la page. Répéter une commande avec la même `requestKey` rouvre le même résultat et ne crée ni second job ni second envoi. Les surfaces distinguent visuellement un **job de mémoire**, qui n'envoie rien, d'un **job d'envoi**, qui possède son propre statut provider.

### Transparence progressive

Toute restitution issue du Prospect 360 conserve quatre attributs : nature (`fait`, `hypothèse`, `recommandation`, `décision`), fraîcheur, autorité et provenance. La vue principale reste concise ; un contrôle « Pourquoi ? » ouvre les sources et la date sans exposer les receipts techniques. Une hypothèse n'utilise jamais le style visuel d'un fait, une recommandation candidate jamais celui d'une action planifiée, et un snapshot périmé est signalé dès qu'il affecte la décision.

### Identités rapprochées

La fiche indique qu'elle compose plusieurs identités, les preuves du rapprochement et sa date. Une séparation affiche avant confirmation quelles vues seront reconstruites ; elle ne réattribue ni ne supprime les événements sources. L'opération et son résultat sont audités. Le rapprochement reste automatique dans le chemin normal, mais jamais invisible ni irréversible.

### Anonymisation

Le retour utilisateur distingue l'anonymisation locale immédiate, la purge asynchrone des dérivés et l'expiration contractuelle des sauvegardes ou traces fournisseur. L'interface ne promet jamais une suppression totale instantanée lorsqu'un stockage suit encore une rétention documentée.

## Fiabilité, sécurité et maintenance

- Aucun état prospect mutable dans un singleton, worker, gateway ou session CLI.
- Les composants long-lived sont stateless et utilisent un scope isolé par job.
- Les contextes sont reconstruits depuis les données durables.
- Les reconstructions et publications de snapshots sont idempotentes.
- La rétention est configurable par workspace.
- Les données sensibles ne sont pas copiées dans les logs techniques.
- Le modèle ne peut ni autoriser un envoi ni contourner une policy.
- Tous les accès et index sont filtrés par workspace côté repository, jamais à partir d'un identifiant fourni par le modèle.
- Les contenus provider et prospect sont des données non fiables : ils sont délimités, privés d'outils et ne reçoivent aucune autorité d'exécution. Ces mesures confinent l'impact d'une injection ; elles ne promettent pas que le modèle ignorera parfaitement le texte malveillant.
- L'état mémoire est reconstructible tant que ses sources sont légalement conservées. L'effacement complet rompt volontairement cette propriété.
- Une anonymisation personnelle efface les contenus et assertions dérivés directement identifiants, invalide snapshots et index, puis détache les faits agrégés conformément à F-053. L'empreinte de suppression F-026 reste une donnée pseudonymisée et corrélable — jamais qualifiée d'anonyme ou non réversible — protégée par une clé serveur à accès restreint et conservée selon sa base légale.

### Barrière d'anonymisation

Chaque contact possède un `privacyEpoch`. Un job capture cette valeur avant inférence puis la revérifie dans la transaction de publication. Une anonymisation incrémente l'epoch, annule les jobs en attente et marque les snapshots illisibles avant de programmer la purge. Toute publication issue d'un ancien epoch est refusée ; toute lecture filtre les contacts anonymisés et l'epoch courant. Les caches incluent l'epoch dans leur clé.

L'inventaire de purge couvre : sources personnelles, journal mémoire, assertions, snapshots, index, caches, outbox et jobs, fichiers temporaires et context receipts. Les sauvegardes suivent leur cycle chiffré et expirent sans restauration sélective ; une restauration rejoue immédiatement les tombstones avant remise en service. Les traces déjà transmises à un fournisseur suivent son contrat de rétention et ne peuvent pas être déclarées effacées localement.

### Contrat de traitement par les modèles

Une route IA n'est éligible à la mémoire conversationnelle que si son profil de traitement documente : chiffrement en transit, absence d'entraînement sur les données de service, durée de rétention fournisseur connue et bornée, région ou juridiction, accès opérateur, politique de sous-traitance et procédure d'effacement. La V1 refuse une route dont le profil est absent ou incompatible avec le workspace.

Avant envoi au modèle, le renderer minimise les données : aucun secret applicatif, token provider, pièce jointe complète ou identifiant inutile ; noms et coordonnées sont remplacés par des rôles lorsque la tâche n'exige pas l'identité. Prompts, retries et traces fournisseur font partie de la frontière de traitement, qu'il s'agisse de Kimi, OpenAI API ou Codex CLI.

### Autorisation par capacité

La capacité est une enum choisie par le use case serveur, jamais par le modèle ou un paramètre libre. Les appels automatisés utilisent un principal système borné au workspace et à une policy publiée ; les appels manuels exigent le rôle prévu par le use case.

| Capacité | Données autorisées |
|---|---|
| Setter campagne | thread ciblé, état courant, objections et engagements du prospect, offre et policy de la campagne |
| Amélioration manuelle | brouillon et thread ciblé pour operator/admin ; aucun droit d'envoi |
| Scoring | faits et signaux structurés ; aucun contenu brut non nécessaire |
| Rédaction Outbound | offre, ICP, preuves autorisées et synthèse relationnelle ; pas de threads sans lien |
| Préparation d'appel | faits, chronologie et threads liés à l'opportunité pour operator/admin |
| Inbound éditorial | agrégats et attribution ; aucune conversation individuelle |

Les repositories, jobs, snapshots, index, caches et receipts appliquent la même paire `workspaceId + capability`. Des tests négatifs couvrent chaque croisement interdit de rôle, workspace et capacité.

## Enveloppe opérationnelle V1

- 20 workspaces et 100 000 prospects actifs ;
- 5 millions d'événements mémoire ;
- ingestion de 10 événements/s pendant une heure avec 50 % de prospects distincts et au plus 5 % d'événements exigeant une synthèse sémantique, plus 5 événements/s de rattrapage ;
- pointe de 100 événements/s pendant cinq minutes, avec 20 % de prospects distincts et au plus 5 % d'événements exigeant une synthèse sémantique ;
- au plus 1 reconstruction sémantique/s soutenue et 10/s en pointe, après coalescing de trente secondes par prospect ;
- assemblage cible p95 inférieur à 300 ms à chaud et 750 ms à froid, hors appel modèle ;
- retard de projection p95 inférieur à 60 secondes en régime nominal et rattrapage de 100 000 événements en moins de 6 heures tout en maintenant les 10 événements/s courants ;
- au plus 20 inférences mémoire concurrentes sur l'instance, 16 000 tokens d'entrée et 2 000 tokens de sortie par reconstruction ;
- plafond initial de 1 000 reconstructions sémantiques et 10 EUR équivalents par workspace et par jour. Une valeur différente exige une configuration explicite dans les bornes produit.

Une reconstruction dispose d'un plafond d'événements et de tokens. Un import ou backfill est découpé en tranches déterministes et utilise une file de priorité inférieure. Quand un quota fournisseur ou financier est atteint, les projections déterministes continuent mais les actions relationnelles nécessitant une mémoire fraîche retournent `WAIT_MEMORY_BUDGET`.

Le benchmark s'exécute sur le profil VPS de référence 4 vCPU / 16 Go avec PostgreSQL du compose standard, 100 assembleurs concurrents, deltas de 0, 20 et 200 événements, données chaudes puis froides. Les 300/750 ms restent des cibles jusqu'à production du rapport de benchmark ; elles ne sont pas déclarées acquises par le design.

### Croissance et rétention des dérivés

- événements mémoire : même rétention que leur source, douze mois par défaut ;
- snapshots : dernière version valide plus vingt versions, maximum quatre-vingt-dix jours ;
- assertions et extraits : durée de leur source ;
- receipts, jobs et outbox traités : quatre-vingt-dix jours ;
- métriques agrégées sans identifiant prospect : selon la politique analytics.

Les identifiants prospect ne sont jamais des labels de métriques. Le diagnostic par prospect passe par des tables/index de traces à accès contrôlé ; les métriques d'exploitation utilisent uniquement workspace, capacité, statut et classe de latence avec cardinalité bornée.

### Compatibilité de schéma

Chaque événement, snapshot et renderer possède une version de schéma indépendante. Les lecteurs acceptent la version courante et la précédente pendant un déploiement mixte ; les writers n'émettent la nouvelle version qu'après déploiement des lecteurs compatibles. Les migrations restent additives, les replays enregistrent la version de renderer, et le rollback n'exige jamais de réinterpréter un payload inconnu.

## Critères de qualité

- Zéro faux négatif sur le corpus de release pour les opt-out structurés et expressions explicites couvertes ; toute expression ambiguë force `WAIT`.
- Zéro perte des engagements structurés sur les tests de replay ; rappel cible d'au moins 98 % pour les engagements extraits du langage naturel sur le corpus labellisé.
- Zéro promotion hypothèse vers fait dans les tests de contrat.
- Taux de répétition injustifiée inférieur à 1 % sur le corpus conversationnel, les redemandes motivées étant annotées séparément.
- Zéro événement mémoire perdu entre la transaction autoritative, le journal et la projection dans les tests de crash/replay.
- Une suppression est propagée aux snapshots, index et caches dans le délai de conformité configuré.
- L'assemblage du contexte vise moins de 300 ms au p95 à chaud et 750 ms au p95 à froid, hors inférence du modèle, selon le protocole de benchmark défini.
- Zéro publication ou lecture d'un snapshot dont le `privacyEpoch` est périmé dans les tests de course anonymisation/reconstruction.
- Zéro lecture inter-workspace, inter-capacité ou inter-rôle dans les tests négatifs couvrant repositories, jobs, snapshots, index, caches et receipts.
- Le rapport de qualification liste pour chaque route modèle son profil de traitement, ses quotas, sa rétention et son plafond de coût ; une route inconnue reste désactivée.

## Validation et activation

Tests obligatoires : conversation longue, changement de canal, changement d'entreprise, contradiction CRM/message, fusion et séparation d'identités, événement concurrent, snapshot périmé complété par delta, reconstruction totale, modèle indisponible, sortie invalide et suppression complète.

Les tests frontend vérifient également que fermer puis rouvrir un drawer retrouve le même job, que chaque état dégradé affiche explicitement l'absence d'envoi, qu'une hypothèse ne ressemble pas à un fait et qu'un rapprochement d'identité reste explicable. Avant le canary, cinq sessions de compréhension — ou tous les opérateurs internes disponibles s'ils sont moins nombreux — doivent répondre correctement dans au moins 90 % des cas à : « un message est-il parti ? », « le travail continue-t-il ? », « pourquoi cette information est-elle affichée ? » et « que se passe-t-il ensuite ? ».

Activation progressive et gates :

1. **Backfill :** 100 % des événements couverts, aucun écart de tenant, backlog rattrapé dans l'objectif annoncé.
2. **Shadow :** zéro régression critique et seuils de qualité atteints sur au moins 1 000 contextes ou l'intégralité du corpus disponible si plus petit.
3. **Setter dry-run :** zéro violation de policy et taux de contradiction inférieur au système actuel.
4. **Canary :** conversations explicitement bornées, arrêt automatique au premier incident critique ou si le retard p95 dépasse cinq minutes pendant quinze minutes.
5. **Activation :** une capacité et un workspace à la fois, avec retour immédiat à l'ancien assembleur par feature flag.

L'observabilité expose par prospect la version, la fraîcheur, le watermark, les événements en attente, le dernier job, son coût, les contradictions, les hypothèses, les rejets et les context receipts.

## Risques reconnus

- Une liaison d'identité erronée peut contaminer plusieurs canaux ; les événements restent attachés à leurs identités sources et le lien doit être explicable et réversible.
- Une synthèse peut perdre une nuance ; les règles structurées sont protégées déterministiquement et les éléments sémantiques sont couverts par l'évaluation, sans garantie parfaite simulée.
- Une indexation sémantique peut manquer une obligation ; elle ne remplace jamais l'état déterministe.
- Une reconstruction par événement peut créer trop de jobs ; le coalescing et les watermarks limitent cette charge.
- Une mémoire trop riche peut dégrader le modèle ; les vues par capacité et budgets adaptatifs réduisent le bruit.

## Non-objectifs

- Conserver une session d'agent ou CLI entre deux jobs.
- Envoyer l'historique complet à chaque invocation.
- Autoriser le modèle à décider seul d'un envoi.
- Transformer l'ensemble de Noosphere en architecture event-sourced.
- Utiliser la mémoire Inbound pour exposer sans nécessité des conversations privées individuelles.
- Garantir une reproduction bit-à-bit d'une inférence fournisseur non déterministe.
- Activer un index sémantique avant qu'un défaut de rappel mesuré le justifie.

## Journal de décisions

| Décision | Alternatives | Justification |
|---|---|---|
| Mémoire centrale par prospect | conversation ou entreprise | Continuité multicanale sans mélanger tous les contacts d'une société |
| Faits observés uniquement | inférences promues ou résumé libre | Empêcher qu'une supposition devienne une vérité commerciale |
| Rapprochement prudent et réversible | exact uniquement ou agressif | Limiter les doublons sans rendre une erreur irréparable |
| Historique immuable + état courant | écrasement ou historique complet dans le prompt | Auditabilité et contexte actuel compact |
| Noyau commun + vues par tâche | résumé universel ou mémoire par agent | Cohérence globale et pertinence locale |
| Reconstruction par job durable | périodique ou à la demande | Fraîcheur, reprise et indépendance du navigateur |
| Dernier snapshot + delta | blocage ou fenêtre récente seule | Continuité pendant les pannes et absence de perte |
| La sécurité est l'objectif prioritaire | personnalisation ou coût en premier | Les contradictions, refus oubliés et opt-out sont inacceptables |
| Recommandation IA, décision déterministe | contexte passif ou autonomie de la mémoire | Conserver l'intelligence sans contourner la gouvernance |
| Budget adaptatif | résumé fixe ou contexte maximal | Équilibre entre précision, coût et bruit |
| Rétention configurable | conservation infinie ou suppression immédiate du brut | Audit, conformité et flexibilité multi-workspace |
| Projection événementielle + récupération ciblée | RAG seul ou mémoire libre | Garanties déterministes pour le critique, rappel riche pour le détail |
| Watermark monotone d'ingestion | timestamps métier ou provider | Les backfills et événements tardifs restent toujours visibles |
| Liens d'identité versionnés sans déplacement de données | fusion physique des prospects | Une séparation ne nécessite pas de deviner la propriété historique des événements |
| `prospect_decisions` reste autoritatif | prochaine action du snapshot | Éviter deux registres concurrents de décision |
| Receipts par identifiants et hashes | copie du contexte complet | Audit sans créer un nouveau stockage de données personnelles |
| Index sémantique conditionnel | indexation immédiate | YAGNI : l'activer seulement si un défaut de rappel est mesuré |

## Revue multi-agent — Challenger

| Objection | Résolution | Statut |
|---|---|---|
| Watermark ambigu face aux backfills et événements tardifs | `sequenceId` PostgreSQL monotone devient l'unique curseur ; temps métier et ingestion restent descriptifs | Acceptée, design corrigé |
| Couverture événementielle non démontrée | Matrice de couverture, événement mémoire transactionnel, curseur outbox par consommateur et gate de backfill | Acceptée, design corrigé |
| Fusion réversible incapable de redistribuer les événements | Aucun déplacement : liens versionnés entre identités sources, fermeture du lien et reconstruction | Acceptée, design corrigé |
| Immutabilité, effacement et opt-out contradictoires | Anonymisation du contenu et des dérivés ; empreinte pseudonymisée F-026 séparée pour faire respecter l'opt-out ; reconstructibilité volontairement perdue | Acceptée, design corrigé |
| Validateur incapable de prouver la vérité sémantique | Garanties limitées aux faits structurés ; assertions IA avec extraits ; qualité sémantique mesurée sur corpus | Acceptée, garantie corrigée |
| Snapshot périmé et delta contradictoires | Delta dédupliqué, overlay déterministe prioritaire, `STOP` sur refus explicite et `WAIT` sur contradiction ambiguë | Acceptée, design corrigé |
| Contenu externe exposé aux injections et fuites | Étiquette non fiable, délimitation comme données, absence d'outils, filtres workspace et tests inter-tenant | Acceptée, design corrigé |
| Ensemble critique potentiellement supérieur au budget | Flags critiques bornés, déduplication, plafonds ; échec en sécurité si le noyau dépasse le budget | Acceptée, design corrigé |
| Prochaine action concurrente avec `prospect_decisions` | Le snapshot ne contient qu'une candidate ; le registre existant reste autoritatif | Acceptée, design corrigé |
| Sources mutables insuffisantes pour reconstruire l'historique | L'événement mémoire capture la mutation minimale dans la transaction et porte sa version source | Acceptée, design corrigé |
| Receipts susceptibles de dupliquer les données sensibles | Receipts composés d'identifiants, hashes et versions ; aucun contenu brut | Acceptée, design corrigé |
| Coût et charge non bornés | Enveloppe V1, tranches de backfill, plafonds par reconstruction et métriques de coût | Acceptée, design corrigé |
| Critères qualité sans oracle ni population | Corpus labellisé, taux définis et gates mesurables | Acceptée, design corrigé |
| Rollout sans seuil d'arrêt ni rollback | Gates par étape, arrêt automatique et feature flag vers l'ancien assembleur | Acceptée, design corrigé |
| Périmètre YAGNI trop large | Index sémantique différé jusqu'à preuve d'un défaut ; V1 centrée sur projection et SQL borné | Acceptée, design simplifié |
| Chaîne de hashes donnant une fausse garantie | Suppression de la chaîne ; hash canonique limité à la déduplication | Acceptée, design corrigé |
| Reproductibilité IA surpromue | Objectif remplacé par traçabilité ; reproduction bit-à-bit explicitement hors périmètre | Acceptée, design corrigé |
| Temporalité commerciale sous-spécifiée | Séquence d'ingestion, supersession, validité, UTC et fuseau d'origine explicités | Acceptée, design corrigé |

## Revue multi-agent — Constraint Guardian

| Objection | Résolution | Statut |
|---|---|---|
| Charge et coût non démontrables | Benchmark avec trafic courant plus rattrapage, durée de pointe, cardinalité, quotas d'inférence, tokens et plafond journalier | Acceptée, design corrigé |
| Delta non borné pendant une panne modèle | Limites de 200 événements/sept jours, fraîcheur de 24 h et `WAIT_MEMORY_STALE` au dépassement | Acceptée, design corrigé |
| Résurrection après anonymisation | `privacyEpoch`, double vérification avant publication, invalidation à la lecture et purge couvrant les jobs en vol | Acceptée, design corrigé |
| Frontière fournisseur absente | Profil de traitement obligatoire par route : rétention, entraînement, région, chiffrement, accès et sous-traitance | Acceptée, design corrigé |
| Autorisation des vues insuffisante | Capacité choisie côté serveur, principal borné, matrice de données et tests négatifs multi-couches | Acceptée, design corrigé |
| Empreinte déclarée non réversible | Alignement F-026/F-053 : donnée pseudonymisée et corrélable, propriété cryptographique non surpromue | Acceptée, design corrigé |
| Locks et reprise non bornés | Transactions courtes, inférence hors lock, lease/heartbeat/deadline/backoff, RPO 0 et RTO worker cinq minutes | Acceptée, design corrigé |
| Compatibilité de schéma absente | Versions séparées, lecture N/N-1, writers retardés et migrations additives | Acceptée, design corrigé |
| SLO 300 ms non reproductible | Protocole VPS, concurrence, chaud/froid et tailles de delta ; chiffre conservé comme cible jusqu'au rapport | Acceptée, design corrigé |
| Protection injection surpromue | Garantie reformulée en confinement des effets et absence d'autorité d'exécution | Acceptée, design corrigé |
| Croissance des dérivés non bornée | Durées et nombres maximums définis par catégorie | Acceptée, design corrigé |
| Cardinalité observabilité excessive | Aucun prospect dans les labels de métriques ; diagnostic via traces indexées à accès contrôlé | Acceptée, design corrigé |

## Revue multi-agent — User Advocate

| Objection | Résolution | Statut |
|---|---|---|
| Jobs et erreurs invisibles pour l'utilisateur | Contrat de visibilité par état avec continuité, absence d'envoi et prochaine étape ; réhydratation et idempotence explicites | Acceptée, design corrigé |
| Faits, hypothèses, recommandations et décisions confondables | Nature, fraîcheur, autorité et provenance obligatoires avec divulgation progressive « Pourquoi ? » | Acceptée, design corrigé |
| Rapprochement d'identité opaque | Lien actif, preuves, date et effet d'une séparation visibles sur la fiche | Acceptée, design corrigé |
| Anonymisation potentiellement surpromue | Distinction entre anonymisation locale, purge asynchrone et expiration fournisseur/sauvegardes | Acceptée, design corrigé |
| Aucun gate de compréhension | Tests frontend et sessions de compréhension avec seuil de 90 % avant canary | Acceptée, design corrigé |

## Arbitrage final

Disposition : **APPROVED**.

- Challenger : 18 objections acceptées et résolues ;
- Constraint Guardian : 12 objections acceptées et résolues ;
- User Advocate : 5 objections acceptées et résolues ;
- objections rejetées : aucune ;
- blocants non résolus : aucun.

L'Arbitre a demandé une dernière correction de cohérence sur la qualification F-026, la proportion d'événements exigeant une synthèse et les seuils chaud/froid. Ces trois corrections sont intégrées. Le design satisfait les exit criteria et peut passer à l'implémentation progressive.
