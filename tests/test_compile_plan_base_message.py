"""`--base` says it wants a checkout directory (#637).

The fix #637 authorizes is the MESSAGE TEXT, not the diagnostic vocabulary: the
refusal species and the `PLAN OK` / `N violation(s)` verdict are frozen, so
every assertion below reads an advisory sentence or the `--help` body and every
one of them re-asserts that the verdict and the exit code did not move.

#725 then made `--base` accept a 40-hex sha as well as a directory, so the
sha branch #637 added — `ADVISORY renders skipped: --base wants a checkout
directory, got a commit sha <value>` — is gone, and with it this file's leg
(c): a sha is now an INPUT the compiler reads, not a value it refuses, and the
runs that ARE refused (a sha naming no commit of the plan's repository, a sha
given for a plan outside any checkout) exit non-zero with empty stdout, which
`_check` below cannot express because it asserts `PLAN OK` and exit 0 first.
That error path is exercised in `tests/test_compile_plan_base_tree.py` instead,
leg (c) [M3] of #725. What survives here is leg (a) — now reading BOTH
`<checkout-dir>` and `<sha>` off the `--help` entry, since the flag takes both
forms — and leg (b), which is frozen.

This exam pins the Machine clauses leg by leg:

  M1 / leg (a) — `compile_plan.py --help` prints the text `<checkout-dir>`
    inside the `--base` entry (BASE's entry opens "the tree file-level
    questions resolve against" and never names a directory), and — since #725 —
    the text `<sha>` beside it.
  M2 / leg (b) — NOT IMPLEMENTED; leg (b) pins the opposite, and says why.
    M2 asked the same-file advisory to end `pass --base <checkout-dir> so the
    compiler can tell a mergeable text file from a non-text one it must
    order`. That sentence is not free prose: leg (e) [M5] of
    `tests/test_compile_plan_proof_runs.py` (re-run by
    `tests/test_compile_plan_proof_species.py`) pins EVERY byte of `--check`
    stdout, stderr and exit code against the compiler blob at the frozen sha
    0a3559a for every fixture plan carrying no `Run:` bullet — and two of
    them, `tests/fixtures/plans/2026-09-01-511-attempt-racing.md` and
    `tests/fixtures/plans/2026-09-02-papercut-drain-2.md`, print this advisory
    under a bare `--check`. Any rewording of it fails that exam, which the
    run's Global Constraints require to keep passing. So the checkout-dir
    wording lands where it costs no frozen byte — the `--base` help entry
    [M1] and the renders skip note [M3] — and leg (b) below pins the advisory
    to BASE's sentence so the freeze is visible from this file too.
  M3 / leg (c) — RETIRED by #725, above. What is left of it is the half that
    was never about a sha: a `--base` naming an empty directory (a real
    directory, not a sha) keeps BASE's `<dir> is not a git checkout` line and
    still exits 0.

The fixture plan is a signed claims-v1 plan (spec §4.5: the compiler refuses to
compile one without its gate-verdict record) and `_check` asserts the fixture's
own health — exit 0, `PLAN OK` first — before any message is read off it, so a
broken fixture never reads as a missing message.
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
import compile_plan  # noqa: E402

# --------------------------------------------------------------------------- #
# The verbatim strings the task pins, quoted from its own words                #
# --------------------------------------------------------------------------- #
# M1: the tokens the `--base` help entry must carry — the directory form #637
# asked for, and (#725) the sha form the flag also takes.
CHECKOUT_DIR = "<checkout-dir>"
SHA_TOKEN = "<sha>"

# M2: the sentence the same-file advisory still ends with, byte for byte. The
# `<checkout-dir>` rewording M2 asked for is blocked — see the module docstring
# and FROZEN_BY below.
SAME_FILE_SPECIES = ("ADVISORY grammar: same-file pair not classifiable "
                     "without a tree")
SAME_FILE_TAIL = ("pass --base so the compiler can tell a mergeable text "
                  "file from a non-text one it must order")
# The rewording M2 named, kept so leg (b)'s failure says which edit it caught.
M2_SAME_FILE_TAIL = ("pass --base <checkout-dir> so the compiler can tell a "
                     "mergeable text file from a non-text one it must order")
# The exam that freezes it, and the sha it freezes against.
FROZEN_BY = ("tests/test_compile_plan_proof_runs.py leg (e) [M5], which pins "
             "`--check` bytes against the compiler at sha 0a3559a for every "
             "Run-less fixture plan")

# M3: the line a directory that is not a git checkout still draws. (#637's sha
# line, and the two 40-hex values leg (c) drove it with, are retired by #725 —
# see the module docstring; the sha error path lives in
# `tests/test_compile_plan_base_tree.py`.)
NOT_A_CHECKOUT = "%s is not a git checkout"
NOT_A_CHECKOUT_TAIL = "is not a git checkout"

# The shared path the fixture's two tasks both `Modify:`.
SHARED_PATH = "app/shared.py"


# --------------------------------------------------------------------------- #
# The fixture plan: two implementation tasks, one shared `Modify:` path        #
# --------------------------------------------------------------------------- #
HEADER = ("# Plan: The same-file pair wants a tree\n"
          "\n"
          "**Grammar:** claims-v1\n"
          "\n"
          "**Acceptance:** waived — inline test plan\n"
          "\n")


def _task(task_id):
    """One claims-v1 task carrying all six slots, naming the shared path."""
    return ("### Task %s: Sample %s\n"
            "\n"
            "**Type:** implementation\n"
            "\n"
            "**Files:**\n"
            "- Modify: `%s`\n"
            "- Test: `tests/test_probe_%s.py`\n"
            "\n"
            "**Claim:** Fix is the message text (say `--base <checkout-dir>`), "
            "not the diagnostic vocabulary. (quoted from #637)\n"
            "Machine: M1. The probe writes `out/report_%s.json`.\n"
            "\n"
            "**Authorized-by:** #637\n"
            "\n"
            "**Interfaces:**\n"
            "- Consumes: nothing\n"
            "- Produces: `probe_%s(n: int) -> str`\n"
            "\n"
            "**Context:** Both tasks edit the same shared module, so the "
            "compiler has to decide whether that path is a mergeable text "
            "file it may fold or a non-text one it must order, and without a "
            "tree to read it can answer neither question here.\n"
            "\n"
            "**Proof:**\n"
            "- Test: `tests/test_probe_%s.py`\n"
            "- Legs: (a) the report file is written [M1].\n"
            "\n"
            "**Stale-if:**\n"
            "- issue-closed: #637\n"
            % (task_id, task_id, SHARED_PATH, task_id, task_id, task_id,
               task_id))


SAME_FILE_PLAN = HEADER + "\n".join([_task("1"), _task("2")])


def _sign(plan):
    """Stamp an all-pass gate-verdict record beside a claims-v1 plan — the
    compiler refuses to compile one without (spec §4.5)."""
    record = {"tasks": {}, "tally": {"dispatched": 0, "rejected": 0}}
    for t in compile_plan.split_tasks(plan.read_text()):
        claims = compile_plan.parse_claims_body(t["body"], t["id"])
        record["tasks"][t["id"]] = {
            "hash": compile_plan.gate_input_hash(claims["claim"],
                                                 claims["proof"]),
            "verdict": "pass", "reason": "layer match"}
        record["tally"]["dispatched"] += 1
    compile_plan.verdicts_path(plan).write_text(json.dumps(record, indent=2) + "\n")
    return plan


@pytest.fixture
def plan(tmp_path):
    """The signed two-task plan, written outside any git checkout."""
    p = tmp_path / "plan.md"
    p.write_text(SAME_FILE_PLAN)
    return _sign(p)


@pytest.fixture
def not_a_checkout(tmp_path):
    """An empty directory that really is not a git checkout — asserted here so
    a stray parent repository never reads as a missing message."""
    d = tmp_path / "empty-dir"
    d.mkdir()
    probe = subprocess.run(["git", "-C", str(d), "rev-parse", "--show-toplevel"],
                           capture_output=True, text=True)
    assert probe.returncode != 0 or not probe.stdout.strip(), (
        "fixture: %s must not resolve to a git checkout; got %r"
        % (d, probe.stdout))
    return d


def _check(plan, *extra):
    """`--check` on the fixture plan, with its own health asserted first: the
    verdict vocabulary is frozen, so `PLAN OK` and exit 0 hold in every case
    below and a fixture that stopped compiling never reads as a missing
    message."""
    p = subprocess.run(
        [sys.executable, str(COMPILER), "--check", str(plan)] + list(extra),
        capture_output=True, text=True, cwd=str(ROOT))
    assert (p.returncode, p.stdout.splitlines()[:1]) == (0, ["PLAN OK"]), (
        "the frozen verdict and exit code are untouched by a message edit: "
        "`--check %s` must print `PLAN OK` and exit 0; got rc=%d\n%s%s"
        % (" ".join(extra), p.returncode, p.stdout, p.stderr))
    return p


def _line_starting(stdout, prefix):
    hits = [l for l in stdout.splitlines() if l.startswith(prefix)]
    assert len(hits) == 1, (
        "exactly one line starts `%s`; got %d:\n%s" % (prefix, len(hits), stdout))
    return hits[0]


# --------------------------------------------------------------------------- #
# (a) [M1] the `--help` body                                                   #
# --------------------------------------------------------------------------- #
_OPTION_START = re.compile(r"^ {2}(-\S)")


def _dewrap(lines):
    """Undo argparse's fill: it wraps at spaces AND after hyphens (`referent-`
    / `existence` in BASE's own `--renders` entry), so a hyphen-broken
    `<checkout-` / `dir>` must rejoin with no space between."""
    out = ""
    for line in lines:
        chunk = line.strip()
        if not out:
            out = chunk
        elif out.endswith("-"):
            out += chunk
        else:
            out += " " + chunk
    return out


def _help_text():
    p = subprocess.run([sys.executable, str(COMPILER), "--help"],
                       capture_output=True, text=True, cwd=str(ROOT),
                       env=dict(os.environ, COLUMNS="80"))
    assert p.returncode == 0, "`--help` exits 0; got %d\n%s%s" % (
        p.returncode, p.stdout, p.stderr)
    return p.stdout


def _base_entry(help_text):
    """The `--base` option entry, unwrapped to one line. The usage block's
    `[--base BASE]` is indented far past two spaces, so only the entry itself
    matches; the entry runs to the next option or the next blank line."""
    lines = help_text.splitlines()
    starts = [i for i, l in enumerate(lines)
              if _OPTION_START.match(l) and l.strip().startswith("--base")]
    assert len(starts) == 1, (
        "`--help` lists the `--base` option exactly once; got %d entr%s:\n%s"
        % (len(starts), "y" if len(starts) == 1 else "ies", help_text))
    start = starts[0]
    end = start + 1
    while (end < len(lines) and lines[end].strip()
           and not _OPTION_START.match(lines[end])):
        end += 1
    return _dewrap(lines[start:end])


def test_help_base_entry_names_a_checkout_dir():
    """leg (a) [M1]: the `--base` entry carries the text `<checkout-dir>` —
    and, since #725 gave the flag a second form, the text `<sha>` too."""
    entry = _base_entry(_help_text())
    assert CHECKOUT_DIR in entry, (
        "leg (a) [M1]: `compile_plan.py --help` prints the text `%s` inside "
        "the `--base` entry — the flag has to say it wants a checkout "
        "directory. Got the entry:\n%s" % (CHECKOUT_DIR, entry))
    assert SHA_TOKEN in entry, (
        "leg (a) [M1, extended by #725]: the `--base` entry also prints the "
        "text `%s` — the flag takes a 40-hex commit sha as well as a checkout "
        "directory, and the help entry names both forms. Got the entry:\n%s"
        % (SHA_TOKEN, entry))


# --------------------------------------------------------------------------- #
# (b) [M2] the same-file advisory, `--check` with no `--base` — FROZEN         #
#                                                                             #
# M2 asked for `pass --base <checkout-dir> …` here. It is unreachable: the     #
# advisory rides a bare `--check`, and every byte of that channel is pinned    #
# against sha 0a3559a for the Run-less fixture corpus, two members of which    #
# print this very line. The three tests below pin the sentence as it stands,   #
# so a future attempt at M2 fails HERE, next to the reason, instead of only    #
# inside the frozen-corpus exam.                                              #
# --------------------------------------------------------------------------- #
def test_same_file_advisory_keeps_its_frozen_sentence(plan):
    """leg (b) [M2, deferred]: the advisory's sentence still ends `pass --base
    so the compiler can tell a mergeable text file from a non-text one it must
    order` — reworded, it breaks the frozen-corpus exam FROZEN_BY names."""
    line = _line_starting(_check(plan).stdout, SAME_FILE_SPECIES)
    assert line.endswith(SAME_FILE_TAIL), (
        "leg (b) [M2, deferred]: the same-file advisory still ends with\n"
        "  %s\n"
        "M2 asked for `%s`, but that channel is frozen by %s. Got:\n  %s"
        % (SAME_FILE_TAIL, M2_SAME_FILE_TAIL, FROZEN_BY, line))


def test_same_file_advisory_keeps_its_frozen_species_and_names_the_pair(plan):
    """leg (b) [M2, deferred]: the whole line — species, the tasks-and-path
    clause, and the sentence — is what the compiler printed at BASE."""
    line = _line_starting(_check(plan).stdout, SAME_FILE_SPECIES)
    expected = ("%s — tasks 1 and 2 both name `%s`; %s"
                % (SAME_FILE_SPECIES, SHARED_PATH, SAME_FILE_TAIL))
    assert line == expected, (
        "leg (b) [M2, deferred]: the bare-`--check` advisory channel is frozen "
        "byte for byte by %s, so the whole line still reads\n  %s\nGot:\n  %s"
        % (FROZEN_BY, expected, line))


def test_the_checkout_dir_wording_stays_off_the_frozen_check_channel(plan):
    """leg (b) [M2, deferred]: `<checkout-dir>` reaches the user through the
    `--help` entry [M1] and the renders skip note [M3] — never through a bare
    `--check`, whose every byte the frozen-corpus exam compares."""
    out = _check(plan).stdout
    assert CHECKOUT_DIR not in out, (
        "leg (b) [M2, deferred]: a bare `--check` prints no `%s`; %s compares "
        "this channel byte for byte and two fixture plans print the same-file "
        "advisory. Got:\n%s" % (CHECKOUT_DIR, FROZEN_BY, out))


# --------------------------------------------------------------------------- #
# (c) [M3] `--check --renders --base <a directory that is not a checkout>`     #
#                                                                             #
# The 40-hex half of leg (c) is retired: #725 makes a sha an input `--base`    #
# READS, so there is no sha skip line left to pin and the two runs that ARE    #
# refused print no verdict at all — `_check` asserts `PLAN OK` and exit 0      #
# first, so that path is exercised in `tests/test_compile_plan_base_tree.py`,  #
# whose leg (c) [M3] also pins that no run says `wants a checkout directory`.  #
# The directory case below is unchanged, and stays unchanged: it is one of the #
# bytes M2 of #725 freezes.                                                    #
# --------------------------------------------------------------------------- #
def test_a_directory_that_is_not_a_checkout_keeps_bases_line(plan, not_a_checkout):
    """leg (c) [M3]: a `--base` naming a directory that is not a git checkout
    keeps BASE's line — the sha branch is the 40-hex non-directory case only."""
    out = _check(plan, "--renders", "--base", str(not_a_checkout)).stdout
    line = _line_starting(out, "ADVISORY renders skipped:")
    assert line.endswith(NOT_A_CHECKOUT_TAIL), (
        "leg (c) [M3]: a directory `--base` keeps BASE's line ending `%s`. "
        "Got:\n  %s" % (NOT_A_CHECKOUT_TAIL, line))
    assert line == "ADVISORY renders skipped: " + NOT_A_CHECKOUT % not_a_checkout, (
        "leg (c) [M3]: BASE's whole line is unchanged for a directory "
        "`--base`. Got:\n  %s" % line)


def test_a_directory_that_is_not_a_checkout_still_exits_zero(plan, not_a_checkout):
    """leg (c) [M3]: the unchanged branch changes no exit code either."""
    p = _check(plan, "--renders", "--base", str(not_a_checkout))
    assert p.returncode == 0, p.stdout + p.stderr
