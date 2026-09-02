"""Pin: §Orchestrator VM names the laptop-side push rule (#537).

The orchestrator shell holds no GitHub push credential — the drive pushes with
its own token from inside `drive.mjs`, so a `git push` typed by hand there dies
with `could not read Username` (#537, 2026-09-01). The path that works is the
one §Park triage already spells out for a failed publish (#497): fetch the
orchestrator's ref to the laptop over ssh and push from the laptop, with the
operator's credential. This test pins that rule as a general sentence in
§Orchestrator VM, and pins §Park triage's four rescue commands unchanged.
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
RUNBOOK = (ROOT / "fleet/RUNBOOK.md").read_text()

PUSH_RULE = (
    "The orchestrator shell has no GitHub push credential (the drive pushes "
    "with its own token inside `drive.mjs`), so adoption or rescue work done "
    "by hand there is fetched to the laptop over ssh and pushed from the "
    "laptop:"
)

SSH_REPO = "ssh://exedev@fleet-orchestrator.exe.xyz/home/exedev/repo"


def section(heading):
    """The text between a `## <heading>` line and the next `## ` heading."""
    lines = RUNBOOK.splitlines()
    start = None
    for i, line in enumerate(lines):
        if line.startswith("## ") and line[3:].startswith(heading):
            start = i + 1
            break
    assert start is not None, f"no `## {heading}` heading in fleet/RUNBOOK.md"
    end = len(lines)
    for i in range(start, len(lines)):
        if lines[i].startswith("## "):
            end = i
            break
    return "\n".join(lines[start:end])


def first_fenced_block_after(text, marker):
    """(info string, body lines) of the first ``` block following `marker`."""
    assert marker in text, "the push rule is missing"
    tail = text.split(marker, 1)[1]
    m = re.search(r"^```([^\n]*)\n(.*?)^```", tail, re.S | re.M)
    assert m is not None, "no fenced block follows the push rule"
    return m.group(1).strip(), m.group(2).splitlines()


def test_orchestrator_vm_states_the_push_rule_verbatim():
    """Leg (a)."""
    assert PUSH_RULE in section("Orchestrator VM")


def test_the_push_rule_is_followed_by_a_fetch_then_push_bash_block():
    """Leg (b): the rule is executable, not advice — ssh fetch in, push out."""
    info, body = first_fenced_block_after(section("Orchestrator VM"), PUSH_RULE)
    assert info == "bash"
    commands = [
        line for line in body if line.strip() and not line.lstrip().startswith("#")
    ]
    assert commands, "the block has no command lines"
    assert commands[0].startswith(f"git fetch {SSH_REPO} ")
    assert commands[-1].startswith("git push origin ")


def test_park_triage_keeps_its_four_rescue_commands():
    """Leg (c): the general rule reuses §Park triage's shape (#497); it must
    not have been written by moving those commands out of it."""
    park = section("Park triage")
    commands = [
        line.strip()
        for line in park.splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]
    assert any("git rev-parse refs/fleet/run-<N>" in c for c in commands)
    assert (
        f"git fetch {SSH_REPO} "
        "refs/fleet/run-<N>:refs/heads/ultra/integration-run-<N>"
    ) in commands
    assert "git push origin ultra/integration-run-<N>" in commands
    assert any(c.startswith("gh pr create") for c in commands)
