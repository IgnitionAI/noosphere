# F-033 — File d’approbation (exceptions autopilote)

## Résultat utilisateur

Superviser efficacement chaque action sensible : examiner le contenu avec
son contexte complet, éditer si besoin, approuver ou rejeter en justifiant —
en lot sans jamais masquer un item devenu invalide.

## Acteurs et permissions

| Acteur | Lecture | Mutation | Approbation |
|---|---|---|---|
| owner/admin | oui | édite | approuve, rejette |
| reviewer | oui | édite | approuve, rejette |
| operator | oui | non | non |
| viewer | non (contenu personnalisé) | non | non |

## Périmètre

- file d’exceptions de l’autopilote : items que la politique F-012 soumet à
  validation humaine (premier contact, réponses ou relances selon la
  politique) et sorties hors bornes de l’autopilote ;
- aperçu contextualisé : prospect, entreprise, canal, étape de séquence,
  contenu rendu avec variables résolues, claims et preuves associés ;
- édition avant approbation, avec version conservée ;
- décision unitaire ou en lot : approbation, rejet avec justification ;
- invalidation automatique : un changement de données (contact, suppression,
  version) renvoie l’item en revue.

## Hors périmètre

- exécution de l’envoi (F-034) ;
- rédaction de réponses (F-042) ;
- génération de contenu par modèle (K3, dans les bornes de la politique
  F-012) ;
- blocage du chemin normal : l’autopilote n’attend jamais cette file pour les
  actions dans les bornes (D-003).

## Parcours principal

1. un item entre dans la file à la planification d’une étape soumise à
   validation ;
2. le reviewer ouvre l’aperçu complet (contexte + contenu + preuves) ;
3. il approuve, édite puis approuve, ou rejette avec justification ;
4. les décisions en lot réaffichent les items devenus invalides entre-temps ;
5. chaque décision est auditée et l’item approuvé devient exécutable
   (F-034).

## Règles métier et invariants

- aucun item soumis à validation par la politique (F-012) n’est exécuté sans
  décision humaine ;
- chaque item montre prospect, entreprise, canal, étape, contenu et preuves ;
- un contenu obsolète après changement de données retourne en revue —
  jamais exécuté tel quel ;
- une suppression (F-026) sur le prospect invalide immédiatement l’item ;
- les décisions en lot sautent les items devenus invalides au lieu de les
  approuver ;
- un rejet exige une justification ; une approbation après édition conserve
  le contenu d’origine et le contenu édité ;
- les décisions sont idempotentes : rejouer une approbation ne duplique ni
  décision ni action ;
- chaque décision est auditée (acteur, date, motif, contenu).

## Critères d’acceptation

- Étant donné un item dont le prospect est supprimé après planification,
  quand j’ouvre la file, alors l’item est marqué invalide et non
  approuvable ;
- Étant donné un lot de 10 items dont 2 devenus invalides, quand j’approuve
  le lot, alors 8 sont approuvés et 2 retournent en revue ;
- Étant donné un rejet sans justification, quand je soumets, alors 422 ;
- Étant donné une approbation après édition, quand je lis l’historique,
  alors les deux contenus sont visibles ;
- Étant donné un operator, quand il appelle l’endpoint d’approbation, alors
  403 ;
- Étant donné la même décision rejouée, quand le réseau retries, alors une
  seule décision existe ;
- Étant donné deux workspaces, quand l’un a des items en file, alors l’autre
  ne les voit pas.

## États et erreurs

- loading : skeleton de la file et de l’aperçu ;
- empty : file vide — état neutre avec compteur à zéro ;
- validation : justification de rejet manquante, contenu édité vide ;
- forbidden : approbation réservée à owner/admin/reviewer, contrôlé côté
  serveur ;
- provider indisponible : non applicable ;
- conflit métier : item déjà décidé par un autre reviewer (409 avec la
  décision existante) ;
- reprise : filtres et position dans la file conservés après navigation.

## Contrats

**Routes UI** : `/w/[workspaceSlug]/approvals`.

**API** :

| Méthode | Route | Usage |
|---|---|---|
| GET | `/api/v1/approval-items?campaignId=&status=` | file paginée et filtrable |
| GET | `/api/v1/approval-items/:id` | aperçu contextualisé complet |
| PATCH | `/api/v1/approval-items/:id` | éditer le contenu avant décision |
| POST | `/api/v1/approval-items/:id/actions/approve` | approuver (idempotent) |
| POST | `/api/v1/approval-items/:id/actions/reject` | rejeter avec justification |
| POST | `/api/v1/approval-items/actions/bulk-decide` | décision en lot, invalides exclus |

**Événements sortants** : `ApprovalItemApproved`, `ApprovalItemRejected`
(entérinés par décision lead — remplacent le `SequenceApproved` du
catalogue), via l’outbox.

**Ports externes** : aucun.

## Données et confidentialité

- agrégat `ApprovalItem` (campagne, prospect, canal, étape, contenu
  original/édité, statut, décision, justification) ;
- données personnelles : contenu personnalisé adressé à une personne —
  viewer exclu, accès tracé ;
- rétention : items et décisions conservés avec la campagne ;
- audit : édition, approbation, rejet tracés.

## Analytics

- événements `approval_item_approved`, `approval_item_rejected` ;
- dimensions : workspace, campagne, canal, édité ou non ;
- métrique de succès : délai médian de décision, taux d’édition.

## Tests obligatoires

- domaine : invalidation sur changement de données, rejet sans justification
  refusé ;
- intégration PostgreSQL : décision idempotente, lot avec invalides exclus ;
- suppression tardive : item invalidé par une suppression créée après
  planification (test transverse) ;
- isolation workspace et permissions (appel direct API) ;
- E2E : item planifié → aperçu → édition → approbation → historique.

## Dépendances

- F-012 (politique de supervision) : livré ;
- F-026 (suppressions) : livré ;
- F-031 (campagne active) : livré ;
- F-032 (enrollments) et F-034 (planification) : produisent et consomment
  les items.

## Questions résolues avant développement

- un item en exception n’est jamais auto-approuvé, même en lot ;
- une édition ne change pas la version de stratégie : elle porte sur l’item
  uniquement et reste tracée ;
- la file est générique dès maintenant (premier contact, relances, plus tard
  réponses F-042) : un seul agrégat `ApprovalItem`.
