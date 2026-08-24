# Contrat HTTP Noosphere V1

Date de réconciliation : 2026-08-24
Statut : vue architecturale de l'API implémentée.

Le contrat machine canonique est
`packages/contracts/openapi/product-research-v1.json` : **191 paths** au moment
de cette réconciliation. Les schémas Zod de `packages/contracts/src` et les
handlers de `packages/interface/src/http` doivent rester compatibles avec lui.
Ce document expose les conventions et familles ; il ne duplique pas chaque
payload.

## 1. Conventions

- préfixe métier `/api/v1` ;
- sessions Better Auth pour l'interface web ;
- `x-workspace-slug` transporte le workspace de la route, puis la session et le
  membership serveur établissent l'autorité ;
- aucun `workspaceId` fourni par le navigateur ou le modèle n'accorde un accès ;
- query params pour filtres, pagination et lentilles de lecture ;
- actions explicites (`/actions/pause`, `/actions/retry`) plutôt que PATCH de
  statut arbitraire ;
- `requestKey` dans le corps pour les commandes durables réessayables ;
- curseur opaque pour les grands flux ; pagination numérotée seulement sur les
  projections qui l'exposent déjà ;
- réponses asynchrones `202 Accepted` avec identifiant durable ;
- erreurs `application/problem+json` avec `code` stable ;
- `correlationId` propagé entre HTTP, job, outils et tentative provider.

Exemple d'erreur :

```json
{
  "type": "https://api.noosphere.local/problems/validation_failed",
  "title": "VALIDATION_FAILED",
  "status": 422,
  "detail": "The request is invalid",
  "code": "VALIDATION_FAILED"
}
```

Certaines routes historiques renvoient encore un URI de problème
`ignition-outbound.local`. Le champ `code` est l'autorité de compatibilité ; le
renommage de l'URI sera additif afin de ne pas casser les clients.

## 2. Familles de ressources

| Famille | Routes représentatives | Autorité |
|---|---|---|
| Workspace | `/workspaces`, `/members`, `/invitations`, `/workspace/setup-readiness` | session + membership |
| Offre et ICP | `/offers`, `/icps`, `/product-research-runs` | versions publiées et preuves |
| Research | `/product-research-runs/:id/evidence`, `/findings`, `/report` | run tenant-scoped |
| CRM | `/companies`, `/contacts`, `/signals`, `/suppressions`, `/merge-candidates` | contact canonique |
| Sourcing | `/discovery-runs`, `/enrichment-jobs`, `/enrichment-coverage` | run/job durable |
| Campagnes | `/campaigns`, `/prospects`, `/actions/activate|pause|resume` | snapshot + policy |
| Outreach | `/actions/:id`, `/actions/retry|cancel`, `/approval-items` | action/tentative durable |
| Conversations | `/conversations`, `/:id/messages`, `/:id/automation` | thread + compte connecté |
| Prospect 360 | `/prospects/:contactId/memory-view`, `/memory-status`, `/memory/actions/refresh` | événements + snapshot |
| Content | `/content/strategy`, `/ideas`, `/brand-kit`, `/publications`, `/autopilot` | versions et request keys |
| Activité | `/activity?lens=inbound|symbiosis|outbound` | projection GET sans effet |
| Knowledge | `/research-documents`, `/knowledge-sources`, `/knowledge-claims` | source/claim autorisé |
| Pipeline | `/opportunities`, `/pipeline/view`, `/calendar-bookings` | opportunity + booking |
| Attribution | journeys et touches reliant interaction, conversation et booking | preuve sourcée |
| IA | `/workspace-ai-settings`, `/ai/models`, `/ai-configurations`, `/evaluation-runs` | capacité + policy |
| Comptes | `/connected-accounts`, `/channel-connections/:channel` | compte lié au workspace |
| Operations | `/console/jobs`, `/dead-letters`, `/correlations`, `/audit-logs` | rôle opérateur/admin |

## 3. Projections d'expérience

Les écrans principaux lisent des projections composées ; ils ne reconstruisent
pas l'état métier dans le navigateur.

| Route | Usage |
|---|---|
| `GET /api/v1/workspace/operational-summary` | résultats, santé, exceptions et prochaines échéances |
| `GET /api/v1/workspace/setup-readiness` | checklist de configuration |
| `GET /api/v1/activity?lens=...` | flux Noosphere par lentille et type d'interaction |
| `GET /api/v1/campaigns/:id/workspace-view` | campagne, population, timeline et prochaine action |
| `GET /api/v1/conversations?...` | inbox filtrable canal/campagne/source/période/lecture |
| `GET /api/v1/pipeline/view` | opportunités et appels |
| `GET /api/v1/prospects/:id/memory-view` | vue Prospect 360 et provenance |

`lens` est une préférence de lecture et ne déclenche aucune commande. Les
filtres sérialisés dans l'URL doivent survivre au retour navigateur.

## 4. Commandes durables

Une commande ayant un effet asynchrone suit le contrat :

```text
HTTP command + requestKey
  → transaction métier
  → ressource durable + job + outbox
  → 202 avec resourceId/jobId
  → worker acquiert un lease
  → policy revalidée
  → tentative provider idempotente
  → résultat final ou réconciliation
```

La même `requestKey` et le même payload retournent la même commande. La même
clé avec un payload incompatible renvoie `IDEMPOTENCY_CONFLICT`. Une déconnexion
du client ne modifie pas l'état du job.

Commandes concernées notamment :

- démarrage/reprise d'une étude ICP ;
- sourcing et enrichissement ;
- décision et envoi prospect ;
- Setter et amélioration de brouillon ;
- génération et publication Content ;
- refresh Prospect 360 ;
- extraction/réindexation documentaire ;
- création, replanification et annulation d'un appel.

## 5. Webhooks et synchronisation

| Route | Règle |
|---|---|
| `POST /api/v1/webhooks/unipile` | authentifier, dédupliquer, persister puis répondre rapidement |
| webhooks calendrier | vérifier la signature, persister et réconcilier le booking |
| callbacks onboarding compte | résoudre l'onboarding durable et associer le compte au workspace |

Le polling par curseur complète les webhooks pour l'historique et les événements
manqués. Le provider n'est jamais la source de vérité du tenant : seuls les
comptes explicitement associés au workspace sont synchronisés.

## 6. Erreurs structurantes

| Classe | HTTP usuel | Exemples |
|---|---:|---|
| authentification | 401 | `AUTHENTICATION_REQUIRED` |
| autorisation | 403 | `WORKSPACE_FORBIDDEN` |
| validation | 400/422 | `INVALID_REQUEST`, `VALIDATION_FAILED` |
| absence | 404 | `*_NOT_FOUND` scoped au workspace |
| conflit métier | 409 | `*_INVALID_STATE`, `IDEMPOTENCY_CONFLICT`, `SUPPRESSED` |
| quota/policy | 409/422 | canal indisponible, action bloquée |
| provider transitoire | 502/503 | indisponible ou rate limited |
| résultat inconnu | 202/409 selon commande | réconciliation nécessaire, pas de retry aveugle |
| interne | 500 | `INTERNAL_ERROR`, sans secret ni payload personnel |

Les erreurs fonctionnelles terminales de documents incluent
`DOCUMENT_OCR_REQUIRED`, `DOCUMENT_ENCRYPTED_UNSUPPORTED`,
`DOCUMENT_CONTENT_LIMIT_EXCEEDED`, `DOCUMENT_FORMAT_INVALID` et
`DOCUMENT_TEXT_EMPTY`.

## 7. Compatibilité et changement

1. Ajouter avant de retirer.
2. Conserver une release de compatibilité lorsqu'une route ou un champ est
   renommé.
3. Refuser les propriétés inconnues sur les commandes sensibles.
4. Versionner les snapshots et payloads asynchrones indépendamment de l'URL.
5. Tester OpenAPI ↔ Zod ↔ handlers pour toute mutation de contrat.
6. Une route documentée mais absente du handler, ou inversement, est un échec
   de gouvernance documentaire.
7. Les anciennes routes UI peuvent rediriger ; les routes API ne changent pas
   silencieusement de sémantique.
