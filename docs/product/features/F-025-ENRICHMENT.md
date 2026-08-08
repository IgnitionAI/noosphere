# F-025 — Enrichissement et vérification

## Résultat utilisateur

Compléter les profils entreprise et contact avec des coordonnées
professionnelles fiables : chaque valeur enrichie affiche sa provenance, sa
fraîcheur et son niveau de confiance, et un email professionnel vérifié est
distingué d’une adresse probable ou invalide.

## Acteurs et permissions

| Acteur | Lecture | Mutation | Approbation |
|---|---|---|---|
| owner/admin | oui | lance un enrichissement | non |
| operator | oui | lance un enrichissement | non |
| reviewer | oui | non | non |
| viewer | oui (valeurs sans preuve détaillée) | non | non |

## État d’implémentation

Partiel. Socle livré : port `ProspectEnricher` (application/crm) avec
implémentation crawler gratuite (`crawler-prospect-enricher`), modèle
`ProspectChannels` par canal (linkedin/email/whatsapp) portant déjà `status`
(`verified`/`found`/`unverified`/`unavailable`), `confidence`
(`high`/`medium`/`low`/`none`), `source`, `evidenceUrl`, `evidenceSnippet` et
`observedAt`, utilisé par la discovery F-023. Restent à livrer :
enrichissement à la demande sur un contact existant (hors discovery),
vérification d’email professionnel robuste, job asynchrone avec statut et
reprise, provenance par champ persistée, distinction numéro public entreprise
vs personnel pour téléphone/WhatsApp, et mesure des taux de couverture.

## Périmètre

- enrichissement à la demande d’un contact ou d’une entreprise existante,
  en job asynchrone avec statut (`queued`/`running`/`succeeded`/`failed`) ;
- recherche d’email professionnel : stratégie gratuite de découverte en
  premier (site entreprise, pages publiques, crawl), vérification de
  délivrabilité avant usage ;
- statuts de coordonnée explicites : `found` (trouvé), `probable` (pattern
  déduit, à confirmer), `verified` (vérifié), `invalid` (invalide) — un
  statut ne rétrograde jamais silencieusement ;
- provenance par champ : fournisseur/source, URL ou preuve, date
  d’observation, confiance ;
- téléphone/WhatsApp : distinction explicite entre numéro public d’entreprise
  (standard, ligne affichée) et numéro personnel ; un numéro personnel n’est
  retenu que si la source le publie comme contact professionnel direct ;
- mesure des coûts et quotas par fournisseur, et des taux de couverture par
  ICP et par source.

## Hors périmètre

- fournisseurs d’enrichissement payants branchés en production (le port
  reste ouvert, la stratégie gratuite est la référence initiale) ;
- enrichissement en masse de tout le CRM (les imports F-022 et la discovery
  F-023 restent les points d’entrée de volume) ;
- scoring de priorité (F-023) et signaux d’intention (F-027) — F-025 livre
  des faits vérifiés, pas des événements.

## Parcours principal

1. depuis la fiche contact, l’opérateur lance « enrichir » (ou comprend qu’un
   enrichissement automatique est prévu) ;
2. un job est créé ; la stratégie gratuite explore les sources publiques ;
3. les valeurs candidates sont évaluées : statut, confiance, preuve ;
4. les champs retenus sont mis à jour sans écraser une donnée plus fiable ;
5. le résultat (ou l’absence de résultat, distinguée de l’erreur) est visible
   avec la provenance par champ ; l’événement est émis une seule fois.

## Règles métier et invariants

- une valeur enrichie n’écrase jamais silencieusement une donnée de confiance
  supérieure ou égale ; un `verified` existant n’est remplacé que par un
  `verified` plus frais ;
- l’absence de résultat est distinguée d’une erreur fournisseur : la première
  est un état final, la seconde déclenche retry borné puis `failed` ;
- chaque valeur conserve fournisseur, date d’observation, preuve et
  confiance — aucune coordonnée sans provenance ;
- un email `probable` n’est jamais utilisé pour un envoi sans vérification ;
- un numéro classé « public entreprise » ne bascule jamais en « personnel »
  par inférence, et inversement ;
- un job d’enrichissement est idempotent : relancer le même job (même
  `requestKey`) ne duplique ni les écritures ni l’événement ;
- isolation workspace stricte : aucune donnée enrichie ne fuite entre
  workspaces, y compris via un cache fournisseur ;
- une suppression active (F-026) bloque l’enrichissement du canal concerné :
  on n’enrichit pas une identité qu’on n’a pas le droit de contacter.

## Critères d’acceptation

- Étant donné un contact avec email `verified`, quand l’enrichissement trouve
  un email `probable` différent, alors la valeur `verified` est conservée et
  le candidat est visible comme alternatif ;
- Étant donné un email déduit par pattern, quand la vérification de
  délivrabilité échoue, alors le statut passe à `invalid` avec la preuve de
  vérification, et le canal n’est plus proposé à l’envoi ;
- Étant donné un fournisseur indisponible, quand le job échoue, alors le
  statut est `failed` (et non « aucun résultat »), avec retry borné et erreur
  observable ;
- Étant donné un numéro trouvé sur la page contact de l’entreprise, quand il
  est retenu, alors il est classé « public entreprise » et jamais présenté
  comme ligne directe personnelle ;
- Étant donné le même enrichissement relancé deux fois, quand le doublon
  arrive, alors une seule écriture et un seul événement existent ;
- Étant donné deux workspaces avec le même contact, quand l’un enrichit,
  alors l’autre ne voit aucune de ces valeurs ;
- Étant donné une suppression email active sur le contact, quand
  l’enrichissement est lancé, alors le canal email est ignoré et le blocage
  est tracé ;
- Étant donné des enrichissements terminés, quand je consulte les métriques,
  alors je lis le taux de couverture par ICP et par source, et le coût par
  fournisseur.

## États et erreurs

- loading : badge « enrichissement en cours » sur la fiche, skeleton des
  champs concernés ;
- empty : aucune donnée enrichie — action principale « Enrichir » visible ;
- validation : contact sans identité minimale (nom + entreprise) —
  l’enrichissement est refusé avec la raison ;
- forbidden : reviewer/viewer ne peuvent pas lancer, même par appel direct
  API (403) ;
- provider indisponible : job `failed` avec cause fournisseur, autres
  fournisseurs/canaux non bloqués, retry borné ;
- conflit métier : 409 explicite quand une écriture tenterait de rétrograder
  une valeur plus fiable ;
- reprise : relance d’un job `failed` depuis la fiche, idempotente via
  `requestKey`.

## Contrats

**Routes UI** : fiche prospect
(`/w/[workspaceSlug]/prospects/[contactId]`) — section coordonnées avec
provenance et statuts ; badge de couverture dans les listes prospects.

**Use cases** : `EnrichContact`, `GetEnrichmentJob`, `RetryEnrichmentJob`,
`RecordEnrichmentResult`.

**API** :

| Méthode | Route | Usage | État |
|---|---|---|---|
| POST | `/api/v1/contacts/:id/actions/enrich` | lance un enrichissement (job) | déclaré, à implémenter |
| GET | `/api/v1/enrichment-jobs/:id` | statut et résultat du job | à spécifier |
| POST | `/api/v1/webhooks/enrichment/:provider` | callback fournisseur signé | déclaré, à implémenter |
| GET | `/api/v1/contacts/:id/enrichment` | provenance par champ | à spécifier |

**Événements sortants** : `ContactIdentityVerified` (un par identité vérifiée,
idempotent à la republication). `EnrichmentJobCompleted` / `EnrichmentJobFailed`
à ajouter si le suivi de job doit être consommé hors UI.

**Ports externes** : `ProspectEnricher` (existant, implémentation crawler
gratuite) ; futur port `EmailVerifier` pour la délivrabilité ; webhooks
fournisseurs à signature vérifiée.

## Données et confidentialité

- extension des observations de canaux (`ProspectChannels`) avec persistance
  de la provenance par champ : table d’observations d’enrichissement
  (workspace, contact, champ, valeur normalisée, statut, confiance, source,
  preuve, `observedAt`, `jobId`) + table de jobs ;
- données personnelles : emails et téléphones professionnels — la distinction
  numéro public entreprise vs personnel est obligatoire ; les preuves
  (snippets, URL) sont conservées pour justification et supprimées avec le
  contact (sauf empreintes de suppression F-026) ;
- rétention : une observation est marquée par sa fraîcheur ; les observations
  périmées restent visibles comme historique, jamais comme valeur courante ;
- audit : lancement de job, écriture de valeur, remplacement de valeur et
  retry sont audités (F-003).

## Analytics

- événements `enrichment_requested`, `enrichment_completed`,
  `enrichment_failed`, `contact_identity_verified` ;
- dimensions : workspace, ICP, source/fournisseur, canal, statut obtenu ;
- métriques de succès : taux de couverture par ICP et source, part de
  `verified` dans les emails utilisés, coût par contact enrichi.

## Tests obligatoires

- domaine : hiérarchie de confiance (jamais de rétrogradation silencieuse),
  transitions de statut (`probable` → `verified`/`invalid`), classification
  public entreprise vs personnel ;
- application : idempotence du job (`requestKey`), distinction absence de
  résultat vs erreur fournisseur ;
- intégration PostgreSQL : unicité d’observation par (contact, champ,
  valeur), persistance de la provenance, historique des valeurs ;
- contrat fournisseur : payload partiel, retardé, invalide et relivré ;
- suppression : enrichissement bloqué sur canal supprimé (F-026) ;
- isolation workspace : mêmes identités métier dans deux workspaces ;
- permission : lancement refusé à reviewer/viewer par appel direct API ;
- E2E : fiche contact → enrichir → job suivi → valeur `verified` affichée
  avec provenance.

## Dépendances

- F-020 (companies), F-021 (contacts) : socles livrés ;
- F-024 (dedup/merge) : les observations suivent le contact survivant à la
  fusion ;
- F-026 (suppressions) : contrôle d’éligibilité avant enrichissement ;
- F-003 (audit, jobs, dead letters) : partiel — console jobs à livrer ;
- consommateurs : F-034 (scheduler) lit les statuts de canal avant envoi,
  F-027 (signaux) réutilise le même modèle source/date/confiance.

## Questions résolues avant développement

- la stratégie gratuite de découverte est la référence initiale ; les
  fournisseurs payants restent derrière le port, branchés plus tard ;
- un email `probable` n’est jamais envoyé sans vérification préalable ;
- la distinction numéro public entreprise vs personnel est un champ explicite,
  jamais une inférence ;
- l’enrichissement à la demande est un job asynchrone : pas de réponse
  synchrone bloquante.
