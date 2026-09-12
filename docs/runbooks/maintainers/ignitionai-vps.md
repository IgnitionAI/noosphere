# IgnitionAI maintainer deployment

This private runbook is intentionally separate from public self-hosting
defaults.

- Current canary host: `noosphere.62-83-8-34.sslip.io`
- Future custom hostname: operator decision, not yet configured
- Checkout: `/srv/noosphere`
- Environment: `/srv/noosphere/.env` with mode `0600`
- Image defaults: `ghcr.io/ignitionai/noosphere-{backend,web,crawler}`
- Current deployment profile: `quickstart` (canary)
- Deployment mode: `registry`
- Current backup mode: `local`; production requires encrypted off-site Restic

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
512 GiB disk. SSH access with the dedicated deployment key is verified.
The host runs Debian 13.6, Docker Engine 29.8.0 and Compose 5.5.1.

The first canary, `v0.1.0-rc.1` (`a7abdf7`), is online at the current HTTPS
hostname. Browser administrator login and a real structured Luna probe passed.
The external MCP SDK listed 62 tools, passed tenant/scope/revocation checks,
and replayed a contact write with one persisted operation and audit row.
The instance uses `gpt-5.6-luna`, reasoning `low`, with no fallback.

A PostgreSQL dump was restored into a separate database created with
`createdb -T template0`; the default ParadeDB template already contains schemas
and must not be used for a clean restore. A MinIO object was backed up and
restored under a separate key. Workspace data, AI authentication and object
content survived application/database/storage service restarts.

This remains a canary: local archives do not survive total VPS loss. The
scheduled archive verification is not an application recovery drill. LinkedIn
and email delivery were not exercised; no external test recipient was approved.
Hermes and its campaigns are outside this deployment's scope.

Infrastructure inputs: `noosphere-netcup.tfvars.example` in this directory.
Review them before importing the server into
[`infra/terraform/netcup`](../../../infra/terraform/netcup/README.md).
Routine updates follow [versioned-updates.md](../versioned-updates.md):
`cd /srv/noosphere && sudo bash deploy/update.sh vX.Y.Z`.
