# Validation du setup IA d’instance — 9 septembre 2026

Périmètre : tickets #87–#93, parent #86. Implémentation locale sur `feat/instance-ai-setup`, depuis `18207a6`. Aucun déploiement, push, tag ou fermeture des tickets. Les services et données du checkout principal sont conservés.

## Comportements et preuves

| Exigence | Preuve | Limite |
| --- | --- | --- |
| Administrateur initial désigné, attribution idempotente | `instance-setup` et `instance-ai-upgrade` : ancienne base réellement migrée, deux utilisateurs, aucune promotion arbitraire | Bases jetables |
| Setup avant workspace, exploration sans IA, configuration ultérieure | E2E `instance-setup`, `instance-ai-connections` | Fournisseurs contrôlés |
| Héritage, personnalisation et choix figés à la création des tâches | `workspace-instance-models`, `task-ai-policy`, E2E correspondants | Pas de preuve de fournisseur réel |
| Panne, secours explicite, pause durable et reprise | `ai-mission-resume`, `ai-fanout-resume`, `paused-ai-jobs`, E2E console/recherche | Redémarrage des composants testé localement |
| Conservation des anciens modèles et données | Migration réelle depuis le journal historique, `legacy-ai-task-migration`, `legacy-ai-settings` desktop/mobile | Un ancien choix absent de tout stockage ne peut pas être reconstruit ; capture des choix disponibles au premier démarrage |
| Remplacement explicite des anciens tiers | UI avec case dédiée ; sauvegarde ordinaire conserve les tiers, remplacement demandé les retire | Les tâches déjà lancées gardent leur snapshot |
| Secrets chiffrés, sauvegarde et restauration | `scripts/verify-instance-ai-backup.ts` : pg_dump/pg_restore réels, clé restaurée déchiffre, mauvaise clé rejetée, deux fichiers auth restaurés en 0600 | Secrets factices, conteneur de restauration local arm64, aucun appel fournisseur |
| Installation Compose AMD64 sans IA | `scripts/verify-instance-ai-compose.ts` : migration, API/web/worker, Caddy, connexion admin, workspace créé, génération refusée avec `AI_SETUP_REQUIRED` | PostgreSQL local partagé comme serveur, base unique ; autres services d’infrastructure non exercés, ingress HTTP loopback |
| Ports et migrations de production | Validation de la composition de production et contrôles self-hosting ; migrations append-only | Pas de déploiement VPS |

Le canary Compose a détecté un vrai défaut : la simple présence de `CODEX_SERVICE_HOME` activait l’IA malgré un volume vide. La disponibilité vérifie maintenant un fichier d’authentification exploitable dans le seul répertoire de service explicitement désigné. Test reproduit rouge avant correction puis vert ; aucun recours au compte Codex personnel. La présence de credentials ne remplace pas une vérification live de leur validité.

## Résultats des vérifications

- Suite navigateur complète : **44 réussites, zéro échec et zéro test ignoré**, desktop/mobile, avec fixture Codex contrôlée. Log local `/tmp/noosphere-93-full-e2e-fixed.log`.
- Migration réelle + contrats de schéma : **6 réussites, 37 assertions** ; conservation des réglages/capture des tâches : **6 réussites, 91 assertions**.
- Dernières régressions disponibilité/reprise/modèles : **13 réussites, 28 assertions**.
- Types, prototype, architecture, self-hosting, builds backend/web passent ; crawler : **43 réussites**.
- `bun run check` atteint **1044 réussites et un échec préexistant** dans le test MCP `prepares authoritative conversation/content/meeting snapshots without execution artifacts`. Le même défaut a été reproduit sur la base. La commande s’arrête avant crawler/builds, exécutés séparément.
- Dernière répétition unitaires/HTTP après le correctif Compose : **1045 réussites, le même unique échec MCP préexistant**, 3541 assertions ; `/tmp/noosphere-93-unit-http-final.log`.
- Intégration complète : **278 réussites, 19 ignorés, 7 échecs** lors de l’exécution globale. Six échecs reproduits sur `18207a6` : deux analytics datés, un snapshot d’effet externe périmé, trois scénarios de contenu avec anciennes fixtures. Le septième venait d’un test exigeant l’ancienne migration en dernière position ; il est corrigé et sa suite ciblée passe. Pas de nouvelle exécution globale revendiquée après cette correction.
- Relectures Standards et Spec effectuées sur les changements du dernier ticket ; aucun défaut bloquant supplémentaire identifié dans le périmètre relu.

Images AMD64 locales validées :

- web `noosphere-ai-validation-web:93`, index `sha256:211011944ebb4533e0f183d7c16feb840ed800ac975f7a6ef3b66f427ad57153` ; Node x64, Next 16.3.3, Sharp 0.35.4.
- backend final `noosphere-ai-validation-backend:93`, index `sha256:abbdf88fe5bc33ca3e6dcfe18930c57bfe87f062247e779d67657aaa5d20cd74` ; Codex CLI 0.147.0 ; image utilisée par le canary final.

Les scripts de preuve créent leurs propres bases et fichiers privés. Ils conservent les volumes Compose et ne touchent pas aux volumes de production. Le canary final a terminé avec succès ; ses conteneurs sont arrêtés. Les fichiers de preuve temporaires restent locaux.

## Sécurité et frontière de livraison

Next et Sharp ont été corrigés vers 16.3.3 et 0.35.4, avec installation figée et nouvelle suite navigateur. L’audit Bun conserve deux dépendances transitives modérées (esbuild, uuid). L’audit Python signale nltk 3.10.3 / PYSEC-2026-3740 sans version corrigée indiquée.

Trivy a scanné les archives AMD64 exactes : web **56 occurrences haute/critique** (52/4), backend final **265** (254/11), aucune version corrigée indiquée dans ces résultats. Ces occurrences de paquets ne sont pas des vulnérabilités uniques. Rapports locaux : `/tmp/noosphere-93-scans/web.json` et `/tmp/noosphere-93-scans/backend-final.json`.

**Le gate de release n’est pas vert** : les échecs globaux préexistants et les résultats d’audit restent ouverts. Cette livraison est une implémentation locale vérifiée, pas une validation de production. Les tests contrôlés d’OpenAI, Anthropic, OpenRouter, endpoints compatibles, Kimi et Codex/ChatGPT ne prouvent pas leur fonctionnement live avec des comptes réels. Aucun appel fournisseur payant ni authentification personnelle n’est revendiqué ici.
