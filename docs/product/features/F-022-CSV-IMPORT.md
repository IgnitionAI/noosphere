# F-022 — Import manuel et CSV

## Résultat utilisateur

Alimenter le CRM avec une liste de prospects existante, en prévisualisant,
corrigeant et rejouant l’import sans jamais créer de doublon.

## Acteurs et permissions

| Acteur | Lecture | Mutation | Approbation |
|---|---|---|---|
| owner/admin | oui | oui | applique l’import |
| operator | oui | oui | applique l’import |
| reviewer | oui | non | non |
| viewer | non (données personnelles en masse) | non | non |

## Périmètre

- création manuelle unitaire (déjà couverte par F-020/F-021) ;
- upload CSV, détection des colonnes et mapping vers les champs CRM
  (entreprise, contact, identités, emploi) ;
- prévisualisation obligatoire : lignes valides, rejetées, doublons détectés ;
- application en job asynchrone avec rapport par ligne ;
- relance du même fichier sans doublon (idempotence par empreinte de fichier
  et par ligne) ;
- provenance `csv` conservée sur chaque objet créé.

## Hors périmètre

- connecteurs de sourcing (F-023) ;
- enrichissement pendant l’import (F-025) ;
- fusion des doublons détectés (F-024) : l’import les signale, ne les
  résout pas ;
- fichiers autres que CSV (XLSX, API) ;
- import sans prévisualisation.

## Parcours principal

1. l’utilisateur dépose un CSV et mappe les colonnes ;
2. le système prévisualise : lignes acceptées, rejetées avec motif, conflits
   avec l’existant (domaine, empreinte d’identité, suppression active) ;
3. l’utilisateur confirme : un job applique l’import ;
4. le rapport final liste créations, rejets et conflits par ligne ;
5. relancer le même fichier ne crée aucun doublon.

## Règles métier et invariants

- aucun import n’est appliqué avant prévisualisation explicite ;
- l’application est idempotente : même fichier + même mapping = aucun effet
  supplémentaire ;
- les erreurs sont rapportées par ligne sans annuler les lignes valides ;
- une ligne dont l’empreinte correspond à une suppression active est rejetée,
  jamais importée ;
- un doublon certain (domaine ou empreinte existante) est rattaché ou rejeté
  selon le mapping, jamais dupliqué ;
- la provenance `csv` est conservée sur entreprise, contact et identités ;
- le fichier importé appartient au workspace et n’est jamais visible ailleurs.

## Critères d’acceptation

- Étant donné un CSV de 100 lignes dont 5 invalides, quand je prévisualise,
  alors les 5 motifs de rejet sont listés ligne par ligne ;
- Étant donné une prévisualisation, quand je n’ai pas confirmé, alors aucune
  ligne n’est en base ;
- Étant donné un import appliqué, quand je redépose le même fichier, alors le
  rapport indique 100 % de lignes déjà importées et zéro création ;
- Étant donné une ligne valide au milieu de lignes invalides, quand
  l’import s’applique, alors la ligne valide est créée ;
- Étant donné un email supprimé en F-026, quand une ligne le contient, alors
  elle est rejetée avec le motif « suppression active » ;
- Étant donné un viewer, quand il appelle l’endpoint d’application, alors la
  réponse est 403.

## États et erreurs

- loading : progression du job d’import visible et reprenable après
  navigation ;
- empty : aucun import réalisé — action principale « importer un CSV » ;
- validation : colonne obligatoire non mappée, ligne malformée ;
- forbidden : reviewer/viewer sans action d’import ;
- provider indisponible : non applicable ;
- conflit métier : domaine ou empreinte existante, suppression active ;
- reprise : un import interrompu reprend sans réappliquer les lignes déjà
  traitées.

## Contrats

**Routes UI** : `/w/[workspaceSlug]/prospects/import` (upload, mapping,
prévisualisation, rapport).

**API** :

| Méthode | Route | Usage |
|---|---|---|
| POST | `/api/v1/imports` | upload CSV + mapping proposé |
| GET | `/api/v1/imports/:id/preview` | lignes acceptées/rejetées/conflits |
| POST | `/api/v1/imports/:id/actions/apply` | appliquer (job asynchrone, idempotent) |
| GET | `/api/v1/imports/:id` | statut et rapport par ligne |

**Événements sortants** : `ImportApplied` (compteurs de créations, rejets,
conflits).

**Ports externes** : aucun.

## Données et confidentialité

- agrégats : `ImportBatch`, `ImportRow` (statut, motif, cible créée) ;
- données personnelles : le CSV contient noms, coordonnées et historiques
  professionnels en masse — volume à risque ;
- le fichier brut est conservé chiffré, avec expiration configurable, puis
  supprimé ; seuls le rapport et les objets créés persistent ;
- les empreintes normalisées servent au contrôle suppression sans exposer le
  contenu du fichier ;
- audit : upload, application et rapport tracés (acteur, workspace, date,
  compteurs).

## Analytics

- événement `import_applied` ;
- dimensions : workspace, nombre de lignes, taux de rejet ;
- métrique de succès : part des lignes valides effectivement importées.

## Tests obligatoires

- domaine : validation de ligne, normalisation des empreintes ;
- application : mapping, prévisualisation sans effet, application idempotente ;
- intégration PostgreSQL : relance du même fichier sans doublon, rejet sur
  suppression active ;
- isolation workspace : un fichier et ses lignes invisibles ailleurs ;
- permission : application refusée à reviewer/viewer par appel direct API ;
- E2E : upload → mapping → prévisualisation → application → rapport →
  relance sans doublon.

## Dépendances

- F-020, F-021 (agrégats cibles) : fondations livrées ;
- F-024 : les conflits détectés alimentent les candidats de fusion ;
- F-026 : contrôle des suppressions à l’import (socle livré : 409 au
  ré-import) ;
- F-003 : job asynchrone (disponible) et audit log (à livrer).

## Questions résolues avant développement

- l’import est toujours asynchrone, même pour un petit fichier : un seul
  chemin de code ;
- les doublons certains sont signalés dans la prévisualisation ; leur
  résolution relève de F-024, jamais d’une fusion automatique à l’import ;
- le viewer n’a pas accès aux imports (données personnelles en masse).
