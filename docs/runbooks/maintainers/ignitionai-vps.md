# IgnitionAI maintainer deployment

This private runbook is intentionally separate from public self-hosting
defaults.

- Application host: `noosphere.ignitionai.fr`
- Checkout: `/srv/noosphere`
- Environment: `/srv/noosphere/.env` with mode `0600`
- Image defaults: `ghcr.io/ignitionai/noosphere-{backend,web,crawler}`
- Deployment profile: `production`
- Deployment mode: `registry`
- Backup mode: `restic`

```bash
APP_DIR=/srv/noosphere ENV_FILE=/srv/noosphere/.env bash deploy/doctor.sh
APP_DIR=/srv/noosphere ENV_FILE=/srv/noosphere/.env bash deploy/release.sh
```

Provider and infrastructure secrets remain outside Git. The public runbook in
`docs/runbooks/vps-production.md` is the authoritative release procedure; this
file records only IgnitionAI-specific coordinates.
