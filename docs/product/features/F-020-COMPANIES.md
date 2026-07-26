# F-020 — Entreprises

## Résultat utilisateur

Disposer d’une fiche entreprise canonique et exploitable, alimentée par la
recherche ICP, l’import manuel et — plus tard — le sourcing.

## Acteurs et permissions

| Acteur | Lecture | Mutation | Approbation |
|---|---|---|---|
| owner/admin | oui | oui | — |
| operator | oui | oui | — |
| reviewer | oui | non | — |
| viewer | oui | non | — |

## Périmètre

- création manuelle d’une entreprise ;
- recherche paginée et filtrable (nom, secteur, taille, localisation) ;
- domaine normalisé unique par workspace lorsqu’il est connu ;
- identifiants externes (LinkedIn, registres) et provenance par champ enrichi ;
- fiche détail : contacts liés, signaux et campagnes liés (placeholders F-02x).

## Hors périmètre

- enrichissement automatique (F-025) ;
- signaux (F-027) ;
- fusion d’entreprises (F-024).

## Parcours principal

1. l’utilisateur crée une entreprise (nom obligatoire, domaine optionnel) ;
2. le domaine est normalisé (minuscules, sans schéma ni chemin) ;
3. la fiche est visible dans la liste avec sa provenance ;
4. un doublon de domaine renvoie un conflit explicite avec la fiche existante.

## Règles métier et invariants

- le domaine normalisé est unique par workspace lorsqu’il est connu ;
- une entreprise d’un autre workspace est indistinguable d’une entreprise
  absente (404) ;
- chaque champ enrichi conserve source, date et confiance ;
- la provenance `manual`, `csv`, `icp_research` ou `provider` est conservée ;
- une entreprise sans domaine reste valide et ne bloque aucune création.

## Critères d’acceptation

- Étant donné un domaine `HTTPS://WWW.Example.com/path`, quand je crée
  l’entreprise, alors le domaine stocké est `example.com` ;
- Étant donné une entreprise existante avec `example.com`, quand je recrée la
  même entreprise, alors j’obtiens 409 avec l’identifiant de l’existante ;
- Étant donné deux workspaces, quand je consulte l’entreprise de l’autre
  workspace, alors la réponse est 404 ;
- Étant donné 30 entreprises, quand je liste avec une limite de 10, alors la
  pagination par curseur est stable.

## États et erreurs

- validation (nom vide, domaine malformé) ;
- conflit domaine (409) ;
- isolation workspace (404).

## Contrats

**Routes UI** : `/w/[workspaceSlug]/companies`, `/w/[workspaceSlug]/companies/[companyId]`

**API** :

| Méthode | Route | Usage |
|---|---|---|
| GET | `/api/v1/companies?search=&sector=&cursor=&limit=` | liste paginée |
| POST | `/api/v1/companies` | création manuelle |
| GET | `/api/v1/companies/:companyId` | détail avec contacts liés |

**Événements sortants** : `CompanyCreated`.

## Données et confidentialité

- table `companies` (workspace-scopée, domaine normalisé unique) ;
- table `company_field_provenance` (champ, source, confiance, date) ;
- aucune donnée personnelle directe ; les contacts sont dans F-021.

## Tests obligatoires

- normalisation de domaine (domaine) ;
- unicité du domaine par workspace (intégration PostgreSQL) ;
- isolation workspace (intégration) ;
- pagination stable (intégration).

## Dépendances

- F-002, F-003 (workspace, rôles).
