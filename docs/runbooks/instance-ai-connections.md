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
