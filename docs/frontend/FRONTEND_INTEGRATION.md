# Intégration frontend

## Source visuelle

Le prototype de référence versionné se trouve dans `prototype/`.

Il contient 26 écrans HTML, un shell partagé, des données réalistes et une
bibliothèque de composants. Le HTML sert à valider le produit et la hiérarchie
visuelle. Il ne doit pas être copié tel quel dans la production.

## Pages et routes Next.js

| Prototype | Route | Feature |
|---|---|---|
| `login.html` | `/login` | auth — livré |
| `onboarding.html` | `/onboarding` | workspace/gtm — état vide livré |
| `dashboard.html` | `/w/[workspaceSlug]` | dashboard |
| `approvals.html` | `/w/[workspaceSlug]/approvals` | approvals |
| `prospects.html` | `/w/[workspaceSlug]/prospects` | prospect intelligence |
| `discover.html` | `/w/[workspaceSlug]/prospects/discover` | prospect sourcing |
| `prospect-detail.html` | `/w/[workspaceSlug]/prospects/[contactId]` | contact |
| `companies.html` | `/w/[workspaceSlug]/companies` | companies |
| `company-detail.html` | `/w/[workspaceSlug]/companies/[companyId]` | company |
| `product-reading.html` | `/w/[workspaceSlug]/strategy/product-reading` | research brief — livré |
| `research-progress.html` | `/w/[workspaceSlug]/research/[runId]` | deep research progress — livré |
| `icp-builder.html` | `/w/[workspaceSlug]/research/[runId]/report` | sourced ICP report |
| `offers.html` | `/w/[workspaceSlug]/offers` | offer versions |
| `icps.html` | `/w/[workspaceSlug]/icps` | ICP versions |
| `campaigns.html` | `/w/[workspaceSlug]/campaigns` | campaigns |
| `campaign-builder.html` | `/w/[workspaceSlug]/campaigns/new` | campaign builder |
| `campaign-detail.html` | `/w/[workspaceSlug]/campaigns/[campaignId]` | campaign detail |
| `sequences.html` | `/w/[workspaceSlug]/sequences` | sequences |
| `inbox.html` | `/w/[workspaceSlug]/inbox` | inbox |
| `pipeline.html` | `/w/[workspaceSlug]/pipeline` | pipeline |
| `knowledge.html` | `/w/[workspaceSlug]/knowledge` | knowledge |
| `ai-studio.html` | `/w/[workspaceSlug]/ai-studio` | AI evaluation |
| `analytics.html` | `/w/[workspaceSlug]/analytics` | analytics |
| `integrations.html` | `/w/[workspaceSlug]/integrations` | integrations |
| `settings.html` | `/w/[workspaceSlug]/settings` | workspace |
| `components.html` | Storybook uniquement | design system |

## Mapping vers shadcn/ui

| Prototype | Composant cible |
|---|---|
| `.btn` | `Button` |
| `.input`, `.select`, `.textarea` | `Input`, `Select`, `Textarea` |
| `.badge` | `Badge` avec variants métier |
| `.panel` | `Card`, sans ombre décorative |
| `.data-table` | TanStack Table + primitives shadcn |
| `.tabs` | `Tabs` |
| `.drawer` | `Sheet` |
| `.toast` | `Sonner` |
| `.conversation-layout` | `InboxLayout` métier |
| `.kanban` | `PipelineBoard` métier |
| `.score-ring` | `ProspectScore` métier |
| sidebar/topbar | `AppShell` |

## Découpage en production

```text
apps/web/
  app/
    api/auth/[...all]/
    login/
    onboarding/
    w/[workspaceSlug]/
  components/
    app-shell.tsx
  lib/
    api.ts
```

Cette première tranche garde les composants au plus près de F-009. Les futures
features devront extraire les primitives partagées seulement lorsqu’un deuxième
usage réel apparaît.

## États à implémenter pour chaque page

- chargement avec skeleton stable ;
- résultat vide avec prochaine action explicite ;
- erreur récupérable ;
- données partielles ou provider indisponible ;
- permission insuffisante ;
- workspace absent ;
- suppression ou restriction de canal ;
- mutation optimiste uniquement si elle est réversible.

## Règles d’intégration

1. Installer Tailwind dans le build. Le CDN du prototype est interdit en
   production.
2. Reprendre les tokens de `DESIGN.md` en variables CSS.
3. Utiliser des Server Components pour le premier chargement des pages.
4. Garder les tableaux, drawers, formulaires et inbox en Client Components
   ciblés.
5. Dériver le workspace de la route et de la session, jamais d’un champ libre.
6. Brancher les pages sur les cas d’usage dès leur première tranche verticale.
7. Capturer des tests visuels aux breakpoints touchés par la tranche.

## Ordre de construction

1. ~~tokens, primitives, auth et `AppShell`~~ ;
2. ~~brief produit et suivi F-009~~ ;
3. ~~rapport ICP sourcé F-009~~ ;
4. Prospects + fiche prospect ;
5. campagne builder + validation ;
6. inbox + approbation de réponse ;
7. pipeline ;
8. knowledge et analytics ;
9. intégrations et settings ;
10. AI Studio uniquement au démarrage de la phase IA.

## Contrat d’exécution

- `OUTBOUND_API_URL` est une URL serveur privée, jamais une variable
  `NEXT_PUBLIC_*`.
- `/api/auth/*` est relayé en same-origin vers l’API Bun.
- `GET /api/v1/workspaces` fournit les seuls workspaces actifs de la session.
- Chaque appel F-009 ajoute ensuite `x-workspace-slug`, validé à nouveau côté
  API.
- `bun run build:web` produit le bundle standalone et y copie les assets
  statiques nécessaires au lancement sur VPS.
