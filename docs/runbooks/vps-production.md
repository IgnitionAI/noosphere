# Déploiement VPS production

Le bundle production exécute l’application dans le même réseau Docker privé
que PostgreSQL, MinIO, SearXNG et le crawler. Seul Caddy expose les
ports 80/443.

## Préparer

```bash
cp deploy/.env.production.example .env
$EDITOR .env
```

Remplacer tous les placeholders. `PUBLIC_HOST`, `BETTER_AUTH_URL`,
`BETTER_AUTH_TRUSTED_ORIGINS` et `PUBLIC_WEBHOOK_BASE_URL` doivent utiliser le
même domaine HTTPS. Les IDs de comptes Unipile doivent correspondre à des
comptes sains, et `UNIPILE_WEBHOOK_SECRET` doit correspondre à la signature
configurée côté Unipile.

Le mot de passe PostgreSQL doit rester URL-safe, car il est injecté dans
`DATABASE_URL` par Compose. Conserver `.env` hors Git avec des permissions
`0600`.

## Lancer

```bash
chmod 600 .env
ENV_FILE=.env bash deploy/validate-production-env.sh
docker compose --env-file .env \
  -f compose.infrastructure.yml -f compose.production.yml \
  build
docker compose --env-file .env \
  -f compose.infrastructure.yml -f compose.production.yml \
  up -d database minio searxng crawler minio-init migrate api web worker decision-worker setter-worker memory-worker proxy
```

Si `AI_PROVIDER=codex-cli`, initialiser une fois le volume d'authentification
avant de démarrer les workers (puis relancer la commande `up -d` ci-dessus) :

```bash
docker compose --env-file .env \
  -f compose.infrastructure.yml -f compose.production.yml \
  --profile codex-auth run --rm codex-auth
```

Les workers `setter-worker` et `memory-worker` sont obligatoires pour les jobs
Setter durables et Prospect 360. Leur absence ne casse pas la page web, mais
laisse les jobs en file ; le healthcheck de déploiement doit donc vérifier leur
présence en plus de l'API et du web.

L’extraction documentaire est locale et automatique selon le MIME vérifié :
PDF texte, DOCX, PPTX, XLSX, HTML, Markdown et texte. Aucun service Docling ou
OCR n’est déployé. Un PDF image est conservé avec l’état `ocr_required` et ne
produit aucun chunk ni aucune preuve.

Avant le canary documentaire, mesurer le routeur local avec
`bun run benchmark:documents`. Le dernier relevé local versionné se trouve dans
`docs/performance/evidence/2026-08-24-structured-document-extraction-local.json`.
Rejouer exactement la même commande sur le VPS et conserver le résultat avant
d’augmenter la concurrence, qui reste fixée à une extraction par worker.

Puis vérifier :

```bash
bash deploy/healthcheck.sh
set -a; source .env; set +a
bash deploy/provider-readiness.sh
```

Les mises à jour suivantes peuvent utiliser le script non destructif :

```bash
APP_DIR=/srv/ignition-outbound bash deploy/release.sh
```

Il refuse un checkout modifié, synchronise `origin/dev` uniquement en
fast-forward, valide les variables avant le build et exécute le healthcheck
après redémarrage.

## Sauvegarder

Définir `BACKUP_DIR` sur un volume persistant et exécuter au minimum une fois
par jour :

```bash
bash deploy/backup.sh
```

Répliquer ensuite ce répertoire vers un stockage hors VPS et tester une
restauration PostgreSQL chaque mois. Les volumes Docker ne constituent pas une
sauvegarde.

## Canary Unipile

Avant toute campagne live, vérifier `GET /api/v1/accounts`, la santé du compte
LinkedIn et du compte WhatsApp, puis envoyer un seul message vers une
destination interne explicitement autorisée. Le canary doit confirmer
l'absence de `422 limit_exceeded`; sinon laisser les campagnes en dry-run et
corriger le quota fournisseur. Le script refuse tout envoi sans confirmation
explicite :

```bash
CANARY_CONFIRM=SEND_ONE_LIVE_CANARY \
CANARY_CHANNEL=whatsapp \
CANARY_ACCOUNT_ID="$UNIPILE_WHATSAPP_ACCOUNT_ID" \
CANARY_RECIPIENT=33600000000 \
CANARY_MESSAGE='Canary Ignition Outbound — merci de ne pas répondre.' \
bash deploy/unipile-canary.sh
```

Une réponse `422 limit_exceeded` arrête le script et interdit l’activation des
campagnes autonomes.
