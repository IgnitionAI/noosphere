# F-051 — Événements analytics et dashboards

## Résultat utilisateur

Mesurer la performance commerciale de bout en bout — prospects trouvés,
profils enrichis, messages envoyés, livraison, réponses, rendez-vous,
opportunités, revenu — avec des métriques déterministes, filtrables par
campagne, ICP, canal, rôle et signal, et reproductibles sans modèle IA.

## Acteurs et permissions

| Acteur | Lecture | Mutation | Approbation |
|---|---|---|---|
| owner/admin | oui (toutes métriques, coûts inclus) | export | non |
| operator | oui (métriques opérationnelles) | non | non |
| reviewer | oui (métriques opérationnelles) | non | non |
| viewer | oui (agrégats sans coûts ni PII) | non | non |

## État d’implémentation

Non commencé en tant que feature, mais le socle de données est largement en
place : faits persistés (`outreach_actions`, `outreach_attempts`,
`enrichment_jobs`, `enrichment_observations`, `signals`,
`prospect_discovery_candidates`, `messages`, `reply_classifications`,
`calendar_bookings`, `opportunities`, `opportunity_stage_history`,
`ai_runs.cost`), events outbox (`ProspectDiscovered`, `OutreachActionSent`,
`ContactIdentityVerified`, `SignalObserved`, `CalendarMeetingBooked`,
`OpportunityStageChanged`…) et un précédent de lecture analytique :
`PostgresCampaignAutopilotDashboard` (projection SQL déterministe par
campagne). Restent à livrer : les projections transverses du workspace,
les endpoints et la page `/analytics`, la gestion du revenu (montant
d’opportunité), les coûts consolidés et l’export.

## Périmètre

- métriques d’entonnoir : prospects trouvés → profils enrichis → actions
  planifiées → envoyées → acceptées (livraison fournisseur) → répondues →
  réponses positives → rendez-vous → opportunités → revenu ;
- distinction stricte intention (planifié), tentative (attempt), accepté
  (sent), répondu (`response_received_at`) — jamais fusionnées ;
- découpages : campagne, version d’ICP, canal, type d’étape, rôle/fonction du
  contact, type de signal, période ;
- coûts : coût IA (`ai_runs.cost`) consolidé, coût par prospect et par
  rendez-vous ; réservés aux rôles owner/admin ;
- montant d’opportunité : extension additive de `opportunities`
  (`amount` + `currency`, nullables) pour alimenter la métrique revenu ;
- export CSV d’une vue filtrée (owner/admin) ;
- page `/w/[workspaceSlug]/analytics` avec filtres période/campagne/ICP/
  canal/signal.

## Hors périmètre

- tables d’agrégats précalculés ou entrepôt de données (voir décision
  d’approche) ;
- attribution multi-touch avancée : l’attribution initiale est
  « dernière campagne touchée » (l’opportunité porte déjà `campaign_id`) ;
- dashboards temps réel (rafraîchissement à la requête) ;
- benchmarks inter-workspaces ou partage de métriques entre tenants ;
- recommandations automatiques (AI-140 consommera ces métriques plus tard) ;
- drill-down d’un chiffre vers la liste des faits sources : différé — le
  contrat expose des agrégats uniquement et l’UI l’affiche explicitement ;
  les listes filtrées existantes (prospects, campagnes) servent de
  vérification manuelle.

## Parcours principal

1. l’utilisateur ouvre `/analytics` : l’entonnoir du workspace s’affiche sur
   la période par défaut (30 jours) avec dénominateurs et période visibles ;
2. il filtre par campagne, ICP, canal, rôle ou signal : toutes les métriques
   se recalculent de façon déterministe ;
3. il compare deux segments (ex. prospects avec signal « recrute » vs sans) ;
4. un owner/admin exporte la vue courante en CSV.

## Règles métier et invariants

- toutes les métriques sont calculées par projection SQL déterministe sur les
  tables de faits — jamais par un modèle IA, jamais par comptage d’events
  outbox : un événement dupliqué ne gonfle aucune métrique ;
- chaque métrique est filtrée par `workspace_id` — aucune fuite entre
  tenants, y compris dans l’export ;
- les dénominateurs et la période sont toujours affichés avec le taux ;
- intention, tentative, accepté et répondu sont des comptages distincts fondés
  sur les statuts et horodatages des tables, pas sur des estimations ;
- une métrique sans donnée affiche zéro ou « pas de données », jamais une
  valeur inventée ;
- les coûts et le revenu ne sont jamais exposés aux rôles viewer/operator/
  reviewer ;
- l’export reflète exactement la vue filtrée courante (mêmes filtres, mêmes
  chiffres) ;
- lecture seule : aucune écriture métier ne part d’un endpoint analytics.

## Décision d’approche technique

Projection SQL déterministe à la demande sur les tables de faits existantes,
sans tables d’agrégats — le précédent du repo
(`PostgresCampaignAutopilotDashboard`) valide ce pattern. Justification :

- reproductibilité totale (même requête = même résultat, critère catalogue) ;
- aucune migration de rattrapage ni risque de divergence agrégat/faits ;
- volumes actuels compatibles (workspace-scopé, index existants sur
  `workspace_id` + dates) ;
- les events outbox restent la piste d’audit, pas la source de comptage.

Réversibilité : si les volumes le exigent, des vues matérialisées rafraîchies
pourront être ajoutées sans changer les contrats d’API.

## Sources de données par métrique (vérifiées sur le schéma)

| Métrique | Source | Statut |
|---|---|---|
| prospects trouvés | `prospect_discovery_candidates` (+ `ProspectDiscovered`) | disponible |
| profils enrichis | `enrichment_jobs`, `enrichment_observations` | disponible |
| invitations/messages envoyés | `outreach_actions` (`channel`, `step_kind`, `sent_at`) | disponible |
| tentatives / accepté | `outreach_attempts` (statuts `sent`/`failed`/`rate_limited`) | disponible |
| répondu | `outreach_actions.response_received_at`, `messages` entrants | disponible |
| réponses positives | `reply_classifications.intent` (classification F-042) | disponible |
| rendez-vous | `calendar_bookings`, `meeting_proposals` | disponible |
| opportunités | `opportunities`, `opportunity_stage_history` | disponible |
| revenu | `opportunities.amount`/`currency` | **extension à livrer** (migration additive) |
| coûts IA | `ai_runs.cost` | disponible |
| coût par prospect / par RDV | coûts consolidés ÷ faits | calculé |
| performance par signal | jointure `signals` (type, cible) | disponible |
| performance par ICP | `campaigns.icp_version_id`, versions d’ICP | disponible |
| performance par rôle | `contact_employments` (fonction) | disponible |

Note délivrabilité : « livré » = accepté par le fournisseur (`sent` sans
échec webhook ultérieur tracé dans `integration_events`) ; un statut
« bounced » fin relèvera d’un complément fournisseur, documenté en limite.

## Critères d’acceptation

- Étant donné un workspace avec des actions envoyées, quand j’ouvre
  `/analytics`, alors je vois l’entonnoir complet avec dénominateurs et
  période affichés ;
- Étant donné le même event outbox présent deux fois, quand les métriques
  sont calculées, alors les comptages restent identiques (source = tables de
  faits) ;
- Étant donné un filtre « signal = recrute », quand je l’applique, alors
  toutes les métriques se restreignent aux prospects porteurs de ce signal
  actuel ;
- Étant donné deux workspaces, quand je consulte l’analytics de l’un, alors
  aucun chiffre de l’autre n’apparaît, y compris dans l’export CSV ;
- Étant donné un viewer, quand il appelle directement l’endpoint des coûts,
  alors la réponse est 403 (ou les champs coûts absents de sa vue) ;
- Étant donné une période sans données, quand je la sélectionne, alors les
  métriques affichent zéro / « pas de données » sans erreur ;
- Étant donné une opportunité avec montant, quand elle passe en étape gagnée,
  alors le revenu de la période et de la campagne l’intègre ;
- Étant donné la même requête exécutée deux fois, quand les données n’ont pas
  changé, alors les résultats sont strictement identiques.

## États et erreurs

- loading : skeleton de dashboard aux dimensions stables ;
- empty : workspace sans activité — état neutre avec action principale
  (« lancer une campagne » / « découvrir des prospects ») ;
- validation : période invalide (début > fin) → 400 explicite ;
- forbidden : coûts/revenu/export refusés aux rôles non autorisés, même par
  appel direct API ;
- provider indisponible : non applicable (lecture sur tables internes) ;
- conflit métier : non applicable (lecture seule) ;
- reprise : non applicable.

## Contrats

**Routes UI** : `/w/[workspaceSlug]/analytics` (page principale) ; le
dashboard autopilot par campagne existant reste inchangé.

**Use cases** : `GetWorkspaceFunnel`, `GetAnalyticsBreakdown` (dimension
paramétrable), `ExportAnalyticsView`.

**API** :

| Méthode | Route | Usage | État |
|---|---|---|---|
| GET | `/api/v1/analytics/funnel` | entonnoir du workspace, filtres période/campagne/ICP/canal/signal | à spécifier |
| GET | `/api/v1/analytics/breakdown` | découpage par dimension (icp, canal, rôle, signal, campagne) | à spécifier |
| GET | `/api/v1/analytics/costs` | coûts IA, coût par prospect et par RDV (owner/admin) | à spécifier |
| GET | `/api/v1/analytics/export` | export CSV de la vue filtrée (owner/admin) | à spécifier |

**Événements sortants** : aucun (lecture seule). La taxonomie d’events
existante est documentée comme source d’audit, pas de comptage.

**Ports externes** : aucun.

## Données et confidentialité

- aucune nouvelle table de faits ; extension additive : `opportunities.amount`
  (numeric) + `opportunities.currency` (varchar(3)), nullables, sans
  rétroactivité ;
- données personnelles : les vues agrégées n’exposent aucune PII et le
  viewer n’a accès qu’aux agrégats ; si le drill-down est introduit plus
  tard, il respectera les permissions existantes des listes (F-020/F-021) ;
- rétention : les métriques suivent la durée de vie des faits ; une
  suppression F-026 ne réécrit pas l’historique (les faits d’envoi passés
  restent comptabilisés, sans lien vers la personne après anonymisation) ;
- audit : l’export CSV est audité (F-003) ; les lectures simples ne le sont
  pas.

## Analytics

- la feature est elle-même le produit d’analytics ; événements produit :
  `analytics_viewed`, `analytics_filter_applied`, `analytics_exported` ;
- dimensions : workspace, filtres utilisés, rôle ;
- métrique de succès : les chiffres affichés sont reproduits à l’identique
  par une requête SQL de référence (test de reproductibilité).

## Tests obligatoires

- domaine : définitions des métriques (intention ≠ tentative ≠ accepté ≠
  répondu), calcul des taux et dénominateurs ;
- application : reproductibilité (deux exécutions = même résultat), période
  bornée inclusive/exclusive documentée ;
- intégration PostgreSQL : doublons d’events sans effet, jointures
  signal/ICP/rôle, montant d’opportunité agrégé sur étape gagnée ;
- isolation workspace : mêmes volumes dans deux workspaces, aucun mélange ;
- permission : coûts/export refusés à operator/reviewer/viewer par appel
  direct API ;
- export : le CSV reflète exactement la vue filtrée ;
- E2E : campagne exécutée sur données réalistes → entonnoir cohérent de
  « trouvé » à « rendez-vous » ;
- visuel/accessibilité : 375/768/1024/1440 px, tableau de chiffres lisible
  au clavier.

## Dépendances

- F-031 (campagnes), F-034 (scheduler/actions), F-040 (inbox/réponses),
  F-044 (pipeline) : livrés ou partiels — sources de faits ;
- F-042 (classification des réponses) : socle livré — réponses positives ;
- F-043 (Cal.com) : partiel — rendez-vous ;
- F-023, F-025, F-027 : livrés — prospects, enrichissement, signaux ;
- F-003 (audit) : livré — audit de l’export ;
- AI-140 (futur consommateur) : aucune action requise dans ce chantier.

## Questions résolues avant développement

- approche : projection SQL à la demande, pas de tables d’agrégats (voir
  section décision) ;
- les métriques comptent les faits (tables), jamais les events outbox ;
- le revenu passe par l’ajout additif de `amount`/`currency` sur
  `opportunities` — pas de rétroactivité, montant optionnel ;
- « livré » = accepté fournisseur ; le bounce fin est documenté comme limite
  connue, pas simulé ;
- l’attribution initiale est « dernière campagne touchée » via
  `opportunities.campaign_id`, sans multi-touch.
