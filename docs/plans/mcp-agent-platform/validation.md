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

## Activation gouvernée et essai réel de préparation

Commit local `3e3074e` : préparation native, activation approuvée, reçu transactionnel et programmation. Le reçu rejoué après suspension ne réactive pas la campagne. Une modification de stratégie après validation du worker est refusée par l’adaptateur sous verrou. La revue a fait corriger l’ordre des verrous évaluation/campagne.

Contrôles : 13 tests MCP/PostgreSQL, 84 assertions ; 1 083 tests unitaires/HTTP, 3 684 assertions ; TypeScript et architecture passent. Le runtime local a été redémarré après vérification de zéro job en cours et sert cette version. Aucun déploiement VPS découle de cette tranche.

L’essai Luna de préparation a retrouvé les sources et le plan réels. Son appel `content_strategy_prepare` a été annulé par le client (`user cancelled MCP tool call`) : cet essai ne prouve aucune nouvelle préparation. Le plan existant n’a qu’un canal exploitable, déjà associé à une campagne active ; Luna l’a laissée intacte. Le scénario complet Inbound + nouveau brouillon Outbound reste à prouver. Un nouvel essai avec revue automatique d’approbation est en cours, toujours sans activation ni envoi autorisés.

L’essai avec revue automatique a abouti à l’opération Inbound `18665c6e-4bda-4ff1-9b03-6949312f5b75`, job `55ae0c8f-c4fd-4f62-9293-5ca7f4d00494`, terminé en une tentative entre 19:43:06 et 19:43:27 UTC. Luna a suivi `operation_get` puis relu `content_strategy_get`. L’appel Outbound explicite a retourné `CAMPAIGN_OFFER_VERSION_CONFLICT` face à la campagne active historique sans liaison d’offre ; aucune nouvelle campagne n’est prouvée. Le résumé de Luna a altéré l’identifiant de l’étude et interprété à tort ce refus comme une offre non publiée. Les réponses outils restent la preuve ; les consignes MCP précisent désormais ces distinctions. Journaux : `/tmp/noosphere-agent-luna-preparation-reviewed-events.jsonl` et `/tmp/noosphere-agent-luna-preparation-reviewed-proof.log`. Les jetons de cet essai ont été révoqués par le script.

## Contrôles complets du commit 9bd55d1

- Suite d’intégration complète : 78 fichiers, 326 tests réussis, 2 803 assertions ; base dédiée `noosphere_agent_full_20260910_test`. Log `/tmp/noosphere-full-integration-check.log`.
- Architecture (620 fichiers TypeScript), quatre variantes Compose, prototype et compilation API/worker/extracteur : réussis.
- Crawler : 43 tests réussis.
- Compilation web production : réussie dans le checkout isolé `/tmp/noosphere-agent-validation-20260910`, après installation verrouillée des dépendances. Le premier essai avec un lien symbolique de dépendances a été refusé par Turbopack ; aucune modification de configuration produit pour le contourner.
- Tests navigateur : lancés dans ce checkout, ports 3390/3391 et base `noosphere_agent_full_20260910_e2e`. Résultat à confirmer.
- Essai Luna complet : étude `b72f87e9-3271-4723-ac0a-ef5bdacdef40` dans l’espace `mcp-agent-5a57de29`, lancée via MCP et brief manuel persisté. Étude encore en cours lors de cette entrée ; ne pas considérer les deux préparations comme acquises.

### Étude réelle et reprise Luna

L’étude `b72f87e9-3271-4723-ac0a-ef5bdacdef40` est terminée : 19:50:07 à 19:55:36 UTC, soit 5 min 29 s, sans reprise d’étape. Luna l’a relue via MCP et a retrouvé l’offre `26d249de-448b-5fcb-af14-cb3054d17c2e` et le brouillon Inbound `d53a5ac9-44ee-4a9d-94f9-2974b084d34c`. Le navigateur authentifié confirme le brouillon et l’autopilote en pause (`/tmp/noosphere-agent-full-inbound-proof.png`).

Le plan `c9af4577-54d0-4c67-a3fe-17be2b6401e4` est prêt, mais aucun canal recommandé : email/WhatsApp sans identité exploitable ; LinkedIn échoue faute de compte sélectionné dans cet espace. Aucune campagne créée. Choix du compte demandé à l’utilisateur ; ne pas copier une connexion d’un autre espace implicitement.

### Régression navigateur

Première suite : 47 réussis, 4 ignorés, 3 échecs. Deux échecs attendaient l’ancien libellé Inbound. Le troisième rechargeait la page après l’annonce de navigation, avant la fin de l’enregistrement de marque (trace : recharge à +33 ms, sauvegarde à +62 ms). Les alertes sont maintenant limitées au formulaire. Les pannes de génération/import sont injectées sur leurs requêtes navigateur, après sauvegarde via la vraie API ; ceci prouve la persistance face à ces pannes réseau, pas les erreurs internes d’un provider. Les deux scénarios de marque corrigés passent. La suite complète est relancée avec environnement provider isolé et fixture Codex contrôlée pour lever les quatre exclusions. Résultat final en attente (`/tmp/noosphere-full-e2e-final.log`).
