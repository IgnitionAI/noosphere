# F-003 (suite) — Console technique opérateur

Suite de F-003 (socle livré : journal d’audit, outbox transactionnelle,
jobs PostgreSQL avec retries bornés et dead letters, idempotence et
corrélation). Cette fiche couvre la **console d’administration technique** :
le moteur existe, il s’agit de le rendre observable et actionnable.

## Résultat utilisateur

Un opérateur diagnostique et relance un traitement en échec en autonomie :
jobs en erreur, dead letters, webhooks rejetés, suivi par `correlationId` —
sans nouvel effet métier quand le traitement d’origine a réussi.

## Acteurs et permissions

| Acteur | Lecture | Mutation | Approbation |
|---|---|---|---|
| owner/admin | oui (tout le workspace) | relance un job/dead letter | non |
| operator | oui (vue technique de son workspace) | non | non |
| reviewer/viewer | non | non | non |

## État d’implémentation

Moteur livré (catalogue : « livré ») : table `jobs` (type, payload,
`idempotency_key`, **`correlation_id`**, attempts/max, statuts
`pending/running/retry/completed/dead_lettered`, verrous), file PostgreSQL
avec retry borné et passage en dead letter, outbox dispatchée, `audit_logs`
alimenté par toutes les mutations sensibles, webhooks persistés
(`connected_account_webhooks`, événements d’intégration). Restent à livrer :
les endpoints de lecture/administration et la page console — listes filtrées
(jobs en échec, dead letters, webhooks rejetés), vue par `correlationId`,
relance sécurisée.

## Périmètre

- liste des jobs filtrable par statut (`failed`, `dead_lettered`, `retry`),
  type et période, avec dernier code/message d’erreur ;
- liste des dead letters avec payload tronqué (pas de secrets) et cause ;
- webhooks rejetés (signature invalide, payload invalide) visibles avec la
  raison du rejet ;
- vue de corrélation : toutes les occurrences (jobs, events outbox, entrées
  d’audit) partageant un `correlationId` ;
- relance d’un job en échec ou d’une dead letter : remise en file
  idempotente — l’`idempotency_key` d’origine est conservée, donc un job
  dont l’effet a déjà réussi ne le rejoue pas ;
- lecture du journal d’audit métier (endpoint partagé avec F-053 :
  `GET /audit-logs`, owner/admin) ;
- accès réservé owner/admin pour les mutations, lecture étendue operator.

## Hors périmètre

- modification du moteur de jobs/outbox (livré, inchangé) ;
- alertes automatiques sur accumulation de dead letters (extension
  ultérieure via F-051/AI-140) ;
- purge des dead letters (relève de la rétention F-053) ;
- console multi-workspaces ou plateforme (vue strictement workspace).

## Parcours principal

1. l’opérateur ouvre la console : jobs en échec et dead letters du workspace
   sont listés, triés par gravité/date ;
2. il filtre par type ou suit un `correlationId` pour voir toute la chaîne
   (job → event → audit) ;
3. il identifie la cause (erreur fournisseur, payload invalide, règle
   métier) ;
4. si la cause est résolue, un owner/admin relance : le job repart avec sa
   clé d’idempotence — aucun doublon d’effet ;
5. chaque relance est auditée.

## Règles métier et invariants

- la console est en lecture seule pour operator, mutations réservées
  owner/admin — contrôle côté serveur ;
- une relance conserve l’`idempotency_key` et le `correlationId` d’origine :
  un effet déjà appliqué n’est jamais rejoué (invariant moteur, exposé tel
  quel) ;
- les payloads affichés sont tronqués et expurgés : aucun secret, aucune PII
  non nécessaire (invariant catalogue : les logs excluent secrets et
  données personnelles) ;
- la console ne montre que le workspace courant — pas de vue transverse ;
- la relance est elle-même idempotente (double clic = une remise en file) ;
- webhooks rejetés : consultables mais jamais rejoués depuis la console (un
  rejet de signature est une décision de sécurité définitive) ;
- toute relance est auditée avec acteur, job et résultat.

## Critères d’acceptation

- Étant donné des jobs en échec, quand j’ouvre la console, alors je les
  vois avec type, erreur et nombre de tentatives, filtrés par workspace ;
- Étant donné un `correlationId`, quand je le recherche, alors je vois le
  job, l’event outbox et les entrées d’audit associés ;
- Étant donné un job dont l’effet a réussi, quand on le relance, alors
  l’effet n’est pas dupliqué (clé d’idempotence conservée) ;
- Étant donné une double relance, quand le doublon arrive, alors une seule
  remise en file existe ;
- Étant donné un operator, quand il tente une relance par appel direct API,
  alors la réponse est 403 ;
- Étant donné un payload contenant un token, quand il est affiché, alors le
  secret n’apparaît ni dans la réponse ni dans les logs ;
- Étant donné un webhook rejeté pour signature invalide, quand je le
  consulte, alors la raison est visible mais aucune action de rejeu n’est
  proposée ;
- Étant donné deux workspaces, quand l’un consulte sa console, alors aucun
  job de l’autre n’apparaît.

## États et erreurs

- loading : skeleton des listes ;
- empty : aucun échec — état neutre positif (« tout est sain ») ;
- validation : `correlationId` ou filtre invalide (400) ;
- forbidden : console et relances selon les rôles ci-dessus, même par appel
  direct API ;
- provider indisponible : non applicable (lecture interne) ;
- conflit métier : 409 sur relance d’un job déjà relancé ou en cours ;
- reprise : la relance est idempotente par construction.

## Contrats

**Routes UI** : `/w/[workspaceSlug]/settings/console` (ou `/admin` interne
au workspace) — jobs, dead letters, webhooks rejetés, corrélation, audit.

**Use cases** : `ListFailedJobs`, `ListDeadLetters`,
`ListRejectedWebhooks`, `TraceCorrelation`, `RequeueJob`.

**API** :

| Méthode | Route | Usage | État |
|---|---|---|---|
| GET | `/api/v1/console/jobs` | jobs filtrés (statut, type, période) | à spécifier |
| GET | `/api/v1/console/dead-letters` | dead letters avec cause | à spécifier |
| GET | `/api/v1/console/webhooks/rejected` | webhooks rejetés et raisons | à spécifier |
| GET | `/api/v1/console/correlations/:id` | vue de corrélation complète | à spécifier |
| POST | `/api/v1/console/jobs/:id/actions/requeue` | relance idempotente (owner/admin) | à spécifier |
| GET | `/api/v1/audit-logs` | journal d’audit (endpoint partagé F-053) | spécifié dans F-053 |

**Événements sortants** : `JobRequeued` à ajouter (un seul envoi par
relance effective).

**Ports externes** : aucun.

## Données et confidentialité

- aucune nouvelle table : lecture des tables existantes (`jobs`,
  `outbox_events`, `audit_logs`, `connected_account_webhooks`) ;
- confidentialité : payloads expurgés côté serveur avant affichage (champs
  secrets masqués par convention de clés) ; la console n’expose aucune
  donnée d’un autre workspace ;
- rétention : celle de F-053 s’applique (jobs et events traités, audit) ;
- audit : relances tracées dans `audit_logs`.

## Analytics

- événements `console_viewed`, `job_requeued` ;
- dimensions : workspace, type de job, code d’erreur ;
- métrique de succès : délai entre passage en dead letter et résolution ;
  zéro relance produisant un effet dupliqué.

## Tests obligatoires

- application : relance idempotente (double appel = une remise en file),
  conservation de la clé d’idempotence ;
- intégration PostgreSQL : filtres par statut/période, vue de corrélation
  complète ;
- sécurité : payloads expurgés (test avec payload contenant un secret) ;
- permission : relance refusée à operator/reviewer/viewer par appel direct ;
- isolation workspace : mêmes types de jobs dans deux workspaces ;
- E2E : job en échec → diagnostic par corrélation → relance → exécution
  sans doublon → audit visible.

## Dépendances

- socle F-003 (moteur) : livré ;
- F-053 : partage l’endpoint `GET /audit-logs` — le livrer une seule fois,
  consommé par les deux features (lot 3 livré avant ou coordonné) ;
- F-002 (rôles) : memberships existants suffisants.

## Questions résolues avant développement

- la console est par workspace, pas plateforme ;
- les webhooks rejetés ne sont jamais rejouables (décision de sécurité) ;
- la relance réutilise la file existante — aucun mécanisme parallèle ;
- l’endpoint d’audit est mutualisé avec F-053 pour éviter deux contrats.
