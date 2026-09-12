# Versioned VPS updates

The delivery path is **feature PR → dev → main → vX.Y.Z images → VPS**.
Both branches require the `bun run check` CI status and a PR. `dev` is never the
VPS's deployment source. Code is promoted to `main` only after the combined
change passes checks. Release images are built for AMD64, scanned, and published
with version/commit tags and immutable digests. Never reuse a version tag.

## First installation

1. Adopt the existing VPS with [Terraform](../../infra/terraform/netcup/README.md).
2. Audit its OS, disk, services and backups. Follow the
   [production runbook](vps-production.md) for Docker, Caddy and host hardening.
3. Use a dedicated clone at `/srv/noosphere`, not a developer's dirty checkout.
   Configure `/srv/noosphere/.env` privately with mode 0600. Configure the instance
   administrator, off-site Restic, monitoring and restore drills.
4. After the release's checks and image scans succeed, install that exact tag.
   `deploy/update.sh` can fetch and install the first tagged release from the
   dedicated clone as soon as it contains this script.

Application data stays in named Docker volumes. Credentials stay in the private
`.env` and service volume, never in Terraform state. Keep the same Compose project
and persistent volumes across upgrades; never run `docker compose down -v`.

## Update command on the VPS

```bash
cd /srv/noosphere
sudo bash deploy/update.sh vX.Y.Z
```

This command:

- Refuses a checkout with tracked or untracked local changes and serializes
  updates with a private lock directory.
- Fetches the exact tag and `main`, then rejects a tag outside `origin/main`.
- Checks out the release's Compose files, migration runner and deployment scripts.
- Runs the existing release procedure: environment validation, exact application
  image resolution, backup before an upgrade, migrations and health checks.
- Records exact image identities and saves the successful version in `.env`
  without regenerating secrets. A failed release returns failure and restores
  the previous code checkout; the release runner reports image rollback status.

A tag alone is not scan/CI proof. Before invoking this command, verify the Check
workflow and all Release images jobs are green for that exact commit/tag. A pull
failure must be fixed before migration; do not substitute `latest` or `dev`.
The version updater refuses nonempty `BACKEND_IMAGE`, `WEB_IMAGE` or
`CRAWLER_IMAGE` overrides so an old digest cannot masquerade as a new version.
Use the existing explicit-image release procedure for custom digest deployments.
Source checkouts on the VPS are deliberately detached at the installed tag. Do
not run `git pull` or edit tracked deployment files there; change them through a
PR and ship another version.

`APP_DIR`, `ENV_FILE` and `RELEASE_STATE_DIR` may override the standard paths,
using absolute paths. Terraform applies and application updates are separate:
routine code upgrades do not touch the Netcup account or require a Netcup token.

## Failure and recovery

The release runner restores recorded exact application images when a distinct
prior successful release exists. Database migrations are forward-only; image
rollback does not guarantee an older application is compatible with a new schema.
Review migration compatibility before shipping. The first installation has no
previous image set to restore. Inspect the exit status and logs; never label a
failed rollback successful. Keep backups and the release manifest for recovery.

Metadata writes are staged with recovery copies; an ordinary write failure
restores the prior environment and release record. This is not a multi-file
transaction across power loss. After a host crash, reconcile the recorded
manifest, running image digests and environment before resuming an update.

A terminated process may leave `.deploy/update.lock`. Check that no update or
release process is running before removing that empty lock with `rmdir`.
Do not run `deploy/release.sh` concurrently with the updater. If the connection
may disconnect, run the operation in an operator-controlled persistent terminal.

After each canary update verify HTTPS, authenticated UI, MCP OAuth/tools, worker
progress and data persistence. Follow the production runbook's backup/restore
and restart drills. Real provider tests require a healthy selected account and
an explicitly authorized test recipient; no live send is implied by deployment.
