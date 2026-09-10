# Validation locale — 10 septembre 2026

## Livré dans cette tranche

Dix nouvelles capacités MCP : workspace_get_readiness, brand_get, brand_update, content_strategy_get, content_strategy_prepare, content_strategy_update, content_strategy_publish, acquisition_plan_list, acquisition_plan_get et campaign_update. Les outils existants restent disponibles. Le serveur fournit le parcours recommandé aux agents.

Les mutations réutilisent le registre transactionnel MCP, les rôles/scopes et les services de l’interface. La marque conserve les champs absents. Les stratégies utilisent leurs sources exactes et détectent les modifications concurrentes, y compris entre une génération différée et une édition humaine. La modification d’une campagne ne l’active pas.

## Preuve par un agent réel

Deux exécutions Codex avec gpt-5.6-luna, raisonnement low, ont utilisé le MCP local via OAuth. Le premier lancement utilisait par erreur le répertoire parent des identifiants et a échoué avant exécution ; le répertoire de la connexion configurée a ensuite été utilisé, sans changer de modèle.

1. Consigne française de lecture : Luna a choisi workspace_get_summary, workspace_get_readiness, brand_get, research_list, content_strategy_get, acquisition_plan_list et acquisition_plan_get. Il a retrouvé IgnitionAI, l’étude terminée et la stratégie Inbound ; il a distingué campagne active et messages effectivement envoyés.
2. Consigne française de modification dans un espace séparé : Luna a consulté le contexte, appelé brand_update, offer_create et offer_update, puis relu brand_get, offer_list et offer_get. La marque « Démo IgnitionAI » et l’offre « Conseil IA — validation MCP » sont persistées. Une première clé de commande mal formée a été refusée ; l’agent a corrigé le format UUID sans intervention. La documentation du schéma précise désormais ce format.
3. Vérification navigateur authentifiée : le champ Nom de marque affiche bien « Démo IgnitionAI » dans l’espace de validation.
4. Jetons d’accès et de renouvellement révoqués après les essais. Aucun envoi, publication sociale ou recherche supplémentaire lancé par les agents de validation.

Espace de démonstration local : /w/mcp-agent-5a57de29/settings/brand.

## Contrôles automatisés

- 1 083 tests unitaires et HTTP réussis (3 684 assertions).
- Sept tests PostgreSQL via SDK MCP réussis (35 assertions) : persistance, rejeu, refus de version périmée, sources étrangères, droits de lecture, reprise après perte de bail worker, édition pendant génération et double commande concurrente.
- Vérification TypeScript réussie.
- Revue Standards et Spec : deux problèmes de concurrence corrigés ; la revue de suivi a identifié l’ordre du contrôle de version et du rejeu, également corrigé et couvert par un test.

## Limites restantes — ne pas déclarer le parcours complet

Le scénario produit → étude → préparations Inbound ET Outbound entièrement exécuté par un agent reste à valider. Les essais réels ci-dessus couvrent lecture, marque et offre ; la génération Inbound et le lien campagne/offre sont testés avec PostgreSQL et un générateur contrôlé.

La préparation Outbound sans identifiants de configuration manuels, l’activation gouvernée et la suspension des campagnes restent dans les tickets 03 et 04. L’ancienne campagne active sans offerVersionId n’a pas été modifiée : campaign_update respecte le verrou métier des campagnes actives. Aucun déploiement ni validation d’un client hébergé distant ne découle de cette preuve locale.
