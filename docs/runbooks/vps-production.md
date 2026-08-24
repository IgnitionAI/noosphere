# Déploiement privé sur VPS

Noosphere est une application web responsive. Une seule instance HTTPS est
utilisable depuis un ordinateur, une tablette ou un téléphone ; aucune
application mobile native n'est nécessaire. Le proxy public retenu est
**Caddy**, car il automatise l'émission et le renouvellement TLS tout en gardant
une configuration plus courte et moins fragile qu'un assemblage Nginx +
Certbot.

Le domaine marketing futur est indépendant. Pour l'instance privée, il suffit
d'utiliser un sous-domaine du domaine déjà détenu, par exemple
`noosphere.ignitionai.fr`. Créer un sous-domaine ne nécessite aucun nouvel achat.

## Architecture exposée

```text
Internet
   │ HTTPS 443
   ▼
Caddy
   ├── Next.js web
   └── API Bun
        └── réseau Docker privé
            ├── workers durables
            ├── PostgreSQL / ParadeDB
            ├── MinIO
            ├── SearXNG + crawler
            └── TEI Qwen + reranker BGE
```

Seuls `80/tcp` et `443/tcp` sont publiés par Docker. PostgreSQL, MinIO, leurs
consoles, le crawler, SearXNG et TEI ne publient aucun port en production. SSH
est limité à l'adresse IP ou au VPN de l'administrateur. Le script de
durcissement ajoute aussi une règle `DOCKER-USER`, car les redirections de ports
Docker peuvent contourner des règles UFW seules.

## Dimensionnement

- **Usage léger, un workspace : RS 2000 G12** — 8 cœurs dédiés, 16 Gio de RAM,
  512 Gio NVMe. C'est le minimum acceptable pour un canary ou un workspace peu
  chargé. Éviter de lancer simultanément une réindexation complète, un crawl
  profond et plusieurs campagnes.
- **Production recommandée : RS 4000 G12** — 12 cœurs dédiés, 32 Gio de RAM,
  1 Tio NVMe. Cette marge absorbe les deux modèles TEI résidents, Chromium,
  ParadeDB, les workers et les pics d'extraction documentaire.

Utiliser Ubuntu 24.04 LTS x86_64/AMD64 et du NVMe. Aucun GPU n'est requis. TEI
garde Qwen et BGE en mémoire pour supprimer les démarrages à froid, mais ne
consomme du CPU intensivement que lors d'une indexation, d'une recherche
hybride ou d'un reranking.

## 1. Préparer le DNS et le serveur

Dans la zone DNS de `ignitionai.fr`, ajouter :

```text
Type A     noosphere     <IPv4 publique du VPS>
Type AAAA  noosphere     <IPv6 du VPS, uniquement si elle est configurée>
```

Ne pas créer un enregistrement AAAA si l'IPv6 n'est pas correctement routée.
Attendre que `dig +short noosphere.ignitionai.fr` retourne l'adresse du VPS
avant de démarrer Caddy.

Installer Docker Engine et le plugin Compose depuis le dépôt officiel Docker,
puis cloner le dépôt dans `/srv/noosphere`. Le script suivant installe les
outils d'exploitation et ferme le réseau public :

```bash
cd /srv/noosphere
sudo SSH_ALLOWED_CIDR="203.0.113.10/32" bash deploy/harden-host.sh
```

Conserver une session SSH ouverte pendant la première application du pare-feu.

## 2. Préparer les secrets

```bash
cd /srv/noosphere
cp deploy/.env.production.example .env
chmod 600 .env
$EDITOR .env
```

Règles importantes :

- `PUBLIC_HOST`, `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS` et
  `PUBLIC_WEBHOOK_BASE_URL` utilisent tous `noosphere.ignitionai.fr` ;
- `BETTER_AUTH_ALLOW_SIGN_UP=false` garde l'instance privée ;
- `APP_VERSION` est un tag immuable `vX.Y.Z` publié dans GHCR ;
- les secrets PostgreSQL, Better Auth, MinIO, crawler et Restic sont uniques ;
- activer `UNIPILE_ENABLED=true` seulement lorsque DSN, clé API et secret de
  webhook sont remplis ; les IDs de comptes peuvent ensuite être choisis dans
  l'interface ;
- activer `CALENDAR_ENABLED=true` seulement avec sa clé de signature ;
- `BACKUP_DIR` et `RESTIC_PASSWORD_FILE` sont des chemins absolus hors Git.

Créer le secret Restic, puis initialiser une fois le dépôt chiffré hors VPS :

```bash
sudo install -d -m 700 /root/.config/noosphere /srv/noosphere/backups
openssl rand -base64 48 | sudo tee /root/.config/noosphere/restic-password >/dev/null
sudo chmod 600 /root/.config/noosphere/restic-password
set -a; source .env; set +a
restic init
ENV_FILE=.env bash deploy/validate-production-env.sh
```

Pour un registre GHCR privé, se connecter une seule fois avec un token ayant
`read:packages` :

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
```

## 3. Publier une release immuable

Chaque release vient d'un commit de `main` dont le workflow `Check` est vert :

```bash
git checkout main
git pull --ff-only origin main
git tag v0.1.0
git push origin v0.1.0
```

Le workflow `Release images` construit, scanne puis publie les images AMD64
backend, web et crawler avec ce tag. Attendre sa réussite avant de continuer.
Le VPS ne compile pas l'application et ne déploie jamais `latest`.

Si `AI_PROVIDER=codex-cli`, authentifier une fois le volume Codex avant la
première release :

```bash
docker compose --env-file .env \
  -f compose.infrastructure.yml -f compose.production.yml \
  --profile codex-auth run --rm codex-auth
```

Puis lancer :

```bash
APP_DIR=/srv/noosphere ENV_FILE=/srv/noosphere/.env bash deploy/release.sh
```

La release :

1. valide les secrets et la syntaxe Compose ;
2. télécharge les images taggées ;
3. sauvegarde l'instance existante ;
4. démarre l'infrastructure privée ;
5. applique les migrations ;
6. démarre API, web et tous les workers ;
7. vérifie le HTTPS public ;
8. restaure les images applicatives précédentes si le démarrage échoue.

Les migrations sont forward-only : le rollback restaure les images, pas le
schéma. Une migration destructive nécessite donc une procédure dédiée.

## 4. Automatiser sauvegarde et supervision

```bash
sudo APP_DIR=/srv/noosphere bash deploy/install-systemd.sh
sudo systemctl start noosphere-backup.service
sudo systemctl start noosphere-restore-drill.service
systemctl list-timers 'noosphere-*'
```

Les timers exécutent :

- un dump PostgreSQL et un miroir MinIO chaque nuit ;
- une sauvegarde Restic chiffrée hors VPS avec rétention 7 quotidiennes,
  4 hebdomadaires et 6 mensuelles ;
- un contrôle de santé toutes les cinq minutes ;
- un exercice mensuel de restauration de la dernière archive.

`ALERT_WEBHOOK_URL` peut pointer vers un webhook Slack/Discord compatible avec
un corps `{ "text": "..." }`. Une sauvegarde stockée uniquement sur le VPS ne
compte pas comme sauvegarde.

Commandes de diagnostic :

```bash
ENV_FILE=.env bash deploy/healthcheck.sh
ENV_FILE=.env bash deploy/monitor.sh
docker compose --env-file .env \
  -f compose.infrastructure.yml -f compose.production.yml ps
journalctl -u noosphere-monitor.service -n 100 --no-pager
```

## 5. Canary avant autonomie

Valider depuis le navigateur desktop puis mobile : connexion, étude ICP,
upload d'un document, retour sur un job après changement de page, inbox et
export workspace. Vérifier ensuite les comptes fournisseurs :

```bash
set -a; source .env; set +a
bash deploy/provider-readiness.sh
```

Tout envoi réel reste borné à une destination interne explicitement autorisée
pendant le canary. Une erreur provider, un compte non sain ou un quota atteint
maintient les campagnes en pause/dry-run. Le script `deploy/unipile-canary.sh`
exige une confirmation explicite avant son unique envoi.

## Mise à jour et incident

Pour mettre à jour, pousser un nouveau tag immuable, modifier `APP_VERSION`
dans `.env`, puis relancer `deploy/release.sh`. Ne jamais modifier les volumes
avec `docker compose down -v` en production.

En cas d'incident : conserver les conteneurs et journaux, exécuter le
healthcheck, vérifier l'espace disque, les jobs échoués et la dernière
sauvegarde. Restaurer les données uniquement après avoir validé l'archive avec
`deploy/verify-backup-restore.sh`.
