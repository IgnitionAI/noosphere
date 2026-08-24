# F-010 — Offres et versions publiées

## Résultat utilisateur

Formaliser ce qui est vendu — proposition de valeur, claims prouvés,
objections, prix communicables — puis publier une version immuable utilisable
par les campagnes.

## Acteurs et permissions

| Acteur | Lecture | Mutation | Approbation |
|---|---|---|---|
| owner | oui | oui | publie |
| admin | oui | oui | publie |
| operator | oui | oui (brouillon) | non |
| reviewer | oui | non | non |
| viewer | oui | non | non |

## Périmètre

- offre brouillon : catégorie, proposition de valeur, cible, prix
  communicables, contraintes ;
- claims avec preuve et statut de validation (`hypothesis`, `sourced`,
  `validated`, `invalidated`) ;
- objections et réponses associées ;
- publication d’une `OfferVersion` immuable et numérotée par offre ;
- liste et détail des versions publiées.

## Hors périmètre

- gestion des sources de connaissance (F-050) : la preuve est une référence
  libre (URL, document, constat) et non un document indexé ;
- tarification dynamique, devis, contrats et facturation ;
- génération de claims par modèle ;
- modification ou dépublication d’une version publiée.

## Parcours principal

1. créer un brouillon d’offre (manuellement ou depuis une proposition F-009) ;
2. renseigner proposition de valeur, claims, preuves et objections ;
3. marquer le statut de validation de chaque claim ;
4. prévisualiser la version à publier ;
5. publier : une `OfferVersion` immuable est créée et
   `OfferVersionPublished` est émis.

## Règles métier et invariants

- une offre appartient exactement à un workspace ;
- une version publiée est immuable et numérotée séquentiellement par offre ;
- une offre sans proposition de valeur ou sans claim ne peut pas être
  publiée ;
- un claim `invalidated` bloque la publication ; un claim `hypothesis` est
  signalé mais ne bloque pas ;
- modifier un brouillon ne change jamais les versions déjà publiées ni les
  campagnes qui les référencent ;
- la publication est idempotente : rejouer la même demande ne crée pas une
  seconde version ;
- chaque publication conserve auteur, date et workspace.

## Critères d’acceptation

- Étant donné un brouillon incomplet, quand l’utilisateur publie, alors la
  publication est refusée avec la liste des champs manquants ;
- Étant donné un brouillon complet, quand un admin publie, alors une version
  immuable numérotée est créée et visible dans la liste des versions ;
- Étant donné une version publiée, quand le brouillon est modifié, alors la
  version publiée reste inchangée ;
- Étant donné un operator, quand il tente de publier, alors l’action est
  refusée côté serveur même si le bouton est masqué ;
- Étant donné deux workspaces avec des offres de même nom, quand l’un publie,
  alors l’autre ne voit ni l’offre ni la version ;
- Étant donné un réseau instable, quand la requête de publication est
  rejouée, alors une seule version existe.

## États et erreurs

- loading : skeleton de la fiche offre et de la liste des versions ;
- empty : aucune offre — action principale « créer une offre » ;
- validation : champs obligatoires manquants listés avant publication ;
- forbidden : viewer/reviewer en lecture seule, operator sans bouton publier ;
- provider indisponible : non applicable (aucun fournisseur externe) ;
- conflit métier : publication concurrente du même brouillon ;
- reprise : un brouillon sauvegardé se rouvre en l’état après navigation.

## Contrats

**Routes UI** : `/w/[workspaceSlug]/offers`, détail offre et écran de
publication (prototype [`offers.html`](../../../prototype/offers.html)).

**Use cases** : `CreateOffer`, `UpdateOfferDraft`, `UpsertClaim`,
`PublishOfferVersion`, `ListOfferVersions`.

**API** :

| Méthode | Route | Usage |
|---|---|---|
| GET | `/api/v1/offers` | lister les offres du workspace |
| POST | `/api/v1/offers` | créer un brouillon |
| GET | `/api/v1/offers/:id` | lire brouillon et versions |
| PATCH | `/api/v1/offers/:id` | modifier le brouillon |
| POST | `/api/v1/offers/:id/actions/publish` | publier une version immuable |
| GET | `/api/v1/offers/:id/versions` | lister les versions publiées |

**Événements sortants** : `OfferVersionPublished`.

**Ports externes** : aucun.

## Données et confidentialité

- agrégats : `Offer`, `OfferVersion`, `Claim` ;
- données personnelles : auteur de publication (`published_by`) uniquement ;
- rétention : les versions publiées sont conservées tant qu’une campagne les
  référence ;
- audit : création, modification de brouillon et publication tracées.

## Analytics

- événement `offer_version_published` ;
- dimensions : workspace, offre, numéro de version ;
- métrique de succès : délai entre création du brouillon et première
  publication.

## Tests obligatoires

- domaine : transitions brouillon → publié, validation des claims ;
- intégration PostgreSQL : unicité (offre, numéro de version) par workspace ;
- isolation workspace : mêmes noms d’offre dans deux workspaces ;
- permission : appel direct API de publication par un operator ;
- idempotence : publication rejouée sans doublon ;
- E2E : création → claims → publication → consultation de la version.

## Dépendances

- F-002 (workspaces et rôles) : disponible ;
- F-003 (audit, outbox) : partiel — la publication écrit l’événement en
  outbox, mais aucun dispatcher ne le publie encore ;
- F-009 : peut pré-remplir un brouillon depuis une proposition, facultatif.

## Questions résolues avant développement

- la dépublication est exclue : une version erronée est remplacée par une
  nouvelle version ;
- le périmètre « preuve » reste une référence libre jusqu’à F-050 ;
- une offre peut avoir plusieurs versions, une campagne n’en référence
  qu’une.
