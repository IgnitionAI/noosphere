# Noosphere

**Open-source growth intelligence: discover the right market, run outbound, publish inbound content, and turn conversations into calls.**

[Documentation française](README.fr.md) · [English documentation](README.en.md) · [Architecture](docs/architecture/ARCHITECTURE.md) · [Self-hosting](docs/runbooks/vps-production.md) · [Required subscriptions](docs/runbooks/required-subscriptions.md)

Noosphere brings the GTM loop into one multi-workspace application:

```mermaid
flowchart LR
  O[Product and offer] --> I[ICP research]
  I --> C[Outbound campaigns]
  O --> P[Inbound content]
  C --> M[LinkedIn, email and WhatsApp conversations]
  P --> M
  M --> R[Qualified calls]
  R --> L[Durable learning]
  L --> I
  L --> P
```

The normal experience stays intentionally simple:

1. launch an ICP study;
2. let campaigns and LinkedIn content run within deterministic policies;
3. answer from the unified inbox and collect calls.

The AI never owns provider state. PostgreSQL, durable jobs, leases, idempotency keys and outbox events remain authoritative. Closing a page or drawer stops browser polling only; it does not cancel the work.

## Quick start

Requirements: Bun 1.3+, Docker with Compose, and `uv` for crawler development.

```bash
cp .env.example .env
bun install
bun run dev:setup
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Self-hosting

The same responsive UI can be hosted privately behind Caddy and used from a
phone or desktop browser. Supply any domain or subdomain that points to the VPS;
the application hostname does not need to be the future marketing domain.

Noosphere supports three distribution paths without YAML edits:

1. pull official public images from `ghcr.io/ignitionai`;
2. tag a public or private fork and let its workflow publish images under the
   lowercase fork owner;
3. set `DEPLOY_MODE=local-build` to build all application images on the VPS.

Create a secure environment interactively:

```bash
bash deploy/configure.sh
ENV_FILE=.env bash deploy/doctor.sh
ENV_FILE=.env bash deploy/release.sh
```

`quickstart` gives one light workspace HTTPS, daily local backups and a clear
warning that VPS loss also loses those backups. `production` additionally
requires encrypted off-VPS Restic storage, monitoring and restore drills. The
configurator generates secrets locally, writes `.env` with mode `0600` and
refuses to overwrite it by default.

See the complete [self-hosting runbook](docs/runbooks/vps-production.md) for
fork releases, private GHCR login, updates, exact-digest rollback and backup
restoration.

A running UI is not yet an operational prospecting system: AI features need a
configured Codex CLI, Kimi Code or OpenAI route, and outreach needs at least one
connected LinkedIn, email or WhatsApp provider account.

## Verification

```bash
bun run check
bun run test:integration
```

The repository also contains effect-free capacity, shadow, Setter-quality and operator-comprehension gates. Their current evidence and remaining production gates are recorded in the [Prospect 360 validation report](docs/performance/2026-08-23-prospect-360-memory-validation-report.md).

Measured on 23 August 2026: the real-data shadow gate passed on 1,000 IgnitionAI contexts; 100/100 synthetic Codex Setter dry-runs were generated with zero provider effects and resolvable memory receipts. An isolated 2-vCPU/8-GiB VPS remained functional but missed the concurrent-memory p95 target.

## Production sizing

- **Light usage, one workspace:** Netcup **RS 2000 G12**, with 8 dedicated cores, 16 GiB RAM and 512 GB NVMe. This is the acceptable minimum for a canary or one lightly loaded workspace, provided heavy crawling, indexing and campaigns are not run concurrently.
- **Recommended production:** Netcup **RS 4000 G12**, with 12 dedicated cores, 32 GiB RAM and 1 TB NVMe. This is the recommended target for the full platform, including PostgreSQL/ParadeDB, MinIO, Chromium crawling, workers, Qwen embedding and BGE reranking.

TEI keeps Qwen and BGE resident in RAM to avoid cold starts, but this is not continuous compute. Embeddings are generated only for new or changed knowledge, hybrid-search queries, and full reindexing; unchanged content is skipped by hash. Message synchronization, prospect sourcing, post writing, sends and normal Setter execution do not currently use Qwen Embedding. See the localized deployment guides below for the complete workload explanation.

Use x86_64/AMD64 and NVMe storage. A GPU is not required. Shared-vCPU plans are suitable for short preproduction tests but are not the preferred production target. See the [French deployment guide](README.fr.md#déploiement-vps), [English deployment guide](README.en.md#vps-deployment) and [capacity report](docs/performance/2026-08-21-noosphere-standard-stack-capacity.md) for assumptions, upgrade thresholds and operational configuration.

## License

Noosphere is licensed under the [GNU Affero General Public License v3.0 only](LICENSE). If you modify and operate it over a network, the AGPL requires offering the corresponding source to its users.
