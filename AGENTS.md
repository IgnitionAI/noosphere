# Repository instructions

## Deployment invariants

- Target: self-hosted, single-VPS Docker Compose deployment on AMD64.
- Public ingress: Caddy only, on TCP ports 80 and 443.
- Deployment branch: `main`; registry releases use immutable semantic-version tags and OCI images.
- The operator supplies the application hostname. Public examples use `noosphere.example.com`.
- The production environment file is never committed and must use permission `0600`.
- Supported distribution modes are official/fork registry images and local VPS builds.
- Required gates before a release tag: `bun run check`, `bun run test:integration`, `bun run test:e2e`, dependency audits, Compose validation and image scans.
- Never publish PostgreSQL, MinIO, SearXNG, crawler or TEI ports in production.
- Never delete production volumes or roll back a database migration automatically.
- Rollback restores the exact recorded application images; migrations remain forward-only.
- `quickstart` permits local-only backups with an explicit durability warning.
- `production` requires encrypted off-site Restic backups, monitoring and restore drills.

Maintainer-specific infrastructure belongs in `docs/runbooks/maintainers/`, not in public defaults or release scripts.
