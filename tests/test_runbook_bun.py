"""Pin: the golden VM build installs Bun and verifies it (#425). The image is
hand-built from RUNBOOK steps, so the RUNBOOK is the only executable record —
a missing line here is a sandbox that cannot run a Bun target."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
RUNBOOK = (ROOT / "fleet/RUNBOOK.md").read_text()


def test_runbook_installs_bun_in_the_golden_build():
    assert "bun.sh/install" in RUNBOOK or "install bun" in RUNBOOK.lower()


def test_runbook_verifies_the_install():
    assert "bun --version" in RUNBOOK


def test_runbook_says_bun_is_for_targets_not_the_driver():
    # the driver stays on Node — spawn/SIGTERM semantics are measured there
    lowered = RUNBOOK.lower()
    assert "driver" in lowered and "node" in lowered


def test_runbook_warms_the_bun_cache_in_the_image():
    """#425 item 3: the cache clones with the sandbox, so a target's
    `bun install` is a hardlink operation rather than a registry fetch on every
    run (measured 574 ms offline, 2026-08-30). Installing the binary without
    warming the cache leaves the per-run network cost in place."""
    assert "bun pm cache" in RUNBOOK
    assert "bun install" in RUNBOOK
