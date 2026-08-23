# Prospect 360 — plan d'implémentation

**Dépend de :** `2026-08-23-prospect-360-memory-context-engineering.md`
**Design :** APPROVED
**Stratégie :** tranches verticales, feature flags, shadow puis canary

## Résultat attendu

Remplacer progressivement la fenêtre fixe des messages récents par un contexte Prospect 360 durable, reconstruit par job, partagé entre les capacités agentiques sans état conversationnel singleton.

Le premier résultat produit n'enverra aucun message : il construira et comparera la nouvelle mémoire en shadow. Le Setter ne basculera sur cette mémoire qu'après validation des invariants, de la qualité et de la compréhension UX.

## Principes d'exécution

- une ou deux issues maximum en cours ;
- aucun changement Big Bang du Setter ;
- migrations additives et lecteurs compatibles N/N-1 ;
- toutes les mutations restent derrière les couches domain/application/infrastructure/interface ;
- aucun nouveau microservice ; le rôle worker dédié réutilise l'image Bun existante ;
- aucun index sémantique en V1 sans défaut de rappel mesuré ;
- aucun canary réel avant réussite du shadow et du dry-run ;
- ancien assembleur conservé derrière feature flag jusqu'à la fin du canary.

## Lot 0 — contrats et couverture des événements

### Objectif

Définir les contrats sans modifier le comportement des agents.

### Travaux

1. Créer le contexte `prospect-memory` dans les couches existantes.
2. Définir les types :
   - `ProspectMemoryEvent` et `ProspectMemoryEventKind` ;
   - `ProspectMemorySnapshot` ;
   - `ProspectMemoryAssertion` ;
   - `ProspectMemoryCapability` ;
   - `ProspectContextBundle` et `ContextReceipt` ;
   - états `fresh`, `refreshing`, `stale`, `budget_blocked`, `failed`, `anonymized`.
3. Écrire la matrice de couverture des mutations : messages entrants/sortants, appels, interactions, contact/entreprise, campagne, décision, merge/undo et anonymisation.
4. Définir le schéma versionné de chaque événement et snapshot.
5. Ajouter les feature flags :
   - `prospectMemoryCapture` ;
   - `prospectMemoryShadow` ;
   - `prospectMemorySetter` ;
   - activation par workspace et capacité.
6. Ajouter le profil de traitement requis aux routes IA qui pourront recevoir une conversation.

### Tests/gate

- tests de domaine des versions, statuts et transitions ;
- test d'architecture des imports ;
- test exhaustif de la matrice de capacités et permissions ;
- aucune différence fonctionnelle sur le Setter existant.

## Lot 1 — persistance, privacy epoch et capture transactionnelle

### Objectif

Créer un journal fiable et rejouable avant toute synthèse IA.

### Données additives

- `prospect_memory_events` : `sequence_id`, workspace, contact source, prospect canonique, source/version, type, temps métier/observation/validité, payload minimal et schema version ;
- `prospect_memory_snapshots` : version, watermark, privacy epoch, état structuré, synthèse, modèle/prompt/policy, schema/renderer version et content hash ;
- `prospect_memory_context_receipts` : identifiants/hashes uniquement, capability, tokens et dates ;
- curseur consommateur dédié si l'outbox actuelle ne permet pas encore le fan-out par abonné ;
- `privacy_epoch` sur le contact ou projection équivalente atomiquement vérifiable.

La V1 réutilise `contact_identities`, `contact_merges`, `merged_into_id`, `anonymized_at`, les suppressions F-026 et les réglages F-053. Elle ne déplace pas davantage de données lors d'un rapprochement : le journal conserve toujours le contact source.

### Capture

Chaque use case autoritatif de la matrice écrit son événement mémoire et sa notification dans la même transaction. Les chemins SQL directs identifiés sont migrés vers ces use cases ou explicitement bloqués par un test de couverture.

### Backfill

- parcours paginé et reprenable par workspace ;
- événements déterministes uniquement ;
- `requestKey` stable et déduplication source/version ;
- file de priorité basse ;
- rapport des lignes exclues et raisons.

### Tests/gate

- PostgreSQL réel : unicité, ordre monotone, événements tardifs, backfill et double livraison ;
- transaction métier rollbackée implique absence d'événement mémoire ;
- crash entre commit et dispatch repris sans perte ;
- isolation inter-workspace ;
- anonymisation incrémente l'epoch et invalide les lectures précédentes ;
- `EXPLAIN` avant tout index supplémentaire.

## Lot 2 — projection déterministe et worker de reconstruction

### Objectif

Produire un snapshot durable sans l'utiliser encore dans les agents.

### Composants

- `ProspectMemoryEventRepository` ;
- `ProspectMemorySnapshotRepository` ;
- `ProspectMemoryProjector` pour l'état déterministe ;
- `ProspectMemorySynthesizer` derrière `ModelGateway` ;
- `ProspectMemoryValidator` ;
- `RefreshProspectMemory` ;
- processor `prospect.memory.refresh` dans un pool dédié de l'image worker existante.

### Exécution

- coalescing trente secondes par prospect ;
- transaction courte pour lease/base version/target sequence/privacy epoch ;
- inférence hors transaction, deadline soixante secondes ;
- publication compare-and-swap dans une transaction courte ;
- lease deux minutes, heartbeat trente secondes, trois tentatives ;
- statut durable et exception opérateur après épuisement.

La première version du synthétiseur utilise la sortie structurée du routeur Kimi/Codex déjà présent. Les faits critiques restent produits par le projector déterministe ; le modèle ne produit que les assertions et la synthèse relationnelle.

### Tests/gate

- replay déterministe depuis zéro ;
- événements concurrents pendant l'inférence ;
- résultat ancien rejeté après nouveau snapshot ou anonymisation ;
- modèle timeout, quota, sortie invalide et circuit ouvert ;
- engagement structuré non perdu ;
- delta borné et `WAIT_MEMORY_STALE` ;
- aucun lock/transaction maintenu pendant l'appel modèle.

## Lot 3 — ContextAssembler, autorisations et shadow

### Objectif

Compiler les vues par tâche et mesurer leur qualité sans modifier les décisions.

### Composants

- `ProspectContextAssembler` ;
- renderers par capability : Setter, amélioration, scoring, Outbound, appel et agrégat Inbound ;
- overlay déterministe du delta post-watermark ;
- `ContextReceiptRecorder` sans contenu personnel ;
- comparateur shadow entre contexte historique actuel et Prospect 360.

### Règles

- capability créée par le use case serveur ;
- workspace et principal dérivés du job/session ;
- contenu prospect étiqueté non fiable et sans autorité outil ;
- flags de sécurité toujours en premier ;
- `prospect_decisions` reste autoritatif ;
- limite de 200 événements/sept jours et snapshot de moins de vingt-quatre heures ;
- dépassement : aucune action automatique, statut durable explicable.

### Tests/gate

- snapshots d'entrée/sortie par capability ;
- tests négatifs rôle/workspace/capability sur chaque stockage ;
- injection de prompt dans messages et sources ;
- budget adaptatif et échec sûr lorsque le noyau critique déborde ;
- receipts reproductibles par identifiants tant que les sources existent ;
- shadow sur 1 000 contextes ou l'intégralité disponible, sans régression critique.

## Lot 4 — Setter, conversations longues et UX durable

### Objectif

Faire du Setter la première capacité consommatrice, d'abord en dry-run puis derrière feature flag.

### Backend

- remplacer la requête locale des messages récents dans `conversation-command-runner.ts` par le port `ProspectContextAssembler` ;
- conserver les messages récents comme couche du bundle, pas comme source unique ;
- transmettre au `langchain-inbound-reply-agent.ts` un DTO déjà compilé ;
- enregistrer snapshot version, watermark et receipt dans `ai_runs` ou la référence associée ;
- ne jamais lier le cycle du job à la requête HTTP ou au drawer.

### Frontend

Dans les drawers Conversation et Prospect :

- réhydrater le même job par `requestKey` ;
- afficher uniquement les états qui affectent l'action ;
- dire explicitement si un message a été envoyé ;
- distinguer mise à jour mémoire et envoi provider ;
- exposer « Pourquoi ? » pour fait/hypothèse/recommandation/décision ;
- montrer fraîcheur, rapprochements d'identité et provenance en divulgation progressive.

### Tests/gate

- conversation de plus de 100 messages avec objection ancienne ;
- LinkedIn vers email vers appel ;
- fermeture/réouverture du drawer pendant le job ;
- double clic Setter avec la même clé ;
- opt-out et contradiction dans le delta ;
- aucun envoi en mode shadow/dry-run ;
- corpus : zéro violation critique, rappel engagements sémantiques >= 98 %, répétition injustifiée < 1 % ;
- test de compréhension opérateur >= 90 %.

## Lot 5 — autres capacités et identité 360

### Objectif

Étendre la même mémoire sans créer de mémoires parallèles.

Ordre :

1. amélioration manuelle de brouillon ;
2. préparation d'appel ;
3. scoring ;
4. rédaction Outbound ;
5. agrégats Inbound.

Chaque capacité possède son feature flag, sa matrice d'autorisation, son renderer et son corpus d'évaluation. Les rapprochements d'identité réutilisent les structures CRM existantes ; la vue mémoire compose les contacts liés sans déplacer les événements. Merge, undo et anonymisation reconstruisent toutes les projections touchées avec locks ordonnés.

### Tests/gate

- aucune conversation privée dans le renderer Inbound ;
- séparation d'identité sans redistribution d'événements ;
- correction de poste/entreprise visible dans l'état courant ;
- attribution et appels disponibles sans dupliquer la prochaine action ;
- aucun use case ne lit directement le JSON du snapshot sans passer par l'application.

## Lot 6 — rétention, benchmark et canary

### Rétention

Intégrer événements, snapshots, assertions et receipts aux policies F-053. Tester les purges, le `privacyEpoch`, les jobs en vol, caches, restauration de backup et empreintes F-026.

### Benchmark

Exécuter le protocole validé sur 4 vCPU / 16 Go :

- 10 événements/s courants plus 5/s de rattrapage ;
- pointe 100/s pendant cinq minutes ;
- 100 assembleurs concurrents ;
- deltas 0/20/200 ;
- données chaudes et froides ;
- objectifs 300 ms/750 ms et retard p95 inférieur à soixante secondes ;
- rapport du débit, backlog, tokens et coût.

### Canary

1. backfill d'un workspace isolé ;
2. shadow ;
3. Setter dry-run ;
4. petit ensemble de conversations bornées ;
5. arrêt au premier incident critique ou retard excessif ;
6. rollback immédiat vers l'ancien assembleur par feature flag.

## Contrats HTTP minimaux

Les agents n'exposent jamais les payloads mémoire bruts. Les surfaces utilisateur ont seulement besoin de :

- `GET /api/v1/prospects/:id/memory-status` : état, fraîcheur, job courant, résultat et effet d'envoi ;
- `GET /api/v1/prospects/:id/memory-view?capability=` : projection autorisée et provenance progressive ;
- `POST /api/v1/prospects/:id/memory/actions/refresh` : commande idempotente réservée à l'exploitation ;
- statut du job existant pour reprendre l'observation après navigation.

Workspace, utilisateur et capability effective viennent exclusivement du contexte serveur. L'OpenAPI et les contrats TypeScript sont livrés dans le même lot que chaque endpoint.

## Ordre des PR

1. **MEM-001 — contrats, matrice de couverture et flags** ;
2. **MEM-002 — tables, privacy epoch, capture et backfill** ;
3. **MEM-003 — projector, synthétiseur et worker** ;
4. **MEM-004 — ContextAssembler et shadow** ;
5. **MEM-005 — Setter et UX durable** ;
6. **MEM-006 — autres capacités et identité** ;
7. **MEM-007 — rétention, benchmark et canary**.

Chaque PR exécute les types, tests d'architecture, unitaires/HTTP ciblés et build Next.js. Les PR avec persistance ajoutent PostgreSQL réel et replay de migration. Les PR d'activation exécutent la suite d'intégration complète et les parcours navigateur concernés.

## Définition de terminé

- un prospect conserve son contexte utile au-delà de trente messages et entre les canaux ;
- aucun état critique ne vit dans une session agent ou CLI ;
- les faits, hypothèses, recommandations et décisions restent distincts ;
- quitter une page ne perd ni n'annule le job ;
- le Setter n'oublie ni opt-out, ni refus, ni engagement couvert ;
- la policy déterministe reste l'unique autorité d'effet ;
- l'anonymisation empêche toute résurrection d'un snapshot ;
- isolation workspace/capability démontrée ;
- coût, latence, backlog et fraîcheur mesurés sur le profil VPS ;
- canary borné réussi et rollback testé.

## État d'implémentation au 23 août 2026

| Lot | État | Preuve locale |
|---|---|---|
| MEM-001 contrats et flags | Implémenté | contrats domaine/application, matrices exhaustives testées et garde d'architecture imposant la capture sur toutes les écritures `prospect_decisions` |
| MEM-002 journal, privacy epoch, capture, backfill | Implémenté | migrations `0089` à `0092`, PostgreSQL réel, transitions transactionnelles, replay et backfill idempotent |
| MEM-003 projection et worker | Implémenté | projector déterministe, synthèse structurée, CAS, pools dédiés ; un test Setter plus long que son lease prouve le heartbeat et le traitement unique |
| MEM-004 ContextAssembler et shadow | Instrumentation implémentée ; gate qualité non exécuté | renderers par capacité, receipts sans contenu, budgets, comparaisons shadow durables et tests négatifs ; le corpus de 1 000 contextes réels reste à mesurer |
| MEM-005 Setter et UX durable | Implémenté derrière flags ; gates humains non exécutés | Setter et amélioration de brouillon consomment le bundle ; dry-run durable réhydratable et idempotent prouvé sur plus de 120 messages ; audit modèle/mémoire conservé ; évaluateurs qualité et compréhension livrés |
| MEM-006 autres capacités | Implémenté derrière flags | préparation d'appel, scoring, rédaction Outbound et agrégat Inbound durable passent par le même assembleur sans divulguer les contenus privés ; merge/undo est prouvé sur PostgreSQL avec verrous ordonnés |
| MEM-007 rétention, benchmark, canary | Sauvegarde/restauration/purge locales validées ; qualification externe non exécutée | fixture 0/20/200, backup restauré avec job en vol, purge sans effet provider, rollback transactionnel local et canary déterministe 120 messages ; mesures VPS, gates humains, rollback déployé et canary provider restent à faire |

Le protocole reproductible et ses seuils sont documentés dans
`docs/performance/2026-08-23-prospect-360-memory-capacity-protocol.md`.
Le rapport d'acceptation local et la liste exacte des gates non encore prouvés
sont documentés dans
`docs/performance/2026-08-23-prospect-360-memory-validation-report.md`.
L'implémentation n'affirme pas avoir atteint les objectifs de capacité avant
l'exécution sur le VPS 4 vCPU / 16 Gio. Le canary réel reste séparé du canary
shadow et exige une autorisation bornée pour tout effet provider.
