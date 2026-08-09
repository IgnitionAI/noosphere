# F-044 — Pipeline et opportunités (complétion)

## Résultat utilisateur

Piloter chaque opportunité jusqu’à la clôture : valeur et probabilité à jour,
responsable identifié, prochaine action visible, perte motivée — et des
prévisions de revenu fiables par période.

## Acteurs et permissions

| Acteur | Lecture | Mutation | Approbation |
|---|---|---|---|
| owner/admin | oui | crée, édite, change d’étape, clôt | non |
| operator | oui | édite ses opportunités, change d’étape | non |
| reviewer | oui | non | non |
| viewer | oui (sans montants) | non | non |

## État d’implémentation

Partiel. Livré : table `opportunities` (étape, `amount`/`currency` et
`next_action` déjà en base — migration 0049), `opportunity_stage_history`
immuable, `GET /api/v1/opportunities` + `POST
/opportunities/:id/actions/change-stage`, vue pipeline 4 colonnes avec
métriques, transitions automatiques depuis le Setter et le calendrier
(F-043), event `OpportunityStageChanged`, rattachement prospect/campagne/
ICP/rendez-vous. Restent à livrer : édition des champs (montant, devise,
probabilité, responsable, prochaine action, date de clôture), clôture avec
motif de perte obligatoire, conservation de l’offre/version vendue, et
prévisions (revenu pondéré par probabilité).

## Périmètre

- édition d’une opportunité ouverte : montant + devise, probabilité (0–100),
  responsable (membre du workspace), prochaine action + date, date de
  clôture estimée ;
- clôture : `won` exige un montant et une devise ; `lost` exige un motif de
  perte (liste normalisée + commentaire) ; la date de clôture est enregistrée ;
- offre/version vendue : référence `offer_version_id` (immuable, F-010)
  conservée sur l’opportunité, renseignée au plus tard à la clôture gagnée ;
- prévisions : revenu pondéré (montant × probabilité) par période de clôture
  estimée, par étape et par responsable — alimente F-051 ;
- la vue pipeline affiche montant, probabilité, responsable et prochaine
  action ; tri/filtre par responsable et étape ;
- les changements financiers significatifs (montant, étape, clôture) sont
  audités ; l’historique d’étapes reste immuable.

## Hors périmètre

- devis, contrats, facturation, delivery (décision catalogue inchangée) ;
- réattribution automatique ou round-robin des responsables ;
- prévisions par modèle IA (le pondéré est déterministe ; AI-1xx plus tard) ;
- devise multiple avec conversion (une devise par opportunité, pas de
  change).

## Parcours principal

1. une opportunité naît d’une réponse positive ou d’un rendez-vous (flux
   existant) ; l’operator la complète : montant, probabilité, responsable,
   prochaine action, clôture estimée ;
2. la vue pipeline reflète ces champs ; le filtre par responsable isole son
   portefeuille ;
3. à la clôture : `won` exige montant + devise (et l’offre/version vendue),
   `lost` exige le motif ; l’historique immuable consigne la transition ;
4. les prévisions agrègent le revenu pondéré par période et responsable ;
5. un viewer ne voit jamais les montants.

## Règles métier et invariants

- l’historique d’étapes est immuable : toute transition ajoute une entrée,
  jamais de modification (invariant existant, étendu aux champs de clôture) ;
- `won` exige montant > 0 et devise ; `lost` exige un motif normalisé — le
  serveur refuse (422) une clôture incomplète, même par appel direct ;
- une opportunité clôturée est verrouillée : seule une réouverture explicite
  (owner/admin, auditée, nouvelle entrée d’historique) la rend modifiable ;
- l’offre/version vendue référence une version publiée et immuable (F-010) —
  jamais un brouillon ; elle ne change pas après clôture gagnée ;
- la probabilité est comprise entre 0 et 100 ; le revenu pondéré est calculé
  (montant × probabilité), jamais saisi ;
- les montants ne sont jamais exposés aux viewers (redaction comme F-051) ;
- une opportunité reste rattachée à son contact et son workspace ; isolation
  stricte ;
- le motif de perte alimente une liste normalisée par workspace (valeurs par
  défaut fournies, extensibles owner/admin) ;
- la réouverture ne réécrit pas les métriques passées de F-051 : le revenu
  est comptabilisé sur la période de clôture effective.

## Critères d’acceptation

- Étant donné une opportunité ouverte, quand l’operator édite montant,
  probabilité, responsable et prochaine action, alors la vue pipeline les
  reflète immédiatement ;
- Étant donné une clôture `won` sans montant ou sans devise, quand elle est
  soumise, alors la réponse est 422 avec le champ manquant ;
- Étant donné une clôture `lost` sans motif, quand elle est soumise, alors
  la réponse est 422 ;
- Étant donné une opportunité gagnée, quand je la lis, alors l’offre et la
  version vendue sont présentes et immuables ;
- Étant donné une opportunité clôturée, quand un operator tente de
  l’éditer, alors la réponse est 409 (verrouillée) ; un owner peut la
  rouvrir, avec entrée d’historique et audit ;
- Étant donné des opportunités avec montants et probabilités, quand je lis
  les prévisions, alors le revenu pondéré par période et responsable est
  calculé de façon déterministe ;
- Étant donné un viewer, quand il liste le pipeline par appel direct API,
  alors les montants sont absents de la réponse ;
- Étant donné deux workspaces, quand l’un clôt une opportunité, alors
  l’autre ne voit ni montant ni historique ;
- Étant donné un changement de montant, quand je consulte l’audit, alors
  j’y lis acteur, avant/après et date.

## États et erreurs

- loading : skeleton des colonnes du pipeline ;
- empty : aucune opportunité — état neutre (les transitions automatiques
  peuplent le pipeline, pas de création manuelle forcée) ;
- validation : probabilité hors 0–100, devise invalide, clôture incomplète
  (422 avec le champ en cause) ;
- forbidden : édition réservée owner/admin/operator, réouverture réservée
  owner/admin, montants masqués au viewer — contrôlé côté serveur ;
- provider indisponible : non applicable ;
- conflit métier : 409 sur édition d’une opportunité clôturée, ou double
  clôture simultanée (une seule transition gagne) ;
- reprise : non applicable (actions synchrones, transitions idempotentes par
  étape cible).

## Contrats

**Routes UI** : `/w/[workspaceSlug]/pipeline` (existante, enrichie :
édition en fiche/drawer, filtres responsable/étape, vue prévisions).

**Use cases** : `UpdateOpportunity`, `CloseOpportunity`,
`ReopenOpportunity`, `GetPipelineForecast`.

**API** :

| Méthode | Route | Usage | État |
|---|---|---|---|
| GET | `/api/v1/opportunities` | liste (montants redactés viewer) | implémenté, à étendre |
| POST | `/api/v1/opportunities/:id/actions/change-stage` | transition + historique | implémenté |
| PATCH | `/api/v1/opportunities/:id` | édition montant/probabilité/responsable/prochaine action/clôture estimée | à spécifier |
| POST | `/api/v1/opportunities/:id/actions/close` | clôture `won`/`lost` avec champs exigés | à spécifier |
| POST | `/api/v1/opportunities/:id/actions/reopen` | réouverture (owner/admin, auditée) | à spécifier |
| GET | `/api/v1/pipeline/forecast` | revenu pondéré par période/étape/responsable | à spécifier |
| GET/PUT | `/api/v1/workspaces/:id/lost-reasons` | motifs de perte normalisés | à spécifier |

**Événements sortants** : `OpportunityStageChanged` (existant),
`OpportunityWon` (matrice), `OpportunityLost` à ajouter — un seul envoi par
transition effective.

**Ports externes** : aucun.

## Données et confidentialité

- extensions de `opportunities` : `probability` (int 0–100), `owner_user_id`
  (membre du workspace), `expected_close_date`, `closed_at`, `lost_reason`,
  `lost_comment`, `offer_version_id` — migration additive, nullables, sans
  rétroactivité ;
- nouvelle table `workspace_lost_reasons` (ou jsonb paramétré) avec valeurs
  par défaut ;
- données personnelles : le responsable est un membre (donnée interne) ;
  les montants sont une donnée confidentielle — redaction viewer, audit des
  changements financiers ;
- rétention : les opportunités clôturées et leur historique persistent ;
  l’anonymisation du contact (F-053) ne réécrit ni montants ni historique.

## Analytics

- événements `opportunity_updated`, `opportunity_won`, `opportunity_lost`,
  `opportunity_reopened` ;
- dimensions : workspace, étape, motif de perte, responsable ;
- métriques de succès : part des opportunités avec montant + probabilité
  renseignés, écart prévisions/réalisé (mesuré par F-051), zéro clôture
  incomplète.

## Tests obligatoires

- domaine : verrous de clôture (champs exigés), calcul du revenu pondéré,
  verrouillage après clôture ;
- application : transitions idempotentes, réouverture avec historique ;
- intégration PostgreSQL : migration additive, immutabilité de l’historique,
  unicité d’une clôture simultanée ;
- permission : édition/réouverture refusées aux rôles insuffisants par appel
  direct API, montants redactés viewer ;
- isolation workspace : deux workspaces, mêmes étapes, aucun mélange ;
- audit : changements de montant, clôtures et réouvertures tracés ;
- cohérence F-051 : le revenu gagné remonte dans l’entonnoir analytics sur
  la période de clôture ;
- E2E : réponse positive → opportunité complétée → prévision pondérée →
  clôture gagnée avec offre/version → revenu visible dans F-051.

## Dépendances

- F-010 (versions d’offre immuables), F-020/F-021 (CRM), F-040/F-043
  (sources de transitions) : livrés ou partiels avancés ;
- F-002 (membres) : le champ responsable s’appuie sur les memberships
  existants — suffisant sans attendre la suite F-002 ;
- F-051 (analytics) : livrée — consomme le revenu et les prévisions ;
- F-003 (audit) : livré.

## Questions résolues avant développement

- la clôture est un endpoint dédié (`close`) plutôt qu’un simple changement
  d’étape : c’est le seul moyen d’exiger les champs de clôture ;
- une opportunité clôturée est verrouillée ; la réouverture est une action
  owner/admin auditée, pas une édition ;
- le revenu pondéré est déterministe (montant × probabilité), jamais estimé
  par un modèle ;
- pas de conversion de devises : une devise par opportunité, affichée telle
  quelle ;
- les motifs de perte sont normalisés par workspace avec des valeurs par
  défaut, extensibles par owner/admin.
