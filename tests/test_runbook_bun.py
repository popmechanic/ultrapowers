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
    `bun install` is a hardlink operation rather than a registry fetch on
    every run (17 ms offline on the golden, 2026-08-30). `--offline`
    succeeding IS the proof — it cannot pass by silently reaching the
    registry."""
    assert "bun install --offline" in RUNBOOK


def test_runbook_installs_xdist_past_pep668():
    """exeuntu's python3.12 is externally managed: a plain `pip install --user`
    refuses outright while `pytest --version` still answers from
    dist-packages — a golden with no xdist and no signal. Verified 2026-08-30."""
    assert "--break-system-packages" in RUNBOOK


def test_runbook_proves_xdist_by_import():
    """The install's exit code is not the check; the import is."""
    assert "import xdist" in RUNBOOK


def test_runbook_measures_the_bun_cache_by_path():
    """`du -sh $(bun pm cache)` outside a project dir prints $HOME's size
    (535M measured) instead of failing — a check that cannot fail."""
    assert "du -sh ~/.bun/install/cache" in RUNBOOK
    assert "du -sh \\$(bun pm cache)" not in RUNBOOK
    assert "du -sh $(bun pm cache)" not in RUNBOOK


def test_runbook_documents_build_then_swap():
    """fleet-golden already exists and every run clones it; and the
    from-scratch path never recreates ~/.claude/settings.json."""
    assert "fleet-golden-next" in RUNBOOK
    assert "settings.json" in RUNBOOK


def test_runbook_versionstamp_row_drops_the_dead_installed_check():
    """The installed-plugin cross-check died at 0.3.0 with the install it
    checked (44e0d15); drive.mjs:1123-1127 is the source of truth. Stale prose
    here tells an operator the gate verifies something it does not."""
    assert "installedPluginVersion" not in RUNBOOK
