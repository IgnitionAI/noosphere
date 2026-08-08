# F-031 — Campagne et snapshot immuable

## Résultat utilisateur

Assembler offre, ICP, stratégie de message, politique de supervision et
séquence en une campagne mesurable, vérifier sa faisabilité puis l’activer :
le snapshot des versions est figé pour toute la vie de la campagne.

## Acteurs et permissions

| Acteur | Lecture | Mutation | Activation |
|---|---|---|---|
| owner | oui | oui | active, met en pause, archive |
| admin | oui | oui | active, met en pause, archive |
| operator | oui | brouillon | non |
| reviewer | oui | non | non |
| viewer | oui | non | non |

## Périmètre

- création d’une campagne brouillon : nom, objectif, sélection d’une
  `OfferVersion`, `ICPVersion`, `MessagingStrategyVersion`,
  `AIPolicyVersion` et `SequenceVersion` — toutes publiées ;
- préflight obligatoire avant activation : versions présentes et publiées,
  population cible non vide (F-032), canaux de la séquence couverts par un
  compte connecté (F-035), suppressions contrôlées (F-026), politique de
  supervision satisfaite (F-012) ;
- activation : snapshot immuable des cinq références de versions (ADR-003) ;
- pause et reprise idempotentes, sans recréer les actions déjà planifiées ;
- archivage : fin de vie douce, historique et versions conservés.

## Hors périmètre

- population, scoring et enrollment (F-032) ;
- file d’approbation (F-033) et exécution des envois (F-034) ;
- connexion des comptes d’envoi (F-035) ;
- métriques et dashboards (F-051).

## Parcours principal

1. l’utilisateur crée une campagne et sélectionne les cinq versions
   publiées ;
2. le préflight vérifie la cohérence et liste les blocages éventuels ;
3. l’activation fige le snapshot et émet `CampaignActivated` ;
4. la campagne active n’accepte plus aucune modification des références ;
5. pause, reprise puis archivage terminent le cycle de vie.

## Règles métier et invariants

- le builder n’accepte que des versions publiées : jamais un brouillon ;
- le préflight est obligatoire et rejouable : ses résultats ne sont pas
  cachés au-delà de la transaction d’activation ;
- l’activation fige les cinq références de versions : une campagne active ne
  peut pas être modifiée rétroactivement — toute évolution exige une nouvelle
  version puis une nouvelle campagne (ADR-003) ;
- l’activation est idempotente : rejouer la demande ne crée ni seconde
  activation ni second événement `CampaignActivated` ;
- pause et reprise sont idempotentes et ne recréent pas les actions déjà
  exécutées ou planifiées (exécution : F-034) ;
- une suppression (F-026) créée après activation reste revérifiée avant
  chaque envoi ;
- l’archivage ne supprime ni la campagne, ni ses versions, ni son
  historique ;
- chaque transition est auditée (F-003).

## Critères d’acceptation

- Étant donné une campagne sans `SequenceVersion` publiée, quand j’active,
  alors 422 avec la référence manquante listée ;
- Étant donné un préflight avec blocages, quand j’active, alors le refus
  liste chaque blocage ;
- Étant donné une activation réussie, quand je modifie l’offre source et
  publie une v2, alors la campagne conserve sa v1 figée ;
- Étant donné la même requête d’activation rejouée, quand le réseau retries,
  alors une seule activation et un seul événement outbox ;
- Étant donné une campagne en pause, quand je mets en pause une seconde
  fois, alors l’état reste cohérent sans effet supplémentaire ;
- Étant donné un operator, quand il appelle l’endpoint d’activation, alors
  403 ;
- Étant donné deux workspaces, quand l’un active une campagne, alors l’autre
  ne voit rien.

## États et erreurs

- loading : skeleton de la liste et du builder ;
- empty : aucune campagne — action principale « créer une campagne » ;
- validation : référence manquante ou non publiée, préflight en échec avec
  blocages détaillés ;
- forbidden : activation/pause/archivage réservés à owner/admin, contrôlé
  côté serveur ;
- provider indisponible : compte d’envoi dégradé signalé au préflight sans
  bloquer la consultation (détail : F-035) ;
- conflit métier : activation concurrente de la même campagne ;
- reprise : le brouillon de campagne se rouvre en l’état après navigation.

## Contrats

**Routes UI** : `/w/[workspaceSlug]/campaigns`,
`/w/[workspaceSlug]/campaigns/new` (builder + préflight),
`/w/[workspaceSlug]/campaigns/[campaignId]` (détail, pause, archivage).

**API** :

| Méthode | Route | Usage |
|---|---|---|
| GET/POST | `/api/v1/campaigns` | liste, création brouillon |
| GET/PATCH | `/api/v1/campaigns/:id` | détail avec snapshot, modification du brouillon |
| POST | `/api/v1/campaigns/:id/actions/preflight` | vérifier la faisabilité (rejouable) |
| POST | `/api/v1/campaigns/:id/actions/activate` | activer et figer le snapshot |
| POST | `/api/v1/campaigns/:id/actions/pause` | mettre en pause (idempotent) |
| POST | `/api/v1/campaigns/:id/actions/resume` | reprendre (idempotent) |
| POST | `/api/v1/campaigns/:id/actions/archive` | archiver |

**Événements sortants** : `CampaignActivated` (catalogue) ;
`CampaignPaused`, `CampaignResumed`, `CampaignArchived` proposés — tous via
l’outbox transactionnelle, un seul exemplaire dispatché par transition.

**Ports externes** : aucun direct ; les capacités des comptes d’envoi sont
lues via F-035.

## Données et confidentialité

- agrégats : `Campaign` (cycle de vie : `draft`, `active`, `paused`,
  `archived`) avec snapshot immuable des cinq références de versions ;
- données personnelles : auteur de création/activation uniquement ; la
  population est gérée par F-032 ;
- rétention : campagne, snapshot et historique conservés après archivage ;
- audit : création, activation, pause, reprise et archivage tracés.

## Analytics

- événements `campaign_activated`, `campaign_paused`, `campaign_archived` ;
- dimensions : workspace, campagne, versions référencées ;
- métrique de succès : délai entre création et activation, taux de préflight
  réussi au premier essai.

## Tests obligatoires

- domaine : transitions de cycle de vie, refus de modification rétroactive ;
- intégration PostgreSQL : snapshot figé à l’activation, idempotence
  activation/pause/reprise, unicité de l’événement outbox ;
- version mutable : tentative de modification d’une version référencée par
  une campagne active (test transverse QUALITY_GATES) ;
- isolation workspace : campagnes invisibles ailleurs ;
- permission : activation refusée à operator/reviewer/viewer par appel
  direct API ;
- E2E : builder → préflight en échec → correction → activation → pause →
  reprise → archivage.

## Dépendances

- F-010, F-011, F-012, F-030 : versions publiées — livrées ou en cours
  (F-030 : backend présent, complétion dans ce chantier) ;
- F-026 : suppressions revérifiées ;
- F-035 : comptes connectés pour le préflight canaux — si absent au moment
  de l’activation, le préflight dégrade proprement en « aucun compte vérifié »
  et l’envoi reste impossible (F-034) ;
- F-003 : audit et outbox — livrés.

## Questions résolues avant développement

- une campagne active n’est jamais modifiée : toute évolution passe par une
  nouvelle version puis une nouvelle campagne ;
- le préflight est un état rejouable, pas un verrou mémorisé : l’activation
  le ré-exécute dans sa transaction ;
- l’archivage est irréversible mais non destructeur : l’historique reste
  consultable.
