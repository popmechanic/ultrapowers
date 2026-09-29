"""The vendored kernel (Manyana) is pinned: its tracked file list and a digest
over those files' bytes are frozen here, so a vendor file that is added,
removed or changed is caught. `vendor/manyana.py` is never edited; re-vendoring
updates `FROZEN_VENDOR_DIGEST` in the same commit (see `vendor/PROVENANCE.md`).
"""
import hashlib
import os
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
VENDOR_DIR = "skills/ultrapowers/kernel/vendor"

GIT_ENV = {
    **os.environ,
    "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_SYSTEM": "/dev/null",
}

FROZEN_VENDOR_FILES = [
    "skills/ultrapowers/kernel/vendor/PROVENANCE.md",
    "skills/ultrapowers/kernel/vendor/manyana.py",
]
FROZEN_VENDOR_DIGEST = \
    "7b3d33893b21d39e8c05c63b72cfb10b605b2a0f198692d46c5e71a3149276cb"


def test_vendored_kernel_is_pinned():
    listed = subprocess.run(["git", "-C", str(REPO_ROOT), "ls-files", "-z",
                             "--", VENDOR_DIR], capture_output=True,
                            text=True, env=GIT_ENV)
    assert listed.returncode == 0, (
        "could not list the vendored kernel:\n%s" % listed.stderr)
    files = sorted(p for p in listed.stdout.split("\0") if p)
    assert files == FROZEN_VENDOR_FILES, (
        "the vendored kernel's file list changed, got %r" % files)

    digest = hashlib.sha256()
    for rel in files:
        blob = (REPO_ROOT / rel).read_bytes()
        digest.update(("%d\0%s\0%d\0" % (len(rel), rel, len(blob))).encode())
        digest.update(blob)
    assert digest.hexdigest() == FROZEN_VENDOR_DIGEST, (
        "the vendored kernel's bytes changed (%s), and "
        "`vendor/manyana.py` is never edited" % digest.hexdigest())
