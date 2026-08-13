# Configuration des providers du moteur agentique

Le worker de décisions réutilise la configuration IA existante :

- `AI_PROVIDER=kimi-code`;
- `KIMI_CODE_API_KEY` dans le secret store, jamais en base;
- `KIMI_CODE_BASE_URL=https://api.kimi.com/coding/v1`;
- `KIMI_RESEARCH_MODELS=k3,k3-256k` dans l’ordre autorisé;
- `PROSPECT_DECISION_MODEL=k3` optionnel;
- `OPENAI_API_KEY` et `OPENAI_EMBEDDING_MODEL` uniquement pour les embeddings.

Les envois exigent `UNIPILE_DSN`, `UNIPILE_API_KEY` et un compte sain du
workspace. Les webhooks doivent viser la route Unipile publique et porter la
signature configurée. Le crawler, SearXNG, Docling, PostgreSQL et le stockage
S3-compatible restent privés au réseau Docker.

Tester d’abord en dry-run. Aucun test automatisé du dépôt ne lit les secrets
de production ou n’appelle un vrai provider d’envoi.
