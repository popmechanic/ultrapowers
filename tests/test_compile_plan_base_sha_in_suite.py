"""A committed exam that compares against BASE is named before a reader is sent.

A new `proof-species` render, `base-sha-in-suite`, reads each claims-v1 task's
Proof `Test:` paths that are TRACKED files of the `--base` checkout and names
two shapes inside them: the BASE environment-variable token, and a 40-hex
literal that resolves as a commit of that same checkout. Both are the run-35
shape — a `Run:`-assigned BASE comparison smuggled into a committed test file —
and both are advisories, never refusals, because the same 40-hex shape is used
lawfully as a frozen pre-edit literal and the reader decides.

This exam pins the five Machine clauses leg by leg:

  M1 / legs (a), (b) — under `--check --renders --base <checkout>`, for each
    claims-v1 task and each of its `Test:` paths tracked at `--base`, in task
    order then `Test:` order, one line per file that contains the token as a
    WHOLE WORD, naming its FIRST occurrence's 1-based line number:

      `ADVISORY proof-species: base-sha-in-suite — task <id>: <path> reads
      <token> at line <L> — a BASE comparison is a Run:, never a committed exam`

  M2 / legs (c), (d), (e) — for the same files, one line per DISTINCT 40-hex
    literal that resolves as a commit of the checkout, in first-occurrence
    order, each at its own first line:

      `ADVISORY proof-species: base-sha-in-suite — task <id>: <path> freezes
      commit <sha> at line <L> — a BASE comparison is a Run:, never a committed
      exam`

    and when one file carries both, its sha line prints before its token line.
  M3 / leg (f) — silence for: a 40-hex literal naming no commit of the
    checkout; a 39- or 41-hex run; the token or a resolving sha in a `Modify:`
    file, in a `Run:` command, or in a Global Constraints `- Check:`; a `Test:`
    path that is not tracked (untracked on disk, or absent); a legacy-grammar
    plan; and `--check` without `--renders`.
  M4 / leg (g) — the render changes no exit code: the plan that draws both
    lines still prints `PLAN OK` as its first stdout line and exits 0, under
    bare `--check` and under `--check --renders` alike.
  M5 / leg (h) — `skills/ultrawrite/SKILL.md` names the species in its
    `ADVISORY proof-species:` list paragraph, and its **Proof** slot bullet
    carries `never reads <token>`, then `freezes a commit sha`, then `BASE
    comparison is a` followed by the `Run:` marker, in that order. The two
    Proof `Run:` commands are re-run verbatim from here.

Two house rules of this file, both from the plan's Global Constraints:

* it never writes the BASE env-var token as one word in its own source — the
  token it plants is built by concatenation (`TOKEN`), so this file, once
  tracked, draws no line on itself;
* it freezes no commit sha of THIS repository. Every sha it asserts belongs to
  the throwaway checkout it builds and commits itself (the `_repo` shape of
  `tests/test_compile_plan_pinned_elsewhere.py`), read back with
  `git rev-parse HEAD`. Legs (c) and (e) freeze the sha that was HEAD when the
  probes were written; leg (d) needs two shas whose first-occurrence order is
  NOT their sorted order, so it plants the lexicographic MAX of the checkout's
  earlier commits first and the MIN second — a render that sorts shas swaps
  them and fails, whatever the random shas turn out to be.

Every fixture plan is a signed claims-v1 plan (spec §4.5), and `_rendered`
asserts the fixture's own health — exit 0, `PLAN OK` first — before reading the
species lines off it, so a broken fixture never reads as a missing species.
"""
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
SKILL = "skills/ultrawrite/SKILL.md"
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
import compile_plan  # noqa: E402

SPECIES = "base-sha-in-suite"
SPECIES_PREFIX = "ADVISORY proof-species: "
PREFIX = SPECIES_PREFIX + SPECIES

# The env-var name the render matches as a WHOLE WORD, built by concatenation
# so this file carries no whole-word occurrence of it (see the module docstring).
TOKEN = "ULTRA_" + "BASE"
# The near-token M1's word boundary excludes: the token with `LINE` glued on.
NEAR_TOKEN = TOKEN + "LINE"
# The advice half both lines end with, verbatim from M1 and M2.
ADVICE = "a BASE comparison is a Run:, never a committed exam"


def token_line(task_id, path, line):
    """M1's line, verbatim, with the path and 1-based line number filled in."""
    return ("ADVISORY proof-species: base-sha-in-suite — task %s: %s reads %s "
            "at line %d — %s" % (task_id, path, TOKEN, line, ADVICE))


def sha_line(task_id, path, sha, line):
    """M2's line, verbatim, with the path, full 40-hex sha and line filled in."""
    return ("ADVISORY proof-species: base-sha-in-suite — task %s: %s freezes "
            "commit %s at line %d — %s" % (task_id, path, sha, line, ADVICE))


# --------------------------------------------------------------------------- #
# The probe files the checkout tracks                                          #
# --------------------------------------------------------------------------- #
PROBE_A = "tests/test_probe_a.py"          # token at lines 2 and 4
PROBE_Z = "tests/test_probe_z.py"          # token at line 5; sorts AFTER PROBE_A
PROBE_FORTY_A = "tests/test_forty_a.py"    # forty `a`s: 40-hex, no commit
PROBE_NEAR_HEX = "tests/test_near_hex.py"  # a 39-hex run and a 41-hex run
PROBE_CLEAN = "tests/test_clean.py"        # neither shape
PROBE_SHA_ONE = "tests/test_sha_one.py"    # one resolving sha, at line 3
PROBE_SHA_TWO = "tests/test_sha_two.py"    # shas at lines 3, 6 and a repeat at 8
PROBE_SHA_TOKEN = "tests/test_sha_then_token.py"  # sha at line 1, token at line 2
PROBE_UNTRACKED = "tests/test_untracked.py"  # on disk, never added
PROBE_ABSENT = "tests/test_absent.py"        # never written
MODIFY_ONLY = "app/mod_probe.py"           # a resolving sha AND the token


def _body(*rows):
    """A file whose i-th row is exactly its line i (1-based)."""
    return "".join(row + "\n" for row in rows)


def _git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args],
                          capture_output=True, text=True, check=True).stdout


def _commit(repo, message):
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    subprocess.run(["git", "-c", "user.email=exam@example.invalid",
                    "-c", "user.name=exam", "commit", "-qm", message],
                   cwd=repo, check=True)
    return _git(repo, "rev-parse", "HEAD").strip()


def _write(repo, rel, text):
    f = repo / rel
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(text)


class Checkout:
    """The throwaway git checkout `--base` names, plus the shas it froze."""

    def __init__(self, path, head, hi, lo):
        self.path = path
        self.head = head    # HEAD when the sha probes were written (legs c, e)
        self.hi = hi        # leg (d): planted FIRST, sorts LAST
        self.lo = lo        # leg (d): planted SECOND, sorts FIRST


@pytest.fixture(scope="module")
def repo(tmp_path_factory):
    r = tmp_path_factory.mktemp("base_sha_repo")
    subprocess.run(["git", "init", "-q"], cwd=r, check=True)
    _write(r, "README.md", "# base\n")
    # Line 1 carries the near-token only; the token itself first appears on
    # line 2 and again on line 4 [M1, leg (a)].
    _write(r, PROBE_A, _body("# near: %s is not the token" % NEAR_TOKEN,
                             'base = "%s"' % TOKEN,
                             "filler = 1",
                             'again = "%s"' % TOKEN))
    # Its first (and only) token line is 5, and its path sorts after PROBE_A's
    # — leg (b)'s discriminator between `Test:` order and path order.
    _write(r, PROBE_Z, _body("# probe z", "# filler", "# filler", "# filler",
                             'base = "%s"' % TOKEN))
    _write(r, PROBE_FORTY_A, _body("# a 40-hex literal naming no commit",
                                   'sha = "%s"' % ("a" * 40)))
    _write(r, PROBE_CLEAN, _body("# neither shape", "def test_clean(): pass"))
    shas = [_commit(r, "probes")]
    # Two more commits, so leg (d) has three shas to choose its max and min
    # from and the planted order can be made the reverse of the sorted order.
    for i, name in enumerate(("notes/one.txt", "notes/two.txt")):
        _write(r, name, "filler %d\n" % i)
        shas.append(_commit(r, "filler %d" % i))
    head, hi, lo = shas[-1], max(shas), min(shas)
    # A 39-hex run and a 41-hex run, neither of which is a 40-hex literal [M3].
    _write(r, PROBE_NEAR_HEX, _body("# one hex digit removed",
                                    'short = "%s"' % head[:-1],
                                    "# one hex digit appended",
                                    'long = "%s0"' % head))
    _write(r, PROBE_SHA_ONE, _body("# one resolving sha", "# filler",
                                   'sha = "%s"' % head))
    _write(r, PROBE_SHA_TWO, _body("# two resolving shas", "# filler",
                                   'first = "%s"' % hi,
                                   "# filler", "# filler",
                                   'second = "%s"' % lo,
                                   "# filler",
                                   'repeat = "%s"' % hi))
    _write(r, PROBE_SHA_TOKEN, _body('sha = "%s"' % head,
                                     'base = "%s"' % TOKEN))
    _write(r, MODIFY_ONLY, _body('sha = "%s"' % head, 'base = "%s"' % TOKEN))
    _commit(r, "sha probes")
    # Written AFTER the last commit: on disk, tracked by nothing [M3, leg (f)].
    _write(r, PROBE_UNTRACKED, _body("# untracked", 'base = "%s"' % TOKEN))
    return Checkout(r, head, hi, lo)


def test_the_checkouts_two_leg_d_shas_are_planted_against_their_sorted_order(repo):
    """Leg (d) only discriminates a sha-sorting render when the sha planted
    first sorts last — this file's fixture guarantees that, so the leg is not
    at the mercy of two random shas."""
    assert repo.hi > repo.lo, (
        "leg (d) [M2] fixture: the sha planted at line 3 must sort AFTER the "
        "one planted at line 6, so first-occurrence order and sorted order "
        "disagree; got hi=%s lo=%s" % (repo.hi, repo.lo))


# --------------------------------------------------------------------------- #
# The fixture plans                                                            #
# --------------------------------------------------------------------------- #
HEADER = ("# Plan: A committed exam that compares against BASE is named\n"
          "\n"
          "**Grammar:** claims-v1\n"
          "\n"
          "**Acceptance:** waived — inline test plan\n"
          "\n")

MACHINE = "M1. The probe reports `ready`."
LEGS = "- Legs: (a) the probe reports it [M1]."
PROSE_BULLET = "- The suite is green."


def _task(task_id, files, proof):
    """One claims-v1 task carrying all six slots. `files` is the Files-block
    bullet lines and `proof` the Proof-slot bullet lines, each without its
    trailing newline. Every probe is named in BOTH blocks where it is a
    `Test:` path, so the render may read either view — but only the Proof's
    `Test:` bullets carry document order, which leg (b) turns on."""
    return ("### Task %s: Sample %s\n"
            "\n"
            "**Type:** implementation\n"
            "\n"
            "**Files:**\n"
            "%s"
            "\n"
            "**Claim:** An operator sees a committed exam that compares "
            "against BASE. (quoted from #730)\n"
            "Machine: %s\n"
            "\n"
            "**Authorized-by:** #730\n"
            "\n"
            "**Interfaces:**\n"
            "- Consumes: nothing\n"
            "- Produces: `probe_%s(n: int) -> str`\n"
            "\n"
            "**Context:** The repo has no render of this species yet, so no "
            "plan is read this way today.\n"
            "\n"
            "**Proof:**\n"
            "%s"
            "\n"
            "**Stale-if:**\n"
            "- issue-closed: #730\n"
            % (task_id, task_id, "".join(l + "\n" for l in files), MACHINE,
               task_id, "".join(l + "\n" for l in proof)))


def _exam_task(task_id, *tests, modify=None):
    """A task whose Proof names `tests` as `Test:` bullets IN ORDER."""
    impl = modify or "app/impl_%s.py" % task_id
    return _task(task_id,
                 ["- Modify: `%s`" % impl]
                 + ["- Test: `%s`" % t for t in tests],
                 ["- Test: `%s`" % t for t in tests] + [LEGS])


def _plan(*tasks, checks=()):
    section = ""
    if checks:
        section = ("## Global Constraints\n\n"
                   + "\n".join([PROSE_BULLET]
                               + ["- Check: " + c for c in checks])
                   + "\n\n")
    return HEADER + section + "\n".join(tasks)


def _legacy_plan(*tests):
    """A legacy-grammar plan (no `**Grammar:**` line) naming the same probe
    files under `Test:`: a legacy task carries no `claims`, so M3 is silent."""
    return ("# Plan: Legacy\n"
            "\n"
            "**Acceptance:** waived — inline test plan\n"
            "\n"
            "### Task 1: Legacy sample\n"
            "\n"
            "**Type:** implementation\n"
            "**Depends-on:** none\n"
            "\n"
            "**Files:**\n"
            "- Create: `app/legacy.py`\n"
            + "".join("- Test: `%s`\n" % t for t in tests)
            + "\n"
            "- [ ] **Step 1:** write the probe.\n")


# Leg (a): the same tracked probe under task 1's `Test:` and again under
# task 2's — one line per (task, path), task 1's first.
PLAN_TWO_TASKS = _plan(_exam_task("1", PROBE_A), _exam_task("2", PROBE_A))
# Leg (b): one task, two probes, the line-5 probe named FIRST though its path
# sorts second.
PLAN_TEST_ORDER = _plan(_exam_task("1", PROBE_Z, PROBE_A))
# Legs (c), (d), (e).
PLAN_SHA_ONE = _plan(_exam_task("1", PROBE_SHA_ONE))
PLAN_SHA_TWO = _plan(_exam_task("1", PROBE_SHA_TWO))
PLAN_SHA_TOKEN = _plan(_exam_task("1", PROBE_SHA_TOKEN))
# Leg (f)'s silent rows.
PLAN_FORTY_A = _plan(_exam_task("1", PROBE_FORTY_A))
PLAN_NEAR_HEX = _plan(_exam_task("1", PROBE_NEAR_HEX))
PLAN_MODIFY_ONLY = _plan(_exam_task("1", PROBE_CLEAN, modify=MODIFY_ONLY))
PLAN_UNTRACKED = _plan(_exam_task("1", PROBE_UNTRACKED))
PLAN_ABSENT = _plan(_exam_task("1", PROBE_ABSENT))
LEGACY_PLAN = _legacy_plan(PROBE_A, PROBE_SHA_TWO)


def _run_and_check_plan(sha):
    """Leg (f): the sha rides in a `Run:` command and the token in a Global
    Constraints `- Check:`; the only `Test:` file carries neither."""
    task = _task("1",
                 ["- Modify: `app/impl_1.py`", "- Test: `%s`" % PROBE_CLEAN],
                 ["- Run: git diff --stat %s -- app/impl_1.py" % sha,
                  "- Test: `%s`" % PROBE_CLEAN,
                  LEGS])
    return _plan(task, checks=["bash -c 'test -n \"$%s\"'" % TOKEN])


# --------------------------------------------------------------------------- #
# Running the compiler                                                         #
# --------------------------------------------------------------------------- #
def _write_plan(tmp_path, text, name="plan.md"):
    p = tmp_path / name
    p.write_text(text)
    return p


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
    compile_plan.verdicts_path(plan).write_text(
        json.dumps(record, indent=2) + "\n")
    return plan


def _check(tmp_path, text, *extra, name="plan.md"):
    plan = _write_plan(tmp_path, text, name)
    if "**Grammar:** claims-v1" in text:
        _sign(plan)
    return subprocess.run(
        [sys.executable, str(COMPILER), "--check", str(plan), *extra],
        capture_output=True, text=True, cwd=str(ROOT))


def _rendered(tmp_path, base, text, name="plan.md"):
    """`--check --renders --base` on a signed fixture plan: its stdout, with
    the fixture's own health asserted first so a broken fixture never reads as
    a missing species line."""
    p = _check(tmp_path, text, "--renders", "--base", str(base), name=name)
    assert (p.returncode, p.stdout.splitlines()[:1]) == (0, ["PLAN OK"]), (
        "fixture plan %s must compile clean before its species are read; "
        "got rc=%d\n%s%s" % (name, p.returncode, p.stdout, p.stderr))
    return p.stdout


def _species(stdout):
    """Every `base-sha-in-suite` line of a render run, in print order."""
    return [l for l in stdout.splitlines() if l.startswith(PREFIX)]


def _lines(tmp_path, base, text, name="plan.md"):
    return _species(_rendered(tmp_path, base, text, name))


# --------------------------------------------------------------------------- #
# The Produces contract                                                        #
# --------------------------------------------------------------------------- #
def test_the_render_is_registered_under_its_species_name():
    """Produces: `_render_base_sha_in_suite(tasks, ctx) -> list[str]`,
    registered with its own `ADVISORY_RENDERS.append` entry."""
    fn = getattr(compile_plan, "_render_base_sha_in_suite", None)
    assert callable(fn), (
        "Produces: `_render_base_sha_in_suite(tasks, ctx) -> list[str]` must "
        "be defined in compile_plan.py")
    assert (SPECIES, fn) in compile_plan.ADVISORY_RENDERS, (
        "the render registers itself with its own "
        '`ADVISORY_RENDERS.append(("%s", _render_base_sha_in_suite))`; the '
        "registry holds %r" % (SPECIES,
                               [name for name, _ in compile_plan.ADVISORY_RENDERS]))


# --------------------------------------------------------------------------- #
# (a) [M1] the token line, its verbatim shape, its first line number, and one  #
#     line per (task, Test: path) in task order                                #
# --------------------------------------------------------------------------- #
def test_a_token_in_a_tracked_test_file_draws_one_line_per_task_in_task_order(
        tmp_path, repo):
    lines = _lines(tmp_path, repo.path, PLAN_TWO_TASKS)
    expected = [token_line("1", PROBE_A, 2), token_line("2", PROBE_A, 2)]
    assert lines == expected, (
        "leg (a) [M1]: `%s` carries the near-token at line 1, the token at "
        "line 2 and again at line 4, and is named under task 1's `Test:` and "
        "task 2's — exactly two lines, task 1's first, each naming line 2. A "
        "substring match reports line 1, a last-occurrence match reports line "
        "4, a per-occurrence render prints four lines, and a per-plan render "
        "prints one.\ngot:\n%s\nwanted:\n%s"
        % (PROBE_A, "\n".join(lines), "\n".join(expected)))


def test_the_token_line_names_the_first_occurrence_line_number(tmp_path, repo):
    """[M1]: `<L>` is the token's FIRST line, 1-based — asserted on its own so
    a wrong line number is not read as a missing line."""
    lines = _lines(tmp_path, repo.path, PLAN_TWO_TASKS)
    assert [l.rsplit(" at line ", 1)[-1] for l in lines] == \
        ["2 — %s" % ADVICE, "2 — %s" % ADVICE], (
        "leg (a) [M1]: the token's first line in `%s` is 2 (line 1 holds the "
        "near-token, line 4 a second occurrence). Got:\n%s"
        % (PROBE_A, "\n".join(lines)))


def test_the_near_token_alone_draws_nothing(tmp_path, repo):
    """[M1]: the match is whole-word, so the near-token on line 1 is not a
    hit — if it were, leg (a)'s line would name line 1."""
    lines = _lines(tmp_path, repo.path, PLAN_TWO_TASKS)
    assert all(" at line 1 " not in l for l in lines), (
        "leg (a) [M1]: `%s` is not the token — a whole-word match skips line "
        "1 of `%s`. Got:\n%s" % (NEAR_TOKEN, PROBE_A, "\n".join(lines)))


# --------------------------------------------------------------------------- #
# (b) [M1] two Test: paths of one task print in Test: order, not path order    #
# --------------------------------------------------------------------------- #
def test_b_two_test_paths_of_one_task_print_in_test_order(tmp_path, repo):
    lines = _lines(tmp_path, repo.path, PLAN_TEST_ORDER)
    expected = [token_line("1", PROBE_Z, 5), token_line("1", PROBE_A, 2)]
    assert lines == expected, (
        "leg (b) [M1]: task 1's `Test:` names `%s` (token at line 5) before "
        "`%s` (token at line 2), so the line-5 probe prints first and each "
        "line carries its own line number. A render that sorts by path prints "
        "them the other way round; one that reports the first token line for "
        "both prints line 2 twice.\ngot:\n%s\nwanted:\n%s"
        % (PROBE_Z, PROBE_A, "\n".join(lines), "\n".join(expected)))


def test_b_the_two_probes_sort_the_other_way_round():
    """The fixture's own discriminator: `Test:` order and path order disagree,
    so leg (b) can tell them apart."""
    assert PROBE_A < PROBE_Z, (
        "leg (b) [M1] fixture: the probe named SECOND under `Test:` must sort "
        "FIRST by path")


# --------------------------------------------------------------------------- #
# (c) [M2] one resolving sha draws one line, full sha, with its line number    #
# --------------------------------------------------------------------------- #
def test_c_a_resolving_sha_in_a_tracked_test_file_draws_one_line(
        tmp_path, repo):
    lines = _lines(tmp_path, repo.path, PLAN_SHA_ONE)
    expected = [sha_line("1", PROBE_SHA_ONE, repo.head, 3)]
    assert lines == expected, (
        "leg (c) [M2]: `%s` freezes a commit of the `--base` checkout at its "
        "line 3 — exactly one line, carrying the FULL 40-hex sha and the line "
        "number. An abbreviated sha, or a line with no line number, fails."
        "\ngot:\n%s\nwanted:\n%s"
        % (PROBE_SHA_ONE, "\n".join(lines), "\n".join(expected)))


# --------------------------------------------------------------------------- #
# (d) [M2] distinct shas, first-occurrence order, a repeat drawing no line     #
# --------------------------------------------------------------------------- #
def test_d_two_distinct_shas_print_in_first_occurrence_order(tmp_path, repo):
    lines = _lines(tmp_path, repo.path, PLAN_SHA_TWO)
    expected = [sha_line("1", PROBE_SHA_TWO, repo.hi, 3),
                sha_line("1", PROBE_SHA_TWO, repo.lo, 6)]
    assert lines == expected, (
        "leg (d) [M2]: `%s` carries one commit sha at line 3, a second at "
        "line 6 and the first again at line 8 — exactly two lines, line 3's "
        "sha then line 6's. A per-occurrence render prints three; a render "
        "that sorts shas prints line 6's first (its sha sorts lower)."
        "\ngot:\n%s\nwanted:\n%s"
        % (PROBE_SHA_TWO, "\n".join(lines), "\n".join(expected)))


def test_d_a_repeated_sha_draws_no_third_line(tmp_path, repo):
    """[M2]: DISTINCT literals — the line-8 repeat of line 3's sha is not a
    third finding, asserted on its own count."""
    lines = _lines(tmp_path, repo.path, PLAN_SHA_TWO)
    assert len(lines) == 2 and not any(" at line 8 " in l for l in lines), (
        "leg (d) [M2]: the repeat at line 8 of `%s` draws no third line. "
        "Got:\n%s" % (PROBE_SHA_TWO, "\n".join(lines)))


# --------------------------------------------------------------------------- #
# (e) [M2] one file carrying both: the sha line before the token line          #
# --------------------------------------------------------------------------- #
def test_e_the_sha_line_prints_before_the_token_line(tmp_path, repo):
    lines = _lines(tmp_path, repo.path, PLAN_SHA_TOKEN)
    expected = [sha_line("1", PROBE_SHA_TOKEN, repo.head, 1),
                token_line("1", PROBE_SHA_TOKEN, 2)]
    assert lines == expected, (
        "leg (e) [M2]: `%s` freezes a commit sha at its line 1 and reads the "
        "token at its line 2 — two lines, the sha line first. A render that "
        "prints the token line first, or one line per file instead of one per "
        "finding, fails.\ngot:\n%s\nwanted:\n%s"
        % (PROBE_SHA_TOKEN, "\n".join(lines), "\n".join(expected)))


# --------------------------------------------------------------------------- #
# (f) [M3] the silent rows                                                     #
# --------------------------------------------------------------------------- #
def test_f_forty_hex_characters_naming_no_commit_are_silent(tmp_path, repo):
    assert _lines(tmp_path, repo.path, PLAN_FORTY_A) == [], (
        "leg (f) [M3]: `%s` carries forty `a`s — a 40-hex literal that names "
        "no commit of the checkout draws nothing" % PROBE_FORTY_A)


def test_f_a_thirty_nine_and_a_forty_one_hex_run_are_silent(tmp_path, repo):
    assert _lines(tmp_path, repo.path, PLAN_NEAR_HEX) == [], (
        "leg (f) [M3]: `%s` carries the checkout's sha with one hex digit "
        "removed and again with one appended — neither is a 40-hex literal, "
        "so both bounds are closed" % PROBE_NEAR_HEX)


def test_f_a_modify_only_file_carrying_both_shapes_is_silent(tmp_path, repo):
    assert _lines(tmp_path, repo.path, PLAN_MODIFY_ONLY) == [], (
        "leg (f) [M3]: `%s` carries a resolving sha AND the token, but is "
        "named under `Modify:`, never `Test:` — the render reads a task's "
        "`Test:` paths only" % MODIFY_ONLY)


def test_f_a_sha_in_a_run_and_the_token_in_a_check_are_silent(tmp_path, repo):
    text = _run_and_check_plan(repo.head)
    assert _lines(tmp_path, repo.path, text) == [], (
        "leg (f) [M3]: a resolving sha inside a `Run:` command and the token "
        "inside a Global Constraints `- Check:` draw nothing — the render "
        "reads `Test:` FILES, not plan text")


def test_f_an_untracked_test_path_is_silent(tmp_path, repo):
    assert _lines(tmp_path, repo.path, PLAN_UNTRACKED) == [], (
        "leg (f) [M3]: `%s` exists on disk under the checkout and reads the "
        "token, but is untracked — only a tracked file is read" % PROBE_UNTRACKED)


def test_f_the_untracked_probe_really_is_on_disk_and_untracked(repo):
    """The fixture's own discriminator: the untracked row is about tracking,
    not about a missing file."""
    assert (repo.path / PROBE_UNTRACKED).exists(), (
        "leg (f) [M3] fixture: `%s` must exist on disk" % PROBE_UNTRACKED)
    assert PROBE_UNTRACKED not in _git(repo.path, "ls-files").split(), (
        "leg (f) [M3] fixture: `%s` must be untracked" % PROBE_UNTRACKED)


def test_f_a_test_path_that_does_not_exist_is_silent(tmp_path, repo):
    assert not (repo.path / PROBE_ABSENT).exists()
    assert _lines(tmp_path, repo.path, PLAN_ABSENT) == [], (
        "leg (f) [M3]: `%s` is named under `Test:` and is not a file of the "
        "checkout at all — the render is silent, not an error" % PROBE_ABSENT)


def test_f_a_legacy_grammar_plan_over_the_same_probes_is_silent(
        tmp_path, repo):
    assert _lines(tmp_path, repo.path, LEGACY_PLAN, name="legacy.md") == [], (
        "leg (f) [M3]: the same probe files under a legacy-grammar plan's "
        "`Test:` bullets draw nothing — a legacy task carries no claims-v1 "
        "Proof, and the render reads claims-v1 tasks")


def test_f_bare_check_prints_no_line_of_this_species(tmp_path, repo):
    p = _check(tmp_path, PLAN_SHA_TOKEN)
    assert p.returncode == 0, p.stdout + p.stderr
    assert [l for l in p.stdout.splitlines() if SPECIES in l] == [], (
        "leg (f) [M3]: the plan that draws both lines under `--renders` "
        "prints no line containing `%s` under bare `--check` — the render "
        "rides behind the flag. Got:\n%s" % (SPECIES, p.stdout))


# --------------------------------------------------------------------------- #
# (g) [M4] the render changes no exit code and prints after the verdict        #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("flags", [(), ("--renders",)],
                         ids=["bare-check", "renders"])
def test_g_the_plan_drawing_both_lines_still_exits_0_with_plan_ok_first(
        tmp_path, repo, flags):
    extra = flags + (("--base", str(repo.path)) if flags else ())
    p = _check(tmp_path, PLAN_SHA_TOKEN, *extra)
    assert (p.returncode, p.stdout.splitlines()[:1]) == (0, ["PLAN OK"]), (
        "leg (g) [M4]: the plan whose `Test:` file carries both shapes exits "
        "0 with `PLAN OK` as its first stdout line, with and without "
        "`--renders` — a render that raises, or that prints before the "
        "verdict, fails one of the two. rc=%d\n%s%s"
        % (p.returncode, p.stdout, p.stderr))


def test_g_the_renders_run_really_did_draw_the_two_lines(tmp_path, repo):
    """[M4]: the exit-code leg is only evidence when the lines were drawn."""
    assert len(_lines(tmp_path, repo.path, PLAN_SHA_TOKEN)) == 2, (
        "leg (g) [M4]: the `--renders` half of the leg must be the plan that "
        "draws both lines")


# --------------------------------------------------------------------------- #
# (h) [M5] the skill names the species and its Proof slot carries the sentence #
# --------------------------------------------------------------------------- #
SPECIES_LIST_RUN = (
    'sed -n "/^The .ADVISORY proof-species:. lines/,/^$/p" ' + SKILL
    + ' | tr "\\n" " " | grep -q "base-sha-in-suite"')
PROOF_SLOT_RUN = (
    'sed -n "/^- \\*\\*Proof:\\*\\*/,/^- \\*\\*Stale-if:\\*\\*/p" ' + SKILL
    + ' | tr "\\n" " " | grep -q "never reads ' + TOKEN
    + '.*freezes a commit sha.*BASE comparison is a .*Run:"')


def _bash(command):
    return subprocess.run(["bash", "-c", command], cwd=str(ROOT),
                          capture_output=True, text=True)


def test_h_the_species_list_paragraph_names_the_species():
    p = _bash(SPECIES_LIST_RUN)
    assert p.returncode == 0, (
        "leg (h) [M5]: the §`ADVISORY proof-species:` list paragraph of `%s` "
        "must name `%s`; the Proof's first `Run:` is this command:\n%s"
        % (SKILL, SPECIES, SPECIES_LIST_RUN))


def test_h_the_proof_slot_bullet_carries_the_three_phrases_in_order():
    p = _bash(PROOF_SLOT_RUN)
    assert p.returncode == 0, (
        "leg (h) [M5]: the **Proof** slot bullet of `%s` must carry, in this "
        "order, `never reads <token>`, `freezes a commit sha`, and `BASE "
        "comparison is a` followed by the `Run:` marker — the sentence that a "
        "committed exam never reads the token or freezes a commit sha of the "
        "repository, and a BASE comparison is a `Run:`. A slot that says the "
        "token may be read in a `Run:`, or that drops the sha half, fails it. "
        "The Proof's second `Run:` is this command:\n%s" % (SKILL,
                                                            PROOF_SLOT_RUN))
