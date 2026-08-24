# Isolation multi-workspace du moteur agentique

Le tenant est le `workspace` existant. Les routes utilisent le slug de l’URL,
la session Better Auth et le membership actif pour produire un contexte
serveur. Aucun body navigateur ne peut sélectionner un workspace.

Toutes les décisions, jobs, approbations, actions, messages, observations et
événements portent `workspace_id`. Les nouvelles FKs de décision sont
composites `(workspace_id,id)` et les queries filtrent les deux dimensions.
Les clés d’idempotence sont uniques dans un workspace, ce qui permet la même
clé logique dans deux tenants sans collision.

Le test `durable-prospect-decisions.test.ts` crée deux workspaces avec la même
clé, prouve deux décisions distinctes et des leases tenant-scoped. Les suites
CRM, campagnes, approvals, webhooks et queue couvrent déjà lecture, mutation
et exécution inter-workspace. La queue alterne les rangs de workspaces avant de
considérer la priorité locale.
