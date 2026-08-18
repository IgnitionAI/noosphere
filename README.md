# Ignition Outbound

Ignition Outbound est une application interne de prospection multicanale conçue
pour IgnitionAI, avec une architecture permettant une évolution ultérieure vers
un produit SaaS multi-workspace.

Ce dépôt contient les spécifications d’architecture, un prototype frontend
HTML/Tailwind navigable et la première tranche verticale Bun/PostgreSQL/Next.js
de la mission de recherche ICP F-009, son moteur LangChain et son crawler
Python autonome.

![Vue d’ensemble du prototype](prototype/screenshots/dashboard-desktop.png)

## Démarrer le prototype

```bash
bun run prototype
```

Puis ouvrir [http://localhost:4173](http://localhost:4173).

Vérifier l’intégrité des pages, des types, de l’architecture, des routes et des
builds Bun :

```bash
bun run check
```

Le contrôle couvre aussi les types, les dépendances d’architecture et les tests
unitaires du domaine, de la file de jobs, de l’orchestrateur et le build
standalone Next.js.

## Application web

Après avoir renseigné `.env`, migré la base et créé le compte propriétaire :

```bash
bun run db:migrate
bun run bootstrap:owner
bun run api
bun run web
```

L’API écoute par défaut sur `127.0.0.1:3001` et Next.js sur
`127.0.0.1:3000`. L’authentification passe par le proxy same-origin
`/api/auth/*`, puis les pages serveur résolvent uniquement les workspaces actifs
de la session.

Pour produire et lancer le bundle VPS :

```bash
bun run build:web
HOSTNAME=0.0.0.0 PORT=3000 bun run web:start
```

Le workflow livré couvre `/login`, la sélection automatique du workspace, le
brief produit et ses documents, le suivi de mission, le rapport sourcé et la
publication automatique de l’ICP exploitable.

## Backend F-009

Le socle est organisé selon le monolithe modulaire :

- `packages/domain` : agrégat et invariants de recherche ;
- `packages/contracts` : contrats Zod des rôles d’agents ;
- `packages/application` : cas d’usage, ports et orchestrateur ;
- `packages/infrastructure` : Drizzle, PostgreSQL, queue et adapters de test ;
- `packages/interface` : transport HTTP Web standard et contrôle des rôles ;
- `apps/api` : serveur Bun et composition root HTTP ;
- `apps/worker` : consommateur Bun à lease.

Voir le [runbook F-009](docs/architecture/F009_BACKEND_RUNBOOK.md) pour lancer
ParadeDB, MinIO et le crawler, migrer la base, puis démarrer l’API et
le worker. Le contrat machine des routes est
[`product-research-v1.json`](packages/contracts/openapi/product-research-v1.json).

Le déploiement VPS reproductible est décrit dans le [runbook production](docs/runbooks/vps-production.md).
Il utilise `compose.infrastructure.yml` et `compose.production.yml`, avec
Caddy pour TLS, deux workers séparés et des profils de sauvegarde PostgreSQL/
MinIO.

L’API monte Better Auth sous `/api/auth/*`. Les appels métier doivent envoyer
le slug de la route dans `x-workspace-slug` ; le serveur vérifie ensuite la
session et le membership PostgreSQL. Voir `.env.example` pour les variables
`BETTER_AUTH_*`.

Après `bun run db:migrate`, le premier compte et son workspace peuvent être
créés avec `bun run bootstrap:owner`. La procédure et les variables requises
sont détaillées dans le runbook F-009.

## Documents

- [Préparation produit et catalogue des features](docs/product/README.md)
- [Plan de livraison des features](docs/product/DELIVERY_PLAN.md)
- [Frontière IA](docs/product/AI_BOUNDARY.md)
- [Spécification d’architecture](docs/architecture/ARCHITECTURE.md)
- [Modèle de domaine](docs/architecture/DOMAIN.md)
- [Modèle de données et ERD](docs/architecture/DATA_MODEL.md)
- [Flux critiques](docs/architecture/FLOWS.md)
- [Contrat API](docs/architecture/API_CONTRACT.md)
- [Contrat d’architecture](docs/architecture/ARCHITECTURE_CONTRACT.md)
- [Checklist Guardian](docs/architecture/GUARDIAN_CHECKLIST.md)
- [Roadmap d’implémentation](docs/architecture/ROADMAP.md)
- [Guide d’intégration frontend](docs/frontend/FRONTEND_INTEGRATION.md)
- [Runbook backend F-009](docs/architecture/F009_BACKEND_RUNBOOK.md)
- [Architecture Decision Records](docs/architecture/adr/)
- [Prototype frontend](prototype/dashboard.html)

## Statut

Socle multi-workspace, CRM, découverte de prospects, campagnes autopilote
supervisées (D-003/D-005), Inbox globale (D-006), pipeline et rendez-vous
Cal.com intégrés au 8 août 2026. Le moteur utilise les agents LangChain via
l’API Kimi for Coding (modèles K3, provider `kimi-code` par défaut,
`AI_PROVIDER=openai` en alternative), OpenAI pour les embeddings
documentaires, le crawler SearXNG/Crawl4AI et ParadeDB. L’extraction documentaire
standard est légère (texte/HTML et PDF via `pdftotext`) ; Docling est une capacité
optionnelle du profil `documents-advanced`. L’autopilote
opère dans les bornes de la policy publiée (F-012) : revérifications
déterministes avant chaque envoi et exceptions explicites dans « À traiter ».
