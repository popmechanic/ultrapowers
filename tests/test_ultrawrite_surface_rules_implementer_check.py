"""Implementer's own red/green check for Task 2 (#609 items 1 and 3, #665 (a)).

The graded exam is written by a peer from the same task text; this file is the
implementer's copy of the same contract, kept under a different name so the two
never collide. Every command below is one of the task's `Run:` bullets, run
verbatim through `bash -c` so a passing run here means the same string passes
there.

M1 — the Proof bullet of §The six body slots says an exam file is one per
     behaviour surface and named for it, that a later task extends it, and that
     the task's legs sit under a comment naming the task.
M2 — the same bullet says a `byte-identical to BASE` / `git show HEAD:`
     comparison is a tautology at the integration head, and names the frozen
     pre-edit literal, the 40-hex sha and `git fetch --depth=1 origin <sha>`.
M3 — rule 4 of §Decomposition judgment names the adjacent-insert shape, the
     resolver, run-12's five tasks and three resolver workers, and the
     registration-is-a-new-file rule.
M4 — §Self-review carries the exam-file-naming line.
"""
import pathlib
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKILL = "skills/ultrawrite/SKILL.md"

SIX_SLOTS = (
    "sed -n '/^### The six body slots/,/^## Elicit the claim/p' " + SKILL
)
DECOMPOSITION = (
    "sed -n '/^## Decomposition judgment/,/^## Global Constraints discipline/p' "
    + SKILL
)
SELF_REVIEW = "sed -n '/^## Self-review/,$p' " + SKILL
SQUEEZE = " | tr -s '[:space:]' ' '"


def run(command):
    return subprocess.run(["bash", "-c", command], cwd=ROOT,
                          capture_output=True, text=True)


RUN_BULLETS = [
    # (clause, the Run: command verbatim)
    ("M1", SIX_SLOTS + SQUEEZE + " | grep -q 'one exam file per behaviou\\?r "
     "surface.*named for it.*later task.*extends.*under a comment naming the "
     "task'"),
    ("M1", SIX_SLOTS + SQUEEZE
     + " | grep -q 'one exam file per behaviou\\?r surface'"),
    ("M1", SIX_SLOTS + SQUEEZE + " | grep -q 'later task.*extends'"),
    ("M1", SIX_SLOTS + SQUEEZE
     + " | grep -q 'under a comment naming the task'"),
    ("M2", SIX_SLOTS + SQUEEZE + " | grep -q 'byte-identical to BASE.*git show "
     "HEAD:.*tautology at the integration head.*frozen pre-edit literal.*40-hex "
     "sha.*git fetch --depth=1 origin.*depth'"),
    ("M2", SIX_SLOTS + " | grep -qF -- 'git fetch --depth=1 origin <sha>'"),
    ("M3", DECOMPOSITION + SQUEEZE + " | grep -q 'Let same-file edits "
     "stand.*adjacent inserts at one location.*resolver.*own region or "
     "file.*registration is a new file.*never an appended line'"),
    ("M3", DECOMPOSITION + SQUEEZE
     + " | grep -q 'run-12.*five tasks.*three resolver workers'"),
    ("M4", SELF_REVIEW + SQUEEZE + " | grep -q 'exam file is named for its "
     "behaviou\\?r surface.*comment naming the task'"),
]


@pytest.mark.parametrize("clause,command", RUN_BULLETS,
                         ids=["%s-%d" % (c, i)
                              for i, (c, _) in enumerate(RUN_BULLETS)])
def test_run_bullet_exits_zero(clause, command):
    done = run(command)
    assert done.returncode == 0, (
        "[%s]: `%s` exited %d\n%s%s"
        % (clause, command, done.returncode, done.stdout, done.stderr))
