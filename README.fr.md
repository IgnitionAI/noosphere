# Noosphere

Noosphere est une plateforme open source d’intelligence de croissance. Elle réunit recherche ICP, prospection Outbound, contenu Inbound, conversations multicanales et rendez-vous dans une seule application multi-workspace.

[English](README.en.md) · [README principal](README.md)

## La promesse produit

L’expérience normale tient en trois étapes :

1. vous lancez une étude ICP à partir de votre offre ;
2. Noosphere source les prospects, exécute les campagnes et publie le contenu autorisé ;
3. vous retrouvez les réponses LinkedIn, email et WhatsApp dans une inbox unique et récoltez les appels.

Les détails techniques restent observables sans envahir l’expérience. Les exceptions sont localisées dans « À traiter » et chaque effet externe reste gouverné par une policy déterministe.

## Capacités

### Outbound

- recherche ICP sourcée avec preuves résolubles ;
- campagnes créées depuis les ICP retenus ;
- sourcing LinkedIn pour LinkedIn et sourcing entreprise/web pour email ou WhatsApp ;
- enrichissement, scoring, rédaction personnalisée, relances et qualification ;
- envoi via les comptes connectés, avec quotas, fenêtres horaires, suppression et idempotence ;
- dry-run durable pour tester un Setter sans envoyer ni réserver.

### Inbound LinkedIn

- stratégie éditoriale dérivée de l’offre, de l’ICP et du brand kit ;
- recherche quotidienne d’idées sourcées et dédupliquées ;
- pipeline `brief → rédaction → audit des preuves → critique` ;
- posts texte, images et carrousels ;
- calendrier réglable, publication durable et réconciliation provider ;
- ingestion des réactions, commentaires et réponses pour alimenter l’attribution.

Les autres canaux sociaux et la génération de shorts restent des extensions futures, pas des capacités déclarées comme prêtes.

### Prospect 360 et conversations

- mémoire centrale durable par prospect ;
- faits, objections, engagements, sujets déjà traités et éléments à ne pas répéter ;
- contexte reconstruit pour chaque job à partir de PostgreSQL ;
- aucun agent ou client CLI singleton ne conserve l’état métier ;
- inbox LinkedIn, email et WhatsApp, filtrable par campagne/hors campagne, canal et période ;
- amélioration IA d’un brouillon sans envoi implicite ;
- préparation d’appel et attribution Inbound, Outbound, mixte ou inconnue.

## Architecture

Noosphere est un monolithe modulaire TypeScript/Bun avec un crawler Python autonome :

| Zone | Responsabilité |
|---|---|
| `packages/domain` | invariants métier et états |
| `packages/application` | cas d’usage et ports |
| `packages/infrastructure` | PostgreSQL/Drizzle, providers, queue et stockage |
| `packages/interface` | contrats HTTP et permissions |
| `apps/api` | composition root et API Bun |
| `apps/worker` | workers durables avec leases et heartbeats |
| `apps/web` | Next.js 16 et React 19 |
| `apps/crawler` | FastAPI, Crawl4AI, Playwright et SearXNG |

Primitives standard : PostgreSQL/ParadeDB, MinIO compatible S3, queue/outbox PostgreSQL, Bun, Next.js et Docker Compose. Docling n’est pas requis dans le déploiement standard ; l’extracteur léger gère texte, Markdown, HTML et PDF texte.

```mermaid
flowchart TB
  WEB[Next.js] --> API[API Bun]
  API --> DB[(PostgreSQL / ParadeDB)]
  API --> S3[(MinIO)]
  API --> Q[Jobs durables / Outbox]
  Q --> W[Workers spécialisés]
  W --> AI[Routeur Kimi / Codex]
  W --> CH[LinkedIn / Email / WhatsApp]
  W --> CR[Crawler Python]
  CR --> SE[SearXNG]
```

Le modèle propose ; la policy autorise. Avant chaque effet, le runtime revérifie workspace, compte, quota, horaire, suppression et idempotence. Une commande n’est considérée envoyée que lorsque son état durable est `sent` et qu’un identifiant provider est enregistré.

## Installation locale

Prérequis :

- Bun 1.3 ou plus récent ;
- Docker et Docker Compose ;
- `uv` pour développer/tester le crawler ;
- des identifiants provider uniquement pour les intégrations que vous souhaitez activer.

```bash
cp .env.example .env
bun install
bun run dev:setup
bun run dev
```

`dev:setup` démarre l’infrastructure, applique les migrations et crée le propriétaire configuré dans `.env`. L’application est ensuite disponible sur [http://localhost:3000](http://localhost:3000).

Pour démarrer les processus séparément :

```bash
bun run db:migrate
bun run bootstrap:owner
bun run api
bun run worker:general
bun run worker:decision
bun run worker:setter
bun run worker:memory
bun run web
```

## Configuration

Copiez `.env.example` et configurez au minimum PostgreSQL, Better Auth, MinIO et les identifiants du propriétaire. Les providers IA sont routés par workspace et par cas d’usage : Kimi et Codex peuvent être sélectionnés comme modèle principal ou fallback lorsque leur runtime est configuré.

Ne commitez jamais `.env`, clés API, cookies LinkedIn, jetons OAuth ou secrets de webhook.

## Tests et preuves

```bash
# Types, architecture, unités/HTTP, crawler et builds
bun run check

# PostgreSQL réel et migrations isolées
bun run test:integration

# E2E navigateur après bootstrap
bun run test:e2e
```

Prospect 360 fournit aussi des commandes sans effet provider :

```bash
bun run prepare:prospect-memory-benchmark
bun run benchmark:capacity
bun run evaluate:prospect-memory-shadow
bun run evaluate:prospect-memory-setter
bun run evaluate:prospect-memory-operator
```

Une suite verte ne remplace pas une preuve live. Consultez le [rapport de validation Prospect 360](docs/performance/2026-08-23-prospect-360-memory-validation-report.md) pour connaître les mesures réellement exécutées, les seuils non atteints et les gates encore ouverts.

## Déploiement VPS

Le déploiement standard utilise `compose.infrastructure.yml` et `compose.production.yml`. Il comprend API, web, crawler, PostgreSQL, MinIO et workers spécialisés. Suivez le [runbook VPS](docs/runbooks/vps-production.md) pour TLS, migrations, sauvegardes, restauration et canary.

Ne lancez pas de canary LinkedIn, email ou WhatsApp réel sans autorisation explicite et bornée au compte, au workspace et au contenu concernés.

## Documentation

- [Architecture](docs/architecture/ARCHITECTURE.md)
- [Architecture produit Noosphere](docs/architecture/NOOSPHERE_PRODUCT_ARCHITECTURE.md)
- [Modèle de domaine](docs/architecture/DOMAIN.md)
- [Contrat d’architecture](docs/architecture/ARCHITECTURE_CONTRACT.md)
- [Contrat OpenAPI](packages/contracts/openapi/product-research-v1.json)
- [Frontière IA](docs/product/AI_BOUNDARY.md)
- [Backlog produit](docs/product/NOOSPHERE_BACKLOG.md)
- [Runbook production](docs/runbooks/vps-production.md)
- [Prospect 360 — design de contexte](docs/architecture/2026-08-23-prospect-360-memory-context-engineering.md)

## Contribuer et sécurité

Les contributions sont bienvenues. Avant une pull request, lancez `bun run check` et `bun run test:integration`, documentez les migrations et conservez l’isolation workspace. N’incluez jamais de données prospect réelles dans les fixtures ou rapports.

Pour une vulnérabilité, n’ouvrez pas immédiatement une issue publique contenant une clé, une donnée personnelle ou une procédure d’exploitation. Contactez d’abord les mainteneurs via le canal privé indiqué par l’organisation GitHub IgnitionAI.

## Licence

Noosphere est distribué sous [GNU AGPL v3.0 uniquement](LICENSE). Toute version modifiée proposée à des utilisateurs via un réseau doit leur offrir le code source correspondant conformément à l’AGPL.
