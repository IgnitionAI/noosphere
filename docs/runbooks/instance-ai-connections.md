# Connexions IA de l’instance

Le compte initial désigné par le bootstrap administre les connexions partagées dans `/setup` ou `/settings/instance/ai`. Posséder un workspace ne donne pas accès aux clés.

## Chiffrement et sauvegarde

`APP_ENCRYPTION_KEY` protège les clés fournisseurs au repos avec AES-256-GCM. Configurez une valeur secrète aléatoire stable, identique pour l’API et tous les workers. Le fichier d’environnement de production doit rester hors Git et avoir le mode `0600`.

Conservez cette valeur séparément dans votre gestionnaire de secrets et dans le dispositif de sauvegarde chiffrée de l’installation. Sauvegarder la base seule ne suffit pas : après restauration, fournissez la même `APP_ENCRYPTION_KEY` à l’API et aux workers avant de les démarrer. Une nouvelle valeur ne déchiffre pas les anciennes connexions. Ne remplacez donc pas cette clé lors d’une recréation de conteneur ou d’un déploiement.

Pour une restauration, restaurez la base et ses migrations, rétablissez le secret d’origine, puis vérifiez les connexions depuis le setup. Un changement volontaire du secret nécessite une migration de chiffrement dédiée ou la ressaisie des clés fournisseurs ; changer seulement la variable ne constitue pas une rotation valide.

## Enregistrement et test

Enregistrer une clé ne rend aucun modèle prêt. Autorisez les identifiants voulus puis testez chaque modèle. Le test effectue un appel court à l’API fournisseur, facturé selon le compte connecté. Il vérifie la sortie structurée par appel de fonction et les réglages de raisonnement utilisés par Noosphere. Un modèle refusant ce contrat reste indisponible.

Chaque résultat concerne un modèle et une version de connexion. Modifier la clé ou la liste de modèles invalide les preuves. Un résultat arrivé après une modification est ignoré. Un défaut invalidé bloque les nouvelles générations : il ne déclenche pas de bascule silencieuse vers les clés de l’environnement.

Choisissez explicitement un modèle testé comme défaut. Les nouveaux workspaces l’utilisent ; les workers lisent la configuration en base sans modification de leurs variables de fournisseur. Les clés restent masquées et ne sont pas renvoyées par les API de lecture.

Les tests de développement utilisent un fournisseur HTTP contrôlé. Ils ne constituent pas une preuve d’appel OpenAI externe ; celle-ci doit être rapportée séparément.

Référence du contrat HTTP : [OpenAI Responses](https://platform.openai.com/docs/api-reference/responses).

L’adaptateur OpenAI utilise Responses avec `store: false`. Le test et les missions envoient le même contrat de fonction et l’effort de raisonnement sélectionné ; certains modèles récents refusent cette combinaison sur Chat Completions.

## Other API-key providers

The setup also accepts Anthropic and OpenRouter keys and an OpenAI-compatible endpoint. Each model requires a successful structured invocation before selection; changing a connection invalidates its model proofs. A connection's provider cannot be changed in place: create a separate connection to avoid sending a retained key to a different provider.

Anthropic uses Messages with `output_config.effort` and an actual `tool_use` result; OpenRouter and compatible endpoints use Chat Completions function calls. OpenRouter requires the requested parameters and disables provider routing fallback. A successful models listing or plain-text answer does not mark a model ready. Protocol support varies by model; a rejected effort or function contract fails the test explicitly.

Compatible destinations must use public HTTPS on port 443, without URL credentials, query parameters or fragments. Every invocation resolves the hostname, rejects any private/special-purpose address (including mixed public/private DNS), then pins the validated address to a fresh TLS connection while retaining hostname certificate verification. Redirects are not followed. Private Docker services, local inference endpoints and metadata addresses are intentionally not admitted by this public-endpoint connection type. An untested URL can be saved; network admission is enforced before sending its key and again for every mission call. The response body is limited to 16 MiB.

Protocol references: [Anthropic effort](https://platform.claude.com/docs/en/build-with-claude/effort), [Anthropic tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools), [OpenRouter tool calling](https://openrouter.ai/docs/guides/features/tool-calling).

## Kimi and Codex via ChatGPT

Kimi uses the API-key workflow against its fixed coding endpoint. The connection probe limits output to 1,024 tokens; worker calls retain the existing Kimi adapter behavior. Existing environment Kimi and Codex routes remain usable until explicitly replaced by an instance default or workspace selection.

Codex uses a ChatGPT service account, never an OpenAI API key. Create a Codex connection and authorize model IDs in the setup. In local development, set `INSTANCE_CODEX_HOME` to the same absolute directory outside the repository for the API and workers, and install Codex CLI 0.147.0 for the host architecture. This is a new dedicated root; the application never falls back to the operator's personal `CODEX_HOME`.

Run `bun run instance:codex:login <connection-id>` from the local application checkout with its normal database environment. Follow the device-auth URL/code printed by Codex. For the Compose deployment, run the following inside the API container (using the operator's normal Compose files/environment): `bun dist/codex-login/instance-codex-login.js <connection-id>`. The AMD64 backend image includes the same CLI version and the script. Compose supplies the private `instance-codex-home` volume to the API and every worker, separate from the legacy `codex-service-home` volume.

Each connection uses a UUID subdirectory (0700). A login attempt writes credentials in its own private staging directory; only the current database session can atomically publish `auth.json` (0600). Tests and new routed invocations remain blocked during login. A fresh invocation of the login command supersedes an abandoned device flow; the old attempt cannot overwrite the new credentials. Login success or failure leaves models untested, so the administrator must explicitly test again. Login does not start a model call or a research mission.

The setup reports required action, a missing service-root configuration, a connection in progress, a connected account and an authentication failure requiring renewal. A connected account is distinct from a validated model. Use the same login command to renew, then retest. Treat the service volume as sensitive credential storage: do not commit or expose it, and use encrypted backups if retaining it off-host. A restored database without this volume requires ChatGPT login again.

Managed Codex executions have an isolated HOME/CODEX_HOME, an empty temporary working directory, ignored user config/rules, disabled project-document loading, and disabled shell, plugin, app, browser, computer, image-generation, memory and multi-agent features. Legacy explicitly configured Codex service routes retain their existing behavior. ChatGPT tokens are never returned by the application API.
