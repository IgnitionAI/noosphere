# F-012 — Stratégie de message et politique de supervision

## Résultat utilisateur

Encadrer ce que les campagnes peuvent dire et faire : ton, claims autorisés,
templates par canal avec variables contrôlées, et règles de validation
humaine — publiés en versions immuables.

## Acteurs et permissions

| Acteur | Lecture | Mutation | Approbation |
|---|---|---|---|
| owner | oui | oui | publie |
| admin | oui | oui | publie |
| operator | oui | brouillon | non |
| reviewer | oui | non | non |
| viewer | oui | non | non |

## Périmètre

- stratégie de message : ton, angle, claims autorisés par référence à une
  `OfferVersion` publiée (F-010), CTA et contraintes par canal (longueur,
  liens, pièces jointes) ;
- templates par canal (LinkedIn, email, WhatsApp) avec variables autorisées
  (`{{contact.first_name}}`, `{{company.name}}`, …) ;
- politique de supervision : premier contact toujours soumis à validation
  humaine, toute réponse toujours humaine, relances automatiques autorisées
  ou non, règles d’escalade ;
- publication d’une `MessagingStrategyVersion` et d’une `AIPolicyVersion`
  immuables, numérotées par conteneur (pattern commun ICP/offre) ;
- aucune génération par modèle : contenu 100 % rédigé par l’utilisateur.

## Hors périmètre

- génération de messages par modèle (AI-110, AI-120) ;
- composition des séquences (F-030) et exécution (F-034) ;
- scoring des prospects (F-032) ;
- A/B testing et variantes automatiques.

## Parcours principal

1. l’utilisateur crée une stratégie (brouillon) et la rattache à une
   `OfferVersion` publiée ;
2. il rédige les templates par canal avec les variables autorisées ;
3. il définit la politique de supervision associée ;
4. la validation détecte variables inconnues, canaux incomplets et claims
   non validés ;
5. il publie : deux versions immuables sont créées et les événements sont
   émis via l’outbox.

## Règles métier et invariants

- stratégie et politique suivent le pattern conteneur + versions : brouillon
  modifiable, version publiée immuable, numérotation séquentielle par
  conteneur ;
- une variable inconnue ou non résoluble bloque la publication, avec la
  liste des occurrences ;
- un canal utilisé doit définir longueur, CTA et contraintes ;
- un claim référencé doit être `sourced` ou `validated` dans l’`OfferVersion`
  ; un claim `hypothesis` ou `invalidated` bloque la publication ;
- le premier contact et toute réponse restent soumis à validation humaine —
  cet invariant n’est pas désactivable ;
- une campagne (F-031) ne peut référencer que des versions publiées ;
- une suppression (F-026) prime sur toute autorisation de la politique ;
- la publication est idempotente et auditée (F-003, désormais disponible).

## Critères d’acceptation

- Étant donné un template contenant `{{contact.titre}}`, quand je publie,
  alors la publication est refusée avec la variable inconnue listée ;
- Étant donné une stratégie référençant un claim `hypothesis`, quand je
  publie, alors le claim est listé comme bloquant ;
- Étant donné un canal email sans longueur définie, quand je publie, alors
  le canal est signalé incomplet ;
- Étant donné une version publiée, quand je modifie le brouillon, alors la
  version reste inchangée ;
- Étant donné un operator, quand il appelle l’endpoint de publication, alors
  403 ;
- Étant donné la même requête de publication rejouée, quand le réseau
  retries, alors une seule version existe et un seul événement outbox est
  dispatché ;
- Étant donné deux workspaces, quand l’un publie, alors l’autre ne voit ni
  stratégie ni politique.

## États et erreurs

- loading : skeleton de la liste et de l’éditeur ;
- empty : aucune stratégie — action principale « créer une stratégie » ;
- validation : variables inconnues, canal incomplet, claim non validé —
  chaque blocage localisé dans le template concerné ;
- forbidden : operator/reviewer/viewer sans action publier, contrôlé côté
  serveur ;
- provider indisponible : non applicable (aucun fournisseur externe) ;
- conflit métier : publication concurrente du même brouillon ;
- reprise : brouillon sauvegardé rouvert en l’état après navigation.

## Contrats

**Routes UI** : section stratégie de message dans
`/w/[workspaceSlug]/strategy` (liste, éditeur de templates, politique) ;
consommation ensuite par le campaign builder (F-031).

**API** :

| Méthode | Route | Usage |
|---|---|---|
| GET | `/api/v1/messaging-strategies` | stratégies du workspace et version courante |
| POST | `/api/v1/messaging-strategies` | créer un brouillon |
| GET | `/api/v1/messaging-strategies/:id` | détail, templates et historique |
| PATCH | `/api/v1/messaging-strategies/:id` | modifier le brouillon |
| POST | `/api/v1/messaging-strategies/:id/actions/publish` | publier une version immuable |
| GET | `/api/v1/ai-policies` | politique du workspace |
| PATCH | `/api/v1/ai-policies/:id` | modifier le brouillon de politique |
| POST | `/api/v1/ai-policies/:id/actions/publish` | publier une version immuable |

**Événements sortants** : `MessagingStrategyVersionPublished`,
`AIPolicyVersionPublished` (via l’outbox transactionnelle, dispatcher en
place depuis le chantier 2).

**Ports externes** : aucun.

## Données et confidentialité

- agrégats : `MessagingStrategy`, `MessagingStrategyVersion`, `AIPolicy`,
  `AIPolicyVersion` (conformes à DATA_MODEL : `rules` en jsonb) ;
- données personnelles : aucune valeur personnelle stockée — les variables
  référencent des champs, jamais des données ; auteur de publication
  (`published_by`) ;
- rétention : les versions publiées sont conservées tant qu’une campagne les
  référence ;
- audit : création, modification de brouillon et publication tracées.

## Analytics

- événements `messaging_strategy_version_published`,
  `ai_policy_version_published` ;
- dimensions : workspace, conteneur, numéro de version ;
- métrique de succès : délai entre création du brouillon et première
  publication.

## Tests obligatoires

- domaine : validation des variables autorisées, complétude par canal,
  blocage des claims non validés ;
- intégration PostgreSQL : unicité (conteneur, version), rejet d’UPDATE sur
  version publiée, unicité de l’événement outbox ;
- isolation workspace : stratégies et politiques invisibles ailleurs ;
- permission : publication refusée à operator/reviewer/viewer par appel
  direct API ;
- idempotence : publication rejouée sans seconde version ;
- E2E : création → templates → validation échouée → correction →
  publication → consultation de la version.

## Dépendances

- F-010 (claims de l’`OfferVersion`) : livré ;
- F-011 (ICP publié, ciblage de la stratégie) : livré ;
- F-003 (audit, outbox) : livré depuis le chantier 2 ;
- consommateurs : F-030 (séquences), F-031 (snapshot campagne), F-033
  (approbations).

## Questions résolues avant développement

- aucune génération par modèle dans cette feature : la supervision porte sur
  du contenu humain, l’IA arrivera en Wave 7 avec les mêmes verrous ;
- la validation humaine du premier contact et des réponses n’est pas
  configurable : seules les relances peuvent être autorisées en automatique ;
- stratégie et politique sont deux conteneurs distincts versionnés
  séparément, publiés ensemble depuis le même écran.
