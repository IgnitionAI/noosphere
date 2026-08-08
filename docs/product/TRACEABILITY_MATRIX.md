# Matrice de traçabilité

Cette matrice relie le prototype, le catalogue et les contrats d’architecture.
Elle ne remplace pas les DTO OpenAPI à écrire avant chaque vertical slice.

## Écrans, features et ressources

| Écran prototype | Route cible | Features | Ressources/use cases principaux |
|---|---|---|---|
| `login.html` | `/login` | F-001 | session, login, logout |
| `onboarding.html` | `/onboarding` | F-002, F-052 | workspace, offer, ICP, import, connected account |
| `dashboard.html` | `/w/[workspaceSlug]` | F-051 | analytics summary, due actions, replies |
| `approvals.html` | `/w/[workspaceSlug]/approvals` | F-033, F-042 | approval item, approve, reject, edit |
| `prospects.html` | `/w/[workspaceSlug]/prospects` | F-021, F-024, F-026 | contacts, merge candidates, suppressions |
| `discover.html` | `/w/[workspaceSlug]/prospects/discover` | F-023, F-025, F-027 | discover, preview, import, enrich |
| `prospect-detail.html` | `/w/[workspaceSlug]/prospects/[contactId]` | F-021, F-025, F-026, F-027 | contact, identities, employments, signals |
| `companies.html` | `/w/[workspaceSlug]/companies` | F-020 | company search, create |
| `company-detail.html` | `/w/[workspaceSlug]/companies/[companyId]` | F-020, F-027 | company, contacts, signals, campaigns |
| `product-reading.html` | `/w/[workspaceSlug]/strategy/product-reading` | F-009 | research brief, product and market |
| `research-progress.html` | `/w/[workspaceSlug]/research/[runId]` | F-009 | stages, competitors, findings and checkpoints |
| `icp-builder.html` | `/w/[workspaceSlug]/research/[runId]/report` | F-011 | sourced report, proposals and publication |
| `offers.html` | `/w/[workspaceSlug]/offers` | F-010 | offer draft, publish version |
| `icps.html` | `/w/[workspaceSlug]/icps` | F-011 | ICP draft, publish version |
| `campaigns.html` | `/w/[workspaceSlug]/campaigns` | F-031 | campaign list, create, pause |
| `campaign-builder.html` | `/w/[workspaceSlug]/campaigns/new` | F-031, F-032 | preflight, snapshot, population |
| `campaign-detail.html` | `/w/[workspaceSlug]/campaigns/[campaignId]` | F-031, F-032, F-034 | activate, pause, prospects, actions |
| `sequences.html` | `/w/[workspaceSlug]/sequences` | F-030 | sequence draft, preview, publish |
| `inbox.html` | `/w/[workspaceSlug]/inbox` | F-040, F-041, F-042 | conversations, messages, drafts |
| `pipeline.html` | `/w/[workspaceSlug]/pipeline` | F-043, F-044 | meeting, opportunity, change stage |
| `knowledge.html` | `/w/[workspaceSlug]/knowledge` | F-050 | sources, documents, claims |
| `ai-studio.html` | `/w/[workspaceSlug]/ai-studio` | AI-100 à AI-140 | runs, evaluations, prompts, feedback |
| `analytics.html` | `/w/[workspaceSlug]/analytics` | F-051 | campaign and pipeline projections |
| `integrations.html` | `/w/[workspaceSlug]/integrations` | F-035, F-043 | accounts, health, calendar |
| `settings.html` | `/w/[workspaceSlug]/settings` | F-002, F-053 | members, roles, policies, export |
| `components.html` | Storybook | F-004 | primitives and business components |

## Features et contrats API existants

| Feature | Endpoints V1 déjà déclarés | Compléments à spécifier avant développement |
|---|---|---|
| F-001 | Better Auth | session contract et erreurs |
| F-002 | `GET/POST /workspaces`, invitations, members | invitation accept/revoke |
| F-003 | health endpoints | audit, jobs et dead letters admin |
| F-009 | — | research runs, stages, competitors, evidence and findings |
| F-010 | `GET/POST /offers`, publish | versions, claims et preuves |
| F-011 | `GET/POST /icps`, publish | versions et validation critères |
| F-012 | — | messaging strategies et AI policies |
| F-020 | `GET/POST /companies` | detail, update et external identities |
| F-021 | `GET/POST /contacts` | identities et employments |
| F-022 | — | import upload, preview, apply et report |
| F-023 | `POST /campaigns/:id/actions/discover` | recherche hors campagne et preview |
| F-024 | approve merge candidate | list, reject et undo merge |
| F-025 | enrich contact, enrichment webhook | job status et result provenance |
| F-026 | `POST /suppressions` | list, eligibility check et lift |
| F-027 | — | company/contact signals |
| F-030 | `GET/POST /sequences`, publish | steps, preview et approve |
| F-031 | campaigns, activate, pause | preflight et archive |
| F-032 | campaign prospects | select, enroll, exclude et conflict |
| F-033 | campaign approve | approval queue générique |
| F-034 | — | actions, attempts, cancel et retry |
| F-035 | connected accounts, check, Unipile webhook | capabilities et reconnect |
| F-040 | inbox conversations/messages | assign, read state et reconcile |
| F-041 | Unipile webhook | suspension et explicit resume |
| F-042 | reply draft approve/reject | create et edit draft |
| F-043 | calendar webhook | meetings et booking actions |
| F-044 | opportunities, change stage | history et close actions |
| F-050 | — | sources, documents et claims |
| F-051 | campaign/pipeline analytics | export et metric definitions |
| F-052 | endpoints métier existants | onboarding progress |
| F-053 | workspace endpoints | audit read, export et anonymize |

## Features et événements

| Feature | Événements de domaine |
|---|---|
| F-002 | `WorkspaceMemberInvited` |
| F-009 | `ProductReadingCompleted`, `OfferDraftCreatedFromReading`, `ICPDraftCreatedFromReading` |
| F-010 | `OfferVersionPublished` |
| F-011 | `ICPVersionPublished` |
| F-023 | `ProspectDiscovered` |
| F-025 | `ContactIdentityVerified` |
| F-027 | `EmploymentChanged`, `SignalObserved` |
| F-026 | `SuppressionRegistered` |
| F-031 | `CampaignActivated`, `CampaignPaused`, `CampaignResumed`, `CampaignArchived` |
| F-032 | `CampaignProspectEnrolled` |
| F-033 | `ApprovalItemApproved`, `ApprovalItemRejected` |
| F-034 | `OutreachActionDue`, `OutreachActionAccepted` |
| F-035 | `ConnectedAccountStatusChanged` |
| F-040/F-041 | `InboundMessageReceived` |
| F-042 | `ReplyDraftApproved` |
| F-043 | `MeetingBooked` |
| F-044 | `OpportunityWon` |

## Couverture du prototype

Les 26 écrans ont une destination fonctionnelle. `ai-studio.html` reste une
référence visuelle non implémentée avant la Wave 7. `components.html` devient
une documentation Storybook et n’est pas une route de production.
