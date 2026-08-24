# F-023 — Découverte de prospects

## Résultat utilisateur

Depuis une `ICPVersion` publiée, lancer une recherche LinkedIn via Unipile V1,
prévisualiser les candidats avec leurs correspondances et écarts ICP, puis
importer les profils choisis dans le CRM avec leur provenance complète.

## Acteurs et permissions

| Acteur | Lecture | Mutation | Approbation |
|---|---|---|---|
| owner/admin | oui | lancer, importer | — |
| operator | oui | lancer, importer | — |
| reviewer | oui | non | — |
| viewer | oui | non | — |

## Périmètre

- `ProspectSource` Unipile V1 (DSN dédié, `/api/v1/linkedin/search`,
  `X-API-KEY`, compte LinkedIn connecté) ;
- filtres explicites construits depuis la version publiée et enregistrés avant
  l’appel fournisseur ;
- correspondances et écarts ICP par règles visibles (géographie, mots-clés du
  secteur, taille) — aucune génération par modèle ;
- import sélectif : contact + emploi courant + identité LinkedIn, source
  `provider`, avec lien vers le run de découverte ;
- états fournisseur : indisponible ou aucun compte valide → run `failed`
  récupérable (retry), jamais une liste vide trompeuse.

## Hors périmètre

- envoi d’invitations ou de messages ;
- recherche d’emails professionnels (F-025) ;
- déduplication inter-runs (F-024) ;
- import CSV (F-022).

## Parcours principal

1. l’utilisateur choisit une version ICP publiée ;
2. les filtres envoyés au fournisseur sont figés et enregistrés ;
3. les candidats s’affichent avec matches et gaps ;
4. l’utilisateur importe les profils choisis ; chaque contact créé porte sa
   provenance (`provider` + run) ;
5. un candidat déjà supprimé ou en conflit d’identité est refusé avec le motif.

## Règles métier et invariants

- seule une `ICPVersion` publiée peut lancer une recherche ;
- les filtres envoyés au fournisseur sont enregistrés avec le run ;
- un candidat n’entre pas dans le CRM sans provenance ;
- les correspondances et écarts ICP sont visibles avant import ;
- un fournisseur indisponible produit un état récupérable, pas une liste vide
  trompeuse ;
- une suppression existante (F-021/F-026) bloque l’import avec 409.

## Critères d’acceptation

- Étant donné un run de recherche sans version publiée, quand je lance, alors
  404 ;
- Étant donné un compte Unipile sans LinkedIn valide, quand je lance, alors le
  run est `failed` avec `PROVIDER_UNAVAILABLE` et une action retry ;
- Étant donné un candidat importé, quand je lis sa fiche, alors la source est
  `provider` et l’identité LinkedIn est normalisée ;
- Étant donné un candidat supprimé, quand j’importe, alors 409
  `CONTACT_SUPPRESSED`.

## États et erreurs

- loading : progression du run visible et reprenable après navigation ;
- empty : aucun run — action principale « lancer une recherche » depuis une
  version publiée ;
- validation : aucune version ICP publiée sélectionnée ;
- forbidden : reviewer/viewer sans action lancer/importer, contrôlé côté
  serveur ;
- provider indisponible : run `failed` avec `PROVIDER_UNAVAILABLE`, action
  retry explicite, jamais de liste vide présentée comme un résultat ;
- conflit métier : 409 à l’import (suppression active, identité existante)
  avec motif lisible ;
- reprise : un run échoué se relance sans recréer les candidats déjà
  importés.

## Contrats

**Routes UI** : `/w/[workspaceSlug]/prospects/discover`

**API** :

| Méthode | Route | Usage |
|---|---|---|
| GET | `/api/v1/icp-versions` | versions publiées du workspace |
| POST | `/api/v1/icp-versions/:versionId/discovery-runs` | lancer une recherche |
| GET | `/api/v1/discovery-runs?icpVersionId=` | runs d’une version |
| GET | `/api/v1/discovery-runs/:runId` | run + candidats |
| POST | `/api/v1/discovery-runs/:runId/actions/retry` | relancer un run échoué |
| POST | `/api/v1/discovery-runs/:runId/candidates/:candidateId/actions/import` | importer un candidat |

**Événements sortants** : `ProspectDiscovered` (via l’outbox
transactionnelle, dispatcher en place depuis le chantier 2).

**Ports externes** : `ProspectSource.searchPeople` (Unipile V1).

## Données et confidentialité

- `prospect_discovery_runs` (version, filtres, statut, erreur) ;
- `prospect_discovery_candidates` (profil public LinkedIn, fit ICP, import) ;
- données personnelles : profils publics ; les suppressions existantes sont
  revérifiées à l’import.

## Tests obligatoires

- contrat fournisseur (forme de requête, headers, parsing, erreurs) ;
- gate ICPVersion (intégration) ;
- filtres enregistrés (intégration) ;
- import avec provenance et suppression (intégration) ;
- isolation workspace (intégration) ;
- visuel 375 → 1440.

## Dépendances

- F-011 (version publiée), F-020, F-021, F-026 (suppressions) ;
- fournisseur : Unipile V1 (DSN, clé API, compte LinkedIn connecté).
