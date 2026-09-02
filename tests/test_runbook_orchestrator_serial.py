"""Pin: §Orchestrator VM says plainly that an orchestrator-side suite run is
serial (#537). The orchestrator was built from the same setup script as the
golden but never got `pytest-xdist`, so an operator who copies the golden's
`-n auto` invocation onto `fleet-orchestrator` gets
`unrecognized arguments: -n auto` (finding of 2026-09-01) — the RUNBOOK is the
only record that tells them not to."""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
RUNBOOK = (ROOT / "fleet/RUNBOOK.md").read_text()

SENTENCE = (
    "The orchestrator carries no `pytest-xdist`, so a suite run there is "
    "serial: `python3 -m pytest` without `-n auto` (141 s for the fleet "
    "files, measured 2026-09-01)."
)


def _section(title):
    """The text from a `## <title>` heading to the next `## ` heading."""
    lines = RUNBOOK.splitlines()
    start = lines.index("## " + title)
    for end in range(start + 1, len(lines)):
        if lines[end].startswith("## "):
            return "\n".join(lines[start:end])
    return "\n".join(lines[start:])


def test_orchestrator_section_carries_the_serial_sentence():
    """Leg (a): the sentence is verbatim, inside §Orchestrator VM."""
    assert SENTENCE in _section("Orchestrator VM")


def test_no_runbook_line_issues_n_auto_on_the_orchestrator():
    """Leg (b), line half: the failing 2026-09-01 command shape never appears."""
    offenders = [
        line
        for line in RUNBOOK.splitlines()
        if "fleet-orchestrator" in line and "-n auto" in line
    ]
    assert offenders == []


def test_orchestrator_section_mentions_n_auto_only_to_forbid_it():
    """Leg (b), section half: the only `-n auto` in §Orchestrator VM is the one
    inside the pinned sentence, which says to run WITHOUT it."""
    section = _section("Orchestrator VM").replace(SENTENCE, "")
    assert "-n auto" not in section


def test_golden_build_still_installs_xdist():
    """Leg (c): the golden's install is untouched — it is the machine that
    still wants `-n auto` (#426)."""
    assert (
        "pip install --user --break-system-packages pytest pytest-xdist"
        in _section("Golden VM build")
    )
