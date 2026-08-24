# F-027 — Signaux entreprise et contact

## Résultat utilisateur

Prioriser les prospects selon des événements observables — recrutements,
levées de fonds, changements de poste, expansion — chaque signal affichant sa
source, sa date d’observation, son expiration et sa confiance, au service du
scoring et de la personnalisation des messages.

## Acteurs et permissions

| Acteur | Lecture | Mutation | Approbation |
|---|---|---|---|
| owner/admin | oui | configure les types de signaux suivis | non |
| operator | oui | non (signaux observés par le système) | non |
| reviewer | oui | non | non |
| viewer | oui (signaux sans preuve détaillée) | non | non |

## État d’implémentation

Non commencé. La discovery F-023 produit des prospects avec des preuves
ponctuelles, mais aucune entité signal persistée, aucune déduplication
d’événements et aucune expiration ne sont implémentées. Le modèle
source/date/confiance de F-025 (observations d’enrichissement) sert de
référence de cohérence.

## Périmètre

- types de signaux : recrutement (offres d’emploi), levée de fonds,
  changement de poste, changement de direction, expansion (nouveau site,
  nouveau marché), activité publique (publication, prise de parole),
  technologies utilisées ; signal concurrent uniquement si la source
  l’autorise explicitement ;
- chaque signal porte : type, cible (entreprise ou contact), source, URL ou
  preuve, date d’observation, date d’expiration, niveau de confiance ;
- collecte via les sources gratuites et connectées disponibles (crawler,
  comptes connectés F-035 le cas échéant) ;
- déduplication : un même événement observé par deux sources ou deux
  passages produit un seul signal (avec sources cumulées) ;
- consommation : filtre dans la recherche/discovery (F-023), explication de
  priorité dans le scoring, variables de personnalisation pour les messages
  (F-030) ;
- liste des signaux récents sur les fiches entreprise et contact, et vue
  filtrable par type/fraîcheur.

## Hors périmètre

- scoring lui-même (règles F-023) : F-027 fournit les faits, F-023 les
  pondère ;
- surveillance en continu temps réel (streams) : la collecte initiale est par
  passages planifiés ;
- signaux sur des individus hors cible professionnelle (vie privée) ;
- alertes notifications temps réel vers l’utilisateur (Wave ultérieure).

## Parcours principal

1. un passage de collecte (planifié ou déclenché après discovery) interroge
   les sources pour les entreprises/contacts suivis ;
2. les événements candidats sont normalisés : type, cible, date, confiance,
   expiration selon le type ;
3. la déduplication fusionne les observations d’un même événement ;
4. les nouveaux signaux sont persistés, les événements de domaine émis une
   seule fois ; les signaux expirés ne sont plus présentés comme actuels ;
5. l’opérateur filtre la recherche par signal, ou lit sur une fiche pourquoi
   ce prospect est prioritaire, et un message peut citer le signal.

## Règles métier et invariants

- tout signal possède type, cible, source, date d’observation, expiration et
  confiance — aucun signal sans provenance ;
- un signal expiré n’est jamais présenté comme actuel, ni utilisé par le
  scoring ou la personnalisation ; il reste visible comme historique daté ;
- un même événement fournisseur est dédupliqué : clé fonctionnelle (type,
  cible, identité externe de l’événement ou fenêtre temporelle) ; les sources
  s’additionnent, le signal reste unique ;
- les données non disponibles via une source ne sont jamais simulées ou
  inférées : absence de signal = absence d’information ;
- un signal « concurrent » n’est collecté que si les conditions de la source
  l’autorisent ; la base légale est tracée avec le signal ;
- la collecte est idempotente : rejouer un passage ne crée ni doublon ni
  événement supplémentaire ;
- isolation workspace stricte : les signaux ne fuient pas entre workspaces ;
- une suppression active (F-026) sur un contact stoppe la collecte de
  signaux le ciblant personnellement ; les signaux entreprise restent
  collectés mais inutilisables pour ce contact.

## Critères d’acceptation

- Étant donné une levée de fonds observée sur deux sources, quand les deux
  observations arrivent, alors un seul signal existe avec les deux sources et
  la confiance la plus élevée ;
- Étant donné un signal dont l’expiration est passée, quand je lis la fiche
  ou lance un scoring, alors il est exclu des signaux actuels et visible
  uniquement en historique daté ;
- Étant donné un changement de poste observé, quand le signal est persisté,
  alors `EmploymentChanged` est émis une seule fois, même si le passage est
  rejoué ;
- Étant donné un filtre « recrute » dans la recherche, quand je l’applique,
  alors seuls les prospects avec un signal recrutement actuel remontent, avec
  la date affichée ;
- Étant donné une source qui ne publie pas de donnée, quand le passage
  s’exécute, alors aucun signal n’est fabriqué et l’absence est neutre ;
- Étant donné un signal actuel, quand je lis la priorité d’un prospect, alors
  le signal est cité comme explication avec sa date et sa source ;
- Étant donné deux workspaces suivant la même entreprise, quand l’un collecte,
  alors l’autre ne voit rien ;
- Étant donné un contact sous suppression globale, quand un passage collecte,
  alors aucun signal personnel n’est créé pour lui.

## États et erreurs

- loading : skeleton de la liste de signaux sur la fiche ;
- empty : aucun signal observé — état neutre, jamais de signal fictif ;
- validation : configuration d’un type de signal inconnu refusée ;
- forbidden : viewer ne voit pas les preuves détaillées ; configuration
  réservée à owner/admin (403 par appel direct API) ;
- provider indisponible : passage marqué en échec partiel, sources restantes
  collectées, retry borné ; l’absence de résultat reste distinguée de
  l’erreur ;
- conflit métier : non applicable (les doublons sont fusionnés, pas rejetés) ;
- reprise : relance d’un passage idempotente — aucun doublon, aucun événement
  en double.

## Contrats

**Routes UI** : fiches entreprise et contact (section « Signaux »), filtres
de la recherche prospects (F-023), et vue « Signaux » filtrable par
type/fraîcheur dans l’espace prospects.

**Use cases** : `CollectSignals` (passage), `ListCompanySignals`,
`ListContactSignals`, `ConfigureSignalTypes`.

**API** :

| Méthode | Route | Usage | État |
|---|---|---|---|
| GET | `/api/v1/companies/:id/signals` | signaux de l’entreprise (actuels + historique) | à spécifier |
| GET | `/api/v1/contacts/:id/signals` | signaux du contact | à spécifier |
| GET | `/api/v1/signals` | vue filtrable du workspace (type, fraîcheur, cible) | à spécifier |
| POST | `/api/v1/signals/actions/collect` | déclenche un passage de collecte | à spécifier |
| PUT | `/api/v1/settings/signals` | types de signaux suivis par le workspace | à spécifier |

**Événements sortants** : `SignalObserved` (un par signal nouveau,
idempotent), `EmploymentChanged` (spécialisation changement de poste,
consommable par le scoring et les séquences).

**Ports externes** : port `SignalSource` (implémentations : crawler gratuit,
sources publiques d’emploi, comptes connectés F-035) ; chaque implémentation
déclare les types qu’elle sait observer et ses conditions d’usage.

## Données et confidentialité

- nouvelle table `signals` (workspace, type, cible entreprise/contact,
  source, preuve/URL, `observedAt`, `expiresAt`, confiance, clé de
  déduplication, base légale) ; index sur (workspace, cible, type,
  expiration) ;
- données personnelles : les signaux contact (changement de poste, activité
  publique) visent des faits professionnels publics uniquement ; aucune
  collecte sur la vie privée ; la base légale (intérêt légitime, donnée
  publiée par la personne) est tracée par signal ;
- rétention : un signal expiré bascule en historique ; l’historique suit la
  durée de vie du contact/entreprise et est supprimé avec lui (les empreintes
  F-026 ne retiennent que l’identité, jamais les signaux) ;
- fusion (F-024) : les signaux suivent l’entité survivante ;
- audit : passages de collecte et changements de configuration audités
  (F-003).

## Analytics

- événements `signal_observed`, `signal_collection_run`,
  `signal_used_in_scoring`, `signal_used_in_message` ;
- dimensions : workspace, type, source, confiance, ICP ;
- métriques de succès : taux de prospects avec au moins un signal actuel,
  part des signaux cités dans les messages, lift de réponse sur prospects
  signalés vs non signalés (mesuré par F-051).

## Tests obligatoires

- domaine : déduplication multi-sources, calcul d’expiration par type,
  exclusion des signaux expirés du scoring/personnalisation ;
- application : idempotence d’un passage rejoué (ni doublon ni événement) ;
- intégration PostgreSQL : unicité de la clé de déduplication, filtrage
  actuels vs historique, fusion d’entités (F-024) ;
- contrat fournisseur : payload partiel, retardé, invalide et relivré ;
- suppression : aucun signal personnel collecté sur un contact supprimé
  (F-026) ;
- isolation workspace : même entreprise suivie dans deux workspaces ;
- E2E : discovery → collecte → signal visible sur fiche avec source/date →
  filtre de recherche → signal cité dans la priorité.

## Dépendances

- F-020 (companies), F-021 (contacts) : socles livrés ;
- F-023 (discovery/scoring) : livré — consommateur principal des signaux ;
- F-025 (enrichissement) : même chantier, modèle source/date/confiance
  partagé — livrer les fondations communes d’abord évite deux modèles de
  provenance ;
- F-026 (suppressions) : contrôle avant collecte personnelle ;
- F-003 (audit, jobs) : partiel ;
- consommateurs : F-030 (personnalisation des séquences), F-051 (analytics).

## Questions résolues avant développement

- pas de signal simulé : l’absence d’information est un état neutre affiché
  comme tel ;
- le signal « concurrent » est conditionné à l’autorisation explicite de la
  source, avec base légale tracée ;
- la collecte initiale est par passages planifiés, pas en temps réel ;
- les signaux expirés restent en historique daté, jamais supprimés
  silencieusement ni présentés comme actuels.
