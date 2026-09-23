"""The exam for task 1 — the kernel folds a patch over the head it was
captured against (`--patch <taskId>=<patchFile>@<anchorSha>`).

One test per Proof leg; every assertion names the leg and the Machine clause it
comes from, so the file maps back to the contract:

* (a) [M1] the anchor is what changes the answer — the same patch spec with and
  without `@<anchorSha>`, side by side;
* (b) [M2] a two-task wave both anchored at `--base` reads exactly as the BASE
  kernel reads it, against literals frozen from the BASE kernel;
* (c) [M3] the three-way over an older anchor: clean where the head's edit is
  elsewhere, one narrated conflict naming `frontier` and the task where it is
  not, resolvable through `resolve --conflict 1 --reply-dir D`;
* (d) [M4] the `fold` event's `anchor` field, `rehydrate` over it (a `resolve`
  whose self-checks read `ok`, a second `materialize` that rebuilds the same
  candidate), and no `anchor` key on a same-anchor fold;
* (e) [M5] the touched set is per task against that task's own anchor;
* (f) [M6] the two refusals stay for what they name;
* (g) [M7] the doc, the `--patch` help and the untouched vendored kernel — the
  second, third and fourth `Run:` lines of the Proof.

The CLI is driven as a subprocess over a temporary repository built with `git`
(the python counterpart of `fleet/tests/_engine_helpers.mjs`'s `makeRepo`), the
way the engine drives it: nothing is imported from the kernel, so what is under
test is the CLI's own contract.

Every git invocation runs with a pinned identity and a pinned author/committer
date, which is what makes leg (d)'s "a second `materialize` returns the same
`candidateSha`" a statement about the fold rather than about the clock.
"""
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
CLI = REPO_ROOT / "skills" / "ultrapowers" / "kernel" / "fold_wave.py"
FOLD_LOG_DOC = REPO_ROOT / "skills" / "ultrapowers" / "kernel" / "FOLD_LOG.md"
VENDOR_DIR = "skills/ultrapowers/kernel/vendor"

# The fixture's BASE content: `a.txt` = eight lines `l1..l8`, plus a `b.txt`
# for leg (e)'s deletion. Fixed bytes — the frozen literals below are trees
# and texts over exactly these.
EIGHT = "".join("l%d\n" % i for i in range(1, 9))
B_TXT = "b1\nb2\n"

GIT_ENV = {
    **os.environ,
    "GIT_AUTHOR_NAME": "exam", "GIT_AUTHOR_EMAIL": "exam@example.com",
    "GIT_COMMITTER_NAME": "exam", "GIT_COMMITTER_EMAIL": "exam@example.com",
    "GIT_AUTHOR_DATE": "2026-01-01T00:00:00+0000",
    "GIT_COMMITTER_DATE": "2026-01-01T00:00:00+0000",
    "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_SYSTEM": "/dev/null",
}

# ---------------------------------------------------------------------------
# Leg (b)'s frozen BASE reading.
#
# M2 is an equality against "the reading the BASE kernel produces for the same
# inputs", and a committed exam cannot run the BASE kernel (it has no
# `$ULTRA_BASE` to check out). So the reading was measured by running the BASE
# kernel (cef3aef8) on exactly the two-task wave `test_m2_leg_b_*` builds — base
# = the BASE commit, task `u`'s patch turning `l2` into `U2`, task `v`'s turning
# `l2` into `V2`, both captured against that same commit — and frozen here.
#
# Tree shas are content-addressed, so they are stable across fresh
# repositories; the `patch` field of a fold event is a temporary path and is
# excluded from the comparison, and `conflicts.json`'s `hunksFile` is the one
# run-dir-dependent field in those bytes, so it is compared with the wave
# directory replaced by `<WAVE-DIR>`.
FROZEN_FOLD_TRIPLES = [
    ("fold", "u", "4ca74fce06ca464223c904948dadacbd3c0dae10"),
    ("fold", "v", "0df389f04892a974a5380d1b93afb6627318ff3a"),
]
FROZEN_CONFLICTS_JSON = """[
  {
    "i": 1,
    "path": "a.txt",
    "kind": "lines",
    "dispatchable": true,
    "reason": "",
    "epoch": 2,
    "hunksFile": "<WAVE-DIR>/conflict-1.hunks.txt",
    "hunkCount": 1
  }
]
"""
FROZEN_REPLY_H1 = "U2\nV2\n"
FROZEN_CANDIDATE_A_TXT = "l1\nU2\nV2\nl3\nl4\nl5\nl6\nl7\nl8\n"

# Leg (g) / M7: the vendored kernel is untouched. The Proof's own check is
# `git diff --quiet $ULTRA_BASE -- <vendor>`; a committed exam reads no
# `$ULTRA_BASE`, so it pins the same fact as a digest over the TRACKED vendor
# files' bytes, frozen at BASE. The file list is pinned beside it, so a vendor
# file that is added or removed is caught too.
FROZEN_VENDOR_FILES = [
    "skills/ultrapowers/kernel/vendor/PROVENANCE.md",
    "skills/ultrapowers/kernel/vendor/manyana.py",
]
FROZEN_VENDOR_DIGEST = \
    "11a51dc8d8e582498f2f090aa8efd799b679b76adc6337eaaf0d15f68f0aa1d7"


# ---------------------------------------------------------------------------
# harness


def git(repo, *args):
    """A git command that must succeed; returns stdout."""
    r = subprocess.run(["git", "-C", str(repo), *args], capture_output=True,
                       text=True, env=GIT_ENV)
    assert r.returncode == 0, "git %s failed: %s" % (" ".join(args), r.stderr)
    return r.stdout


def git_try(repo, *args):
    """A git command that is allowed to fail — absence checks."""
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True,
                          text=True, env=GIT_ENV)


def cli(*args):
    """One `fold_wave.py` invocation, as the engine makes it: a fresh process."""
    return subprocess.run([sys.executable, str(CLI), *args],
                          capture_output=True, text=True, env=GIT_ENV)


def shows(r):
    """A CompletedProcess rendered for an assertion message."""
    return "exit=%d\nstdout=%s\nstderr=%s" % (r.returncode, r.stdout, r.stderr)


def write_commit(repo, files, msg):
    """Write `files` (None = delete) into `repo` and commit; returns the sha."""
    for path, content in files.items():
        target = Path(repo) / path
        if content is None:
            target.unlink()
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content)
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", msg)
    return git(repo, "rev-parse", "HEAD").strip()


def base_repo(tmp_path):
    """(repo, BASE sha): `a.txt` = `l1..l8`, `b.txt` = two lines."""
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "-q", ".")
    base = write_commit(repo, {"a.txt": EIGHT, "b.txt": B_TXT}, "base")
    return repo, base


def capture_patch(tmp_path, repo, anchor, files, name):
    """A task's patch, captured the way a worker captures it: `git diff
    --binary --full-index --no-renames <anchor>` from a worktree AT `anchor`
    carrying the task's edits."""
    worktree = tmp_path / ("worktree-" + name)
    git(repo, "worktree", "add", "-q", "--detach", str(worktree), anchor)
    for path, content in files.items():
        target = worktree / path
        if content is None:
            target.unlink()
        else:
            target.write_text(content)
    diff = git(worktree, "diff", "--binary", "--full-index", "--no-renames",
               anchor)
    patch = tmp_path / (name + ".patch")
    patch.write_text(diff)
    return patch


def spec(task_id, patch, anchor=None):
    """A `--patch` spec: `<taskId>=<patchFile>`, or the anchored form
    `<taskId>=<patchFile>@<anchorSha>` (M1)."""
    if anchor is None:
        return "%s=%s" % (task_id, patch)
    return "%s=%s@%s" % (task_id, patch, anchor)


def fold(repo, run_dir, wave, base, patches=(), branches=()):
    args = ["fold", "--repo", str(repo), "--run-dir", str(run_dir),
            "--wave", str(wave), "--base", base]
    for s in patches:
        args += ["--patch", s]
    for s in branches:
        args += ["--branch", s]
    return cli(*args)


def resolve(repo, run_dir, wave, conflict, reply_dir, patches):
    args = ["resolve", "--repo", str(repo), "--run-dir", str(run_dir),
            "--wave", str(wave), "--conflict", str(conflict),
            "--reply-dir", str(reply_dir)]
    for s in patches:
        args += ["--patch", s]
    return cli(*args)


def materialize(repo, run_dir, wave, prev_head, patches):
    args = ["materialize", "--repo", str(repo), "--run-dir", str(run_dir),
            "--wave", str(wave), "--prev-head", prev_head]
    for s in patches:
        args += ["--patch", s]
    return cli(*args)


def wave_dir(run_dir, wave):
    return Path(run_dir) / "frontier" / ("wave-%d" % wave)


def read_events(run_dir, wave):
    log = wave_dir(run_dir, wave) / "fold_log.jsonl"
    assert log.is_file(), "no fold log at %s" % log
    return [json.loads(line) for line in log.read_text().splitlines()
            if line.strip()]


def fold_events(events):
    return [e for e in events if e.get("type") == "fold"]


def triples(events):
    """The `(type, task, headSha)` triples M2 compares — the `patch` field is a
    temporary path and is deliberately not among them."""
    return [(e["type"], e["task"], e["headSha"]) for e in fold_events(events)]


def write_reply(tmp_path, name, bodies):
    """A resolver reply directory: one `h<k>.txt` per hunk."""
    reply_dir = tmp_path / name
    reply_dir.mkdir()
    for hunk_id, body in bodies.items():
        (reply_dir / (hunk_id + ".txt")).write_text(body)
    return reply_dir


def candidate_text(repo, candidate, path):
    return git(repo, "cat-file", "-p", "%s:%s" % (candidate, path))


def candidate_carries(repo, candidate, path):
    return git_try(repo, "rev-parse", "--verify", "-q",
                   "%s:%s" % (candidate, path)).returncode == 0


def unrelated_root_commit(repo):
    """A root commit of the empty tree — a head the base is no ancestor of."""
    empty_tree = subprocess.run(["git", "-C", str(repo), "mktree"], input="",
                                capture_output=True, text=True, env=GIT_ENV,
                                check=True).stdout.strip()
    return subprocess.run(["git", "-C", str(repo), "commit-tree", empty_tree,
                           "-m", "unrelated root"], capture_output=True,
                          text=True, env=GIT_ENV, check=True).stdout.strip()


# ---------------------------------------------------------------------------
# (a) [M1] the anchor is what changed the answer


def test_m1_leg_a_anchor_decides_where_the_patch_applies(tmp_path):
    """Leg (a) [M1]: `--patch t=p.patch@BASE` over a `--base` the patch does
    NOT apply to folds clean and complete; the same spec without `@BASE` is the
    unchanged exit-2 refusal. The two differ only in the anchor.

    `H1` moves `l4`, which sits inside the patch's own hunk context, so `git
    apply` cannot place the patch over `H1` — while the re-rooted three-way
    (`l2` against `l4`) has nothing to disagree about.
    """
    repo, base = base_repo(tmp_path)
    h1 = write_commit(repo, {"a.txt": EIGHT.replace("l4", "L4")},
                      "h1 moves l4")
    patch = capture_patch(tmp_path, repo, base,
                          {"a.txt": EIGHT.replace("l2", "T2")}, "t")

    anchored = fold(repo, tmp_path / "run-anchored", 1, h1,
                    [spec("t", patch, base)])
    assert anchored.returncode == 0, (
        "M1 leg (a): a patch anchored at its own capture head must fold — "
        "`fold --base H1 --patch t=p.patch@BASE`:\n%s" % shows(anchored))
    reply = json.loads(anchored.stdout)
    assert reply["complete"] is True, (
        "M1 leg (a): the anchored fold's reply must read `\"complete\": true`, "
        "got %r" % reply)

    bare = fold(repo, tmp_path / "run-bare", 1, h1, [spec("t", patch)])
    assert bare.returncode == 2, (
        "M1/M6 leg (a): the same patch WITHOUT `@BASE` is anchored at the "
        "wave's `--base`, which it does not apply over — that is still the "
        "exit-2 refusal:\n%s" % shows(bare))
    assert "refusing wave 1: patch for task t" in bare.stderr, (
        "M1/M6 leg (a): the unanchored refusal keeps its stderr line, got %r"
        % bare.stderr)


# ---------------------------------------------------------------------------
# (b) [M2] a same-anchor wave reads exactly as at BASE


@pytest.mark.parametrize("form", ["bare", "explicit"])
def test_m2_leg_b_same_anchor_wave_reads_as_the_base_kernel(tmp_path, form):
    """Leg (b) [M2]: a two-task wave both anchored at `--base` — spelled
    without `@` (`bare`) and with `@<--base>` (`explicit`), which M1 says are
    the same wave — folds, resolves and materializes to the frozen BASE
    reading: the same fold triples with no `anchor` key, a byte-equal
    `conflicts.json`, the same candidate `a.txt`.
    """
    repo, base = base_repo(tmp_path)
    pu = capture_patch(tmp_path, repo, base,
                       {"a.txt": EIGHT.replace("l2", "U2")}, "u")
    pv = capture_patch(tmp_path, repo, base,
                       {"a.txt": EIGHT.replace("l2", "V2")}, "v")
    anchor = None if form == "bare" else base
    patches = [spec("u", pu, anchor), spec("v", pv, anchor)]
    run_dir = tmp_path / "run"

    folded = fold(repo, run_dir, 1, base, patches)
    assert folded.returncode == 0, (
        "M2 leg (b): the same-anchor wave must fold exactly as at BASE:\n%s"
        % shows(folded))
    reply = json.loads(folded.stdout)
    assert (reply["conflicts"], reply["complete"]) == (1, False), (
        "M2 leg (b): at BASE this wave stops on one dispatchable conflict, "
        "got %r" % reply)

    events = read_events(run_dir, 1)
    assert triples(events) == FROZEN_FOLD_TRIPLES, (
        "M2 leg (b): the fold events' (type, task, headSha) triples must equal "
        "the BASE kernel's, got %r" % (triples(events),))
    assert all("anchor" not in e for e in fold_events(events)), (
        "M2/M4 leg (b),(d): a patch anchored at the wave's base carries NO "
        "`anchor` key, got %r" % fold_events(events))

    conflicts = wave_dir(run_dir, 1) / "conflicts.json"
    got = conflicts.read_text().replace(str(wave_dir(run_dir, 1)), "<WAVE-DIR>")
    assert got == FROZEN_CONFLICTS_JSON, (
        "M2 leg (b): conflicts.json must be byte-identical to the BASE "
        "kernel's (the wave dir is the one path-dependent field), got:\n%s"
        % got)

    reply_dir = write_reply(tmp_path, "reply", {"h1": FROZEN_REPLY_H1})
    resolved = resolve(repo, run_dir, 1, 1, reply_dir, patches)
    assert resolved.returncode == 0, (
        "M2 leg (b): the same-anchor wave resolves as at BASE:\n%s"
        % shows(resolved))
    assert json.loads(resolved.stdout)["complete"] is True, (
        "M2 leg (b): the resolve reply must complete the wave, got %r"
        % resolved.stdout)

    built = materialize(repo, run_dir, 1, base, patches)
    assert built.returncode == 0, (
        "M2 leg (b): the same-anchor wave materializes as at BASE:\n%s"
        % shows(built))
    candidate = json.loads(built.stdout)["candidateSha"]
    assert candidate_text(repo, candidate, "a.txt") == FROZEN_CANDIDATE_A_TXT, (
        "M2 leg (b): the candidate's a.txt must be the BASE kernel's text, "
        "got %r" % candidate_text(repo, candidate, "a.txt"))


# ---------------------------------------------------------------------------
# (c) [M3] the three-way over an older anchor


def test_m3_leg_c_clean_three_way_over_an_older_anchor(tmp_path):
    """Leg (c) [M3], clean case: a task that changed line 2 of a file whose
    line 8 the head has since changed folds clean, and the candidate carries
    BOTH changes — `l1 T2 l3 … l7 L8`.
    """
    repo, base = base_repo(tmp_path)
    h1 = write_commit(repo, {"a.txt": EIGHT.replace("l8", "L8")},
                      "h1 moves l8")
    patch = capture_patch(tmp_path, repo, base,
                          {"a.txt": EIGHT.replace("l2", "T2")}, "t")
    run_dir = tmp_path / "run"

    folded = fold(repo, run_dir, 1, h1, [spec("t", patch, base)])
    assert folded.returncode == 0, (
        "M3 leg (c): the anchored fold must be clean:\n%s" % shows(folded))
    reply = json.loads(folded.stdout)
    assert (reply["clean"], reply["complete"]) == (True, True), (
        "M3 leg (c): line 2 against line 8 is a clean three-way over the "
        "anchor, got %r" % reply)

    built = materialize(repo, run_dir, 1, h1, [spec("t", patch, base)])
    assert built.returncode == 0, (
        "M3 leg (c): materialize must build the candidate:\n%s" % shows(built))
    candidate = json.loads(built.stdout)["candidateSha"]
    assert candidate_text(repo, candidate, "a.txt") == \
        "l1\nT2\nl3\nl4\nl5\nl6\nl7\nL8\n", (
        "M3 leg (c): the candidate must carry the task's edit AND the head's, "
        "got %r" % candidate_text(repo, candidate, "a.txt"))


def anchored_conflict_wave(tmp_path):
    """The M3 conflict case, driven end to end; returns every reading.

    The head changed line 2 to `X2`, the task changed the same line to `T2`
    over its older anchor, so the re-rooted three-way narrates one conflict.
    Nothing is asserted here — legs (c) and (d) each read what they own off
    the returned readings.
    """
    repo, base = base_repo(tmp_path)
    h1 = write_commit(repo, {"a.txt": EIGHT.replace("l2", "X2")},
                      "h1 moves l2")
    patch = capture_patch(tmp_path, repo, base,
                          {"a.txt": EIGHT.replace("l2", "T2")}, "t")
    run_dir = tmp_path / "run"
    patches = [spec("t", patch, base)]

    out = {"repo": repo, "base": base, "head": h1, "run_dir": run_dir,
           "patches": patches}
    out["fold"] = fold(repo, run_dir, 1, h1, patches)
    index = wave_dir(run_dir, 1) / "conflicts.json"
    narration = wave_dir(run_dir, 1) / "conflict-1.txt"
    brief = wave_dir(run_dir, 1) / "conflict-1.hunks.txt"
    out["index"] = json.loads(index.read_text()) if index.is_file() else None
    out["narration"] = narration.read_text() if narration.is_file() else None
    out["brief"] = brief.read_text() if brief.is_file() else None

    # The reply: the two sides' lines, in the order the exam chooses.
    out["reply_lines"] = ["X2", "T2"]
    reply_dir = write_reply(tmp_path, "reply", {"h1": "X2\nT2\n"})
    out["resolve"] = resolve(repo, run_dir, 1, 1, reply_dir, patches)
    out["materialize"] = materialize(repo, run_dir, 1, h1, patches)
    # Leg (d)'s rehydrate check: a SECOND materialize on the same wave rebuilds
    # the engine from the log alone, over each task's recorded anchor.
    out["materialize2"] = materialize(repo, run_dir, 1, h1, patches)
    out["events"] = read_events(run_dir, 1) \
        if (wave_dir(run_dir, 1) / "fold_log.jsonl").is_file() else []
    return out


def test_m3_leg_c_conflict_is_narrated_and_resolved(tmp_path):
    """Leg (c) [M3], conflict case: exactly one narrated conflict on `a.txt`,
    dispatchable, whose marker sides read `frontier` and the task's id — the
    shape `hunks.derive` accepts — and `resolve --conflict 1 --reply-dir D`
    with one `h1.txt` completes the wave into a candidate carrying the reply's
    lines.
    """
    w = anchored_conflict_wave(tmp_path)
    assert w["fold"].returncode == 0, (
        "M3 leg (c): the anchored fold must run and narrate, not refuse:\n%s"
        % shows(w["fold"]))
    reply = json.loads(w["fold"].stdout)
    assert (reply["conflicts"], reply["dispatchable"], reply["parked"]) == \
        (1, 1, 0), (
        "M3 leg (c): the same line edited on both sides narrates exactly one "
        "dispatchable conflict, got %r" % reply)

    assert w["index"] is not None and len(w["index"]) == 1, (
        "M3 leg (c): conflicts.json must name exactly one entry, got %r"
        % (w["index"],))
    entry = w["index"][0]
    assert entry["path"] == "a.txt", (
        "M3 leg (c): the conflict's `path` is a.txt, got %r" % entry)
    assert entry["dispatchable"] is True, (
        "M3 leg (c): the conflict must be `dispatchable`, got %r" % entry)
    assert entry["hunkCount"] == 1, (
        "M3 leg (c): the narration derives one hunk, answered by `h1.txt`, "
        "got %r" % entry)

    markers = [line for line in (w["narration"] or "").split("\n")
               if line.startswith(("<<<<<<<", "=======", ">>>>>>>"))]
    assert any("frontier" in line for line in markers), (
        "M3 leg (c): a marker side must read `frontier`, got %r" % markers)
    assert any(line.endswith(" t") or " t " in line for line in markers), (
        "M3 leg (c): a marker side must read the task's id `t`, got %r"
        % markers)
    assert w["brief"] is not None and "HUNK h1" in w["brief"], (
        "M3 leg (c): the hunks brief must carry the `h1` header the reply "
        "answers, got %r" % w["brief"])

    assert w["resolve"].returncode == 0, (
        "M3 leg (c): the reply must be accepted and complete the wave:\n%s"
        % shows(w["resolve"]))
    assert json.loads(w["resolve"].stdout)["complete"] is True, (
        "M3 leg (c): the resolve reply must read `\"complete\": true`, got %r"
        % w["resolve"].stdout)

    assert w["materialize"].returncode == 0, (
        "M3 leg (c): the resolved wave must materialize:\n%s"
        % shows(w["materialize"]))
    candidate = json.loads(w["materialize"].stdout)["candidateSha"]
    assert candidate_text(w["repo"], candidate, "a.txt") == \
        "l1\nX2\nT2\nl3\nl4\nl5\nl6\nl7\nl8\n", (
        "M3 leg (c): the candidate must carry the reply's lines in place of "
        "the conflict, got %r" % candidate_text(w["repo"], candidate, "a.txt"))


# ---------------------------------------------------------------------------
# (d) [M4] the recorded anchor, and rehydrate over it


def test_m4_leg_d_anchor_is_recorded_and_rehydrated(tmp_path):
    """Leg (d) [M4]: the `fold` event for `t` carries `"anchor"` equal to the
    anchor sha; the `resolve` reply's `selfChecks` reads `ok` (the post-fold
    self-checks rehydrate the wave over that anchor); and a second
    `materialize` on the same wave returns the same `candidateSha`.
    """
    w = anchored_conflict_wave(tmp_path)
    assert w["fold"].returncode == 0, (
        "M4 leg (d): the anchored fold must run:\n%s" % shows(w["fold"]))
    folds = fold_events(w["events"])
    assert len(folds) == 1 and folds[0]["task"] == "t", (
        "M4 leg (d): one fold event for task t, got %r" % (folds,))
    assert folds[0].get("anchor") == w["base"], (
        "M4 leg (d): the fold event must carry `anchor` = the anchor sha %s, "
        "got %r" % (w["base"], folds[0]))

    assert w["resolve"].returncode == 0, (
        "M4 leg (d): resolve must complete the wave:\n%s" % shows(w["resolve"]))
    assert json.loads(w["resolve"].stdout)["selfChecks"] == "ok", (
        "M4 leg (d): the self-checks (raw-shuffle + log-replay rehydrate over "
        "the recorded anchor) must read `ok`, got %r" % w["resolve"].stdout)

    assert w["materialize"].returncode == 0, (
        "M4 leg (d): the first materialize must build a candidate:\n%s"
        % shows(w["materialize"]))
    assert w["materialize2"].returncode == 0, (
        "M4 leg (d): a second materialize must rebuild the same engine from "
        "the log alone:\n%s" % shows(w["materialize2"]))
    first = json.loads(w["materialize"].stdout)["candidateSha"]
    second = json.loads(w["materialize2"].stdout)["candidateSha"]
    assert first == second, (
        "M4 leg (d): a second materialize on the same wave must return the "
        "same candidateSha, got %s then %s" % (first, second))


def test_m4_leg_d_a_base_anchored_fold_records_no_anchor_key(tmp_path):
    """Leg (d) [M4]: a `fold` event without `anchor` reads as anchored at the
    base, so a patch whose anchor IS the base — spelled either way — records no
    `anchor` key and every log written before this task rehydrates unchanged.
    """
    repo, base = base_repo(tmp_path)
    patch = capture_patch(tmp_path, repo, base,
                          {"a.txt": EIGHT.replace("l2", "T2")}, "t")
    for form, anchor in (("bare", None), ("explicit", base)):
        run_dir = tmp_path / ("run-" + form)
        folded = fold(repo, run_dir, 1, base, [spec("t", patch, anchor)])
        assert folded.returncode == 0, (
            "M4 leg (d): the %s same-anchor fold must succeed:\n%s"
            % (form, shows(folded)))
        folds = fold_events(read_events(run_dir, 1))
        assert folds and all("anchor" not in e for e in folds), (
            "M4 leg (d): the %s form's fold event must carry no `anchor` key, "
            "got %r" % (form, folds))


# ---------------------------------------------------------------------------
# (e) [M5] the touched set is per task, against that task's anchor


def test_m5_leg_e_touched_set_is_derived_against_each_anchor(tmp_path):
    """Leg (e) [M5]: with the head also ADDING `new.txt` after the task's
    anchor and the task's patch DELETING `b.txt`, the candidate carries
    `new.txt` with the head's content (the task never touched it) and no
    `b.txt` (the task deleted it relative to its anchor).
    """
    repo, base = base_repo(tmp_path)
    h1 = write_commit(repo, {"a.txt": EIGHT.replace("l8", "L8"),
                             "new.txt": "n1\n"}, "h1 moves l8, adds new.txt")
    patch = capture_patch(tmp_path, repo, base,
                          {"a.txt": EIGHT.replace("l2", "T2"),
                           "b.txt": None}, "t")
    run_dir = tmp_path / "run"
    patches = [spec("t", patch, base)]

    folded = fold(repo, run_dir, 1, h1, patches)
    assert folded.returncode == 0, (
        "M5 leg (e): the anchored fold must run:\n%s" % shows(folded))
    assert json.loads(folded.stdout)["complete"] is True, (
        "M5 leg (e): an edit plus a delete over the anchor folds clean, got %r"
        % folded.stdout)

    built = materialize(repo, run_dir, 1, h1, patches)
    assert built.returncode == 0, (
        "M5 leg (e): materialize must build the candidate:\n%s" % shows(built))
    candidate = json.loads(built.stdout)["candidateSha"]
    assert candidate_text(repo, candidate, "new.txt") == "n1\n", (
        "M5 leg (e): a path the head added after the task's anchor, which the "
        "task never touched, must be present with the head's content, got %r"
        % candidate_text(repo, candidate, "new.txt"))
    assert not candidate_carries(repo, candidate, "b.txt"), (
        "M5 leg (e): a path the task deleted relative to its anchor must be "
        "absent from the candidate")
    assert candidate_text(repo, candidate, "a.txt") == \
        "l1\nT2\nl3\nl4\nl5\nl6\nl7\nL8\n", (
        "M5 leg (e): the folded path still carries both edits, got %r"
        % candidate_text(repo, candidate, "a.txt"))


# ---------------------------------------------------------------------------
# (f) [M6] the two refusals stay for what they name


def test_m6_leg_f_patch_that_does_not_apply_over_its_anchor(tmp_path):
    """Leg (f) [M6]: a patch whose preimage line was already edited at its
    anchor is still `refusing wave N: patch for task <id> (<file>) does not
    apply against base <anchor>` on stderr with exit 2 — and the sha it names
    is the ANCHOR's, not `--base`'s.
    """
    repo, base = base_repo(tmp_path)
    anchor = write_commit(repo, {"a.txt": EIGHT.replace("l2", "X2")},
                          "the anchor already moved l2")
    wave_base = write_commit(repo, {"a.txt": EIGHT.replace("l2", "X2")
                                    .replace("l8", "L8")}, "the wave's base")
    patch = capture_patch(tmp_path, repo, base,
                          {"a.txt": EIGHT.replace("l2", "T2")}, "t")
    run_dir = tmp_path / "run"

    refused = fold(repo, run_dir, 1, wave_base, [spec("t", patch, anchor)])
    assert refused.returncode == 2, (
        "M6 leg (f): a patch that does not apply over its own anchor is the "
        "exit-2 refusal:\n%s" % shows(refused))
    assert "refusing wave 1: patch for task t" in refused.stderr, (
        "M6 leg (f): the refusal names the wave and the task, got %r"
        % refused.stderr)
    assert str(patch) in refused.stderr, (
        "M6 leg (f): the refusal names the patch file, got %r" % refused.stderr)
    assert "does not apply against base %s" % anchor[:7] in refused.stderr, (
        "M6 leg (f): the refusal names the ANCHOR it could not apply over "
        "(%s), got %r" % (anchor[:7], refused.stderr))
    assert wave_base[:7] not in refused.stderr, (
        "M6 leg (f): the patch was applied over its anchor, never over "
        "`--base` (%s), so the refusal must not name it: %r"
        % (wave_base[:7], refused.stderr))
    assert not wave_dir(run_dir, 1).exists(), (
        "M6 leg (f): the refusal comes before anything is written, but %s "
        "exists" % wave_dir(run_dir, 1))


def test_m6_leg_f_undescended_task_head_is_still_refused(tmp_path):
    """Leg (f) [M6]: a task head the base is not an ancestor of is still
    refused (exit 2, nothing written) — the anchor changes nothing here.
    """
    repo, base = base_repo(tmp_path)
    root = unrelated_root_commit(repo)
    run_dir = tmp_path / "run"

    refused = fold(repo, run_dir, 1, base, branches=["t=x:%s" % root])
    assert refused.returncode == 2, (
        "M6 leg (f): an undescended task head is still the exit-2 refusal:\n%s"
        % shows(refused))
    assert "not descended from base" in refused.stderr, (
        "M6 leg (f): the refusal keeps its stderr line, got %r"
        % refused.stderr)
    assert not wave_dir(run_dir, 1).exists(), (
        "M6 leg (f): nothing is written on the undescended refusal, but %s "
        "exists" % wave_dir(run_dir, 1))


# ---------------------------------------------------------------------------
# (g) [M7] the doc, the help, the untouched vendor


def test_m7_leg_g_fold_log_documents_the_anchor(tmp_path):
    """Leg (g) [M7], the Proof's third `Run:` line (`grep -q 'anchor'
    skills/ultrapowers/kernel/FOLD_LOG.md`): the doc documents the `anchor`
    field on the `fold` event and the `@<anchorSha>` form of `--patch`.
    """
    doc = FOLD_LOG_DOC.read_text()
    assert "anchor" in doc, (
        "M7 leg (g): FOLD_LOG.md must document the anchor (the Proof's third "
        "Run line greps for it)")
    assert '"anchor"' in doc, (
        "M7 leg (g): FOLD_LOG.md must show the `anchor` FIELD on the fold "
        "event, in the event's own JSON form")
    assert "@<anchorSha>" in doc, (
        "M7 leg (g): FOLD_LOG.md must document the `--patch "
        "<taskId>=<patchFile>@<anchorSha>` form")


def test_m7_leg_g_fold_help_names_the_anchor_form(tmp_path):
    """Leg (g) [M7], the Proof's fourth `Run:` line (`fold --help | grep -q
    '@<anchorSha>'`), and M1's "on `fold`, `resolve` and `materialize` alike".
    """
    for command in ("fold", "resolve", "materialize"):
        helped = cli(command, "--help")
        assert helped.returncode == 0, (
            "M7 leg (g): `%s --help` must run:\n%s" % (command, shows(helped)))
        assert "@<anchorSha>" in helped.stdout, (
            "M1/M7 leg (g): `%s --help` must name the `@<anchorSha>` form of "
            "--patch, got:\n%s" % (command, helped.stdout))


def test_m7_leg_g_vendored_kernel_is_untouched(tmp_path):
    """Leg (g) [M7], the Proof's second `Run:` line (`git diff --quiet
    $ULTRA_BASE -- skills/ultrapowers/kernel/vendor`): the vendored kernel is
    untouched. A committed exam reads no `$ULTRA_BASE`, so the same fact is
    pinned as the tracked vendor file list plus a digest of their bytes,
    frozen at BASE.
    """
    listed = subprocess.run(["git", "-C", str(REPO_ROOT), "ls-files", "-z",
                             "--", VENDOR_DIR], capture_output=True,
                            text=True, env=GIT_ENV)
    assert listed.returncode == 0, (
        "M7 leg (g): could not list the vendored kernel:\n%s" % shows(listed))
    files = sorted(p for p in listed.stdout.split("\0") if p)
    assert files == FROZEN_VENDOR_FILES, (
        "M7 leg (g): the vendored kernel's file list changed, got %r" % files)

    digest = hashlib.sha256()
    for rel in files:
        blob = (REPO_ROOT / rel).read_bytes()
        digest.update(("%d\0%s\0%d\0" % (len(rel), rel, len(blob))).encode())
        digest.update(blob)
    assert digest.hexdigest() == FROZEN_VENDOR_DIGEST, (
        "M7 leg (g): the vendored kernel's bytes changed (%s), and "
        "`vendor/manyana.py` is never edited" % digest.hexdigest())
