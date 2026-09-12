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

## Netcup canary

The panel inspected on 2026-09-12 identifies server `936076`, name
`v2202609415079516665`, IPv4 `62.83.8.34`, AMD64, 8 CPUs, 16 GiB RAM,
512 GiB disk. The OS and persistent data have not yet been audited over SSH.
The local default SSH keys were refused; no password reset was performed.
The intended application hostname has no A/AAAA answer at this observation.

Infrastructure inputs: `noosphere-netcup.tfvars.example` in this directory.
Review them before importing the server into
[`infra/terraform/netcup`](../../../infra/terraform/netcup/README.md).
Routine updates follow [versioned-updates.md](../versioned-updates.md):
`cd /srv/noosphere && sudo bash deploy/update.sh vX.Y.Z`.
