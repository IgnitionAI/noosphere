# F-034 — Scheduler et actions d’outreach

## Résultat utilisateur

Exécuter les séquences de façon fiable : chaque étape planifiée dans sa
fenêtre, envoyée une seule fois, après revérification complète — et jamais
sans la validation exigée par la politique (F-012/F-033).

## Acteurs et permissions

| Acteur | Lecture | Mutation | Approbation |
|---|---|---|---|
| owner/admin | oui | annule, relance | — |
| operator | oui | annule, relance | — |
| reviewer | oui | non | non |
| viewer | oui | non | non |

Les envois eux-mêmes sont exécutés par le système ; aucun rôle humain
n’envoie directement.

## Périmètre

- planification des actions depuis les enrollments (F-032) : étapes de la
  `SequenceVersion` figée, délais, fenêtres horaires, fuseau du workspace ;
- états d’action : `planned`, `awaiting_approval`, `due`, `sent`, `failed`,
  `cancelled` ;
- tentatives et retries bornés avec backoff ; rate limit fournisseur =
  décalage, jamais duplication ;
- revérification finale dans la transaction d’exécution : approbation
  (F-033), suppression (F-026), réponse entrante (F-041), santé du compte
  (F-035) ;
- annulation : une action annulée ne peut plus être exécutée, même par un
  job déjà livré ;
- envoi effectif via le port fournisseur (email V1 ; LinkedIn/WhatsApp en
  Wave 5).

## Hors périmètre

- composition des séquences (F-030) et contenu des messages (F-012) ;
- décisions d’approbation (F-033) ;
- traitement des réponses entrantes (F-040/F-041) ;
- warmup, rotation de comptes, optimisation d’envoi par modèle.

## Parcours principal

1. un enrollment planifie les actions de la séquence figée ;
2. chaque action devient `due` dans sa fenêtre, après approbation si exigée ;
3. l’exécuteur revérifie tout dans la transaction finale puis envoie ;
4. un échec fournisseur déclenche un retry borné ; un rate limit décale ;
5. pause de campagne ou annulation fige les actions non exécutées.

## Règles métier et invariants

- aucune action n’est envoyée sans l’approbation requise par la politique
  (F-012/F-033) — revérifiée à l’exécution, pas seulement à la
  planification ;
- suppression, réponse et santé du compte sont revérifiées dans la
  transaction finale ;
- une clé d’idempotence protège chaque action logique : rejouer un job ne
  renvoie jamais le message ;
- un rate limit décale l’action sans la dupliquer ni la marquer en échec ;
- une action annulée ne peut plus être exécutée par un job déjà livré :
  l’état est revérifié à la prise de lease ;
- les fallbacks de canal n’entraînent jamais deux envois pour la même étape
  logique (F-030) ;
- pause de campagne : aucune nouvelle exécution ; reprise : pas de rattrapage
  en rafale hors fenêtre ;
- chaque transition est auditée ; les events passent par l’outbox, un seul
  exemplaire dispatché.

## Critères d’acceptation

- Étant donné une action dont l’approbation manque, quand elle devient due,
  alors elle reste `awaiting_approval` sans envoi ;
- Étant donné une suppression créée après planification, quand l’action
  devient due, alors elle est annulée avant exécution (test transverse
  « suppression tardive ») ;
- Étant donné un job d’envoi relivré deux fois, quand il s’exécute, alors un
  seul message part ;
- Étant donné un rate limit fournisseur, quand l’envoi est tenté, alors
  l’action est replanifiée avec la même clé d’idempotence ;
- Étant donné une action annulée pendant qu’un job est en vol, quand le job
  s’exécute, alors il renonce sans effet ;
- Étant donné une réponse entrante persistée pendant qu’une action devient
  due, quand la transaction finale s’exécute, alors l’action est suspendue
  (test transverse « course réponse/envoi », périmètre F-041) ;
- Étant donné un viewer, quand il appelle l’endpoint d’annulation, alors
  403.

## États et erreurs

- loading : skeleton du détail campagne (actions à venir) ;
- empty : aucune action planifiée — état neutre avant enrollment ;
- validation : fenêtre horaire invalide, fuseau manquant ;
- forbidden : annulation/relance réservées aux rôles de mutation ;
- provider indisponible : compte dégradé → actions suspendues avec statut
  explicite et reprise automatique à la guérison (F-035) ;
- conflit métier : double exécution impossible (clé d’idempotence), course
  réponse/envoi arbitrée en faveur de la suspension ;
- reprise : après incident worker, les actions `due` reprennent sans
  doublon grâce aux leases et clés d’idempotence.

## Contrats

**Routes UI** : onglet actions de
`/w/[workspaceSlug]/campaigns/[campaignId]`.

**API** :

| Méthode | Route | Usage |
|---|---|---|
| GET | `/api/v1/campaigns/:id/actions?status=` | actions planifiées et exécutées |
| GET | `/api/v1/actions/:id` | détail : tentatives, erreurs, décisions |
| POST | `/api/v1/actions/:id/actions/cancel` | annuler (idempotent) |
| POST | `/api/v1/actions/:id/actions/retry` | relancer une action en échec |

**Événements sortants** : `OutreachActionDue`, `OutreachActionAccepted`
(catalogue), via l’outbox transactionnelle.

**Ports externes** : `UnipileClient.send` (V1 : email).

## Données et confidentialité

- agrégats : `OutreachAction` (étape, fenêtre, état, clé d’idempotence),
  `OutreachAttempt` (tentative, erreur, prochaine tentative) ;
- données personnelles : destinataire et contenu envoyé — journaux limités
  aux métadonnées, jamais de secret ni de contenu sensible dans les logs ;
- rétention : actions et tentatives conservées avec la campagne ;
- audit : planification, exécution, annulation, retry tracés.

## Analytics

- événements `outreach_action_due`, `outreach_action_sent`,
  `outreach_action_failed` ;
- dimensions : workspace, campagne, canal, étape, motif d’échec ;
- métrique de succès : taux d’envoi sans doublon (cible : 100 %).

## Tests obligatoires

- domaine : transitions d’état, fenêtres et fuseaux, backoff borné ;
- intégration PostgreSQL : idempotence d’envoi, lease sans double exécution,
  annulation en vol ;
- suppression tardive et course réponse/envoi (tests transverses
  QUALITY_GATES) ;
- compte indisponible : suspension sans blocage des autres comptes ;
- contrat fournisseur : erreurs, rate limit, relivraison ;
- isolation workspace et permissions ;
- E2E : enrollment → approbation → envoi réel (compte de test) → statut
  `sent` exactement une fois.

## Dépendances

- F-003 (jobs, outbox, audit) : livré ;
- F-026 (suppressions), F-033 (approbations), F-035 (comptes et santé) :
  revérifiés à l’exécution ;
- F-030 (séquence figée), F-031 (campagne), F-032 (enrollments) ;
- F-041 : la suspension sur réponse est câblée ici, traitée en Wave 4.

## Questions résolues avant développement

- V1 = email uniquement ; LinkedIn et WhatsApp activent le même scheduler en
  Wave 5 sans refonte ;
- aucun rattrapage en rafale après pause : les actions reprennent dans leur
  prochaine fenêtre ;
- la revérification finale est systématique, même quand tout était sain à la
  planification.
