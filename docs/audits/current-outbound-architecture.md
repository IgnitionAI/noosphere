# Audit factuel de l’architecture Outbound

Audit réalisé le 13 août 2026 sur `dev` au commit de départ
`e95821dcc8dd61d2447d69071d79e09b32e802c5`.

## Architecture observée

Ignition Outbound est un monolithe modulaire TypeScript/Bun, pas un CRM
généraliste. `apps/web` contient l’interface Next.js 16, `apps/api` compose les
handlers Web `Request`/`Response`, `apps/worker` consomme les jobs PostgreSQL et
`apps/crawler` reste le seul service Python. Les dépendances suivent
`interface → application → domain`; les adaptateurs Drizzle, Unipile,
LangChain/Kimi, S3 et crawler sont dans `packages/infrastructure` ;
l’extraction standard est portée par `DocumentTextExtractor` avec `pdftotext`,
tandis que Docling reste un adaptateur optionnel hors du chemin standard.

La base est PostgreSQL/Drizzle (`packages/infrastructure/src/database/schema.ts`).
Better Auth gère l’identité tandis que `workspaces` et `workspace_members`
portent le tenant et les rôles. Le slug HTTP est résolu côté serveur par
`packages/interface/src/http/request-context.ts`; le navigateur ne choisit
jamais un `workspaceId` de confiance.

Le runtime agentique existant est LangChain 1.5 / Deep Agents :
`langchain-research-agent-executor.ts` emploie `createAgent` et
`createDeepAgent`, les agents de contenu et Setter emploient `ChatOpenAI`
OpenAI-compatible. Kimi K3 est configuré par environnement; OpenAI demeure
utilisé pour les embeddings. Les outils web passent par le crawler interne.

Les traitements durables utilisent `jobs`, `PostgresJobQueue` et
`ResearchWorker`. Le claim se fait avec `FOR UPDATE SKIP LOCKED`, lease
renouvelable, retry, dead letter, idempotence `(workspace,type,key)` et
fairness entre workspaces. `outbox_events` relie transaction métier et
événement. Le worker est horizontalement réplicable.

Les canaux LinkedIn, email et WhatsApp utilisent Unipile derrière les ports
`OutboundChannelGateway` et `ProspectSource`. Cal.com est l’adaptateur de
calendrier. Les traces persistantes sont les jobs, outbox, audit logs,
`ai_runs`, `outreach_attempts`, événements d’intégration et correlation IDs.

## Modèle métier réel

| Concept | Modèle réel | Preuve principale |
|---|---|---|
| prospect/personne | `contacts`, `contact_identities`, `contact_employments` | `schema.ts`, `postgres-prospect-view-repository.ts` |
| société | `companies`, domaines et emplois | `schema.ts`, `postgres-crm-repository.ts` |
| ICP/offre | versions immuables ICP et offre | repositories GTM/offres |
| campagne/séquence | `campaigns`, `sequences`, `sequence_versions`, `campaign_enrollments` | campaign repositories/runners |
| action/message | `outreach_actions`, `outreach_attempts`, `messages` | composition/dispatch/inbound runners |
| conversation/réponse | `conversations`, `integration_events`, `reply_classifications`, `automated_replies` | inbound reply runner |
| enrichissement/preuve | `enrichment_jobs`, `enrichment_observations`, knowledge claims | enrichment/knowledge repositories |
| état commercial | `opportunities`, historique d’étape | pipeline repositories |
| tâche/run | `jobs`, `research_stage_runs`, `ai_runs`, désormais `prospect_decisions` | queue/orchestrateurs |
| tenant/membre | `workspaces`, `workspace_members` | request context et schema |

## Workflow avant cette évolution

1. Le brief produit lançait la recherche ICP durable via
   `ResearchOrchestrator` et ses checkpoints.
2. Une ICP publiée créait des plans et campagnes mono-canal.
3. `ProspectDiscoveryJobProcessor` cherchait/importait des candidats.
4. `CampaignAutomationJobProcessor` scorait et sélectionnait les contacts.
5. `CampaignCompositionJobProcessor` personnalisait puis créait directement
   les actions et jobs `outreach.dispatch` selon une séquence rigide.
6. `OutreachDispatchJobProcessor` revérifiait fenêtres, quotas, suppression et
   provider, puis envoyait avec clé d’idempotence.
7. Le webhook persistait un `integration_event` et un job inbound.
8. `InboundReplyJobProcessor` persistait le message, annulait les relances,
   classifiait et créait éventuellement réponse, meeting ou opportunité.

Ce qui fonctionnait déjà : recherche reprise après crash, multi-workspace,
outbox, idempotence provider, suppression, quotas, inbox, Setter et
calendrier. Ce qui manquait : une prochaine décision métier persistante avec
observation/raison, la priorité atomique du webhook sur une relance déjà
réclamée, le dry-run explicite par campagne et les intentions inbound
prioritaires étendues.

Le risque de course était précis : l’annulation ne survenait qu’à l’étape 8,
après le job asynchrone. Une action réclamée entre les étapes 7 et 8 pouvait
donc appeler le provider. La correction est décrite dans
`docs/architecture/inbound-reply-processing.md`.

## Baseline exécutée avant modification

- `bun run check`: succès, 305 tests unitaires/HTTP, 40 tests crawler, builds
  Bun et Next.js verts.
- `bun run test:integration`: succès, 97 tests PostgreSQL.
- l’environnement local utilisait une base de test isolée; aucun provider
  réel n’a été appelé.

Le benchmark VPS existant demeure dans
`docs/performance/2026-08-11-local-capacity-baseline.md`; ce lot ne remplace
pas une charge longue durée avec vrais volumes de pages et appels modèles.
