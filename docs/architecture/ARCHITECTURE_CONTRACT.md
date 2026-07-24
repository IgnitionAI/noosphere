# Contrat d’architecture

Ce document est normatif. Toute implémentation qui le viole doit être corrigée
avant merge.

## 1. Structure attendue

```text
apps/
  web/                 # Next.js, pages et composition HTTP
  worker/              # consommateurs de jobs
packages/
  domain/              # TypeScript pur
    workspace/
    gtm/
    prospect-intelligence/
    campaigns/
    outreach/
    inbox/
    pipeline/
    ai-knowledge/
  application/         # cas d’usage, DTO et ports
  infrastructure/      # Drizzle, fournisseurs, queue, stockage
  interface/           # handlers, validation et sérialisation
  contracts/           # schémas API et événements
```

Les contextes sont des sous-dossiers de chaque couche. Un dossier transversal
`modules/` mélangeant domaine, HTTP et DB est interdit.

## 2. Sens des dépendances

- `domain` : standard TypeScript uniquement ;
- `application` : dépend de `domain`, jamais d’infrastructure ou Next.js ;
- `infrastructure` : implémente les repositories et ports ;
- `interface` : appelle les cas d’usage, jamais Drizzle ni les SDK ;
- `apps/*` : composition root et démarrage uniquement.

Imports interdits dans `domain` : `next`, `react`, `better-auth`,
`drizzle-orm`, `pg`, SDK Unipile, SDK IA, `zod`, bibliothèques de queue et
stockage.

## 3. Règles obligatoires

1. Les entités de domaine ne sont pas des schémas Drizzle.
2. Chaque agrégat persistant possède un repository interface et un mapper.
3. Les dépendances sont injectées au constructeur.
4. Aucun cas d’usage n’instancie un repository ou SDK.
5. Aucun handler ne contient de logique métier ou requête SQL.
6. Tout use case mutateur suit : charger, appeler le domaine, sauvegarder,
   écrire les événements, retourner un DTO.
7. Toute requête repository métier est automatiquement scoped par workspace.
8. Les opérations externes sont idempotentes.
9. Les changements d’état et événements outbox partagent une transaction.
10. Les versions publiées sont immuables.
11. Aucun secret ni payload personnel n’est écrit dans les logs.
12. Les migrations sont additives avant toute suppression destructive.

## 4. Ports imposés

- `ProspectSource`
- `ContactEnrichment`
- `CommunicationChannel`
- `CalendarProvider`
- `AIModelProvider`
- `KnowledgeRetriever`
- `ObjectStorage`
- `JobQueue`
- `EventPublisher`
- `Clock`
- `IdGenerator`

Le code métier ne teste jamais `provider === "unipile"` ; la sélection
d’adaptateur appartient à l’application ou à l’infrastructure.

## 5. Tests d’architecture

- graphe d’imports sans cycle ;
- absence d’import interdit ;
- domaines testables sans DB, réseau ou variables d’environnement ;
- repositories testés contre PostgreSQL réel en intégration ;
- contrats fournisseurs testés sur fixtures ;
- test systématique d’isolation inter-workspace ;
- test de double livraison webhook/job ;
- test de course entre réponse entrante et envoi planifié ;
- test de suppression créée entre planification et exécution ;
- test de compatibilité Bun pour chaque SDK serveur.

## 6. Critères déclenchant une réévaluation

- Redis : seulement après mesure d’un besoin de cache ou de coordination ;
- ParadeDB : lorsque PostgreSQL FTS/pgvector ne répond plus au besoin hybride ;
- microservice : équipe propriétaire distincte ou exigence de déploiement
  indépendant démontrée ;
- base par tenant : exigence contractuelle d’isolation ou très grand tenant ;
- CQRS dédié : projections trop coûteuses malgré index et vues.
