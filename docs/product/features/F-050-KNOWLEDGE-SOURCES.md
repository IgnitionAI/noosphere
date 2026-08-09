# F-050 — Sources de connaissance

## Résultat utilisateur

Centraliser les arguments que l’IA est autorisée à utiliser — documents
produit, claims validés, preuves, cas clients, objections — chacun avec sa
source, sa date de fraîcheur et son statut, pour que les messages générés ne
cite que du vérifié.

## Acteurs et permissions

| Acteur | Lecture | Mutation | Approbation |
|---|---|---|---|
| owner/admin | oui | ajoute/retire une source, valide un claim | valide un claim |
| operator | oui | propose une source ou un claim | non |
| reviewer | oui | non | non |
| viewer | oui (contenus validés uniquement) | non | non |

## État d’implémentation

Non commencé en tant que feature. Briques réutilisables vérifiées dans le
code : `research_documents` et `research_document_chunks` (documents de
recherche F-009 déjà découpés), `offer_claims` (claims d’offre avec preuves,
F-010), `market_evidence` ; `KnowledgeRetriever` est un port documenté
(décision d’architecture : PostgreSQL d’abord, pgvector/ParadeDB seulement
après benchmark — confirmée par le user : PostgreSQL suffit pour la V1) mais
**non implémenté**. Aujourd’hui, le Setter (F-042) et le générateur de
contenu ne consomment que les stratégies/politiques et instructions — aucun
accès à une base de preuves. Restent à livrer : le modèle de sources de
connaissance, la validation des claims adossée à des sources, la fraîcheur,
le port `KnowledgeRetriever` en PostgreSQL FTS, et son branchement au
Setter/générateur.

## Périmètre

- sources typées : document produit, preuve (étude, donnée chiffrée), cas
  client, objection-réponse ; chacune avec titre, contenu ou document,
  auteur, date de publication et **date de fraîcheur** (expiration) ;
- claims autorisés : un claim n’est utilisable par l’IA que s’il est validé
  et cite au moins une source non expirée ; lien avec les claims d’offre
  (F-010) quand le claim concerne une offre ;
- cycle de vie : `draft` → `validated` → (`expired` automatique à la date de
  fraîcheur | `withdrawn` manuel avec motif) ;
- retrait ou expiration : la source cesse immédiatement d’alimenter les
  générations futures, **sans altérer** les campagnes déjà exécutées
  (snapshots immuables F-031) ni les messages déjà envoyés ;
- consultation : liste filtrable par type/statut/fraîcheur, fiche source
  avec claims associés ;
- indexation derrière le port `KnowledgeRetriever` — implémentation V1 en
  PostgreSQL FTS (décision user), interface prête pour pgvector/ParadeDB
  ultérieur ;
- consommation : le Setter (F-042) et le générateur de campagne ne citent
  que des claims validés et non expirés, via le port.

## Hors périmètre

- RAG vectoriel (pgvector/ParadeDB) : reporté après benchmark (décision
  architecture + user) ;
- import/crawl automatique de sources externes (les sources sont saisies ou
  déposées, pas aspirées) ;
- génération automatique de claims par l’IA (l’IA consomme, elle ne certifie
  pas) ;
- gestion de versions de documents (une nouvelle version = une nouvelle
  source qui remplace l’ancienne, expirée).

## Parcours principal

1. l’operator dépose une source (type, contenu, date de fraîcheur) — statut
   `draft` ;
2. un owner/admin la valide ; les claims qui la citent deviennent
   utilisables ;
3. le Setter ou le générateur interroge `KnowledgeRetriever` : seuls les
   claims validés sur sources non expirées sont retournés ;
4. à la date de fraîcheur, la source passe `expired` : visible comme telle,
   exclue des générations ; les claims qui ne citaient qu’elle redeviennent
   « à re-sourcer » ;
5. un owner retire une source (`withdrawn` + motif) : même effet, historique
   conservé, campagnes passées intactes.

## Règles métier et invariants

- un claim n’est marqué `validated` que s’il cite au moins une source
  `validated` et non expirée — contrôle serveur, y compris à l’expiration
  ultérieure de la source (le claim retombe en « à re-sourcer », jamais
  utilisé en l’état) ;
- une source expirée ou retirée n’est jamais servie par
  `KnowledgeRetriever` — le filtre est dans le port, pas laissé aux
  consommateurs ;
- retirer une source ne modifie ni les snapshots de campagne (F-031) ni les
  messages déjà envoyés : la connaissance n’a d’effet qu’au moment de la
  génération ;
- contenu strictement isolé par workspace ;
- chaque mutation (dépôt, validation, retrait) est auditée ; validation et
  retrait exigent owner/admin ;
- les sources déposées ne contiennent pas de données personnelles de
  prospects (elles décrivent le produit et le marché, pas les cibles) ;
- l’indexation est un détail du port : les contrats métier ne dépendent pas
  de la technologie de recherche.

## Critères d’acceptation

- Étant donné un claim sans source valide, quand on tente de le valider,
  alors la réponse est 422 avec la raison ;
- Étant donné une source qui atteint sa date de fraîcheur, quand le Setter
  génère une réponse, alors les claims qui ne citaient qu’elle ne sont plus
  utilisés ;
- Étant donné une source retirée, quand je consulte une campagne déjà
  exécutée qui l’avait utilisée, alors son contenu est inchangé ;
- Étant donné une source retirée puis une nouvelle génération, quand le
  contenu est produit, alors aucune trace du claim associé n’y figure ;
- Étant donné deux workspaces, quand l’un dépose une source, alors l’autre
  ne la voit ni ne l’utilise ;
- Étant donné un operator, quand il tente de valider un claim, alors la
  réponse est 403 — il peut seulement proposer ;
- Étant donné un viewer, quand il liste les sources, alors il ne voit que
  les contenus validés ;
- Étant donné un retrait avec motif, quand je consulte le journal d’audit,
  alors j’y lis acteur, source, motif et date ;
- Étant donné une recherche plein-texte, quand j’interroge le port avec des
  termes du contenu, alors les sources correspondantes remontent — en
  PostgreSQL FTS, sans dépendance externe.

## États et erreurs

- loading : skeleton de la liste des sources ;
- empty : aucune source — action principale « déposer une source » ; état
  « à re-sourcer » affiché distinctement pour les claims orphelins ;
- validation : type inconnu, date de fraîcheur absente ou passée,
  validation d’un claim non sourcé (422) ;
- forbidden : validation/retrait réservés owner/admin, même par appel
  direct API ;
- provider indisponible : non applicable (PostgreSQL interne) ;
- conflit métier : 409 sur double validation ou retrait d’une source déjà
  retirée ;
- reprise : non applicable (actions synchrones ; l’indexation FTS est
  transactionnelle avec l’écriture).

## Contrats

**Routes UI** : `/w/[workspaceSlug]/knowledge` (liste, fiches, filtres
type/statut/fraîcheur) ; badge « à re-sourcer » sur les claims d’offre
(F-010).

**Use cases** : `CreateKnowledgeSource`, `ValidateKnowledgeSource`,
`WithdrawKnowledgeSource`, `ValidateClaim`, `SearchKnowledge` (port).

**API** :

| Méthode | Route | Usage | État |
|---|---|---|---|
| GET | `/api/v1/knowledge-sources` | liste filtrable (type, statut, fraîcheur) | à spécifier |
| POST | `/api/v1/knowledge-sources` | dépôt (statut `draft`) | à spécifier |
| POST | `/api/v1/knowledge-sources/:id/actions/validate` | validation (owner/admin) | à spécifier |
| POST | `/api/v1/knowledge-sources/:id/actions/withdraw` | retrait motivé (owner/admin) | à spécifier |
| GET | `/api/v1/knowledge-claims` | claims avec leurs sources et statut « à re-sourcer » | à spécifier |
| POST | `/api/v1/knowledge-claims/:id/actions/validate` | validation d’un claim sourcé (owner/admin) | à spécifier |

**Événements sortants** : `KnowledgeSourceValidated`,
`KnowledgeSourceWithdrawn`, `KnowledgeSourceExpired` (via job quotidien de
passage d’expiration, idempotent) — un seul envoi par transition.

**Ports externes** : `KnowledgeRetriever` (nouveau port, implémentation
PostgreSQL FTS V1 ; pgvector/ParadeDB interchangeables après benchmark).

## Données et confidentialité

- nouvelles tables : `knowledge_sources` (workspace, type, titre, contenu ou
  `research_document_id`, statut, `publishedAt`, `freshnessUntil`, auteur,
  validateur, `withdrawnAt` + motif) et `knowledge_claims` (workspace, texte
  du claim, statut, `offer_claim_id` optionnel) + table de jonction
  claim ↔ sources ; index FTS PostgreSQL sur titre + contenu ;
- données personnelles : aucune PII de prospect dans les sources (règle
  métier, validée au dépôt : rejet si le contenu ressemble à une donnée de
  contact) ; les cas clients sont des contenus marketing validés ;
- rétention : les sources retirées/expirées sont conservées pour l’audit ;
  la purge relève de la politique F-053 ;
- audit : dépôt, validation, retrait, expiration automatique.

## Analytics

- événements `knowledge_source_created/validated/withdrawn/expired`,
  `knowledge_claim_validated`, `knowledge_retriever_queried` ;
- dimensions : workspace, type, statut ;
- métriques de succès : part des générations citant au moins un claim
  validé, nombre de claims « à re-sourcer », délai médian de remplacement
  d’une source expirée.

## Tests obligatoires

- domaine : transitions de cycle de vie, règle « claim validé ⇒ source
  valide non expirée », bascule « à re-sourcer » à l’expiration ;
- application : le port ne sert jamais une source expirée/retirée (filtre
  interne) ;
- intégration PostgreSQL : recherche FTS pertinente, unicité de transition,
  job d’expiration idempotent ;
- snapshot : une campagne exécutée avant retrait conserve son contenu
  (F-031) ;
- isolation workspace : mêmes titres dans deux workspaces, aucune fuite de
  recherche ;
- permission : validation/retrait refusés à operator/reviewer/viewer par
  appel direct API ;
- E2E : dépôt → validation → génération Setter citant le claim → expiration
  → claim « à re-sourcer » exclu des générations suivantes.

## Dépendances

- F-010 (claims d’offre) : livré — lien optionnel claim-to-claim ;
- F-031 (snapshots immuables) : livré — garantit le non-altération des
  campagnes exécutées ;
- F-042 (Setter) et générateur de contenu : socles livrés — deviennent
  consommateurs du port ;
- F-003 (jobs, audit, outbox) : livré ;
- AI-130 (retrieval) : cette fiche en est l’implémentation V1 (PostgreSQL
  FTS, décision user) ; AI-140 évaluera la qualité des citations.

## Questions résolues avant développement

- pas de ParadeDB ni pgvector en V1 : PostgreSQL FTS suffit (décision user),
  le port garde l’interchangeabilité ;
- l’IA ne crée pas de claims : elle consomme des claims validés par un
  humain ;
- expiration = effet immédiat sur les générations futures, aucune
  rétroactivité sur l’exécuté ;
- une nouvelle version d’un document = une nouvelle source ; l’ancienne est
  expirée (pas de versioning interne).
