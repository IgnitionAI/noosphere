# F-032 — Population, priorité et enrollment

## Résultat utilisateur

Sélectionner les bons prospects pour une campagne active : filtres
déterministes, score explicable pondéré par les critères ICP, revue manuelle,
puis enrollment sans conflit.

## Acteurs et permissions

| Acteur | Lecture | Mutation | Approbation |
|---|---|---|---|
| owner/admin | oui | sélectionne, enrolle, exclut | — |
| operator | oui | sélectionne, enrolle, exclut | — |
| reviewer | oui | non | non |
| viewer | oui | non | non |

## Périmètre

- population : filtres déterministes sur le CRM (ICP versionnée de la
  campagne, secteur, taille, géographie, présence d’un canal valide) ;
- scoring : poids par critère d’`ICPCriterion` (obligatoire, souhaitable,
  exclusif), score reproductible à partir des critères enregistrés ;
- explication par prospect : critères satisfaits, données manquantes,
  exclusions — distinguées ;
- sélection manuelle dans la population scorée ;
- enrollment : rattachement à la campagne avec sa `SequenceVersion` figée ;
- gestion des conflits : un contact déjà en séquence active est refusé avec
  la campagne concernée.

## Hors périmètre

- scoring par modèle (AI-100, mode shadow uniquement en Wave 7) ;
- exécution des étapes (F-034) et approbation des messages (F-033) ;
- découverte de nouveaux prospects (F-023) ;
- modification de la population après activation hors enrollment explicite.

## Parcours principal

1. l’utilisateur ouvre la population de la campagne (ICP figée au snapshot) ;
2. les prospects sont listés avec score et explication ;
3. il ajuste les filtres, sélectionne et exclut manuellement ;
4. l’enrollment vérifie éligibilité (suppression F-026, canal valide,
   conflit) puis rattache les prospects ;
5. tout enrollement est rejouable sans doublon.

## Règles métier et invariants

- chaque score est reproductible : mêmes critères + mêmes données = même
  score ;
- l’explication distingue toujours faits, données manquantes et exclusions ;
- un critère exclusif non satisfait exclut le prospect, quel que soit le
  score ;
- un contact n’a qu’une séquence active par workspace : le conflit indique
  la campagne active concernée ;
- les prospects supprimés (F-026) ou sans canal valide sont exclus, avec
  revérification à l’enrollment ;
- l’enrollment est idempotent : rejouer la même sélection ne duplique ni
  enrollment ni actions ;
- la campagne doit être activée (snapshot figé) avant tout enrollment ;
- chaque enrollment est audité.

## Critères d’acceptation

- Étant donné un critère ICP sans donnée prospect, quand je lis
  l’explication, alors il apparaît comme « manquant », jamais comme écart ;
- Étant donné un critère exclusif violé, quand le score est calculé, alors
  le prospect est exclu malgré un score élevé par ailleurs ;
- Étant donné le même jeu de données, quand je recalcule, alors les scores
  sont identiques ;
- Étant donné un contact en séquence active dans une autre campagne, quand
  je l’enrolle, alors 409 avec la campagne concernée ;
- Étant donné une suppression créée entre sélection et enrollment, quand
  l’enrollment s’exécute, alors le prospect est refusé avec le motif ;
- Étant donné le même enrollment rejoué, quand le réseau retries, alors un
  seul enrollment existe ;
- Étant donné un reviewer, quand il appelle l’endpoint d’enrollment, alors
  403.

## États et erreurs

- loading : skeleton de la population pendant le scoring ;
- empty : aucun prospect éligible — filtres et critères manquants affichés
  pour expliquer ;
- validation : campagne non activée, sélection vide ;
- forbidden : enrollment réservé aux rôles de mutation, contrôlé côté
  serveur ;
- provider indisponible : non applicable (données CRM internes) ;
- conflit métier : 409 séquence active ailleurs, suppression active ;
- reprise : filtres et sélection conservés après navigation.

## Contrats

**Routes UI** : onglet population de
`/w/[workspaceSlug]/campaigns/[campaignId]` et étape population du builder.

**API** :

| Méthode | Route | Usage |
|---|---|---|
| GET | `/api/v1/campaigns/:id/prospects` | population scorée et explications (existant, à étendre) |
| POST | `/api/v1/campaigns/:id/prospects/select` | sélectionner des prospects |
| POST | `/api/v1/campaigns/:id/prospects/:contactId/actions/enroll` | enrollement idempotent |
| POST | `/api/v1/campaigns/:id/prospects/:contactId/actions/exclude` | exclure avec motif |
| GET | `/api/v1/campaigns/:id/prospects/:contactId/explanation` | détail du score et des exclusions |

**Événements sortants** : `CampaignProspectEnrolled` (entériné par décision
lead), via l’outbox.

**Ports externes** : aucun.

## Données et confidentialité

- agrégats : `CampaignProspect` (état : candidat, sélectionné, exclu,
  enrôlé) avec score et explication persistés ;
- données personnelles : scores et expositions de critères sur des personnes
  — lecture limitée aux membres du workspace ;
- rétention : l’explication est conservée avec la campagne pour
  l’auditabilité des scores ;
- audit : sélection, exclusion, enrollment tracés.

## Analytics

- événement `campaign_prospect_enrolled` ;
- dimensions : workspace, campagne, source du prospect ;
- métrique de succès : part de la population scorée effectivement enrôlée.

## Tests obligatoires

- domaine : scoring reproductible, critère exclusif, distinction
  manquant/écart ;
- intégration PostgreSQL : unicité de la séquence active par contact,
  enrollment idempotent ;
- suppression tardive : suppression créée entre sélection et enrollment
  (test transverse QUALITY_GATES) ;
- isolation workspace et permissions (appel direct API) ;
- E2E : population → explication → sélection → enrollment → conflit géré.

## Dépendances

- F-011 (critères ICP structurés), F-031 (campagne activée, snapshot) :
  livrés ;
- F-021 (contacts), F-026 (suppressions) : livrés ;
- F-033/F-034 : consomment les enrollments.

## Questions résolues avant développement

- le scoring est 100 % déterministe : aucun modèle avant la Wave 7, et même
  alors en shadow uniquement ;
- l’exclusion manuelle est mémorisée avec motif : un prospect exclu n’est
  pas reproposé à la même campagne ;
- l’enrollment après activation est autorisé en continu (population vivante),
  toujours sur la `SequenceVersion` figée du snapshot.
