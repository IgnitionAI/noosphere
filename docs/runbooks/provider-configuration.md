# Configuration des providers du moteur agentique

Noosphere sépare les authentifications serveur du choix fait dans l’interface.
La page `Configuration > Modèles IA` peut ensuite appliquer Kimi ou Codex à
tous les usages, ou choisir une route différente pour chaque usage.

## Kimi

- `KIMI_CODE_API_KEY` reste dans le secret store, jamais en base ;
- `KIMI_CODE_BASE_URL=https://api.kimi.com/coding/v1` ;
- le catalogue est découvert via `/models` ;
- `AI_PROVIDER=kimi-code` conserve Kimi comme route initiale du workspace.

## Codex

Le backend contient une version épinglée de Codex CLI. Son authentification est
isolée dans le volume Docker `codex-service-home`, commun à l’API et aux
workers mais absent du web et du dépôt.

Initialiser ou renouveler la session :

```bash
docker compose -f compose.infrastructure.yml -f compose.production.yml \
  --profile codex-auth run --rm codex-auth
```

Puis vérifier dans `Configuration > Modèles IA` que Codex est marqué `Prêt`.
Pour un déploiement Codex-only :

```text
AI_PROVIDER=codex-cli
CODEX_DEFAULT_MODEL=gpt-5.6-luna
CODEX_DEFAULT_REASONING_EFFORT=xhigh
```

Le runtime lance chaque appel avec un répertoire temporaire vide, en mode
éphémère, read-only, sans règles, configuration utilisateur, MCP ni accès aux
secrets applicatifs. L’abonnement Codex possède tout de même des limites : il
n’est jamais présenté comme illimité.

Les embeddings documentaires n'utilisent aucun provider IA distant. Le worker
appelle le service privé TEI gRPC avec Qwen3 Embedding 0.6B en 1 024 dimensions,
puis ParadeDB combine BM25 et pgvector. Un second TEI privé exécute le reranker
BGE. Les identités des modèles de référence et des artefacts ONNX INT8 sont
épinglées et vérifiées par l'appel gRPC `Info`.

Les envois exigent `UNIPILE_DSN`, `UNIPILE_API_KEY` et un compte sain du
workspace. Les webhooks doivent viser la route Unipile publique et porter la
signature configurée. Le crawler, SearXNG, PostgreSQL et le stockage
S3-compatible restent privés au réseau Docker. L’extraction PDF et Office est
locale, isolée dans un processus Bun transitoire et choisie automatiquement
selon le MIME vérifié. Aucun service d’OCR ou Docling n’est requis.

Tester d’abord en dry-run. Aucun test automatisé du dépôt ne lit les secrets
de production ou n’appelle un vrai provider d’envoi.
