"""Pins for fleet/update-cli.sh — the CLI version-update workflow.

The workflow's whole safety claim is "every parity probe runs at the one
moment CLI drift can enter, and a red refuses the version." That claim decays
silently if a probe is renamed/added without the script learning it, or if a
probe's success sentinel drifts from what the script greps. These pins make
either change fail loudly.
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = (ROOT / "fleet/update-cli.sh").read_text()
PROBE_DIR = ROOT / "fleet/tests"


def script_probe_entries():
    return dict(
        m.groups() for m in re.finditer(r'"(probe_[\w]+\.mjs):([^"]+)"', SCRIPT)
    )


def test_every_probe_on_disk_is_in_the_script():
    on_disk = {p.name for p in PROBE_DIR.glob("probe_*.mjs")}
    in_script = set(script_probe_entries())
    assert on_disk == in_script, (
        "fleet/tests/probe_*.mjs and update-cli.sh's PROBES list diverged — "
        f"on disk only: {sorted(on_disk - in_script)}; "
        f"in script only: {sorted(in_script - on_disk)}. A probe the update "
        "workflow does not run is a contract change nothing will catch."
    )


def test_each_sentinel_appears_in_its_probe_source():
    for probe, sentinel in script_probe_entries().items():
        src = (PROBE_DIR / probe).read_text()
        assert sentinel in src, (
            f"{probe}: the script greps for {sentinel!r} but the probe never "
            "prints it — the workflow would call this probe red forever "
            "(or, worse, a reworded success could be greened by accident)."
        )


def test_worker_env_freezes_the_autoupdater():
    run_main = (ROOT / "fleet/run-main.mjs").read_text()
    assert "DISABLE_AUTOUPDATER" in run_main, (
        "run-main.mjs no longer freezes the auto-updater in the worker env — "
        "CLI drift could then enter mid-run instead of only via update-cli.sh"
    )
