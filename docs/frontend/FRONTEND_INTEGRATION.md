# Intégration frontend

## Source visuelle

Le prototype de référence versionné se trouve dans `prototype/`.

Il contient 23 écrans HTML, un shell partagé, des données réalistes et une
bibliothèque de composants. Le HTML sert à valider le produit et la hiérarchie
visuelle. Il ne doit pas être copié tel quel dans la production.

## Pages et futures routes Next.js

| Prototype | Route | Feature |
|---|---|---|
| `login.html` | `/login` | auth |
| `onboarding.html` | `/onboarding` | workspace/gtm |
| `dashboard.html` | `/w/[workspaceSlug]` | dashboard |
| `approvals.html` | `/w/[workspaceSlug]/approvals` | approvals |
| `prospects.html` | `/w/[workspaceSlug]/prospects` | prospect intelligence |
| `discover.html` | `/w/[workspaceSlug]/prospects/discover` | prospect sourcing |
| `prospect-detail.html` | `/w/[workspaceSlug]/prospects/[contactId]` | contact |
| `companies.html` | `/w/[workspaceSlug]/companies` | companies |
| `company-detail.html` | `/w/[workspaceSlug]/companies/[companyId]` | company |
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

## Découpage recommandé

```text
apps/web/
  app/
    (auth)/
    w/[workspaceSlug]/
  features/
    workspace/
    gtm/
    prospects/
    campaigns/
    outreach/
    inbox/
    pipeline/
    knowledge/
    analytics/
  components/
    ui/            # shadcn, sans logique métier
    layout/        # AppShell, Sidebar, Topbar
    data-display/  # Score, Identity, Status
```

Les composants `ui/` ne connaissent ni les prospects, ni les campagnes. Les
composants feature assemblent les primitives et portent le vocabulaire métier.

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
6. Reproduire d’abord le prototype à données statiques, puis brancher les cas
   d’usage.
7. Capturer des tests visuels à 375, 768, 1024 et 1440 px.

## Ordre de construction

1. tokens et primitives ;
2. `AppShell` et RBAC de navigation ;
3. Prospects + fiche prospect ;
4. campagne builder + validation ;
5. inbox + approbation de réponse ;
6. pipeline ;
7. knowledge, AI Studio et analytics ;
8. intégrations, settings, onboarding et auth.
