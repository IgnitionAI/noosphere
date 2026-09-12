"""Publish successful release metadata; restore prior files on an I/O failure."""
import json
import os
import re
import sys
import tempfile
from pathlib import Path


def stage(target: Path, content: bytes) -> Path:
    with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as handle:
        path = Path(handle.name)
        try:
            os.chmod(path, 0o600)
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        except BaseException:
            path.unlink(missing_ok=True)
            raise
    return path


def publish(environment: Path, candidate: Path, manifest: Path, legacy: Path) -> None:
    release = candidate.read_bytes()
    version = json.loads(release)["appVersion"]
    if not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9._-]+)?", version):
        raise ValueError("Invalid release version")
    content = environment.read_text()
    line = "APP_VERSION=" + version
    if re.search(r"^(?:export\s+)?APP_VERSION=.*$", content, flags=re.M):
        content = re.sub(r"^(?:export\s+)?APP_VERSION=.*$", line, content, flags=re.M)
    else:
        content = content.rstrip() + "\n" + line + "\n"
    targets = [(environment, content.encode()), (legacy, (version + "\n").encode()), (manifest, release)]
    staged = {}
    backups = {}
    replaced = []
    safe_to_cleanup = False
    try:
        # Stage all writes and rollback copies before replacing any live metadata.
        for target, value in targets:
            if target.is_symlink() or (target.exists() and not target.is_file()):
                raise ValueError("Release metadata must be regular files")
            backups[target] = stage(target, target.read_bytes()) if target.exists() else None
            staged[target] = stage(target, value)
        for target, _ in targets:
            os.replace(staged[target], target)
            replaced.append(target)
        safe_to_cleanup = True
    except BaseException:
        for target in reversed(replaced):
            if backups[target] is None:
                target.unlink(missing_ok=True)
            else:
                os.replace(backups[target], target)
        safe_to_cleanup = True
        raise
    finally:
        if safe_to_cleanup:
            for path in [*staged.values(), *backups.values(), candidate]:
                if path is not None:
                    try:
                        path.unlink(missing_ok=True)
                    except OSError:
                        print("Private release staging file retained: " + str(path), file=sys.stderr)


if __name__ == "__main__":
    publish(*(Path(value) for value in sys.argv[1:]))
