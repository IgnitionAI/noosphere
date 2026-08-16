# Déploiement VPS production

Le bundle production exécute l’application dans le même réseau Docker privé
que PostgreSQL, MinIO, SearXNG, le crawler et Docling. Seul Caddy expose les
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
docker compose --env-file .env \
  -f compose.infrastructure.yml -f compose.production.yml \
  build
docker compose --env-file .env \
  -f compose.infrastructure.yml -f compose.production.yml \
  up -d database minio searxng crawler docling minio-init migrate api web worker decision-worker proxy
```

Puis vérifier :

```bash
bash deploy/healthcheck.sh
```

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
corriger le quota fournisseur.
