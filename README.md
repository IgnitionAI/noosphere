# Ignition Outbound

Ignition Outbound est une application interne de prospection multicanale conçue
pour IgnitionAI, avec une architecture permettant une évolution ultérieure vers
un produit SaaS multi-workspace.

Ce dépôt contient les spécifications d’architecture et un prototype frontend
HTML/Tailwind navigable. Le backend et l’application Next.js ne sont pas encore
implémentés.

![Vue d’ensemble du prototype](prototype/screenshots/dashboard-desktop.png)

## Démarrer le prototype

```bash
bun run prototype
```

Puis ouvrir [http://localhost:4173](http://localhost:4173).

Vérifier l’intégrité des pages et liens :

```bash
bun run check
```

## Documents

- [Spécification d’architecture](docs/architecture/ARCHITECTURE.md)
- [Modèle de domaine](docs/architecture/DOMAIN.md)
- [Modèle de données et ERD](docs/architecture/DATA_MODEL.md)
- [Flux critiques](docs/architecture/FLOWS.md)
- [Contrat API](docs/architecture/API_CONTRACT.md)
- [Contrat d’architecture](docs/architecture/ARCHITECTURE_CONTRACT.md)
- [Checklist Guardian](docs/architecture/GUARDIAN_CHECKLIST.md)
- [Roadmap d’implémentation](docs/architecture/ROADMAP.md)
- [Guide d’intégration frontend](docs/frontend/FRONTEND_INTEGRATION.md)
- [Architecture Decision Records](docs/architecture/adr/)
- [Prototype frontend](prototype/dashboard.html)

## Statut

Architecture V1 et prototype frontend validés le 24 juillet 2026. Les versions
précises des dépendances applicatives seront figées au démarrage de
l’implémentation Next.js.
