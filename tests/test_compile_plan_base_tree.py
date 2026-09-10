"""One reader for the tree at BASE, a directory or a sha (#725).

`--base` used to mean one thing: a checkout directory, read through
`git -C <dir>` and through `open()`. #725 makes it mean the TREE — a checkout
directory OR a 40-hex commit sha of the plan's own repository — so a plan can
be checked against the exact commit `launch.mjs --base` will use. A sha is an
INPUT, not a new diagnostic: every refusal species, verdict and exit code a
directory `--base` produces stays where it was, byte for byte.

This exam pins the Machine clauses leg by leg. Each fixture repository is built
here, so every sha it asserts is its own and nothing reads the network. The
shape is the one the task names: one `git init` repository under `tmp_path`,
a first commit carrying the sha-only file, then a commit that deletes it — so
the working directory of that same repository IS the "checkout lacking the
file" the directory half of every leg needs, and no clone is made.

  M2 / leg (b) — a directory `--base` prints what it printed at BASE: each of
    the five canonical fixtures (`wide`, `chained`, `mixed`, `degrade`,
    `contend`) prints exactly `PLAN OK` and nothing else.
  M3 / leg (c) — a 40-hex `--base` naming no commit of the plan's repository,
    and a 40-hex `--base` given for a plan outside any checkout, each exit
    non-zero with EMPTY stdout (no verdict line at all) and one stderr line
    beginning `error:` that contains the sha. None of the runs this exam makes
    on the sha fixture prints a line containing `wants a checkout directory` —
    the #637 skip line is gone, because a sha is now read, not refused. The
    `--help` entry for `--base` names both `<checkout-dir>` and `<sha>`.
  M5 / leg (g) — on a plain compile the claims-v1 non-text same-file
    classifier reads the tree at the sha too: a shared path committed as a
    symlink there orders the pair into two waves, while the same path held as
    a plain text file in the checkout leaves them in one.

Every fixture plan is a signed claims-v1 plan (spec §4.5: the compiler refuses
to compile one without its gate-verdict record).
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
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import compile_plan  # noqa: E402

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
# M2: the five canonical fixtures, and the only stdout each may print.
CANONICAL = ("wide", "chained", "mixed", "degrade", "contend")
PLAN_OK = "PLAN OK\n"

# M3 / leg (c): the file the fixture repository's first commit carries and its
# second deletes — the plan every sha run below is made against sits beside it.
ONLY_PATH = "pkg/only.py"
ONLY_PY = "VALUE = 1\n"

# M5 / leg (g): the shared path, a symlink at the sha and plain text after.
SHARED_PATH = "app/shared"
SHARED_TARGET = "target.txt"
SHARED_TEXT = "a plain, line-wise mergeable text file\n"

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
           "compile can see and what it cannot. %s")


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
# --------------------------------------------------------------------------- #
# The fixture repository the sha legs are made against                         #
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


# --------------------------------------------------------------------------- #
# (b) [M2] a directory `--base` prints what it printed at BASE                 #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("name", CANONICAL)
def test_each_canonical_fixture_still_prints_only_plan_ok(name):
    """leg (b) [M2]: `--check --base evals/fixtures/<name>/project`
    on `evals/fixtures/<name>/plan.md` exits 0 with stdout exactly `PLAN OK`
    plus its newline — not one byte more."""
    plan = ROOT / ("evals/fixtures/%s/plan.md" % name)
    project = ROOT / ("evals/fixtures/%s/project" % name)
    p = _run(plan, "--check", "--base", project)
    assert (p.returncode, p.stdout) == (0, PLAN_OK), (
        "leg (b) [M2]: the `%s` fixture prints exactly %r and exits 0 under a "
        "directory `--base`; got rc=%d, stdout=%r\n%s"
        % (name, PLAN_OK, p.returncode, p.stdout, p.stderr))
# --------------------------------------------------------------------------- #
# (c) [M3] a sha that names no commit, and a plan outside any checkout         #
# --------------------------------------------------------------------------- #
_OPTION_START = re.compile(r"^ {2}(-\S)")


def _dewrap(lines):
    """Undo argparse's fill: it wraps at spaces AND after hyphens, so a
    hyphen-broken `<checkout-` / `dir>` must rejoin with no space between."""
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
        "`--help` lists the `--base` option exactly once; got %d:\n%s"
        % (len(starts), help_text))
    start = starts[0]
    end = start + 1
    while (end < len(lines) and lines[end].strip()
           and not _OPTION_START.match(lines[end])):
        end += 1
    return _dewrap(lines[start:end])


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
    _assert_error_run(_run(referent.plan, "--check", "--base", ZEROS),
                      ZEROS, "`--check --base %s`" % ZEROS)


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
        _run(outside, "--check", "--base", referent.sha),
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
        ("--base <sha>", _run(referent.plan, "--check", "--base",
                              referent.sha)),
        ("--base <dir>", _run(referent.plan, "--check", "--base",
                              referent.repo)),
        ("--base %s" % ZEROS, _run(referent.plan, "--check", "--base", ZEROS)),
        ("--base <sha>, plan outside a checkout",
         _run(outside, "--check", "--base", referent.sha)),
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
