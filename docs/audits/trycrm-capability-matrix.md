# Matrice Ignition Outbound / TryCRM

Référence inspectée hors dépôt : `trycompai/crm` au commit
`f2484fb08d1dd1357c1e3deddb97610cd8e6f1ed`, licence MIT. Les chemins observés
sont `README.md`, `docs/agent.md`, le schéma Prisma, `lib/tasks.ts`,
`dispatch.ts`, `schedule_recheck.ts`, le ledger facts/evidence et le writer de
threads. Aucun code TryCRM n’a été copié; seuls les concepts sont réimplémentés
dans la stack existante.

| Capacité | Ignition avant | TryCRM observé | Écart et décision | Fichiers / tests |
|---|---|---|---|---|
| tâche durable, dueAt, lease, retry | queue PostgreSQL complète | `agentTask`, claim `SKIP LOCKED` | Réutiliser la queue, ajouter un registre métier `prospect_decisions` | queue, migration 0062, foundation tests |
| prochaine action + reason | implicitement l’étape suivante de séquence | `schedule_recheck` exige une raison | Adopté : décision datée, motivée et corrélée | scheduler/runner, durable tests |
| dispatcher sans décision métier | worker route les types | `dispatch.ts` ne décide rien | Conservé/renforcé : K3 propose, policy autorise, worker exécute | worker, decision agent/policy |
| reprise après crash | lease + heartbeat + dead letter | lease expirant | Déjà plus complet; pas de seconde queue | PostgresJobQueue |
| campaign policies | séquences, horaires, quotas, suppression | agent orienté tâches | Conservé; campagne devient une borne, pas le décideur | autopilot policy/decision runner |
| evidence ledger/suggestions | observations et knowledge claims sourcés | facts proposés/appliqués/rejetés | Pas de table concurrente : l’équivalent Outbound protège déjà les valeurs humaines | evidence-ledger.md, enrichment tests |
| mailbox/threads | webhooks, chat sync, conversations/messages | writer dédié | Existant; renforcer l’invalidation à l’ingestion | webhook/inbound runner, V3 integration |
| classification inbound | 7 intents structurés via K3 | agent mailbox riche | Étendue avec règles prioritaires et schéma riche | inbound agent/runner, priority tests |
| dry-run | implicite dans certaines validations | tâches/outils supervisés | Ajout explicite, défaut sécurisé, activation par campagne | policy, approvals, campagne UI |
| audit de runs | jobs/outbox/audit/ai_runs/correlation | sessions/steps | Existant; rattacher décisions et résultats | prospect decisions + UI |
| multi-tenancy | workspace partout, contexte serveur | outil interne explicitement single-tenant | Rejet de l’architecture tenant TryCRM; renforcer FKs composites | migration + isolation tests |
| permissions | RBAC 5 rôles | application interne | Conserver Better Auth/RBAC | handlers existants |
| interface opérateur | console jobs/outbox/audit + prospects | écrans reps/agents | Étendre fiche prospect et campagne, pas nouveau CRM | pages prospects/campaigns |

## Concepts rejetés

- Prisma, NestJS, Eve et l’organisation des agents TryCRM : doublons de la
  stack Bun/Drizzle/LangChain existante.
- Modèle single-tenant et lecture libre de toutes les données : incompatible
  avec l’isolation workspace.
- Pipeline deals générique et agent builder : hors invariant produit.
- Copie du ledger `ContactFact` : l’enrichissement Outbound conserve déjà
  observations, sources, confiance, déduplication et ne promeut pas les valeurs
  probables vers une identité.
