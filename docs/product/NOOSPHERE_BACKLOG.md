# Noosphere — backlog Outbound + Content Inbound

Date : 2026-08-20
Baseline : `b8efbf8424ebc1c5c6f86f48a0a68d70d63a6652`
Architecture : [`NOOSPHERE_PRODUCT_ARCHITECTURE.md`](../architecture/NOOSPHERE_PRODUCT_ARCHITECTURE.md)

## Règles du backlog

- Chaque ticket est une tranche verticale démontrable : données, cas d'usage,
  API, UI, audit et tests lorsque ces couches sont nécessaires.
- Les tickets sont publiables dans l'ordre de dépendance indiqué.
- `P0` livre LinkedIn Content Inbound et le nouveau produit Noosphere.
- `P1` étend le moteur à X et à la vidéo verticale.
- `P2` branche YouTube Shorts, TikTok Shorts et l'optimisation cross-channel.
- Un canal n'est jamais déclaré livré avant son canary réel.
- Les issues Outbound existantes #15, #16 et #17 restent dans le backlog ; elles
  ne sont ni dupliquées ni masquées par le renommage.

## Vue d'ensemble

| ID | Priorité | Wave | Titre | Bloqué par |
|---|---|---|---|---|
| NOO-001 | P0 | 0 | Adopter l'identité Noosphere sans casser les URLs | — |
| NOO-002 | P0 | 0 | Afficher Outbound et Inbound dans le cockpit Aujourd'hui | NOO-001 |
| PUB-001 | P0 | 0 | Exposer les capacités sociales réelles de chaque compte | NOO-001 |
| INB-001 | P0 | 0 | Publier une stratégie éditoriale liée à l'offre et à l'ICP | NOO-001 |
| INB-002 | P0 | 1 | Capturer et rechercher des idées sourcées | INB-001 |
| INB-003 | P0 | 1 | Transformer une idée en brief éditorial prouvé | INB-002 |
| INB-004 | P0 | 1 | Générer, critiquer et versionner un contenu canonique | INB-003 |
| PUB-002 | P0 | 1 | Planifier une publication durable et idempotente | PUB-001, INB-004 |
| ENG-001 | P0 | 1 | Normaliser les interactions sociales | PUB-001 |
| ATT-001 | P0 | 1 | Attribuer contenu, engagement, conversation et call | ENG-001 |
| LI-001 | P0 | 1 | Qualifier les comptes LinkedIn Unipile pour la publication | PUB-001 |
| LI-002 | P0 | 1 | Produire un post LinkedIn non générique | INB-004, LI-001 |
| LI-003 | P0 | 1 | Publier et reprendre un post LinkedIn texte | PUB-002, LI-002 |
| LI-004 | P0 | 1 | Publier images, documents et carrousels LinkedIn | LI-003, MED-001 |
| LI-005 | P0 | 1 | Synchroniser posts et métriques LinkedIn | LI-003 |
| LI-006 | P0 | 2 | Centraliser commentaires et réponses LinkedIn | ENG-001, LI-005 |
| LI-007 | P0 | 2 | Convertir un engagement LinkedIn en signal CRM | ATT-001, LI-006 |
| LI-008 | P0 | 2 | Exécuter la cadence LinkedIn en autopilote borné | LI-003, LI-006 |
| LI-009 | P0 | 2 | Prouver le parcours LinkedIn par un canary réel | LI-007, LI-008 |
| MED-001 | P1 | 1 | Gérer une bibliothèque média et un brand kit | INB-001 |
| MED-002 | P1 | 3 | Dériver un contenu sans copier entre canaux | INB-004, MED-001 |
| MED-003 | P1 | 3 | Rendre une vidéo verticale 9:16 reproductible | MED-002 |
| X-001 | P1 | 3 | Connecter X et afficher scopes, coûts et capacités | PUB-001 |
| X-002 | P1 | 3 | Publier posts, threads et médias sur X | X-001, PUB-002, MED-001 |
| X-003 | P1 | 3 | Synchroniser mentions, réponses, métriques et attribution X | X-002, ENG-001, ATT-001 |
| YT-001 | P2 | 4 | Connecter une chaîne YouTube et uploader en privé | PUB-001, MED-003 |
| YT-002 | P2 | 4 | Publier un Short avec traitement et scheduling durables | YT-001, PUB-002 |
| YT-003 | P2 | 4 | Synchroniser commentaires, rétention et attribution YouTube | YT-002, ENG-001, ATT-001 |
| TT-001 | P2 | 4 | Connecter TikTok et livrer un upload brouillon conforme | PUB-001, MED-003 |
| TT-002 | P2 | 4 | Publier un Short TikTok avec suivi du statut | TT-001, PUB-002 |
| TT-003 | P2 | 4 | Synchroniser les métriques TikTok accessibles et l'attribution | TT-002, ATT-001 |
| CC-001 | P1 | 3 | Unifier le calendrier éditorial cross-channel | PUB-002, LI-003, X-002 |
| CC-002 | P2 | 5 | Piloter la performance du contenu jusqu'au revenu | ATT-001, LI-007, X-003, YT-003, TT-003 |
| CC-003 | P1 | 2 | Relier automatiquement signaux Inbound et moteur Outbound | LI-007 |
| OPS-001 | P0 | 2 | Réconcilier publications, retries et actions concurrentes | LI-003, PUB-002 |
| AI-160 | P2 | 5 | Évaluer continuellement la qualité éditoriale | LI-005, CC-002 |

## Wave 0 — identité et fondations

### NOO-001 — Adopter l'identité Noosphere sans casser les URLs

## What to build

Faire de Noosphere le nom produit visible dans le shell, les métadonnées, la
documentation et les notifications, tout en conservant les routes et variables
techniques historiques par compatibilité. Produire l'inventaire explicite des
éléments à migrer avant un éventuel renommage du dépôt GitHub.

## Acceptance criteria

- [ ] Le nom et le logo texte Noosphere sont cohérents sur login, onboarding,
  shell, emails système, erreurs et manifests.
- [ ] Les URLs `/w/:workspace/*` existantes continuent de fonctionner.
- [ ] Aucun nom de variable, table ou job n'est renommé sans migration et
  compatibilité documentée.
- [ ] Les tests de navigation et snapshots ne contiennent plus un mélange de
  marques visible par l'utilisateur.
- [ ] L'inventaire du renommage de dépôt couvre CI, compose, images, webhooks,
  domaines, liens GitHub et runbooks.

## Blocked by

None - can start immediately.

### NOO-002 — Afficher Outbound et Inbound dans le cockpit Aujourd'hui

## What to build

Étendre le cockpit opérationnel afin qu'il présente l'activité des deux moteurs
sans obliger l'utilisateur à ouvrir leurs consoles : campagnes, publications,
prochains rendez-vous, jobs en cours et exceptions actionnables.

## Acceptance criteria

- [ ] Les compteurs distinguent Outbound, Content Inbound et Conversations.
- [ ] Une publication planifiée ou bloquée expose sa prochaine action.
- [ ] Un workspace sans contenu voit une action unique vers la stratégie.
- [ ] Les erreurs d'un canal ne masquent pas l'activité des autres.
- [ ] La projection est workspace-scoped, paginée pour les exceptions et datée
  avec `asOf`.

## Blocked by

- NOO-001.

### PUB-001 — Exposer les capacités sociales réelles de chaque compte

## What to build

Étendre les comptes connectés avec un contrat `SocialAccountCapabilities` lu
auprès de l'adaptateur. L'UI de configuration affiche les opérations réellement
disponibles, les scopes, la santé, les quotas et la dernière vérification.

## Acceptance criteria

- [ ] Les capacités de publication, lecture, commentaire et métriques sont
  persistées avec provider, compte, source et date.
- [ ] Une capacité inconnue est désactivée, jamais considérée vraie par défaut.
- [ ] Un probe rejoué met à jour le même état sans dupliquer les alertes.
- [ ] Les tokens et identifiants secrets ne sont jamais renvoyés au navigateur.
- [ ] Un compte dégradé bloque seulement les jobs qui le ciblent.

## Blocked by

- NOO-001.

### INB-001 — Publier une stratégie éditoriale liée à l'offre et à l'ICP

## What to build

Créer une surface Inbound / Stratégie qui projette une offre publiée et un ICP
dans une stratégie éditoriale : audience, niveau de conscience, piliers, voix,
formats, cadence, CTA, sujets interdits et policy par canal. La publication
produit une version immuable.

## Acceptance criteria

- [ ] Une stratégie ne peut être publiée sans offre, audience/ICP, au moins un
  pilier, une voix et un objectif mesurable.
- [ ] Les claims autorisés et sujets interdits sont hérités avec leur version.
- [ ] Modifier le brouillon ne change aucune publication existante.
- [ ] L'UI compare le brouillon à la version active et explique les prérequis.
- [ ] Les mutations sont workspace-scoped, RBAC, idempotentes et auditées.

## Blocked by

- NOO-001.

## Wave 1 — studio et LinkedIn tracer bullet

### INB-002 — Capturer et rechercher des idées sourcées

## What to build

Fournir une inbox d'idées alimentée manuellement ou par un job de recherche
borné utilisant connaissances internes, actualités publiques, questions de
prospects et contenus déjà performants. Chaque idée conserve angle, audience,
source, fraîcheur et statut.

## Acceptance criteria

- [ ] Une idée manuelle peut être enregistrée en moins de deux interactions.
- [ ] Une idée issue de recherche cite au moins une source résoluble.
- [ ] Les doublons sémantiques sont regroupés sans perdre leurs sources.
- [ ] Les idées expirées ou déjà traitées sont distinguées.
- [ ] La recherche est durable, reprenable, budgétée et ne publie rien.

## Blocked by

- INB-001.

### INB-003 — Transformer une idée en brief éditorial prouvé

## What to build

Produire depuis une idée un brief structuré contenant audience, problème,
insight, angle, preuve, promesse, format, CTA, contre-arguments et risques. Le
brief reste éditable puis devient un snapshot à la génération.

## Acceptance criteria

- [ ] Chaque fait du brief référence une preuve autorisée ou le label opinion.
- [ ] Un brief sans angle distinctif ou sans rapport avec l'offre est rejeté.
- [ ] Le brief affiche les contenus récents trop proches.
- [ ] La demande est idempotente et conserve le modèle, prompt et sources.
- [ ] Une erreur IA laisse l'idée et les sources intactes et relançables.

## Blocked by

- INB-002.

### INB-004 — Générer, critiquer et versionner un contenu canonique

## What to build

Créer un pipeline `writer → evidence auditor → independent critic` qui produit
un asset canonique versionné. L'éditeur montre les preuves, les changements,
les motifs de rejet et permet une amélioration IA sans publication implicite.

## Acceptance criteria

- [ ] Le writer reçoit offre, ICP, voix, brief, historique récent et objectif.
- [ ] Le critic rejette hooks génériques, répétitions, faux chiffres, CTA hors
  sujet et phrases interchangeables.
- [ ] Toute réécriture crée une version et conserve la précédente.
- [ ] Le contenu publié est toujours relié au modèle, prompt, policy et preuves.
- [ ] Les sorties structurées invalides ne deviennent jamais `ready`.

## Blocked by

- INB-003.

### PUB-002 — Planifier une publication durable et idempotente

## What to build

Créer l'agrégat Publication, le calendrier, le job lease/retry et la policy de
dernière seconde. Une publication peut être planifiée, déplacée, annulée ou
publiée immédiatement sans double envoi.

## Acceptance criteria

- [ ] Une publication capture asset, stratégie, compte et policy immuables.
- [ ] Deux demandes avec la même clé logique produisent une publication.
- [ ] Déplacer ou annuler conserve l'historique et invalide le job précédent.
- [ ] Le gate final revérifie compte, capacité, quota, fenêtre, source et
  contenu dupliqué sous verrou.
- [ ] Un résultat provider inconnu n'est jamais automatiquement rejoué.

## Blocked by

- PUB-001.
- INB-004.

### ENG-001 — Normaliser les interactions sociales

## What to build

Créer une ingestion commune des commentaires, réponses, réactions et mentions.
Chaque événement conserve la référence provider, l'auteur résolu si possible,
la provenance et une clé d'idempotence.

## Acceptance criteria

- [ ] Un webhook ou polling relivré produit une seule interaction.
- [ ] Les interactions envoyées par le compte sont distinguées des entrantes.
- [ ] L'identité incertaine n'est pas fusionnée automatiquement avec un contact.
- [ ] Suppression provider et modification restent traçables sans réapparition.
- [ ] L'UI distingue inconnu, prospect, client et membre du workspace.

## Blocked by

- PUB-001.

### ATT-001 — Attribuer contenu, engagement, conversation et call

## What to build

Créer des touches d'attribution déterministes reliant publication,
interaction, contact, conversation, campagne, rendez-vous et opportunité. La
vue explique le modèle retenu et n'affirme pas une causalité non prouvée.

## Acceptance criteria

- [ ] Chaque touch conserve source, date, identité et règle d'attribution.
- [ ] Les UTM et références provider sont consommées sans duplication.
- [ ] Les modèles first-touch et last-touch sont reproductibles en SQL.
- [ ] Une identité non résolue reste visible sans être attribuée à tort.
- [ ] L'utilisateur peut remonter du call au contenu source.

## Blocked by

- ENG-001.

### LI-001 — Qualifier les comptes LinkedIn Unipile pour la publication

## What to build

Ajouter l'adaptateur de capacité LinkedIn sur les comptes Unipile existants et
un écran de vérification en lecture seule : publier, lister ses posts, lire et
répondre aux commentaires, lire les réactions et publier pour une page.

## Acceptance criteria

- [ ] Le probe ne réalise aucune publication.
- [ ] Chaque compte expose personnel/page, permissions et capacités observées.
- [ ] Une session LinkedIn en checkpoint ou expirée produit une action de
  reconnexion explicite.
- [ ] Les limites v1/v2 Unipile restent dans l'adaptateur.
- [ ] Un test contractuel couvre les payloads réels expurgés.

## Blocked by

- PUB-001.

### LI-002 — Produire un post LinkedIn non générique

## What to build

Ajouter la variante LinkedIn du pipeline éditorial avec hooks, structure,
longueur, lisibilité, mentions, lien externe et CTA conformes au compte. Une
preview fidèle permet de comparer les versions et preuves.

## Acceptance criteria

- [ ] Le texte respecte les contraintes LinkedIn lues par l'adaptateur.
- [ ] Le critic compare les derniers posts et rejette les formulations répétées.
- [ ] Les mentions sont résolues avant que la variante devienne `ready`.
- [ ] Une amélioration IA ne planifie et ne publie rien.
- [ ] Les fixtures de qualité contiennent des cas français longs et réalistes.

## Blocked by

- INB-004.
- LI-001.

### LI-003 — Publier et reprendre un post LinkedIn texte

## What to build

Livrer le premier chemin réel complet : sélectionner un compte sain, planifier
un post texte, le publier via Unipile, conserver l'identifiant provider, puis
réconcilier son état après redémarrage.

## Acceptance criteria

- [ ] Un succès provider produit exactement une publication `published`.
- [ ] Une réponse 422/429/5xx est classée avec retry seulement si sûre.
- [ ] Un crash après acceptation provider ne crée pas un second post.
- [ ] Le post est visible dans le calendrier avec lien LinkedIn.
- [ ] Le test d'intégration utilise un faux provider ; le canary réel reste LI-009.

## Blocked by

- PUB-002.
- LI-002.

### LI-004 — Publier images, documents et carrousels LinkedIn

## What to build

Étendre la publication LinkedIn aux images multiples, document/carrousel et
vidéo supportée en validant type, taille, résolution, droits et preview avant
upload.

## Acceptance criteria

- [ ] Les limites provider sont lues et vérifiées avant création du job.
- [ ] Les pièces proviennent exclusivement de la bibliothèque média du workspace.
- [ ] Un upload partiel ne crée pas de publication fantôme.
- [ ] Le hash du rendu relie le fichier MinIO à la publication provider.
- [ ] Les erreurs de média sont actionnables et n'altèrent pas la version texte.

## Blocked by

- LI-003.
- MED-001.

### LI-005 — Synchroniser posts et métriques LinkedIn

## What to build

Rattraper les posts du compte, rapprocher ceux publiés hors Noosphere et
collecter les métriques disponibles sous forme de snapshots datés.

## Acceptance criteria

- [ ] Un post publié hors produit est marqué `external`, sans asset inventé.
- [ ] Les métriques cumulatives ne sont jamais additionnées comme des deltas.
- [ ] La suppression ou indisponibilité du post est réconciliée.
- [ ] Le curseur de sync survit aux redémarrages.
- [ ] La fraîcheur et le périmètre des métriques sont visibles.

## Blocked by

- LI-003.

## Wave 2 — engagement, conversion et autonomie LinkedIn

### LI-006 — Centraliser commentaires et réponses LinkedIn

## What to build

Afficher les commentaires LinkedIn dans une inbox d'engagement, avec contexte
du post, auteur, intention, suggestion IA et réponse manuelle ou Setter. Une
action humaine annule toute réponse IA concurrente.

## Acceptance criteria

- [ ] Les commentaires et réponses paginés sont synchronisés sans doublon.
- [ ] Le brouillon IA cite le post, l'échange et les claims autorisés.
- [ ] Le bouton améliorer ne publie jamais.
- [ ] Une réponse manuelle ou automatique utilise une clé idempotente.
- [ ] Opt-out, juridique, sécurité, prix et conflit deviennent des exceptions.

## Blocked by

- ENG-001.
- LI-005.

### LI-007 — Convertir un engagement LinkedIn en signal CRM

## What to build

Transformer un commentaire, une réaction ou une mention en signal d'intention
daté. Résoudre le profil avec confiance, rattacher ou créer un contact sans
fusion faible, puis expliquer si ce contact correspond à un ICP.

## Acceptance criteria

- [ ] Commentaire, réaction et mention ont des poids configurables distincts.
- [ ] Une réaction seule ne déclenche ni invitation ni DM.
- [ ] Le contact conserve l'URL/source et la date de l'interaction.
- [ ] Les suppressions et exclusions ICP bloquent toute activation Outbound.
- [ ] Le score explique contenu, interaction et critères ICP satisfaits.

## Blocked by

- ATT-001.
- LI-006.

### LI-008 — Exécuter la cadence LinkedIn en autopilote borné

## What to build

Exécuter chaque jour le radar d'idées, les briefs, la rédaction et le calendrier
selon la stratégie active. Le chemin normal ne demande pas d'approbation, mais
la policy crée des exceptions ciblées et respecte un budget quotidien.

## Acceptance criteria

- [ ] Activer l'autopilote exige stratégie publiée, compte sain et cadence.
- [ ] Le scheduler évite les collisions et contenus trop proches.
- [ ] Le budget limite le travail quotidien sans perdre les idées restantes.
- [ ] Une exception suspend seulement la publication concernée.
- [ ] Pause/reprise est immédiate, idempotente et auditée.

## Blocked by

- LI-003.
- LI-006.

### LI-009 — Prouver le parcours LinkedIn par un canary réel

## What to build

Exécuter et documenter PTC-IN-LI-001 sur un compte et une publication canary
explicitement autorisés : post réel, commentaire réel, réponse, sync après
redémarrage, signal CRM et attribution.

## Acceptance criteria

- [ ] Le destinataire, le compte et le texte canary sont explicitement autorisés.
- [ ] Le post n'est créé qu'une fois et son URL est enregistrée.
- [ ] Un commentaire réel est synchronisé puis répondu une seule fois.
- [ ] Le redémarrage ne duplique ni interaction, ni signal, ni réponse.
- [ ] Le rapport distingue les preuves réelles des contrôles locaux.

## Blocked by

- LI-007.
- LI-008.

### CC-003 — Relier automatiquement signaux Inbound et moteur Outbound

## What to build

Permettre à une campagne Outbound de consommer les signaux issus du contenu
comme critère de priorité. La transition reste gouvernée par l'ICP, les
suppressions et la policy de campagne.

## Acceptance criteria

- [ ] La campagne peut filtrer et prioriser par type de contenu/interaction.
- [ ] Chaque décision cite l'interaction source.
- [ ] Aucun DM n'est déclenché uniquement par une réaction.
- [ ] Une réponse sociale ouverte empêche un message direct contradictoire.
- [ ] Les analytics distinguent organique, outbound et parcours combiné.

## Blocked by

- LI-007.

### OPS-001 — Réconcilier publications, retries et actions concurrentes

## What to build

Étendre la console opérateur et les workers aux publications : lease expiré,
résultat provider inconnu, post absent, interaction concurrente et relance
manuelle sûre.

## Acceptance criteria

- [ ] Les jobs de publication sont visibles par correlation ID.
- [ ] Un état provider inconnu exige réconciliation avant retry.
- [ ] Deux workers ne publient jamais le même snapshot.
- [ ] Une modification humaine du post suspend l'action IA concurrente.
- [ ] Les payloads opérateur sont expurgés de tokens et PII inutile.

## Blocked by

- LI-003.
- PUB-002.

## Wave 3 — médias partagés et X

### MED-001 — Gérer une bibliothèque média et un brand kit

## What to build

Créer une bibliothèque workspace pour logos, couleurs, polices, images,
documents, vidéos, droits et templates. Les fichiers sont stockés dans MinIO et
exposés par liens signés courts.

## Acceptance criteria

- [ ] Type, taille, hash, dimensions, durée, licence et source sont validés.
- [ ] Un fichier identique n'est stocké qu'une fois par workspace.
- [ ] Aucun bucket ou chemin interne n'est exposé au modèle.
- [ ] Le retrait d'un asset bloque les futures publications sans modifier les
  snapshots déjà publiés.
- [ ] Upload, retrait et usage sont audités.

## Blocked by

- INB-001.

### MED-002 — Dériver un contenu sans copier entre canaux

## What to build

Créer un cas d'usage de repurposing qui transforme un asset canonique en
variantes LinkedIn, X et short vidéo, chacune avec son angle, format et CTA. La
relation de dérivation reste visible.

## Acceptance criteria

- [ ] Chaque variante conserve l'asset et les preuves sources.
- [ ] Le critic rejette la copie littérale entre canaux.
- [ ] Les contraintes du canal sont validées avant `ready`.
- [ ] Corriger une variante ne modifie pas les autres.
- [ ] Les coûts IA sont attribués à la dérivation concernée.

## Blocked by

- INB-004.
- MED-001.

### MED-003 — Rendre une vidéo verticale 9:16 reproductible

## What to build

Produire depuis un brief un script, un storyboard, une narration, des sous-
titres et un rendu MP4 9:16 via un port `MediaRenderer`. Le manifest de rendu
permet de reproduire exactement le fichier.

## Acceptance criteria

- [ ] Le rendu respecte durée, codec, résolution, audio et safe zones cibles.
- [ ] Script, voix, sous-titres, assets, renderer et versions sont manifestés.
- [ ] Le job est repris après crash sans perdre les étapes terminées.
- [ ] Les médias sans droits ou au contenu interdit sont bloqués.
- [ ] Une preview web et les sous-titres éditables précèdent toute publication.

## Blocked by

- MED-002.

### X-001 — Connecter X et afficher scopes, coûts et capacités

## What to build

Ajouter OAuth utilisateur X, chiffrer les tokens et sonder les capacités
réelles du plan : posts, médias, lecture des mentions, métriques publiques et
owner. Afficher coûts et limites sans estimation silencieuse.

## Acceptance criteria

- [ ] La connexion est reprenable et révocable.
- [ ] Les scopes et capacités sont lus puis affichés.
- [ ] Le coût/quota absent est marqué inconnu et bloque l'autopilote.
- [ ] La rotation ou révocation de token cible uniquement ce compte.
- [ ] Un test de lecture réel ne publie aucun post.

## Blocked by

- PUB-001.

### X-002 — Publier posts, threads et médias sur X

## What to build

Générer puis publier un post, un thread ordonné ou un média X via la publication
durable commune. Chaque élément d'un thread est idempotent et reprend au bon
point après erreur.

## Acceptance criteria

- [ ] La variante respecte longueur, médias et ordre du thread.
- [ ] Un thread partiel est réconcilié avant reprise.
- [ ] Les identifiants provider relient tous les éléments au même asset.
- [ ] Les quotas et coûts sont contrôlés avant chaque appel.
- [ ] Un canary réel borné prouve publication et suppression/réconciliation.

## Blocked by

- X-001.
- PUB-002.
- MED-001.

### X-003 — Synchroniser mentions, réponses, métriques et attribution X

## What to build

Ingestions des mentions/réponses et snapshots de métriques X, réponse assistée,
signal CRM et attribution au contenu puis au rendez-vous.

## Acceptance criteria

- [ ] Les métriques publiques et owner sont distinguées avec leur fenêtre.
- [ ] Les mentions et réponses sont dédupliquées et visibles dans l'inbox.
- [ ] Une réponse humaine suspend le Setter concurrent.
- [ ] Les interactions créent des signaux avec provenance et confiance.
- [ ] Le canary couvre post, reply, sync, signal et reprise après redémarrage.

## Blocked by

- X-002.
- ENG-001.
- ATT-001.

### CC-001 — Unifier le calendrier éditorial cross-channel

## What to build

Afficher dans un calendrier unique toutes les variantes, comptes, canaux,
états, dépendances et conflits. Déplacer une publication respecte sa policy et
ne déplace pas implicitement ses variantes sœurs.

## Acceptance criteria

- [ ] Filtres canal, compte, stratégie, campagne et statut dans l'URL.
- [ ] Fuseau workspace et heure provider sont explicites.
- [ ] Conflits de cadence, duplication et compte dégradé sont visibles.
- [ ] Drag/drop appelle une mutation idempotente et auditable.
- [ ] Mobile propose une liste chronologique utilisable.

## Blocked by

- PUB-002.
- LI-003.
- X-002.

## Wave 4 — YouTube Shorts et TikTok Shorts

### YT-001 — Connecter une chaîne YouTube et uploader en privé

## What to build

Ajouter OAuth YouTube, capacités de chaîne, quota et un upload resumable privé
ou non répertorié. Le test valide le format sans publier publiquement.

## Acceptance criteria

- [ ] Les scopes YouTube Data et Analytics sont minimaux et visibles.
- [ ] L'upload reprend après interruption et conserve le même video ID.
- [ ] Le statut de traitement est suivi jusqu'à succès ou échec.
- [ ] Le quota réel est enregistré par appel.
- [ ] Le canary privé peut être nettoyé sans supprimer un autre contenu.

## Blocked by

- PUB-001.
- MED-003.

### YT-002 — Publier un Short avec traitement et scheduling durables

## What to build

Produire titre, description, tags, miniature, audience et confidentialité,
uploader le rendu puis publier selon le calendrier. L'état YouTube processing
fait partie de la machine d'état.

## Acceptance criteria

- [ ] Un rendu non conforme n'est pas uploadé.
- [ ] Metadata et fichier sont un snapshot immuable.
- [ ] Un succès d'upload sans succès de processing reste `processing`.
- [ ] Le polling respecte quota, backoff et reprise après redémarrage.
- [ ] Un canary public borné prouve une seule publication.

## Blocked by

- YT-001.
- PUB-002.

### YT-003 — Synchroniser commentaires, rétention et attribution YouTube

## What to build

Collecter commentaires et Analytics owner : vues, engaged views, durée moyenne,
rétention, likes, partages et abonnés gagnés. Relier interactions et appels.

## Acceptance criteria

- [ ] Les métriques et dimensions conservent leur définition et période.
- [ ] Les commentaires sont visibles et répondables selon capacité.
- [ ] Les seuils de confidentialité API sont représentés comme données absentes.
- [ ] Les snapshots sont recalculables sans double comptage.
- [ ] Un canary couvre commentaire réel, sync et attribution.

## Blocked by

- YT-002.
- ENG-001.
- ATT-001.

### TT-001 — Connecter TikTok et livrer un upload brouillon conforme

## What to build

Passer le parcours OAuth et d'audit TikTok, sonder les capacités du compte et
uploader un rendu comme brouillon via Content Posting API. L'accès manquant est
un état produit explicite, pas une simulation.

## Acceptance criteria

- [ ] Scopes, audit status et limites sont affichés.
- [ ] Le mode draft fonctionne sans Direct Post.
- [ ] FILE_UPLOAD et PULL_FROM_URL sont encapsulés derrière le même port.
- [ ] L'upload est idempotent et son statut durable.
- [ ] Aucun contenu n'est rendu public pendant le canary brouillon.

## Blocked by

- PUB-001.
- MED-003.

### TT-002 — Publier un Short TikTok avec suivi du statut

## What to build

Activer Direct Post lorsqu'il est approuvé, avec caption, privacy, interaction
settings et suivi du processing provider. Sinon l'UI conserve le workflow
brouillon sans fausse capacité.

## Acceptance criteria

- [ ] Direct Post n'est visible que si le compte et l'app sont autorisés.
- [ ] Les paramètres de visibilité et interactions sont confirmés par la policy.
- [ ] Le statut provider est réconcilié après timeout et redémarrage.
- [ ] Un résultat inconnu n'est jamais renvoyé automatiquement.
- [ ] Un canary réel crée une publication unique et traçable.

## Blocked by

- TT-001.
- PUB-002.

### TT-003 — Synchroniser les métriques TikTok accessibles et l'attribution

## What to build

Collecter uniquement les métriques et interactions réellement accessibles au
compte/app, conserver leur fraîcheur, et attribuer les conversions observables.

## Acceptance criteria

- [ ] La matrice de capacité distingue indisponible, refusé et erreur temporaire.
- [ ] Les métriques absentes ne valent jamais zéro.
- [ ] Les snapshots sont idempotents et datés.
- [ ] Les liens/UTM et identités résolubles créent des touches d'attribution.
- [ ] Le rapport de canary décrit précisément ce que l'API ne permet pas.

## Blocked by

- TT-002.
- ATT-001.

## Wave 5 — pilotage et apprentissage

### CC-002 — Piloter la performance du contenu jusqu'au revenu

## What to build

Créer un dashboard cross-channel qui distingue production, distribution,
engagement, conversations, rendez-vous et revenu. Les dénominateurs, fenêtres
et coûts sont explicites.

## Acceptance criteria

- [ ] Filtres canal, compte, pilier, format, ICP, période et offre.
- [ ] Impressions, vues, engagement, conversations et calls restent distincts.
- [ ] Les métriques incompatibles entre plateformes ne sont pas additionnées.
- [ ] Coût IA/provider par asset, publication, conversation et call.
- [ ] Export exact de la vue filtrée, workspace-scoped et audité.

## Blocked by

- ATT-001.
- LI-007.
- X-003.
- YT-003.
- TT-003.

### AI-160 — Évaluer continuellement la qualité éditoriale

## What to build

Étendre l'évaluation IA avec un dataset éditorial : fidélité aux preuves,
spécificité, voix, répétition, qualité du hook, clarté du CTA, conformité canal,
coût et latence. Le shadow mode ne publie rien.

## Acceptance criteria

- [ ] Les cas n'utilisent aucune PII réelle inutile.
- [ ] Les règles déterministes évaluent claims, longueurs et duplication.
- [ ] Le modèle évalué ne se note pas lui-même.
- [ ] Le shadow mode ne crée ni Publication ni appel provider.
- [ ] Une promotion de prompt est versionnée, auditée et sans rétroactivité.

## Blocked by

- LI-005.
- CC-002.

## Ordre de création recommandé dans GitHub

1. NOO-001, PUB-001, INB-001.
2. NOO-002, INB-002, LI-001, MED-001.
3. INB-003, INB-004, ENG-001.
4. PUB-002, ATT-001, LI-002.
5. LI-003, LI-005, OPS-001.
6. LI-004, LI-006, LI-007.
7. LI-008, CC-003, LI-009.
8. MED-002, MED-003, X-001, X-002, X-003, CC-001.
9. YT-001, YT-002, YT-003, TT-001, TT-002, TT-003.
10. CC-002, AI-160.

Le graphe est volontairement acyclique. LI-009 est le release gate de
LinkedIn ; X-003, YT-003 et TT-003 portent leurs canaries de canal.
