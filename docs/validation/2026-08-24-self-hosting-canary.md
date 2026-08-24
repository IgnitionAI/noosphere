# Self-hosting canary — 24 August 2026

This report records what was actually verified for the first self-hostable
Noosphere release candidate. It deliberately separates a healthy authenticated
stack from the remaining anonymous-distribution gate.

## Source and CI

- source commit: `6cb5354a757963c72a47b10f258330db42108483`;
- official `Check` run: [32761295375](https://github.com/IgnitionAI/noosphere/actions/runs/32761295375), successful;
- the run includes types, architecture checks, 603 TypeScript/HTTP tests, 43
  crawler tests, a Next.js build and 18 desktop/mobile browser journeys;
- local integration suite: 153 tests passed;
- self-hosting unit suite: 6 tests passed;
- Compose rendered successfully for `quickstart` and `production`, each in
  `registry` and `local-build` mode;
- locally built AMD64 runtime images were scanned with Trivy 0.67.2: zero fixed
  High or Critical vulnerability; their declared users were `bun`, `node` and
  `crawler`.

## Fork canary

A temporary public fork `salim4n/noosphere` was created at the exact source
commit. Its Actions runs never reached a runner: GitHub rejected them before
the first step with `The job was not started because your account is locked due
to a billing issue.` This is an account-level external blocker, not an
application or workflow failure.

To keep testing the application path, the same locally scanned AMD64 images
were pushed manually to the fork namespace. A generated quickstart environment
had mode `0600`, and an isolated Compose project started these services:

| Service | Image | Result |
|---|---|---|
| API | `ghcr.io/salim4n/noosphere-backend:v0.0.0-selfhost-canary.1` | healthy, `/health/ready` 200 |
| Web | `ghcr.io/salim4n/noosphere-web:v0.0.0-selfhost-canary.1` | healthy, `/login` 200 |
| Crawler | `ghcr.io/salim4n/noosphere-crawler:v0.0.0-selfhost-canary.1` | healthy, `/health` 200 |
| ParadeDB | `paradedb/paradedb:v0.23.5` | healthy |
| MinIO | `minio/minio:RELEASE.2025-07-23T15-54-02Z` | healthy |
| SearXNG | `searxng/searxng:2026.8.16-b2da6b90f` | healthy |

The isolated containers, network and three temporary volumes were removed
after the test. The three temporary fork packages were also deleted.

## Official image canary

Tag `v0.0.0-selfhost-canary.1` triggered official release run
[32763568979](https://github.com/IgnitionAI/noosphere/actions/runs/32763568979).
All three matrix jobs successfully built AMD64 images, ran Trivy, pushed both
SemVer and SHA tags, resolved their digests and generated build provenance:

| Image | Published digest |
|---|---|
| `ghcr.io/ignitionai/noosphere-backend` | `sha256:0b41c96649219fa3c95908eb8923476ba7f9ae7c29463c0bfa257f8096093b05` |
| `ghcr.io/ignitionai/noosphere-web` | `sha256:0778a658cfd14e6a18e6afbcd826c37d0bf1661f450af792e3fa45d8b5ed0e1f` |
| `ghcr.io/ignitionai/noosphere-crawler` | `sha256:217b7392ca5826d8b637677a99a444f8f7b56f0071e0f64139a011c76a846406` |

The workflow then failed closed on its final anonymous pull. GitHub creates new
GHCR packages as private even when they are linked to a public repository. The
three packages must be changed to `Public` once in their package settings, then
the release workflow must be re-run. No official anonymous installation is
claimed before that run becomes green.

## Remaining external actions

1. Change the three official packages from `Private` to `Public` in GitHub.
2. Re-run official release run 32763568979 and require all three anonymous
   digest pulls to pass.
3. Delete the temporary `salim4n/noosphere` fork. The current CLI credential can
   delete packages but lacks the `delete_repo` scope, so repository deletion
   was intentionally not bypassed.

The code path is deployable in registry and local-build modes. Public,
credential-free distribution remains gated by item 1, and the report must not
be interpreted as proof of that still-pending external setting.
