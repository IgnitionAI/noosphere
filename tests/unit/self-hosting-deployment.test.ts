import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repositoryRoot = process.cwd();
const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "noosphere-self-hosting-"));
  temporaryDirectories.push(directory);
  return directory;
}

function runBash(script: string, env: Record<string, string> = {}) {
  return Bun.spawnSync(["bash", "-c", script], {
    cwd: repositoryRoot,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("self-hosting distribution", () => {
  test("resolves official, fork and explicit image coordinates", () => {
    const official = runBash(
      "source deploy/lib/images.sh; APP_VERSION=v1.2.3; noosphere_export_images; printf '%s|%s|%s' \"$BACKEND_IMAGE\" \"$WEB_IMAGE\" \"$CRAWLER_IMAGE\"",
    );
    expect(official.exitCode).toBe(0);
    expect(official.stdout.toString()).toBe(
      "ghcr.io/ignitionai/noosphere-backend:v1.2.3|ghcr.io/ignitionai/noosphere-web:v1.2.3|ghcr.io/ignitionai/noosphere-crawler:v1.2.3",
    );

    const fork = runBash(
      "source deploy/lib/images.sh; APP_VERSION=v2.0.0; IMAGE_NAMESPACE=salim4n; noosphere_export_images; printf '%s' \"$BACKEND_IMAGE\"",
    );
    expect(fork.exitCode).toBe(0);
    expect(fork.stdout.toString()).toBe("ghcr.io/salim4n/noosphere-backend:v2.0.0");

    const overridden = runBash(
      "source deploy/lib/images.sh; APP_VERSION=v2.0.0; BACKEND_IMAGE=registry.example/custom/backend@sha256:abc; noosphere_export_images; printf '%s' \"$BACKEND_IMAGE\"",
    );
    expect(overridden.exitCode).toBe(0);
    expect(overridden.stdout.toString()).toBe("registry.example/custom/backend@sha256:abc");
  });

  test("creates a valid quickstart environment once with mode 0600", () => {
    const directory = temporaryDirectory();
    const environmentFile = join(directory, ".env");
    const command = [
      "bash deploy/configure.sh",
      "--non-interactive",
      "--profile quickstart",
      "--mode local-build",
      "--version v1.2.3",
      "--domain noosphere.example.com",
      "--admin-email owner@example.com",
      "--admin-name 'Owner Example'",
      "--image-namespace salim4n",
      `--output '${environmentFile}'`,
    ].join(" ");
    const configured = runBash(command);
    expect(configured.exitCode).toBe(0);
    expect(statSync(environmentFile).mode & 0o777).toBe(0o600);
    const content = readFileSync(environmentFile, "utf8");
    expect(content).toContain("DEPLOY_PROFILE=quickstart");
    expect(content).toContain("DEPLOY_MODE=local-build");
    expect(content).toContain("BACKUP_MODE=local");
    expect(content).toContain("IMAGE_NAMESPACE=salim4n");
    expect(content).toContain("PUBLIC_HOST=noosphere.example.com");
    expect(content).not.toContain("replace-with-");

    const overwrite = runBash(command);
    expect(overwrite.exitCode).not.toBe(0);
    expect(overwrite.stderr.toString()).toContain("Refusing to overwrite");
  });

  test("requires off-VPS Restic for the production profile", () => {
    const directory = temporaryDirectory();
    const environmentFile = join(directory, ".env");
    const passwordFile = join(directory, "restic-password");
    const configured = runBash(
      [
        "bash deploy/configure.sh",
        "--non-interactive",
        "--profile production",
        "--mode local-build",
        "--version v1.2.3",
        "--domain noosphere.example.com",
        "--admin-email owner@example.com",
        "--admin-name Owner",
        "--restic-repository s3:s3.example.com/noosphere",
        `--restic-password-file '${passwordFile}'`,
        `--output '${environmentFile}'`,
      ].join(" "),
    );
    expect(configured.exitCode).toBe(0);
    expect(statSync(passwordFile).mode & 0o777).toBe(0o600);

    const invalid = readFileSync(environmentFile, "utf8").replace(
      "BACKUP_MODE=restic",
      "BACKUP_MODE=local",
    );
    writeFileSync(environmentFile, invalid);
    chmodSync(environmentFile, 0o600);
    const validated = runBash(`ENV_FILE='${environmentFile}' bash deploy/validate-production-env.sh`);
    expect(validated.exitCode).not.toBe(0);
    expect(validated.stderr.toString()).toContain(
      "DEPLOY_PROFILE=production requires BACKUP_MODE=restic",
    );
  });

  test("keeps private deployment coordinates out of public release scripts", () => {
    const publicFiles = [
      "deploy/release.sh",
      "deploy/configure.sh",
      "deploy/doctor.sh",
      "deploy/validate-production-env.sh",
      ".github/workflows/release-images.yml",
    ];
    for (const path of publicFiles) {
      const content = readFileSync(join(repositoryRoot, path), "utf8");
      expect(content).not.toContain("noosphere.ignitionai.fr");
      expect(content).not.toContain("ghcr.io/ignitionai/noosphere-");
    }
  });

  test("guides private GHCR packages through their landing page", () => {
    const workflow = readFileSync(
      join(repositoryRoot, ".github/workflows/release-images.yml"),
      "utf8",
    );
    expect(workflow).not.toContain(
      "packages/container/package/noosphere-${{ matrix.name }}/settings",
    );
    expect(workflow).toContain(
      "packages/container/package/noosphere-${{ matrix.name }}",
    );
    expect(workflow).toContain("Sign in to github.com");
    expect(workflow).toContain("click Package settings");
  });

  test("records exact images and never rolls migrations or volumes back", () => {
    const release = readFileSync(join(repositoryRoot, "deploy/release.sh"), "utf8");
    expect(release).toContain("last-successful-release.json");
    expect(release).toContain("image_digest_ref");
    expect(release).toContain("Migrations and volumes were deliberately left untouched");
    expect(release).not.toContain("down -v");
  });

  test("writes an exact release manifest after a local-build deployment", () => {
    const directory = temporaryDirectory();
    const environmentFile = join(directory, ".env");
    const stateDirectory = join(directory, "state");
    const binaryDirectory = join(directory, "bin");
    mkdirSync(binaryDirectory);

    const configured = runBash(
      [
        "bash deploy/configure.sh",
        "--non-interactive",
        "--profile quickstart",
        "--mode local-build",
        "--version v3.2.1",
        "--domain noosphere.example.com",
        "--admin-email owner@example.com",
        "--admin-name Owner",
        "--image-namespace release-test",
        `--output '${environmentFile}'`,
      ].join(" "),
    );
    expect(configured.exitCode).toBe(0);

    const dockerMock = `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "image" && "\${2:-}" == "inspect" ]]; then
  ref="\${@: -1}"
  case "$ref" in
    *backend*) echo sha256:backend-image-id ;;
    *web*) echo sha256:web-image-id ;;
    *crawler*) echo sha256:crawler-image-id ;;
    *) exit 1 ;;
  esac
  exit 0
fi
if [[ "\${1:-}" == "inspect" ]]; then
  echo healthy
  exit 0
fi
if [[ "\${1:-}" == "compose" ]]; then
  joined=" $* "
  if [[ "$joined" == *" ps --status running --services "* ]]; then
    printf '%s\\n' database tei-embedding tei-reranker minio searxng crawler api web worker decision-worker setter-worker memory-worker proxy
  elif [[ "$joined" == *" ps -q "* ]]; then
    echo noosphere-container
  fi
  exit 0
fi
exit 0
`;
    const curlMock = `#!/usr/bin/env bash
set -euo pipefail
if [[ " $* " == *"/health/ready"* ]]; then
  printf '%s\\n' '{"status":"ready"}'
fi
`;
    writeFileSync(join(binaryDirectory, "docker"), dockerMock, { mode: 0o755 });
    writeFileSync(join(binaryDirectory, "curl"), curlMock, { mode: 0o755 });

    const released = runBash(
      `ENV_FILE='${environmentFile}' RELEASE_STATE_DIR='${stateDirectory}' BACKUP_BEFORE_RELEASE=false bash deploy/release.sh`,
      { PATH: `${binaryDirectory}:${process.env.PATH}` },
    );
    if (released.exitCode !== 0) {
      console.error(released.stdout.toString(), released.stderr.toString());
    }
    expect(released.exitCode).toBe(0);
    const manifest = JSON.parse(
      readFileSync(join(stateDirectory, "last-successful-release.json"), "utf8"),
    );
    expect(manifest.appVersion).toBe("v3.2.1");
    expect(manifest.deployMode).toBe("local-build");
    expect(manifest.images.backend.exact).toBe(
      "ghcr.io/release-test/noosphere-backend:v3.2.1",
    );
    expect(manifest.images.backend.imageId).toBe("sha256:backend-image-id");
    expect(statSync(join(stateDirectory, "last-successful-release.json")).mode & 0o777).toBe(
      0o600,
    );
  });
});
