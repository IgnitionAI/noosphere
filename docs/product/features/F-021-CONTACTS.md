# F-021 — Contacts, identités et emplois

## Résultat utilisateur

Suivre une personne malgré ses changements d’employeur : une identité
canonique, des coordonnées vérifiées ou non, et un historique d’emplois.

## Acteurs et permissions

| Acteur | Lecture | Mutation | Approbation |
|---|---|---|---|
| owner/admin | oui | oui | — |
| operator | oui | oui | — |
| reviewer | oui | non | — |
| viewer | oui | non | — |

## Périmètre

- identité canonique (prénom, nom, photo éventuelle) ;
- identités de contact : emails, URL LinkedIn, téléphone/WhatsApp, chacune avec
  statut de vérification (`unknown`, `verified`, `invalid`) et provenance ;
- emplois historisés (entreprise, intitulé, début, fin) : un emploi courant au
  plus ;
- préférence de canal et suppression (empreinte F-026 minimale) ;
- recherche paginée (nom, email, entreprise courante).

## Hors périmètre

- fusion de contacts (F-024) ;
- enrichissement et recherche d’email (F-025) ;
- signaux (F-027).

## Parcours principal

1. l’utilisateur crée un contact rattaché à une entreprise (emploi courant) ;
2. les coordonnées sont ajoutées avec leur provenance ;
3. un changement d’employeur clôture l’emploi courant et en ouvre un nouveau,
   sans créer de deuxième personne ;
4. une suppression marque l’identité comme inéligible de façon persistante.

## Règles métier et invariants

- un changement d’emploi ne crée jamais automatiquement une nouvelle personne ;
- chaque identité porte son statut de vérification ;
- le contact expose l’emploi courant et les emplois historiques ;
- les données inconnues (`unknown`) restent distinguées des données invalides
  (`invalid`) ;
- une identité supprimée ne peut pas redevenir éligible par réimport : la
  suppression persiste par empreinte normalisée (email, LinkedIn) ;
- un contact d’un autre workspace est indistinguable d’un contact absent.

## Critères d’acceptation

- Étant donné un contact avec un emploi courant, quand je déclare un nouvel
  employeur, alors l’ancien emploi est clôturé et la personne reste unique ;
- Étant donné un email `Jean.Dupont@Example.com`, quand il est stocké, alors
  l’empreinte normalisée est `jean.dupont@example.com` ;
- Étant donné un contact supprimé, quand un import recrée la même empreinte,
  alors l’identité reste inéligible ;
- Étant donné un email marqué `invalid`, quand je lis la fiche, alors il n’est
  jamais présenté comme inconnu (`unknown`).

## États et erreurs

- loading : skeleton de la liste et de la fiche ;
- empty : aucun contact — action principale « créer un contact » ou importer
  (F-022) ;
- validation (nom vide, email malformé, deux emplois courants) ;
- forbidden : reviewer/viewer en lecture seule, contrôles serveur inchangés ;
- conflit d’empreinte d’identité (409 avec le contact existant) ;
- isolation workspace (404).

## Contrats

**Routes UI** : `/w/[workspaceSlug]/prospects`, `/w/[workspaceSlug]/prospects/[contactId]`

**API** :

| Méthode | Route | Usage |
|---|---|---|
| GET | `/api/v1/contacts?search=&companyId=&cursor=&limit=` | liste paginée |
| POST | `/api/v1/contacts` | création manuelle (+ emploi courant optionnel) |
| GET | `/api/v1/contacts/:contactId` | fiche avec identités et emplois |
| POST | `/api/v1/contacts/:contactId/identities` | ajouter une coordonnée |
| POST | `/api/v1/contacts/:contactId/employments` | nouvel emploi (clôture le courant) |
| POST | `/api/v1/contacts/:contactId/actions/suppress` | suppression persistante |

**Événements sortants** : `ContactCreated`, `ContactEmploymentChanged`,
`SuppressionRegistered`.

## Données et confidentialité

- tables `contacts`, `contact_identities`, `contact_employments`,
  `contact_suppressions` ;
- données personnelles : nom, coordonnées, historique d’emploi ;
- empreintes normalisées conservées après suppression (base légale : respect
  d’une opposition).

## Tests obligatoires

- clôture d’emploi sans duplication de personne (application) ;
- normalisation d’empreintes (domaine) ;
- suppression persistante au réimport (intégration) ;
- unicité d’empreinte par workspace (intégration) ;
- isolation workspace (intégration).

## Dépendances

- F-020 (entreprises), F-026 (empreintes de suppression).
