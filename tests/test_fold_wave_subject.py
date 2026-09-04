"""fold_wave.py `materialize --subject` — the fold commit's subject line.

The exam for Task 2's Claim: *a run's squash-merge keeps the plan's title.*

M1 is the clause this file carries. `materialize` accepts an OPTIONAL
`--subject <text>`; supplied, the candidate commit's subject (`%s`) is exactly
`<text>` and its body (`%b`) is `frontier fold wave <N>`; omitted, the whole
message is `frontier fold wave <N>` — byte-for-byte what BASE already writes.
`git commit-tree` joins several `-m` values as paragraphs, so the two-paragraph
message is the shape being pinned, not a hand-built string.

Proof leg (a) is the whole of the first two scenarios; the last scenario is
M4, the RUNBOOK sentence, replicated from the Proof's two `Run:` greps (wraps
joined) so the documented half of the claim is graded here too.

Every scenario builds its own `tmp_path` git repo; no shared fixtures — the
house style of `tests/test_fold_wave.py` and `tests/test_fold_wave_materialize.py`,
whose `do_fold`/`do_materialize` argv shapes this file reuses.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KERNEL = ROOT / "skills" / "ultrapowers" / "kernel"
CLI = str(KERNEL / "fold_wave.py")

# The two literals the clause spells out. `SUBJECT` is the plan title a run
# would carry; `WAVE_1` is the message BASE writes today.
SUBJECT = "Widget plan"
WAVE_1 = "frontier fold wave 1"

BASE_APP = "def a(x):\n    return x\n\ndef b(y):\n    return y\n\ndef c(z):\n    return z\n"
T1_APP = "def a(x):\n    return x\n\ndef b(y):\n    return y + 1\n\ndef c(z):\n    return z\n"


def _git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True,
                          capture_output=True, text=True).stdout.strip()


def _init(repo):
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "integration")
    _git(repo, "config", "user.email", "t@example.com")
    _git(repo, "config", "user.name", "T")


def make_one_writer_repo(tmp_path, name="repo"):
    """A base commit plus a single task branch `t1` editing one line of
    `app.py` — the cheapest wave that folds clean, so nothing about the
    candidate's MESSAGE is entangled with conflict handling."""
    repo = tmp_path / name
    _init(repo)
    (repo / "app.py").write_text(BASE_APP)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "base")
    base_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", "-b", "t1", base_sha)
    (repo / "app.py").write_text(T1_APP)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "t1")
    t1_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", base_sha)
    return repo, base_sha, t1_sha


def run_cli(*args):
    return subprocess.run([sys.executable, CLI, *args],
                          capture_output=True, text=True)


def do_fold(repo, run_dir, wave, base_sha, branch_specs, extra=()):
    """branch_specs: [(taskId, branchName, headSha), ...] in task-index order."""
    args = ["fold", "--repo", str(repo), "--run-dir", str(run_dir),
            "--wave", str(wave), "--base", base_sha]
    for tid, name, sha in branch_specs:
        args += ["--branch", "%s=%s:%s" % (tid, name, sha)]
    return run_cli(*args, *extra)


def do_materialize(repo, run_dir, wave, prev_head, branch_specs, extra=()):
    """The `materialize` mirror, with the `extra` argv tail `do_fold` uses —
    `--subject` rides there, so the flag is exercised exactly as the engine
    would append it."""
    args = ["materialize", "--repo", str(repo), "--run-dir", str(run_dir),
            "--wave", str(wave), "--prev-head", prev_head]
    for tid, _name, sha in branch_specs:
        args += ["--task-head", "%s=%s" % (tid, sha)]
    return run_cli(*args, *extra)


def candidate_of(result):
    """The `candidateSha` from materialize's stdout reply."""
    import json
    return json.loads(result.stdout.strip().splitlines()[-1])["candidateSha"]


def message_parts(repo, sha):
    """`(%s, %b, %B)` for a commit, each stripped of git's trailing newlines.

    Read off the real object, never off the CLI's own bookkeeping: the clause
    names `git log -1 --format=%s`, so that is what this asks git.
    """
    return (_git(repo, "log", "-1", "--format=%s", sha),
            _git(repo, "log", "-1", "--format=%b", sha),
            _git(repo, "log", "-1", "--format=%B", sha))


def fold_one_wave(tmp_path):
    """A clean wave-1 fold of `t1`, ready to materialize. Returns
    `(repo, run_dir, base_sha, specs)`."""
    repo, base_sha, t1_sha = make_one_writer_repo(tmp_path)
    run_dir = tmp_path / "run"
    specs = [("t1", "t1", t1_sha)]
    fold = do_fold(repo, run_dir, 1, base_sha, specs)
    assert fold.returncode == 0, fold.stderr
    return repo, run_dir, base_sha, specs


# --- M1, leg (a): with `--subject` ----------------------------------------


def test_materialize_with_subject_titles_the_candidate_and_bodies_the_wave(tmp_path):
    """Leg (a), first half [M1]: a fold of one task followed by
    `materialize --subject 'Widget plan'` yields a candidate whose `%s` is
    `Widget plan` and whose `%b` is `frontier fold wave 1`.

    Both halves are equalities against the clause's verbatim strings, not
    containments: a candidate still titled `frontier fold wave 1` with the
    plan title appended somewhere is NOT this leg.
    """
    repo, run_dir, base_sha, specs = fold_one_wave(tmp_path)
    mat = do_materialize(repo, run_dir, 1, base_sha, specs,
                         extra=["--subject", SUBJECT])
    assert mat.returncode == 0, mat.stderr

    subject, body, whole = message_parts(repo, candidate_of(mat))
    assert subject == SUBJECT, (
        "M1: with --subject the candidate's %%s is exactly the supplied text; got %r" % subject)
    assert body == WAVE_1, (
        "M1: with --subject the candidate's %%b is exactly %r; got %r" % (WAVE_1, body))
    # The two-paragraph shape `commit-tree -m <subject> -m <wave>` yields —
    # spelled out so a single-`-m` message that merely happens to start with
    # the title cannot pass.
    assert whole == SUBJECT + "\n\n" + WAVE_1, (
        "M1: the whole message is the title, a blank line, then the wave line; got %r" % whole)


def test_materialize_subject_is_taken_verbatim(tmp_path):
    """Leg (a) [M1], the same half held against a title that would not survive
    re-derivation: `--subject` is passed through as given, so a subject
    carrying markdown, punctuation and inner spacing arrives unchanged.

    Nothing in the clause licenses the kernel to reformat, truncate or
    re-case the text it is handed.
    """
    repo, run_dir, base_sha, specs = fold_one_wave(tmp_path)
    odd = "Fix #633: the plan's H1 — as the subject"
    mat = do_materialize(repo, run_dir, 1, base_sha, specs, extra=["--subject", odd])
    assert mat.returncode == 0, mat.stderr

    subject, body, _ = message_parts(repo, candidate_of(mat))
    assert subject == odd, "M1: --subject is verbatim; got %r" % subject
    assert body == WAVE_1, "M1: the wave line still bodies the commit; got %r" % body


# --- M1, leg (a): without `--subject` --------------------------------------


def test_materialize_without_subject_is_byte_for_byte_base(tmp_path):
    """Leg (a), second half [M1]: the same fold materialized WITHOUT
    `--subject` yields `%s` equal to `frontier fold wave 1` and an empty `%b`.

    This is the optionality half of M1 — the flag is an addition, not a
    replacement — and it is the leg that keeps the existing kernel exams
    (`tests/test_fold_wave_materialize.py`) honest about the message.
    """
    repo, run_dir, base_sha, specs = fold_one_wave(tmp_path)
    mat = do_materialize(repo, run_dir, 1, base_sha, specs)
    assert mat.returncode == 0, mat.stderr

    subject, body, whole = message_parts(repo, candidate_of(mat))
    assert subject == WAVE_1, (
        "M1: without --subject the subject is unchanged from BASE; got %r" % subject)
    assert body == "", (
        "M1: without --subject there is no second paragraph; got %r" % body)
    assert whole == WAVE_1, (
        "M1: without --subject the WHOLE message is %r; got %r" % (WAVE_1, whole))


def test_materialize_wave_number_rides_the_body(tmp_path):
    """Leg (a) [M1], the `<N>` in `frontier fold wave <N>`: the wave number is
    the fold's, not a hard-coded 1, in both the subject and the no-subject
    shape. Wave 2 folds off the same base here — the message is a function of
    `--wave` alone, so no second wave of work is needed to read it.
    """
    repo, base_sha, t1_sha = make_one_writer_repo(tmp_path)
    run_dir = tmp_path / "run"
    specs = [("t1", "t1", t1_sha)]
    fold = do_fold(repo, run_dir, 2, base_sha, specs)
    assert fold.returncode == 0, fold.stderr

    with_sub = do_materialize(repo, run_dir, 2, base_sha, specs,
                              extra=["--subject", SUBJECT])
    assert with_sub.returncode == 0, with_sub.stderr
    subject, body, _ = message_parts(repo, candidate_of(with_sub))
    assert subject == SUBJECT
    assert body == "frontier fold wave 2", (
        "M1: the body carries the fold's own wave number; got %r" % body)

    without = do_materialize(repo, run_dir, 2, base_sha, specs)
    assert without.returncode == 0, without.stderr
    plain, _, whole = message_parts(repo, candidate_of(without))
    assert plain == "frontier fold wave 2"
    assert whole == "frontier fold wave 2"


def test_materialize_candidate_is_still_a_real_candidate(tmp_path):
    """Leg (a) [M1], the guard rail: `--subject` changes the MESSAGE and
    nothing else. Same fold, materialized twice — with and without the flag —
    must yield the same tree and the same parents.

    Without this, an implementation that reached the right subject by
    rebuilding the commit differently would still read as green.
    """
    repo, run_dir, base_sha, specs = fold_one_wave(tmp_path)
    with_sub = do_materialize(repo, run_dir, 1, base_sha, specs,
                              extra=["--subject", SUBJECT])
    without = do_materialize(repo, run_dir, 1, base_sha, specs)
    assert with_sub.returncode == 0, with_sub.stderr
    assert without.returncode == 0, without.stderr

    a, b = candidate_of(with_sub), candidate_of(without)
    assert _git(repo, "rev-parse", a + "^{tree}") == _git(repo, "rev-parse", b + "^{tree}"), (
        "M1: --subject must not change the candidate's tree")
    assert _git(repo, "log", "-1", "--format=%P", a) == _git(repo, "log", "-1", "--format=%P", b), (
        "M1: --subject must not change the candidate's parents")
    assert a != b, "the two candidates differ — in their message, which is the point"


# --- M4: the RUNBOOK sentence ---------------------------------------------

RUNBOOK = ROOT / "fleet" / "RUNBOOK.md"

# The Proof's two `Run:` greps, verbatim: the load-bearing half and the causal
# half of the sentence M4 asks `fleet/RUNBOOK.md` to say.
RUNBOOK_HALVES = [
    "squash-merge takes the plan's title as its subject",
    "titled from the plan's H1",
]


def _runbook_joined():
    """`tr '\\n' ' ' < fleet/RUNBOOK.md` — the wraps joined, so the sentence
    reads the same however the paragraph is hard-wrapped."""
    return RUNBOOK.read_text().replace("\n", " ")


def test_runbook_says_the_fold_commit_is_titled_from_the_plan():
    """M4: `fleet/RUNBOOK.md` says that a squash-merge takes the plan's title
    as its subject because the fold commit is titled from the plan's H1.

    Both halves are exact substrings of the wraps-joined document, matching
    the Proof's own `tr | grep -q` bullets.
    """
    joined = _runbook_joined()
    for half in RUNBOOK_HALVES:
        assert half in joined, (
            "M4: fleet/RUNBOOK.md does not say %r (wraps joined)" % half)
