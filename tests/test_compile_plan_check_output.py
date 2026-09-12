"""`--check` prints a verdict and nothing else — the advisory tier is gone.

The exam for task 2 of plan run-88. Both advisory channels leave the compiler:
Channel A, the unconditional `ADVISORY grammar:` lines, and Channel B, the ten
`--renders` advisories together with the `--renders` and `--exclude` flags that
gate them. What survives is everything with a reader outside the tier — the
symbols `skills/ultrawrite/scripts/pin_base_facts.py` imports, `BaseTree` and
its `--base` flag, the `proofGuards` data key — and, above all, the compiled
output itself: every fixture plan must still compile to the same waves, DAG
edges and launch waves it did at BASE. `evals/compile_census.py` is the
instrument that says so, and this exam grades the instrument as well as the
deletion.

One test (sometimes two) per Proof leg, each assertion naming its leg and the
Machine clause it comes from:

  (a) [M1] `--check` on the claims fixture exits 0 and its stdout, as bytes, is
      exactly `PLAN OK` plus one newline; any extra line is printed on failure.
  (b) [M2] no line of `compile_plan.py` contains `ADVISORY`, and
      `--check --renders <plan>` and `--check --exclude x <plan>` each exit 2
      with `unrecognized arguments` on stderr.
  (c) [M3] `import pin_base_facts` succeeds with `skills/ultrawrite/scripts` on
      `sys.path`, and `compile_plan` still defines all nine named symbols.
  (d) [M4] the fifteen retired test files and `evals/check_renders_ab.py` are
      absent.
  (e) [M6] `compile_plan.py` is between 2000 and 3300 lines.
  (f) [M5] the census lists exactly the `evals/fixtures/*/plan.md` directory
      names, sorted, one line each, with a 64-hex digest that equals the one
      this exam recomputes from its own plain compile; and it exits 1 naming
      the first fixture on stderr both when a compile exits non-zero and when a
      compile's JSON lacks any of the three keys.
  (g) [M5] the census lists the same thirteen fixtures for the BASE compiler as
      for this tree's, and each fixture's three output keys digest the same at
      BASE as here once the entry keys added since BASE are removed (today:
      `factsheet`, #913) — the Proof's `Run:` bullet, run here.

Leg (c) is a survival leg: it passes at BASE and must keep passing. Every other
leg is red at BASE, where the advisory tier is still in the compiler and the
census does not exist yet.
"""
import fcntl
import hashlib
import json
import os
import pathlib
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPILER_REL = "skills/ultrapowers/scripts/compile_plan.py"
COMPILER = ROOT / COMPILER_REL
CENSUS_REL = "evals/compile_census.py"
CENSUS = ROOT / CENSUS_REL

# The token leg (b) must not find in the compiler. This exam scans
# `compile_plan.py`, never itself, so spelling it plainly here is safe.
ADVISORY = "ADVISORY"

# The BASE the Proof's `Run:` bullet resolves through `$ULTRA_BASE`; the literal
# is task 2's own BASE, used when the variable is unset (a bare `pytest` run).
BASE_SHA = os.environ.get(
    "ULTRA_BASE") or "a4138b230fb10986a2ac1603f2467d41c62a512b"

CLAIMS_PLAN = ROOT / "evals/fixtures/claims/plan.md"

# Leg (f) globs the corpus itself rather than trusting a hand-written list; M5's
# thirteen names are pinned separately, below.
FIXTURE_PLANS = sorted((ROOT / "evals/fixtures").glob("*/plan.md"))
FIXTURE_NAMES = [plan.parent.name for plan in FIXTURE_PLANS]

M5_NAMES_AT_BASE = [
    "bun-greenfield", "chained", "claims", "contend", "contend-big",
    "contend-prod", "contend-wide", "degrade", "flawed", "flawed-routing",
    "mixed", "webapp", "wide",
]

# M3's nine survivors: the first two are what pin_base_facts imports by name,
# the rest are the compiler's own load-bearing entry points.
SURVIVING_SYMBOLS = [
    "_path_referent", "_referent_scan_lines", "BaseTree", "default_base",
    "match_head", "plan_grammar", "split_tasks", "_fence_aware_lines", "_git",
]

# M4's fifteen retired test files, plus the A/B harness that only ever drove two
# renders. Every one is deleted whole, not emptied.
RETIRED_PATHS = [
    "tests/test_compile_plan_pinned_elsewhere.py",
    "tests/test_check_renders.py",
    "tests/test_compile_plan_base_sha_in_suite.py",
    "tests/test_compile_plan_wide_files.py",
    "tests/test_compile_plan_sha_unguarded.py",
    "tests/test_compile_plan_proof_species.py",
    "tests/test_compile_plan_one_sided.py",
    "tests/test_compile_plan_prose_check.py",
    "tests/test_compile_plan_engine_self_change.py",
    "tests/test_compile_plan_integration_hostile.py",
    "tests/test_compile_plan_check_cost.py",
    "tests/test_compile_plan_engine_self_change_impl.py",
    "tests/test_directory_quantifier_advisory.py",
    "tests/test_check_renders_pin_is_tree_independent.py",
    "tests/test_compile_plan_base_message.py",
    "evals/check_renders_ab.py",
]

MIN_LINES, MAX_LINES = 2000, 3300

HEX64 = "0123456789abcdef"


def _run(argv, cwd=None):
    return subprocess.run([sys.executable] + [str(a) for a in argv],
                          capture_output=True, cwd=str(cwd or ROOT))


def _text(raw):
    return raw.decode("utf-8", "replace")


# --- (a) [M1] the whole of `--check` stdout is the verdict line -------------

def test_check_on_the_claims_fixture_prints_the_verdict_and_nothing_else():
    p = _run([COMPILER, "--check", CLAIMS_PLAN])
    extra = [line for line in _text(p.stdout).splitlines() if line != "PLAN OK"]
    assert p.returncode == 0, (
        "leg (a) [M1]: `--check evals/fixtures/claims/plan.md` exits 0 — got "
        "%d; stderr: %s" % (p.returncode, _text(p.stderr)))
    assert p.stdout == b"PLAN OK\n", (
        "leg (a) [M1]: the whole stdout is exactly `PLAN OK` plus one newline; "
        "these extra lines were printed: %r" % (extra,))


def test_no_fixture_plan_draws_an_advisory_line_under_check():
    """The Claim, over the whole corpus: `--check` prints a verdict, and an
    exit-0 check prints exactly `PLAN OK`."""
    offenders, not_bare = {}, {}
    for plan, name in zip(FIXTURE_PLANS, FIXTURE_NAMES):
        p = _run([COMPILER, "--check", plan])
        lines = [ln for ln in _text(p.stdout).splitlines() if ADVISORY in ln]
        if lines:
            offenders[name] = lines
        if p.returncode == 0 and p.stdout != b"PLAN OK\n":
            not_bare[name] = _text(p.stdout)
    assert offenders == {}, (
        "leg (a) [M1]: no plan draws an advisory line any more — %s" % offenders)
    assert not_bare == {}, (
        "leg (a) [M1]: an exit-0 `--check` prints exactly `PLAN OK` — %s"
        % not_bare)


# --- (b) [M2] the string is gone and so are the two flags -------------------

def test_no_line_of_the_compiler_contains_the_advisory_token():
    hits = ["%s:%d: %s" % (COMPILER_REL, n, line)
            for n, line in enumerate(COMPILER.read_text().splitlines(), 1)
            if ADVISORY in line]
    assert hits == [], (
        "leg (b) [M2]: no line of %s contains %r — %d line(s) still do: %s"
        % (COMPILER_REL, ADVISORY, len(hits), "\n".join(hits)))


@pytest.mark.parametrize("flag", [["--renders"], ["--exclude", "x"]])
def test_the_render_flags_are_unrecognized_arguments(flag):
    p = _run([COMPILER, "--check"] + flag + [CLAIMS_PLAN])
    err = _text(p.stderr)
    assert p.returncode == 2, (
        "leg (b) [M2]: `--check %s <plan>` exits 2 (argparse's unknown-flag "
        "exit) — got %d; stdout: %r; stderr: %r"
        % (" ".join(flag), p.returncode, _text(p.stdout), err))
    assert "unrecognized arguments" in err, (
        "leg (b) [M2]: `--check %s <plan>` reports `unrecognized arguments` on "
        "stderr — got %r" % (" ".join(flag), err))


# --- (c) [M3] the survivors outside the tier still resolve ------------------

def test_pin_base_facts_still_imports():
    code = ("import sys; sys.path.insert(0, %r); import pin_base_facts; "
            "print(pin_base_facts.__name__)"
            % str(ROOT / "skills/ultrawrite/scripts"))
    p = _run(["-c", code])
    assert p.returncode == 0, (
        "leg (c) [M3]: `import pin_base_facts` with skills/ultrawrite/scripts "
        "on sys.path succeeds — it imports nine names from the compiler and "
        "must keep resolving every one; stderr:\n%s" % _text(p.stderr))


def test_the_compiler_still_defines_every_named_survivor():
    sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
    import compile_plan  # noqa: E402

    missing = [name for name in SURVIVING_SYMBOLS
               if not hasattr(compile_plan, name)]
    assert missing == [], (
        "leg (c) [M3]: the deletion keeps every symbol with a reader outside "
        "the advisory tier — these are gone: %s" % missing)


# --- (d) [M4] the retired files are absent ----------------------------------

def test_every_retired_path_is_absent():
    survivors = [rel for rel in RETIRED_PATHS if (ROOT / rel).exists()]
    assert survivors == [], (
        "leg (d) [M4]: each retired path is deleted whole, not emptied — %d "
        "still exist(s): %s" % (len(survivors), survivors))


# --- (e) [M6] the compiler's size ------------------------------------------

def test_the_compiler_is_between_two_and_thirty_three_hundred_lines():
    lines = COMPILER.read_bytes().count(b"\n")  # what `wc -l` counts
    assert MIN_LINES <= lines <= MAX_LINES, (
        "leg (e) [M6]: %s is between %d and %d lines — it is %d"
        % (COMPILER_REL, MIN_LINES, MAX_LINES, lines))


# --- (f) [M5] the census: listing, digests, and both failure modes ----------

def _census(compiler, cwd=None):
    return _run([CENSUS, compiler], cwd=cwd)


def _digest(compiler, plan):
    """The digest M5 pins: sha256 of the plain compile's three output keys."""
    p = _run([compiler, plan])
    assert p.returncode == 0, (
        "leg (f) [M5]: the exam's own plain compile of %s must succeed before "
        "its digest can be compared; stderr:\n%s" % (plan, _text(p.stderr)))
    compiled = json.loads(p.stdout)
    payload = json.dumps([compiled["waves"], compiled["dag_edges"],
                          compiled["launch_waves"]], sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _parsed(stdout):
    return [line.split(" ") for line in _text(stdout).splitlines()]


def test_the_fixture_glob_is_the_thirteen_plans_m5_names():
    assert FIXTURE_NAMES == M5_NAMES_AT_BASE, (
        "leg (f) [M5]: the corpus is the thirteen `evals/fixtures/*/plan.md` "
        "directories M5 enumerates (`jsdeps` carries no plan.md) — the glob "
        "found %s" % FIXTURE_NAMES)


def test_the_census_lists_every_fixture_once_in_sorted_order():
    p = _census(COMPILER)
    assert p.returncode == 0, (
        "leg (f) [M5]: `%s <compiler>` exits 0 on this tree's compiler — got "
        "%d; stderr:\n%s" % (CENSUS_REL, p.returncode, _text(p.stderr)))
    rows = _parsed(p.stdout)
    assert [row[0] for row in rows] == FIXTURE_NAMES, (
        "leg (f) [M5]: one line per `evals/fixtures/*/plan.md`, first field the "
        "directory name, sorted by name — the exam's own glob is %s, the "
        "census printed %s" % (FIXTURE_NAMES, [row[0] for row in rows]))
    assert all(len(row) == 2 for row in rows), (
        "leg (f) [M5]: each line is `<directory name> <64 hex>` — these are "
        "not two space-separated fields: %s"
        % [row for row in rows if len(row) != 2])


def test_every_census_digest_matches_this_trees_own_compile():
    p = _census(COMPILER)
    assert p.returncode == 0, (
        "leg (f) [M5]: the census exits 0 before its digests can be checked; "
        "stderr:\n%s" % _text(p.stderr))
    printed = {row[0]: row[1] for row in _parsed(p.stdout) if len(row) == 2}
    malformed, wrong = [], {}
    for plan, name in zip(FIXTURE_PLANS, FIXTURE_NAMES):
        got = printed.get(name)
        if got is None or len(got) != 64 or any(c not in HEX64 for c in got):
            malformed.append((name, got))
            continue
        expected = _digest(COMPILER, plan)
        if got != expected:
            wrong[name] = (got, expected)
    assert malformed == [], (
        "leg (f) [M5]: the second field of every line matches ^[0-9a-f]{64}$ — "
        "these do not: %s" % malformed)
    assert wrong == {}, (
        "leg (f) [M5]: each digest is the sha256 of "
        "`json.dumps([waves, dag_edges, launch_waves], sort_keys=True)` over "
        "that fixture's plain compile — (printed, recomputed) disagree for: %s"
        % wrong)


def test_a_compiler_that_exits_non_zero_fails_the_census(tmp_path):
    stub = tmp_path / "exits_one" / "compile_plan.py"
    stub.parent.mkdir(parents=True)
    stub.write_text("import sys\nsys.exit(1)\n")
    p = _census(stub)
    assert p.returncode == 1, (
        "leg (f) [M5]: a compile that exits non-zero makes the census exit 1 — "
        "got %d; stdout: %r" % (p.returncode, _text(p.stdout)))
    assert FIXTURE_NAMES[0] in _text(p.stderr), (
        "leg (f) [M5]: the failing fixture's directory name (%r, the first the "
        "census reaches) is on stderr — got %r"
        % (FIXTURE_NAMES[0], _text(p.stderr)))


def test_a_compile_missing_an_output_key_fails_the_census(tmp_path):
    stub = tmp_path / "partial_json" / "compile_plan.py"
    stub.parent.mkdir(parents=True)
    stub.write_text('print(\'{"waves": []}\')\n')
    p = _census(stub)
    assert p.returncode == 1, (
        "leg (f) [M5]: a compile whose JSON lacks `dag_edges` and "
        "`launch_waves` makes the census exit 1, exit 0 from the compiler "
        "notwithstanding — got %d; stdout: %r"
        % (p.returncode, _text(p.stdout)))
    assert FIXTURE_NAMES[0] in _text(p.stderr), (
        "leg (f) [M5]: the offending fixture's directory name (%r) is on "
        "stderr — got %r" % (FIXTURE_NAMES[0], _text(p.stderr)))


# --- (g) [M5] the census over BASE and this tree agree, line for line -------

@pytest.fixture(scope="module")
def base_compiler(tmp_path_factory):
    """The compiler blob at BASE, written four directories deep.

    `PLUGIN_ROOT = Path(__file__).resolve().parents[3]` is resolved at import,
    so a copy shallower than that raises before it compiles anything — the
    Proof's `Run:` bullet writes `<mktemp>/a/b/c/compile_plan.py` and so does
    this. A depth-1 checkout does not hold BASE: probe, and fetch exactly that
    commit under a shared lock (concurrent fetches lose on `.git/shallow.lock`
    under xdist), and a fetch that fails is a failure here, not a skip.
    """
    lock_path = tmp_path_factory.getbasetemp().parent / "ultra-base-sha.lock"
    with open(lock_path, "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            probe = subprocess.run(
                ["git", "cat-file", "-e", BASE_SHA + "^{commit}"],
                cwd=str(ROOT), capture_output=True)
            if probe.returncode != 0:
                fetch = subprocess.run(
                    ["git", "fetch", "-q", "--depth=1", "origin", BASE_SHA],
                    cwd=str(ROOT), capture_output=True)
                assert fetch.returncode == 0, (
                    "leg (g) [M5]: BASE %s must be readable to compare the two "
                    "censuses; stderr:\n%s"
                    % (BASE_SHA[:7], _text(fetch.stderr)))
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)
    blob = subprocess.run(["git", "show", "%s:%s" % (BASE_SHA, COMPILER_REL)],
                          cwd=str(ROOT), capture_output=True)
    assert blob.returncode == 0, (
        "leg (g) [M5]: `git show %s:%s` must succeed; stderr:\n%s"
        % (BASE_SHA[:7], COMPILER_REL, _text(blob.stderr)))
    deep = tmp_path_factory.mktemp("base") / "a" / "b" / "c"
    deep.mkdir(parents=True)
    path = deep / "compile_plan.py"
    path.write_bytes(blob.stdout)
    return path


# The keys added to a `launch_waves` entry AFTER this exam's BASE, each by its
# own task and pinned by its own exam: `factsheet` (#913,
# `tests/test_compile_plan_factsheet.py`). Leg (g)'s question is whether a
# fixture's compiled output otherwise moved, so the comparison is taken with
# these removed — a BASE compiler that never emitted them cannot be asked about
# them, and every other byte of the three keys is still compared.
KEYS_ADDED_SINCE_BASE = ("factsheet",)


def _stripped_digest(compiler, plan):
    """The digest leg (g) compares: leg (f)'s three output keys with the
    post-BASE entry keys removed from every `launch_waves` entry."""
    p = _run([compiler, plan])
    assert p.returncode == 0, (
        "leg (g) [M5]: the exam's own plain compile of %s must succeed before "
        "its digest can be compared; stderr:\n%s" % (plan, _text(p.stderr)))
    compiled = json.loads(p.stdout)
    launch_waves = [[{k: v for k, v in e.items()
                      if k not in KEYS_ADDED_SINCE_BASE} for e in wave]
                    for wave in compiled["launch_waves"]]
    payload = json.dumps([compiled["waves"], compiled["dag_edges"],
                          launch_waves], sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def test_the_census_over_base_and_this_tree_is_the_same_thirteen_lines(
        base_compiler):
    base = _census(base_compiler)
    new = _census(COMPILER)
    assert base.returncode == 0, (
        "leg (g) [M5]: the census exits 0 on the BASE compiler (%s); stderr:\n%s"
        % (BASE_SHA[:7], _text(base.stderr)))
    assert new.returncode == 0, (
        "leg (g) [M5]: the census exits 0 on this tree's compiler; stderr:\n%s"
        % _text(new.stderr))
    base_lines = _text(base.stdout).splitlines()
    new_lines = _text(new.stdout).splitlines()
    assert len(base_lines) == 13 and len(new_lines) == 13, (
        "leg (g) [M5]: both listings are thirteen lines long — BASE %d, this "
        "tree %d" % (len(base_lines), len(new_lines)))
    assert [line.split(" ")[0] for line in base_lines] == \
           [line.split(" ")[0] for line in new_lines], (
        "leg (g) [M5]: both listings name the same thirteen fixtures in the "
        "same order — base %s, tree %s" % (base_lines, new_lines))
    differing = {}
    for plan, name in zip(FIXTURE_PLANS, FIXTURE_NAMES):
        at_base = _stripped_digest(base_compiler, plan)
        here = _stripped_digest(COMPILER, plan)
        if at_base != here:
            differing[name] = (at_base, here)
    assert differing == {}, (
        "leg (g) [M5]: every fixture compiles to the same waves, dag_edges and "
        "launch_waves it did at BASE (%s), the entry keys added since (%s) "
        "aside — these differ (base, tree): %s"
        % (BASE_SHA[:7], ", ".join(KEYS_ADDED_SINCE_BASE), differing))
