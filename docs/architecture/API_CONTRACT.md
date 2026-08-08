# Contrat API V1

## 1. Principes

- préfixe `/api/v1` ;
- sessions Better Auth pour l’interface web ;
- API keys futures pour les clients machine ;
- pagination par curseur ;
- erreurs au format Problem Details ;
- `Idempotency-Key` obligatoire pour les actions pouvant provoquer un envoi ;
- `workspace_id` dérivé de la session et du contexte de route, jamais du payload ;
- `x-workspace-slug` transporte le slug de la route et ne vaut accès qu’après
  validation du membership actif côté serveur ;
- actions métier explicites plutôt que modifications arbitraires de statut.

## 2. Ressources principales

| Méthode | Route | Usage | Rôle minimal |
|---|---|---|---|
| GET | `/workspaces` | lister les workspaces actifs de la session | utilisateur |
| POST | `/workspaces` | créer un workspace | utilisateur |
| POST | `/workspaces/:id/invitations` | inviter un membre | admin |
| PATCH | `/workspaces/:id/members/:userId` | changer un rôle | owner |
| GET/POST | `/offers` | lister/créer une offre | operator |
| POST | `/offers/:id/actions/publish` | publier une version immuable | admin |
| GET/POST | `/icps` | lister/créer un ICP | operator |
| POST | `/icps/:id/actions/publish` | publier une version immuable | admin |
| GET/POST | `/companies` | rechercher/créer une entreprise | operator |
| GET/POST | `/contacts` | rechercher/créer un contact | operator |
| POST | `/contacts/:id/actions/enrich` | lancer l’enrichissement | operator |
| POST | `/merge-candidates/:id/actions/approve` | fusionner | admin |
| POST | `/suppressions` | enregistrer un blocage | operator |
| GET/POST | `/sequences` | gérer les playbooks | operator |
| POST | `/sequences/:id/actions/publish` | figer une version | admin |
| GET/POST | `/campaigns` | gérer les campagnes | operator |
| POST | `/campaigns/:id/actions/discover` | reprise manuelle d’exception legacy | operator |
| POST | `/campaigns/:id/actions/pause` | suspendre | operator |
| GET | `/campaigns/:id/prospects` | examiner scores et preuves | viewer |
| GET | `/campaigns/:campaignId/conversations` | compteurs et projection des prospects engagés | viewer |
| GET | `/campaigns/:campaignId/conversations/:conversationId` | historique, décision K3, réponse et opportunité | viewer |
| GET/PATCH | `/campaigns/:campaignId/autopilot-policy` | lire ou configurer la politique avant planification | viewer/operator |
| POST | `/webhooks/unipile` | persister un événement entrant signé | Unipile |
| GET | `/opportunities` | lire le pipeline automatiquement alimenté | viewer |
| POST | `/opportunities/:id/actions/change-stage` | changer d’étape | operator |
| GET | `/analytics/campaigns` | performance campagne | viewer |
| GET | `/analytics/pipeline` | pipeline et revenu | viewer |
| GET/POST | `/connected-accounts` | comptes expéditeurs | admin |
| POST | `/connected-accounts/:id/actions/check` | vérifier la santé | admin |
| GET/PUT/DELETE | `/calendar-connection` | résoudre l’événement public ou valider une clé Cal.com chiffrée | admin |
| POST | `/product-research-runs` | créer une mission de recherche ICP | operator |
| POST | `/product-research-runs/:id/actions/start` | lancer la mission | operator |
| GET | `/product-research-runs/:id` | lire état, étapes et tentatives | viewer |
| GET | `/product-research-runs/:id/evidence` | paginer les preuves | viewer |
| POST | `/product-research-runs/:id/actions/pause` | suspendre la mission | operator |
| POST | `/product-research-runs/:id/actions/resume` | reprendre la mission | operator |
| POST | `/product-research-runs/:id/actions/research-more` | reprendre depuis une étape | operator |

## 3. Endpoints fournisseurs

| Méthode | Route | Contrat |
|---|---|---|
| POST | `/webhooks/unipile` | vérifier signature, persister, répondre 202 |
| POST | `/webhooks/calendar/:provider?connection=:id` | vérifier, persister et réconcilier l’événement |
| POST | `/webhooks/enrichment/:provider` | persister les résultats asynchrones |
| GET | `/health/live` | processus vivant, sans dépendances |
| GET | `/health/ready` | DB et dépendances critiques disponibles |

## 4. Erreurs métier stables

| Code | HTTP | Signification |
|---|---:|---|
| `WORKSPACE_FORBIDDEN` | 403 | membre absent ou rôle insuffisant |
| `VERSION_NOT_PUBLISHED` | 409 | version de travail utilisée |
| `CAMPAIGN_IMMUTABLE` | 409 | modification interdite après activation |
| `CAMPAIGN_AUTOPILOT_POLICY_LOCKED` | 409 | politique déjà engagée dans une planification |
| `CALCOM_AUTHENTICATION_FAILED` | 401/403 | clé Cal.com invalide ou révoquée |
| `CALCOM_EVENT_TYPE_NOT_FOUND` | 422 | le lien public ne correspond à aucun type d’événement du compte |
| `CALCOM_SLOT_UNAVAILABLE` | 409 | le créneau choisi n’est plus disponible |
| `CONTACT_ALREADY_ACTIVE` | 409 | autre séquence active |
| `APPROVAL_REQUIRED` | 409 | action non approuvée |
| `SUPPRESSED` | 409 | contact ou identité bloquée |
| `CHANNEL_UNAVAILABLE` | 422 | aucun canal/fallback valide |
| `PROVIDER_RATE_LIMITED` | 503 | exécution différée |
| `IDEMPOTENCY_CONFLICT` | 409 | même clé avec un payload différent |
| `AUTHENTICATION_REQUIRED` | 401 | session absente ou contexte invalide |
| `WORKSPACE_CONTEXT_REQUIRED` | 400 | slug de workspace absent ou mal formé |
| `PRODUCT_RESEARCH_RUN_NOT_FOUND` | 404 | mission absente du workspace courant |
| `PRODUCT_RESEARCH_INVALID_STATE` | 409 | transition de mission interdite |
| `INVALID_REQUEST` | 400 | corps, identifiant, curseur ou limite invalide |

Le contrat détaillé F-009 est versionné dans
`packages/contracts/openapi/product-research-v1.json`. Le rôle et le
`workspace_id` proviennent exclusivement de l’adaptateur de contexte
authentifié ; aucun endpoint n’accepte un workspace dans son payload.
