#!/usr/bin/env bash
# Run only from a dedicated deployment checkout, never from a developer checkout.
set -euo pipefail

version="${1:-}"
if [[ $# -ne 1 || ! "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9._-]+)?$ ]]; then
  echo "Usage: bash deploy/update.sh vX.Y.Z" >&2
  exit 1
fi
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$APP_DIR"
APP_DIR="$(pwd -P)"
export APP_DIR
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
RELEASE_STATE_DIR="${RELEASE_STATE_DIR:-$APP_DIR/.deploy}"
export ENV_FILE RELEASE_STATE_DIR
if [[ ! -f "$ENV_FILE" ]]; then echo "Missing environment: $ENV_FILE" >&2; exit 1; fi
if [[ "$(git rev-parse --show-toplevel)" != "$APP_DIR" ]]; then
  echo "APP_DIR must be the root of a dedicated deployment checkout" >&2; exit 1
fi
if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo "Refusing to update a checkout with local changes" >&2; exit 1
fi
mkdir -p "$RELEASE_STATE_DIR"
chmod 700 "$RELEASE_STATE_DIR"
lock="$RELEASE_STATE_DIR/update.lock"
if ! mkdir "$lock" 2>/dev/null; then
  echo "An update lock already exists: $lock. Check the active process before removing a stale lock." >&2
  exit 1
fi
trap 'rmdir "$lock"' EXIT
printf '%s\n' "Fetching release $version and main"
git fetch --no-tags origin "refs/heads/main:refs/remotes/origin/main" "refs/tags/$version:refs/tags/$version"
target="$(git rev-parse "refs/tags/$version^{commit}")"
if ! git merge-base --is-ancestor "$target" refs/remotes/origin/main; then
  echo "Refusing a release that is not part of origin/main" >&2; exit 1
fi
# Evaluate the same trusted environment as release.sh in an isolated shell.
if ! bash -c 'set -eu; set -a; source "$1"; for value in "${BACKEND_IMAGE:-}" "${WEB_IMAGE:-}" "${CRAWLER_IMAGE:-}"; do [[ -z "$value" ]] || exit 1; done' bash "$ENV_FILE"; then
  echo "Version updates require empty BACKEND_IMAGE, WEB_IMAGE and CRAWLER_IMAGE overrides. Use the explicit-image release procedure for custom digests." >&2
  exit 1
fi
previous="$(git rev-parse HEAD)"
git checkout --detach "$target"
if bash deploy/release.sh "$version"; then
  echo "Deployment checkout and application now use $version ($target)"
else
  result=$?
  git checkout --detach "$previous"
  echo "Release failed; previous checkout restored. Inspect release logs for application rollback status; database schema and volumes are retained." >&2
  exit "$result"
fi
