import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const temporaryRoot = mkdtempSync(join(tmpdir(), "noosphere-compose-"));

function run(command: string[], env: Record<string, string> = {}) {
  const result = Bun.spawnSync(command, {
    cwd: root,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `${command.join(" ")} failed\n${result.stdout.toString()}${result.stderr.toString()}`,
    );
  }
  return result.stdout.toString();
}

try {
  const shellScripts = [
    "deploy/backup.sh",
    "deploy/configure.sh",
    "deploy/doctor.sh",
    "deploy/healthcheck.sh",
    "deploy/install-systemd.sh",
    "deploy/monitor.sh",
    "deploy/provider-readiness.sh",
    "deploy/release.sh",
    "deploy/validate-production-env.sh",
    "deploy/verify-backup-restore.sh",
    "deploy/lib/images.sh",
  ];
  run(["bash", "-n", ...shellScripts]);

  for (const profile of ["quickstart", "production"] as const) {
    for (const mode of ["registry", "local-build"] as const) {
      const environmentFile = join(temporaryRoot, `${profile}-${mode}.env`);
      const args = [
        "bash",
        "deploy/configure.sh",
        "--non-interactive",
        "--profile",
        profile,
        "--mode",
        mode,
        "--version",
        "v9.9.9-selfhost-test",
        "--domain",
        "noosphere.example.com",
        "--admin-email",
        "owner@example.com",
        "--admin-name",
        "Noosphere Owner",
        "--image-namespace",
        "example-owner",
        "--output",
        environmentFile,
      ];
      if (profile === "production") {
        args.push(
          "--restic-repository",
          "s3:s3.example.com/noosphere-test",
          "--restic-password-file",
          join(temporaryRoot, `${profile}-${mode}.restic-password`),
        );
      }
      run(args);
      const images = run([
        "docker",
        "compose",
        "--env-file",
        environmentFile,
        "-f",
        "compose.infrastructure.yml",
        "-f",
        "compose.production.yml",
        "config",
        "--images",
      ]);
      for (const component of ["backend", "web", "crawler"]) {
        const expected = `ghcr.io/example-owner/noosphere-${component}:v9.9.9-selfhost-test`;
        if (!images.includes(expected)) {
          throw new Error(`${profile}/${mode} does not resolve ${expected}`);
        }
      }
    }
  }

  const releaseWorkflow = readFileSync(
    join(root, ".github/workflows/release-images.yml"),
    "utf8",
  );
  for (const required of [
    "GITHUB_REPOSITORY_OWNER,,",
    "org.opencontainers.image.source",
    "actions/attest-build-provenance@v3",
    "sha-$short_sha",
    "DOCKER_CONFIG=\"$anonymous_config\" docker pull",
  ]) {
    if (!releaseWorkflow.includes(required)) {
      throw new Error(`release-images.yml is missing ${required}`);
    }
  }

  console.log("Self-hosting scripts and all four profile/mode Compose variants are valid");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
