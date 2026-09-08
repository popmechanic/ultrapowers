"""One reader for the tree at BASE, a directory or a sha (#725).

`--base` used to mean one thing: a checkout directory, read through
`git -C <dir>` and through `open()`. #725 makes it mean the TREE — a checkout
directory OR a 40-hex commit sha of the plan's own repository — so a plan can
be checked against the exact commit `launch.mjs --base` will use. A sha is an
INPUT, not a new diagnostic: every line the sha mode prints is a line a
directory could have printed, and no `ADVISORY` sentence, refusal species,
verdict or exit code a directory `--base` produces moves by one byte.

This exam pins the Machine clauses leg by leg. Each fixture repository is built
here, so every sha it asserts is its own and nothing reads the network. The
shape is the one the task names: one `git init` repository under `tmp_path`,
a first commit carrying the sha-only file, then a commit that deletes it — so
the working directory of that same repository IS the "checkout lacking the
file" the directory half of every leg needs, and no clone is made.

  M1 / leg (a) — `--check --renders --base <sha>` prints no `ADVISORY
    referent:` line for a path a task body names that exists in the tree at
    that sha; `--base <dir>` on the checkout that lacks the path prints exactly
    one such line, naming it.
  M2 / leg (b) — a directory `--base` prints what it printed at BASE: each of
    the five canonical fixtures (`wide`, `chained`, `mixed`, `degrade`,
    `contend`) prints exactly `PLAN OK` and nothing else, and a directory that
    is not a git checkout still draws the `is not a git checkout` skip line.
    M2's third half — every Run-less fixture plan's bare `--check` bytes still
    equal the frozen compiler blob at `0a3559a`'s — is
    `tests/test_compile_plan_proof_runs.py`'s own
    `test_every_run_less_fixture_plan_checks_byte_identically_to_base`, which
    the Proof's first `Run:` bullet re-runs; it is not duplicated here.
  M3 / leg (c) — a 40-hex `--base` naming no commit of the plan's repository,
    and a 40-hex `--base` given for a plan outside any checkout, each exit
    non-zero with EMPTY stdout (no verdict line at all) and one stderr line
    beginning `error:` that contains the sha. None of the four runs this exam
    makes on the sha fixture prints a line containing `wants a checkout
    directory` — the #637 skip line is gone, because a sha is now read, not
    refused. The `--help` entry for `--base` names both `<checkout-dir>` and
    `<sha>`.
  M4 / legs (d), (e), (f) — the compiler's OTHER tree reads follow: the
    Produces blast radius (i), the `pinned-elsewhere` species (ii) and the
    `base-sha-in-suite` species (iii) each draw their line off a file that
    exists only in the tree at the sha, and draw none under a directory
    `--base` whose checkout lacks it.
  M5 / leg (g) — on a plain compile the claims-v1 non-text same-file
    classifier reads the tree at the sha too: a shared path committed as a
    symlink there orders the pair into two waves, while the same path held as
    a plain text file in the checkout leaves them in one.
  M7 / leg (j) — `skills/ultrawrite/SKILL.md` §The proof gate carries the
    compile line with `--base <checkout-dir|sha>` and the sentence naming both
    forms and local presence. The two assertions below are the two `Run:`
    bullets of the Proof, scoped to the same section boundary.

Every fixture plan is a signed claims-v1 plan (spec §4.5: the compiler refuses
to compile one without its gate-verdict record), and `_renders` asserts the
fixture's own health — exit 0, `PLAN OK` first, renders not skipped — before
any advisory line is read off it, so a broken fixture never reads as a missing
render.
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
SKILL = ROOT / "skills/ultrawrite/SKILL.md"
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import compile_plan  # noqa: E402
# leg (c) [M3]: the `--help` entry is dewrapped exactly as #637's exam dewraps
# it — argparse wraps at spaces AND after hyphens, so the reader is imported
# rather than re-written here.
from test_compile_plan_base_message import _base_entry, _help_text  # noqa: E402

# --------------------------------------------------------------------------- #
# The verbatim strings the task pins, quoted from its own words                #
# --------------------------------------------------------------------------- #
# M3: the 40-hex value that names no commit of any repository built here.
ZEROS = "0000000000000000000000000000000000000000"
# M3: the #637 sentence this task deletes — no run may print it any more.
WANTS_A_CHECKOUT = "wants a checkout directory"
# M3: the two tokens the `--base` help entry carries.
CHECKOUT_DIR = "<checkout-dir>"
SHA_TOKEN = "<sha>"
# M2: the skip line a directory that is not a checkout still draws.
NOT_A_CHECKOUT = "ADVISORY renders skipped: %s is not a git checkout"
# M2: the five canonical fixtures, and the only stdout each may print.
CANONICAL = ("wide", "chained", "mixed", "degrade", "contend")
PLAN_OK = "PLAN OK\n"
# M1: the render must RUN under a sha — a skipped render prints no referent
# line either, and that is not what M1 asserts.
SKIPPED_PREFIX = "ADVISORY renders skipped:"

# M1 / leg (a): the path that exists only in the tree at the sha.
ONLY_PATH = "pkg/only.py"
ONLY_PY = "VALUE = 1\n"
REFERENT_LINE = ("ADVISORY referent: Task 1 names `%s` — not at BASE, not in "
                 "Task 1's Files, not Created by a task it Depends-on"
                 % ONLY_PATH)

# M4 (i) / leg (d): the code file mentioning the Produces symbol.
USES_SYM_PATH = "lib/uses_sym.py"
PRODUCES_SYMBOL = "probe_sym"
USES_SYM_PY = "from probe import %s\n\n\ndef call():\n    return %s(1)\n" % (
    PRODUCES_SYMBOL, PRODUCES_SYMBOL)
BLAST_HEAD = ("ADVISORY blast-radius: Task 1 Produces `%s` — 1 file(s) at BASE "
              "outside Task 1's Files mention it:" % PRODUCES_SYMBOL)
BLAST_BULLET = "  - " + USES_SYM_PATH

# M4 (ii) / leg (e): the span a sibling test file pins, and that file.
PINNED_SPAN = "runner: None"
PIN_PATH = "tests/test_pin.py"
PIN_PY = "def test_header():\n    assert header() == '%s'\n" % PINNED_SPAN
PINNED_LINE = ("ADVISORY proof-species: pinned-elsewhere — task 1: %s is "
               "asserted in %s, which is in no task's Files"
               % (PINNED_SPAN, PIN_PATH))
PINNED_PREFIX = "ADVISORY proof-species: pinned-elsewhere"

# M4 (iii) / leg (f): the `Test:` file that freezes an earlier commit's sha.
FROZEN_PATH = "tests/test_frozen.py"
FROZEN_LINE = ("ADVISORY proof-species: base-sha-in-suite — task 1: %s freezes "
               "commit %%s at line 1 — a BASE comparison is a Run:, never a "
               "committed exam" % FROZEN_PATH)
FROZEN_PREFIX = "ADVISORY proof-species: base-sha-in-suite"

# M5 / leg (g): the shared path, a symlink at the sha and plain text after.
SHARED_PATH = "app/shared"
SHARED_TARGET = "target.txt"
SHARED_TEXT = "a plain, line-wise mergeable text file\n"

# M7 / leg (j): the two `Run:` bullets' subject, and the section they scope to.
SECTION_START = "## The proof gate"
SECTION_END = "## The worktree-pure contract"
COMPILE_LINE = ("compile_plan.py --check --renders --base <checkout-dir|sha> "
                "<plan.md>")
BOTH_FORMS_RE = re.compile(r"a checkout directory or a 40-hex sha.*present "
                           r"locally")

README = "# a fixture repository built by tests/test_compile_plan_base_tree.py\n"


# --------------------------------------------------------------------------- #
# Fixture repositories: a commit that carries the file, then one that drops it #
# --------------------------------------------------------------------------- #
def _git(repo, *args):
    p = subprocess.run(["git", "-C", str(repo), *args],
                       capture_output=True, text=True)
    assert p.returncode == 0, "git %s failed:\n%s" % (" ".join(args), p.stderr)
    return p.stdout


def _repo_init(tmp_path, name="repo"):
    repo = tmp_path / name
    repo.mkdir(parents=True)
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "exam@example.invalid")
    _git(repo, "config", "user.name", "exam")
    return repo


def _commit(repo, files, msg="c"):
    """Write (or, for a None value, delete) `files` and commit them. Returns
    the new HEAD sha, 40-hex."""
    for rel, text in files.items():
        p = repo / rel
        if text is None:
            p.unlink()
            continue
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", msg)
    return _git(repo, "rev-parse", "HEAD").strip()


def _head(repo):
    return _git(repo, "rev-parse", "HEAD").strip()


def _assert_forty_hex(sha):
    assert re.fullmatch(r"[0-9a-f]{40}", sha), (
        "fixture: `--base` is given a 40-hex sha; got %r" % (sha,))
    return sha


# --------------------------------------------------------------------------- #
# Fixture plans: signed claims-v1, written INSIDE the fixture repository       #
# --------------------------------------------------------------------------- #
HEADER = ("# Plan: One reader for the tree at BASE\n"
          "\n"
          "**Grammar:** claims-v1\n"
          "\n"
          "**Acceptance:** waived — inline test plan\n"
          "\n")

CONTEXT = ("The reader this task installs answers every file-level question "
           "the compile asks, so the tree it is handed decides what the "
           "renders can see and what they cannot. %s")


def _task(task_id, files, machine, context, produces=None,
          legs="(a) the probe holds [M1]."):
    """One claims-v1 task carrying all six slots."""
    produces = produces or ("`probe_%s(n: int) -> str`" % task_id)
    return ("### Task %s: Sample %s\n"
            "\n"
            "**Type:** implementation\n"
            "\n"
            "**Files:**\n"
            "%s"
            "\n"
            "**Claim:** An operator checking a plan against a commit gets the "
            "answers that commit's tree gives. (quoted from #725)\n"
            "Machine: %s\n"
            "\n"
            "**Authorized-by:** #725\n"
            "\n"
            "**Interfaces:**\n"
            "- Consumes: nothing\n"
            "- Produces: %s\n"
            "\n"
            "**Context:** %s\n"
            "\n"
            "**Proof:**\n"
            "- Run: python3 scripts/probe_%s.py --header\n"
            "- Legs: %s\n"
            "\n"
            "**Stale-if:**\n"
            "- issue-closed: #725\n"
            % (task_id, task_id, "".join(l + "\n" for l in files), machine,
               produces, context, task_id, legs))


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


def _write_plan(where, *tasks, name="plan.md"):
    plan = where / name
    plan.write_text(HEADER + "\n".join(tasks))
    return _sign(plan)


# --------------------------------------------------------------------------- #
# Running the compiler                                                         #
# --------------------------------------------------------------------------- #
def _run(plan, *extra):
    return subprocess.run(
        [sys.executable, str(COMPILER), str(plan)] + [str(a) for a in extra],
        capture_output=True, text=True, cwd=str(ROOT))


def _renders(plan, base):
    """`--check --renders --base <base>` lines, with the fixture's own health
    asserted first: the verdict vocabulary is frozen, so `PLAN OK` and exit 0
    hold for every run below, and the renders must have RUN — a skipped render
    says nothing about the tree and would answer M1/M4 by accident."""
    p = _run(plan, "--check", "--renders", "--base", base)
    assert (p.returncode, p.stdout.splitlines()[:1]) == (0, ["PLAN OK"]), (
        "the frozen verdict and exit code are untouched by a `--base` mode: "
        "`--check --renders --base %s` prints `PLAN OK` and exits 0; got "
        "rc=%d\n%s%s" % (base, p.returncode, p.stdout, p.stderr))
    skipped = [l for l in p.stdout.splitlines() if l.startswith(SKIPPED_PREFIX)]
    assert skipped == [], (
        "a `--base` the compiler can read skips no render: `--base %s` printed "
        "%s" % (base, skipped))
    return p.stdout.splitlines()


def _contains(lines, needle):
    return [l for l in lines if needle in l]


# --------------------------------------------------------------------------- #
# (a) [M1] the referent render reads the tree at the sha                       #
# --------------------------------------------------------------------------- #
@pytest.fixture
def referent(tmp_path):
    """A repository whose first commit carries `pkg/only.py` and whose second
    deletes it, and a signed plan inside it naming that path in Context."""
    repo = _repo_init(tmp_path)
    sha = _assert_forty_hex(
        _commit(repo, {"README.md": README, ONLY_PATH: ONLY_PY}, "the file"))
    _commit(repo, {ONLY_PATH: None}, "delete the file")
    assert _head(repo) != sha and not (repo / ONLY_PATH).exists(), (
        "fixture: the checkout must LACK the path the sha's tree carries")
    plan = _write_plan(repo, _task(
        "1", ["- Modify: `app/x.py`", "- Test: `tests/test_x.py`"],
        "M1. The probe header reports one line.",
        CONTEXT % ("The definition the probe copies lives in `%s`." % ONLY_PATH)))
    return SimpleNamespace(repo=repo, sha=sha, plan=plan)


def test_a_sha_base_resolves_a_path_that_exists_only_at_that_commit(referent):
    """leg (a) [M1]: under `--base <sha>` the tree at that commit carries
    `pkg/only.py`, so the referent render says nothing about it."""
    lines = _renders(referent.plan, referent.sha)
    offenders = [l for l in lines
                 if l.startswith("ADVISORY referent:") and ONLY_PATH in l]
    assert offenders == [], (
        "leg (a) [M1]: `--check --renders --base %s` prints no `ADVISORY "
        "referent:` line for `%s` — the tree at that commit carries it. Got:\n"
        "%s" % (referent.sha, ONLY_PATH, "\n".join(offenders)))


def test_a_directory_base_lacking_the_path_names_it_once(referent):
    """leg (a) [M1]: the same plan against the CHECKOUT, whose tree lacks the
    path, draws exactly one `ADVISORY referent:` line, and it is BASE's own
    sentence."""
    lines = _renders(referent.plan, referent.repo)
    hits = [l for l in lines
            if l.startswith("ADVISORY referent:") and ONLY_PATH in l]
    assert hits == [REFERENT_LINE], (
        "leg (a) [M1]: `--check --renders --base %s`, a checkout whose tree "
        "lacks `%s`, prints exactly one line:\n  %s\nGot:\n%s"
        % (referent.repo, ONLY_PATH, REFERENT_LINE, "\n".join(hits) or "(none)"))


# --------------------------------------------------------------------------- #
# (b) [M2] a directory `--base` prints what it printed at BASE                 #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("name", CANONICAL)
def test_each_canonical_fixture_still_prints_only_plan_ok(name):
    """leg (b) [M2]: `--check --renders --base evals/fixtures/<name>/project`
    on `evals/fixtures/<name>/plan.md` exits 0 with stdout exactly `PLAN OK`
    plus its newline — no advisory, no skip note, not one byte more."""
    plan = ROOT / ("evals/fixtures/%s/plan.md" % name)
    project = ROOT / ("evals/fixtures/%s/project" % name)
    p = _run(plan, "--check", "--renders", "--base", project)
    assert (p.returncode, p.stdout) == (0, PLAN_OK), (
        "leg (b) [M2]: the `%s` fixture prints exactly %r and exits 0 under a "
        "directory `--base`; got rc=%d, stdout=%r\n%s"
        % (name, PLAN_OK, p.returncode, p.stdout, p.stderr))


def test_a_directory_that_is_not_a_checkout_still_draws_the_skip_line(tmp_path):
    """leg (b) [M2]: an empty directory `--base` is still a directory, and the
    #637 skip line for one that is not a git checkout is unchanged."""
    empty = tmp_path / "empty-dir"
    empty.mkdir()
    probe = subprocess.run(["git", "-C", str(empty), "rev-parse", "--show-toplevel"],
                           capture_output=True, text=True)
    assert probe.returncode != 0 or not probe.stdout.strip(), (
        "fixture: %s must not resolve to a git checkout; got %r"
        % (empty, probe.stdout))
    clean = ROOT / "evals/fixtures/wide/plan.md"
    p = _run(clean, "--check", "--renders", "--base", empty)
    assert p.returncode == 0, p.stdout + p.stderr
    assert p.stdout == PLAN_OK + "\n" + NOT_A_CHECKOUT % empty + "\n", (
        "leg (b) [M2]: a directory that is not a git checkout still draws\n"
        "  %s\nGot:\n%s" % (NOT_A_CHECKOUT % empty, p.stdout))


# --------------------------------------------------------------------------- #
# (c) [M3] a sha that names no commit, and a plan outside any checkout         #
# --------------------------------------------------------------------------- #
def _assert_error_run(p, sha, what):
    """M3's three assertions for a refused sha: non-zero exit, EMPTY stdout —
    no verdict line at all — and exactly one stderr line, beginning `error:`
    and containing the sha."""
    assert p.returncode != 0, (
        "leg (c) [M3]: %s exits non-zero; got 0\n%s%s" % (what, p.stdout, p.stderr))
    assert p.stdout == "", (
        "leg (c) [M3]: %s prints EMPTY stdout — no `PLAN OK`, no `N "
        "violation(s)`, no verdict line at all. Got:\n%s" % (what, p.stdout))
    err = p.stderr.splitlines()
    assert len(err) == 1, (
        "leg (c) [M3]: %s prints exactly one stderr line; got %d:\n%s"
        % (what, len(err), p.stderr))
    assert err[0].startswith("error:"), (
        "leg (c) [M3]: %s's stderr line begins `error:`; got:\n  %s"
        % (what, err[0]))
    assert sha in err[0], (
        "leg (c) [M3]: %s's `error:` line contains the sha %s; got:\n  %s"
        % (what, sha, err[0]))


def test_a_forty_hex_base_naming_no_commit_is_an_error(referent):
    """leg (c) [M3]: a 40-hex `--base` that names no commit of the plan's own
    repository is refused — it is an input the compiler cannot read, not a
    tree it may guess at."""
    _assert_forty_hex(ZEROS)
    _assert_error_run(_run(referent.plan, "--check", "--renders", "--base", ZEROS),
                      ZEROS, "`--check --renders --base %s`" % ZEROS)


def test_a_forty_hex_base_for_a_plan_outside_any_checkout_is_an_error(referent,
                                                                      tmp_path):
    """leg (c) [M3]: a sha names a commit of the PLAN's repository, so a plan
    that lies outside any checkout has no repository to read it in."""
    probe = subprocess.run(["git", "-C", str(tmp_path), "rev-parse", "--show-toplevel"],
                           capture_output=True, text=True)
    assert probe.returncode != 0 or not probe.stdout.strip(), (
        "fixture: %s must not lie inside a git checkout; got %r"
        % (tmp_path, probe.stdout))
    outside = _write_plan(tmp_path, _task(
        "1", ["- Modify: `app/x.py`", "- Test: `tests/test_x.py`"],
        "M1. The probe header reports one line.",
        CONTEXT % "There is no checkout around this plan at all."),
        name="outside.md")
    _assert_error_run(
        _run(outside, "--check", "--renders", "--base", referent.sha),
        referent.sha, "`--base %s` for a plan outside any checkout" % referent.sha)


def test_no_run_on_the_sha_fixture_wants_a_checkout_directory(referent, tmp_path):
    """leg (c) [M3]: the #637 skip line is GONE. Neither of the two runs that
    read a tree nor either of the two that are refused says the flag wants a
    checkout directory — a sha is an input the compiler reads, so nothing
    tells the caller to hand it a directory instead."""
    outside = _write_plan(tmp_path, _task(
        "1", ["- Modify: `app/x.py`", "- Test: `tests/test_x.py`"],
        "M1. The probe header reports one line.",
        CONTEXT % "There is no checkout around this plan at all."),
        name="outside.md")
    runs = [
        ("--base <sha>", _run(referent.plan, "--check", "--renders",
                              "--base", referent.sha)),
        ("--base <dir>", _run(referent.plan, "--check", "--renders",
                              "--base", referent.repo)),
        ("--base %s" % ZEROS, _run(referent.plan, "--check", "--renders",
                                   "--base", ZEROS)),
        ("--base <sha>, plan outside a checkout",
         _run(outside, "--check", "--renders", "--base", referent.sha)),
    ]
    offenders = [(what, line) for what, p in runs
                 for line in (p.stdout + p.stderr).splitlines()
                 if WANTS_A_CHECKOUT in line]
    assert offenders == [], (
        "leg (c) [M3]: no run prints a line containing `%s`; got:\n%s"
        % (WANTS_A_CHECKOUT,
           "\n".join("%s: %s" % pair for pair in offenders)))


def test_the_help_entry_for_base_names_a_checkout_dir_and_a_sha():
    """leg (c) [M3]: the `--help` entry for `--base` carries both
    `<checkout-dir>` and `<sha>` — dewrapped as #637's exam dewraps it, since
    argparse breaks the entry at spaces and after hyphens."""
    entry = _base_entry(_help_text())
    missing = [tok for tok in (CHECKOUT_DIR, SHA_TOKEN) if tok not in entry]
    assert missing == [], (
        "leg (c) [M3]: the `--base` help entry names both forms — `%s` and "
        "`%s`. Missing %s. Got the entry:\n%s"
        % (CHECKOUT_DIR, SHA_TOKEN, missing, entry))


# --------------------------------------------------------------------------- #
# (d) [M4 (i)] the Produces blast radius reads the tree at the sha             #
# --------------------------------------------------------------------------- #
@pytest.fixture
def blast(tmp_path):
    """`lib/uses_sym.py` mentions `probe_sym` as a whole word only in the first
    commit; the second deletes the file."""
    repo = _repo_init(tmp_path)
    sha = _assert_forty_hex(
        _commit(repo, {"README.md": README, USES_SYM_PATH: USES_SYM_PY},
                "the caller"))
    _commit(repo, {USES_SYM_PATH: None}, "delete the caller")
    assert not (repo / USES_SYM_PATH).exists()
    plan = _write_plan(repo, _task(
        "1", ["- Modify: `app/x.py`", "- Test: `tests/test_x.py`"],
        "M1. The probe header reports one line.",
        CONTEXT % "The symbol this task Produces is called from elsewhere.",
        produces="`%s(n: int) -> str`" % PRODUCES_SYMBOL))
    return SimpleNamespace(repo=repo, sha=sha, plan=plan)


def test_blast_radius_lists_a_caller_that_exists_only_at_the_sha(blast):
    """leg (d) [M4 (i)]: under `--base <sha>` the blast radius names
    `lib/uses_sym.py` — the tree at that commit is where the symbol is
    mentioned."""
    lines = _renders(blast.plan, blast.sha)
    assert BLAST_HEAD in lines and BLAST_BULLET in lines, (
        "leg (d) [M4 (i)]: `--base %s` prints the blast-radius header\n  %s\n"
        "and the bullet\n  %s\nGot:\n%s"
        % (blast.sha, BLAST_HEAD, BLAST_BULLET, "\n".join(lines)))


def test_blast_radius_names_no_caller_a_checkout_lacking_it_has(blast):
    """leg (d) [M4 (i)]: against the checkout, which deleted the file, no line
    names it."""
    lines = _renders(blast.plan, blast.repo)
    assert _contains(lines, USES_SYM_PATH) == [], (
        "leg (d) [M4 (i)]: `--base %s`, a checkout whose tree lacks `%s`, "
        "names it on no line. Got:\n%s"
        % (blast.repo, USES_SYM_PATH, "\n".join(_contains(lines, USES_SYM_PATH))))


# --------------------------------------------------------------------------- #
# (e) [M4 (ii)] the `pinned-elsewhere` species reads the tree at the sha       #
# --------------------------------------------------------------------------- #
@pytest.fixture
def pinned(tmp_path):
    """`tests/test_pin.py` carries the exact span `runner: None` only in the
    first commit; the second deletes it. The task's Files declare it nowhere,
    which is what the species turns on."""
    repo = _repo_init(tmp_path)
    sha = _assert_forty_hex(
        _commit(repo, {"README.md": README, PIN_PATH: PIN_PY}, "the pin"))
    _commit(repo, {PIN_PATH: None}, "delete the pin")
    assert not (repo / PIN_PATH).exists()
    plan = _write_plan(repo, _task(
        "1", ["- Modify: `app/x.py`", "- Test: `tests/test_x.py`"],
        "M1. The probe header reports `%s`." % PINNED_SPAN,
        CONTEXT % "A sibling suite may already assert the span this clause pins.",
        legs="(a) the header carries the span, and carries nothing else [M1]."))
    return SimpleNamespace(repo=repo, sha=sha, plan=plan)


def test_pinned_elsewhere_draws_its_line_for_a_pin_only_at_the_sha(pinned):
    """leg (e) [M4 (ii)]: under `--base <sha>` the species names
    `tests/test_pin.py`, on exactly one line, in BASE's own sentence."""
    lines = _renders(pinned.plan, pinned.sha)
    hits = [l for l in lines if l.startswith(PINNED_PREFIX)]
    assert hits == [PINNED_LINE], (
        "leg (e) [M4 (ii)]: `--base %s` prints exactly one line:\n  %s\nGot:\n%s"
        % (pinned.sha, PINNED_LINE, "\n".join(hits) or "(none)"))


def test_pinned_elsewhere_is_silent_against_a_checkout_lacking_the_pin(pinned):
    """leg (e) [M4 (ii)]: against the checkout, which deleted the pinning file,
    the species draws no line at all."""
    lines = _renders(pinned.plan, pinned.repo)
    hits = [l for l in lines if l.startswith(PINNED_PREFIX)]
    assert hits == [], (
        "leg (e) [M4 (ii)]: `--base %s`, a checkout whose tree lacks `%s`, "
        "draws no `pinned-elsewhere` line. Got:\n%s"
        % (pinned.repo, PIN_PATH, "\n".join(hits)))


# --------------------------------------------------------------------------- #
# (f) [M4 (iii)] the `base-sha-in-suite` species reads the tree at the sha     #
# --------------------------------------------------------------------------- #
@pytest.fixture
def frozen(tmp_path):
    """Three commits — a commit's tree cannot contain its own sha, so the
    `Test:` file that freezes the FIRST commit's sha lands in the second, and
    the third deletes it."""
    repo = _repo_init(tmp_path)
    first = _assert_forty_hex(_commit(repo, {"README.md": README}, "first"))
    second = _assert_forty_hex(
        _commit(repo, {FROZEN_PATH: "FROZEN = '%s'\n" % first}, "the exam"))
    _commit(repo, {FROZEN_PATH: None}, "delete the exam")
    assert not (repo / FROZEN_PATH).exists()
    plan = _write_plan(repo, _task(
        "1", ["- Modify: `app/x.py`", "- Test: `%s`" % FROZEN_PATH],
        "M1. The probe header reports one line.",
        CONTEXT % "The exam this task owns may already freeze a commit."))
    return SimpleNamespace(repo=repo, first=first, sha=second, plan=plan)


def test_base_sha_in_suite_draws_its_line_for_an_exam_only_at_the_sha(frozen):
    """leg (f) [M4 (iii)]: under `--base <second commit sha>` the `Test:` file
    is in that tree and freezes the first commit's sha, so the species names
    both."""
    lines = _renders(frozen.plan, frozen.sha)
    hits = [l for l in lines if l.startswith(FROZEN_PREFIX)]
    assert hits == [FROZEN_LINE % frozen.first], (
        "leg (f) [M4 (iii)]: `--base %s` prints exactly one line:\n  %s\nGot:\n%s"
        % (frozen.sha, FROZEN_LINE % frozen.first, "\n".join(hits) or "(none)"))


def test_base_sha_in_suite_is_silent_against_a_checkout_lacking_the_exam(frozen):
    """leg (f) [M4 (iii)]: against the checkout, whose HEAD deleted the exam,
    the species draws no line."""
    lines = _renders(frozen.plan, frozen.repo)
    hits = [l for l in lines if l.startswith(FROZEN_PREFIX)]
    assert hits == [], (
        "leg (f) [M4 (iii)]: `--base %s`, a checkout whose tree lacks `%s`, "
        "draws no `base-sha-in-suite` line. Got:\n%s"
        % (frozen.repo, FROZEN_PATH, "\n".join(hits)))


# --------------------------------------------------------------------------- #
# (g) [M5] the plain compile's non-text classifier reads the tree at the sha   #
# --------------------------------------------------------------------------- #
@pytest.fixture
def shared(tmp_path):
    """`app/shared` is committed as a SYMLINK in the first commit and replaced
    by a plain text file in the second — a symlink no kernel fold can merge,
    a text file it can."""
    repo = _repo_init(tmp_path)
    (repo / "app").mkdir()
    (repo / "app" / SHARED_TARGET).write_text("the link's target\n")
    (repo / "README.md").write_text(README)
    os.symlink(SHARED_TARGET, repo / SHARED_PATH)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "the symlink")
    sha = _assert_forty_hex(_head(repo))
    mode = _git(repo, "ls-tree", sha, "--", SHARED_PATH).split()[:1]
    assert mode == ["120000"], (
        "fixture: `%s` must be a symlink at %s; got mode %s"
        % (SHARED_PATH, sha, mode))
    (repo / SHARED_PATH).unlink()
    _commit(repo, {SHARED_PATH: SHARED_TEXT}, "a plain text file")
    plan = _write_plan(
        repo,
        _task("1", ["- Modify: `%s`" % SHARED_PATH, "- Test: `tests/test_1.py`"],
              "M1. The probe header reports one line.",
              CONTEXT % "Both tasks edit the one shared path."),
        _task("2", ["- Modify: `%s`" % SHARED_PATH, "- Test: `tests/test_2.py`"],
              "M1. The probe footer reports one line.",
              CONTEXT % "Both tasks edit the one shared path."))
    return SimpleNamespace(repo=repo, sha=sha, plan=plan)


def _waves(plan, base):
    p = _run(plan, "--base", base)
    assert p.returncode == 0, (
        "the plain compile exits 0 under `--base %s`; got rc=%d\n%s%s"
        % (base, p.returncode, p.stdout, p.stderr))
    return json.loads(p.stdout)["waves"]


def test_a_symlink_at_the_sha_orders_the_same_file_pair_into_two_waves(shared):
    """leg (g) [M5]: on a plain compile `--base <sha>` classifies the shared
    path by the tree at that commit — a symlink there, so the pair is ordered
    and lands in two waves."""
    waves = _waves(shared.plan, shared.sha)
    assert waves == [["1"], ["2"]], (
        "leg (g) [M5]: `--base %s`, where `%s` is a symlink, compiles the "
        "two-task plan to two waves; got %s"
        % (shared.sha, SHARED_PATH, waves))


def test_a_text_file_in_the_checkout_leaves_the_pair_in_one_wave(shared):
    """leg (g) [M5]: the same plan against the CHECKOUT, which holds the path
    as a plain text file, leaves the pair unordered — one wave, folded at merge
    time."""
    waves = _waves(shared.plan, shared.repo)
    assert waves == [["1", "2"]], (
        "leg (g) [M5]: `--base %s`, where `%s` is a plain text file, compiles "
        "the two-task plan to one wave; got %s"
        % (shared.repo, SHARED_PATH, waves))


# --------------------------------------------------------------------------- #
# (j) [M7] the skill's proof gate names both `--base` forms                    #
# --------------------------------------------------------------------------- #
def _proof_gate_section():
    """§The proof gate, scoped exactly as the Proof's two `Run:` bullets scope
    it: from `## The proof gate` through `## The worktree-pure contract`."""
    lines = SKILL.read_text().splitlines()
    starts = [i for i, l in enumerate(lines) if l.startswith(SECTION_START)]
    ends = [i for i, l in enumerate(lines) if l.startswith(SECTION_END)]
    assert len(starts) == 1 and len(ends) == 1, (
        "fixture: `%s` carries `%s` and `%s` exactly once each; got %d and %d"
        % (SKILL, SECTION_START, SECTION_END, len(starts), len(ends)))
    return lines[starts[0]:ends[0] + 1]


def test_the_proof_gate_carries_the_compile_line_with_both_base_forms():
    """leg (j) [M7]: §The proof gate's compile line is
    `compile_plan.py --check --renders --base <checkout-dir|sha> <plan.md>` —
    the Proof's second `Run:` bullet, asserted here too."""
    section = _proof_gate_section()
    assert any(COMPILE_LINE in l for l in section), (
        "leg (j) [M7]: §The proof gate carries the compile line\n  %s\nGot the "
        "section:\n%s" % (COMPILE_LINE, "\n".join(section)))


def test_the_proof_gate_says_base_takes_a_directory_or_a_local_sha():
    """leg (j) [M7]: the same section says `--base` takes a checkout directory
    or a 40-hex sha, and that a sha must be present locally — the Proof's third
    `Run:` bullet, asserted here too."""
    flat = " ".join(_proof_gate_section())
    assert BOTH_FORMS_RE.search(flat), (
        "leg (j) [M7]: §The proof gate carries a sentence matching `%s` — "
        "`--base` takes a checkout directory or a 40-hex sha, and a sha must "
        "be present locally. Got the section:\n%s"
        % (BOTH_FORMS_RE.pattern, "\n".join(_proof_gate_section())))
