# Self-host Noosphere on one VPS

Noosphere is a responsive HTTPS web application. One installation works from
desktop, tablet and mobile browsers. Caddy is the only public service and
automates TLS; PostgreSQL, MinIO, SearXNG, the crawler, TEI and workers remain
on a private Docker network.

```text
Internet :443 -> Caddy -> Next.js + Bun API -> private Docker network
                                         -> workers, ParadeDB, MinIO
                                         -> crawler, Qwen embedding, BGE reranker
```

You need a domain or subdomain whose DNS points to the VPS. It can be a
subdomain of a domain you already own; the application hostname and a future
marketing domain are independent.

## Choose a profile

| Profile | Intended use | Backups | Operational gates |
|---|---|---|---|
| `quickstart` | One light workspace or canary | Daily local PostgreSQL + MinIO snapshot | Health monitoring; explicit VPS-loss warning |
| `production` | Durable operation | Local snapshot plus encrypted Restic repository outside the VPS | Monitoring, daily backup timer and monthly restore drill |

Minimum accepted host: AMD64, 8 dedicated cores, 16 GiB RAM and NVMe. The
recommended production host has 12 dedicated cores and 32 GiB RAM. A GPU is
not required. TEI keeps Qwen and BGE resident in RAM, while intensive CPU use
occurs during indexing, hybrid search and reranking rather than continuously.

Use Ubuntu 24.04 LTS and install Docker Engine with the Compose v2 plugin.

## Choose an image mode

### Official public images

Clone the official repository and keep the detected `IMAGE_NAMESPACE=ignitionai`.
Public GHCR images can be downloaded without a Docker login. Pick an immutable
tag from the repository releases.

### Images produced by a fork

Fork the repository and enable GitHub Actions. A tag `vX.Y.Z` on a green `main`
commit publishes three images under the lowercase fork owner:

```text
ghcr.io/<owner>/noosphere-backend:vX.Y.Z
ghcr.io/<owner>/noosphere-web:vX.Y.Z
ghcr.io/<owner>/noosphere-crawler:vX.Y.Z
```

The workflow links each image to the fork, records OCI source/version/commit/
license labels, scans it, creates provenance and verifies it can be pulled.
Public repositories must expose their GHCR packages publicly for anonymous
installs. Private forks keep private packages and require:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
```

### Build locally on the VPS

Set `DEPLOY_MODE=local-build`. The release script builds and tags the backend,
web and crawler from the checked-out commit. This is slower and consumes more
disk, but does not require published application images.

## Configure without editing YAML

```bash
sudo install -d -m 755 /srv/noosphere
sudo chown "$USER" /srv/noosphere
git clone https://github.com/IgnitionAI/noosphere.git /srv/noosphere
cd /srv/noosphere
bash deploy/configure.sh
```

The configurator asks for the hostname, administrator, AI provider and profile,
detects the repository owner, generates secrets locally, writes `.env` with
mode `0600` and never overwrites an existing file without `--force`.

Non-interactive quickstart example:

```bash
bash deploy/configure.sh \
  --non-interactive \
  --profile quickstart \
  --mode registry \
  --version vX.Y.Z \
  --domain noosphere.example.com \
  --admin-email owner@example.com \
  --admin-name "Noosphere Owner"
```

For production, also pass `--restic-repository` and optionally
`--restic-password-file`. The script generates the password file when absent.
Environment templates remain available as
`deploy/.env.quickstart.example` and `deploy/.env.production.example`.

## Validate and deploy

Create the DNS A record before continuing, then run:

```bash
cd /srv/noosphere
ENV_FILE=.env bash deploy/doctor.sh
sudo SSH_ALLOWED_CIDR="203.0.113.10/32" bash deploy/harden-host.sh
```

Keep an SSH session open while applying the firewall. Only ports 80 and 443
are public; restrict SSH to the administrator IP or VPN.

If `AI_PROVIDER=codex-cli`, authenticate the persistent Codex volume once:

```bash
docker compose --env-file .env \
  -f compose.infrastructure.yml -f compose.production.yml \
  --profile codex-auth run --rm codex-auth
```

Deploy and install the timers:

```bash
APP_DIR=/srv/noosphere ENV_FILE=/srv/noosphere/.env bash deploy/release.sh
sudo APP_DIR=/srv/noosphere bash deploy/install-systemd.sh
```

The release validates the environment, pulls or builds images, records their
exact digests/IDs, creates a pre-release backup when an instance exists,
applies forward-only migrations, starts every service and checks the public
HTTPS UI. On failure it restores only the exact previous application images.
It never rewinds migrations and never changes or deletes volumes.

## Backups, updates and rollback

Quickstart runs daily local backups. They survive an application error but not
the loss of the VPS. Copy `/srv/noosphere/backups` to another machine or move
to the production profile.

Production requires an off-VPS Restic repository. Initialize it once:

```bash
set -a; source .env; set +a
restic init
ENV_FILE=.env bash deploy/backup.sh
ENV_FILE=.env bash deploy/verify-backup-restore.sh
```

To update, set a new immutable `APP_VERSION` and rerun `deploy/release.sh`.
The last successful release is stored in
`.deploy/last-successful-release.json` with exact image references, digests and
image IDs. Never use `docker compose down -v` on an installation you want to
keep.

Useful diagnostics:

```bash
ENV_FILE=.env bash deploy/healthcheck.sh
ENV_FILE=.env bash deploy/monitor.sh
docker compose --env-file .env \
  -f compose.infrastructure.yml -f compose.production.yml ps
systemctl list-timers 'noosphere-*'
```

## What a healthy installation does not prove

The UI can run without a connected acquisition channel, but it cannot prospect
through LinkedIn, email or WhatsApp until a supported provider account is
connected. It also needs a working `codex-cli`, Kimi Code or OpenAI route for
AI features. Provider credentials are optional at initial boot only when their
features remain disabled.

Noosphere is AGPL-3.0-only. If you modify it and make that modified version
available to users over a network, you must offer those users the corresponding
source as required by the AGPL.
