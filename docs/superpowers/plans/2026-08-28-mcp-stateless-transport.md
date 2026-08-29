# Plan : transport MCP stateless et routage API (#71)

## Objectif

Exposer un endpoint MCP Streamable HTTP stateless (`/mcp`) dans le même
processus que l’API, en réutilisant uniquement les capacités bornées composées
par `packages/bootstrap`. Le transport doit être compatible avec l’Inspector
pour `initialize`, `ping`, `tools/list`, `tools/call`, `resources/list` et
`resources/read`, sans session serveur, boucle réseau, accès direct à la base ou
aux providers.

## Décisions et garde-fous

- Implémenter l’adaptateur avec le SDK TypeScript MCP officiel v2 :
  `@modelcontextprotocol/server@2.0.0` pour `createMcpHandler`/`McpServer` et
  `@modelcontextprotocol/client@2.0.0` pour les tests Web Standard. Les versions
  sont épinglées exactement dans `package.json` et `bun.lock`; aucun autre
  service ou runtime n’est ajouté. Aucune dépendance MCP de la ligne v1 n’est
  conservée.
- Le handler SDK négocie deux ères par requête : trafic legacy 2025 stateless et
  enveloppe moderne explicitement épinglée `2026-07-28` (`server/discover`,
  `tools/list`, `resources/list`, `tools/call`). Le précheck local ne filtre pas
  la liste legacy : les versions inconnues sont rejetées par `createMcpHandler`.
- Limiter chaque POST à 1 MiB avant parsing, exiger JSON et les en-têtes Accept
  MCP, et retourner des erreurs HTTP/JSON-RPC déterministes.
- Valider `Origin` et `Host` contre des allowlists explicites ; une éventuelle
  authentification de développement est opt-in et impossible lorsque
  `NODE_ENV=production`. La production passe toujours par l’authentification
  Better Auth composée par le bootstrap.
- Ne conserver aucun état mutable ou identifiant de session entre requêtes ;
  chaque appel crée son contexte de parsing/réponse.
- Router `/mcp` vers `api:3001` avant le fallback Caddy, sans modifier les
  invariants Compose.

## Étapes TDD

1. Ajouter les tests de transport couvrant initialize/ping, découverte outils et
  ressources, appel `noosphere_ping`/`tracer`, isolation concurrente,
  redémarrage (nouvelles instances), limite 1 MiB, méthode/JSON invalides,
  Origin/Host/auth et absence de session. Le client officiel v2 couvre le
  chemin legacy/auto et un smoke explicite pinned couvre l’enveloppe moderne
  `2026-07-28` sans fallback.
2. Ajouter les tests statiques Caddy/Compose vérifiant la route `/mcp` avant le
   fallback et l’absence de nouveau service/port.
3. Implémenter `packages/interface/src/mcp/mcp-transport.ts` autour de
   `createMcpHandler`/`McpServer`, avec des interfaces explicites, garde-fous
   Web Request/Response, et capacités runtime en lecture seule.
4. Composer le transport dans `create-noosphere-api-runtime.ts` et faire
   dispatcher `/mcp` avant les routes HTTP existantes.
5. Exécuter les tests ciblés, `check:types`, `check:architecture`,
   `git diff --check`, puis les vérifications intégration disponibles.

## Fichiers prévus

- `packages/interface/src/mcp/mcp-transport.ts`
- `packages/bootstrap/src/create-noosphere-api-runtime.ts`
- `deploy/Caddyfile`
- `tests/unit/mcp-transport.test.ts`
- `tests/unit/mcp-caddy-compose.test.ts`
