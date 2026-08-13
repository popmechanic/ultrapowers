"""fold_wave.py — the wave-scoped CLI: `fold` folds a wave's completed tasks
through the kernel and writes its self-sufficient record (fold_log.jsonl,
per-conflict narrations, conflicts.json); `resolve` applies a resolver reply
against a rehydrated engine, or re-narrates once (markerless) on a stale
epoch. Every scenario is its own tmp_path git repo — no shared fixtures.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KERNEL = ROOT / "skills" / "ultrapowers" / "kernel"
CLI = str(KERNEL / "fold_wave.py")
sys.path.insert(0, str(KERNEL))
sys.path.insert(0, str(KERNEL / "vendor"))
import repo_weave as rw
import frontier_fold as ff
import fold_wave as fw

BASE_APP = "def a(x):\n    return x\n\ndef b(y):\n    return y\n\ndef c(z):\n    return z\n"
T1_APP = "def a(x):\n    return x\n\ndef b(y):\n    return y + 1\n\ndef c(z):\n    return z\n"
T2_APP = "def a(x):\n    return x\n\ndef b(y):\n    return y * 2\n\ndef c(z):\n    return z\n"
T3_APP = "def a(x):\n    return x\n\ndef b(y):\n    return y\n\ndef c(z):\n    return z + 5\n"


def _git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True,
                          capture_output=True, text=True).stdout.strip()


def _init(repo):
    repo.mkdir()
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "t@example.com")
    _git(repo, "config", "user.name", "T")


def make_repo(tmp_path):
    """Base commit (app.py: 3 short functions + other.txt) plus t1/t2
    branches editing app.py's `b` line differently — one genuine conflict —
    with t2 also deleting other.txt."""
    repo = tmp_path / "repo"
    _init(repo)
    (repo / "app.py").write_text(BASE_APP)
    (repo / "other.txt").write_text("hello\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "base")
    base_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", "-b", "t1", base_sha)
    (repo / "app.py").write_text(T1_APP)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "t1")
    t1_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", "-b", "t2", base_sha)
    (repo / "app.py").write_text(T2_APP)
    (repo / "other.txt").unlink()
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "t2")
    t2_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", base_sha)
    return repo, base_sha, {"t1": t1_sha, "t2": t2_sha}


def add_third_branch(repo, base_sha):
    """t3: touches only app.py's `c` line — no new conflict, but advances the
    touched-at map past the t1/t2 conflict's recorded epoch."""
    _git(repo, "checkout", "-q", "-b", "t3", base_sha)
    (repo / "app.py").write_text(T3_APP)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "t3")
    t3_sha = _git(repo, "rev-parse", "HEAD")
    _git(repo, "checkout", "-q", base_sha)
    return t3_sha


def make_union_scope_repo(tmp_path):
    """Base commit with app.py + shared.py, both pre-existing.

    Three base-existing paths, folded in the order t1, t2, t3:

    * `app.py`  — single writer (t1 only): the modify-as-modify path itself.
    * `early.py` — contested by t1 and t2, untouched by t3.
    * `late.py`  — contested by t2 and t3, untouched by t1.

    Every contested path is in the base, so `_text_kind` must report `lines`.
    No single branch's touched set covers both contested paths, so ANY base
    scope narrower than the union of all three heads drops one of them out of
    the base and turns its collision into `add/add` — a first-branch (or
    per-task streaming) scope loses `late.py`, a last-branch scope loses
    `early.py`. That is the falsifier this shape exists for.
    """
    repo = tmp_path / "unionscope"
    _init(repo)
    (repo / "app.py").write_text("x = 1\n")
    (repo / "early.py").write_text("e = 1\n")
    (repo / "late.py").write_text("l = 1\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "base")
    base_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", "-b", "t1", base_sha)
    (repo / "app.py").write_text("x = 2\n")
    (repo / "early.py").write_text("e = 2\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "t1")
    t1_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", "-b", "t2", base_sha)
    (repo / "early.py").write_text("e = 3\n")
    (repo / "late.py").write_text("l = 2\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "t2")
    t2_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", "-b", "t3", base_sha)
    (repo / "late.py").write_text("l = 3\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "t3")
    t3_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", base_sha)
    return repo, base_sha, {"t1": t1_sha, "t2": t2_sha, "t3": t3_sha}


def make_big_conflict_repo(tmp_path):
    """A ~1200-line file both branches edit at the same line, differently: a
    genuine conflict whose narration exceeds RESOLVER_LINE_CAP."""
    lines = ["line %d" % i for i in range(1200)]
    base_text = "\n".join(lines) + "\n"
    t1_lines = list(lines)
    t1_lines[600] = "line 600 (t1)"
    t2_lines = list(lines)
    t2_lines[600] = "line 600 (t2)"

    repo = tmp_path / "big"
    _init(repo)
    (repo / "big.py").write_text(base_text)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "base")
    base_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", "-b", "t1", base_sha)
    (repo / "big.py").write_text("\n".join(t1_lines) + "\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "t1")
    t1_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", "-b", "t2", base_sha)
    (repo / "big.py").write_text("\n".join(t2_lines) + "\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "t2")
    t2_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", base_sha)
    return repo, base_sha, {"t1": t1_sha, "t2": t2_sha}


def make_single_writer_repo(tmp_path, n_lines, name="huge"):
    """One base-existing text file of `n_lines`, edited by exactly ONE branch.

    `_fold_text` calls `merge_states` for every base-existing touched path even
    with a single writer, so this is the cheapest shape that drives the kernel's
    per-line recursion — no conflict required.
    """
    repo = tmp_path / name
    _init(repo)
    lines = ["line %d" % i for i in range(n_lines)]
    (repo / "huge.py").write_text("\n".join(lines) + "\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "base")
    base_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", "-b", "t1", base_sha)
    edited = list(lines)
    edited[n_lines // 2] = "line %d (t1)" % (n_lines // 2)
    (repo / "huge.py").write_text("\n".join(edited) + "\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "t1")
    t1_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", base_sha)
    return repo, base_sha, t1_sha, "\n".join(edited) + "\n"


def run_cli(*args):
    return subprocess.run([sys.executable, CLI, *args],
                          capture_output=True, text=True)


def do_fold(repo, run_dir, wave, base_sha, branch_specs):
    """branch_specs: [(taskId, branchName, headSha), ...] in task-index order."""
    args = ["fold", "--repo", str(repo), "--run-dir", str(run_dir),
            "--wave", str(wave), "--base", base_sha]
    for tid, name, sha in branch_specs:
        args += ["--branch", "%s=%s:%s" % (tid, name, sha)]
    return run_cli(*args)


def last_json(result):
    return json.loads(result.stdout.strip().splitlines()[-1])


# --- fold ---------------------------------------------------------------


def test_fold_writes_log_narrations_index_and_passes_self_checks(tmp_path):
    repo, base_sha, heads = make_repo(tmp_path)
    run_dir = tmp_path / "run"
    result = do_fold(repo, run_dir, 1, base_sha,
                     [("t1", "t1", heads["t1"]), ("t2", "t2", heads["t2"])])
    assert result.returncode == 0, result.stderr

    wave_dir = run_dir / "frontier" / "wave-1"
    events = [json.loads(l) for l in
              (wave_dir / "fold_log.jsonl").read_text().splitlines()]
    assert events[0] == {"type": "base", "sha": base_sha}
    fold_events = [e for e in events if e["type"] == "fold"]
    assert [(e["task"], e["headSha"]) for e in fold_events] == [
        ("t1", heads["t1"]), ("t2", heads["t2"])]

    index = json.loads((wave_dir / "conflicts.json").read_text())
    assert len(index) == 1
    entry = index[0]
    assert entry["path"] == "app.py" and entry["dispatchable"] is True
    narration = (wave_dir / ("conflict-%d.txt" % entry["i"])).read_text()
    assert any(line.startswith(rw.MARKERS) for line in narration.splitlines())

    payload = last_json(result)
    assert payload == {"clean": False, "conflicts": 1, "dispatchable": 1,
                       "parked": 0, "selfChecks": "ok"}


def test_fold_refuses_preexisting_log(tmp_path):
    repo, base_sha, heads = make_repo(tmp_path)
    run_dir = tmp_path / "run"
    branch_specs = [("t1", "t1", heads["t1"]), ("t2", "t2", heads["t2"])]
    first = do_fold(repo, run_dir, 1, base_sha, branch_specs)
    assert first.returncode == 0, first.stderr

    second = do_fold(repo, run_dir, 1, base_sha, branch_specs)
    assert second.returncode == 2
    assert "fold log already exists for wave 1" in second.stderr


def test_fold_scoped_snapshot_folds_single_writer_modify_as_modify(tmp_path):
    """The union-then-fold ordering contract, made falsifiable.

    `app.py` is a base-existing path with a single writer (t1, folded first),
    which must fold as a modify. It cannot carry the contract on its own — a
    single-writer path materializes identically whether it is scoped as a
    modify or as an add — so the falsifier rides the two contested paths
    `early.py` (t1+t2) and `late.py` (t2+t3): both are in the base, so both
    must be reported `lines`, and no single branch's touched set covers both.
    Narrow cmd_fold's scope to any one head and one of them flips to
    `add/add`, which also diverges cmd_fold's manifest from `rehydrate`'s
    (union-scoped), tripping the replay self-check to exit 3.
    """
    repo, base_sha, heads = make_union_scope_repo(tmp_path)
    run_dir = tmp_path / "run"
    result = do_fold(repo, run_dir, 1, base_sha,
                     [("t1", "t1", heads["t1"]), ("t2", "t2", heads["t2"]),
                      ("t3", "t3", heads["t3"])])
    assert result.returncode == 0, result.stdout + result.stderr

    wave_dir = run_dir / "frontier" / "wave-1"
    index = json.loads((wave_dir / "conflicts.json").read_text())
    assert [(e["path"], e["kind"], e["epoch"]) for e in index] == [
        ("early.py", "lines", 2), ("late.py", "lines", 3)]
    assert not any(e["kind"] == "add/add" for e in index)

    # selfChecks=="ok" pins cmd_fold's own manifest equal to rehydrate's, so
    # reading the manifest through rehydrate also asserts cmd_fold's scoping.
    payload = last_json(result)
    assert payload == {"clean": False, "conflicts": 2, "dispatchable": 2,
                       "parked": 0, "selfChecks": "ok"}

    manifest = ff.rehydrate(repo, wave_dir / "fold_log.jsonl").manifest()
    assert manifest["app.py"] == "x = 2\n"


def test_fold_kernel_limit_parks_with_named_reason(tmp_path):
    repo, base_sha, heads = make_big_conflict_repo(tmp_path)
    run_dir = tmp_path / "run"
    result = do_fold(repo, run_dir, 1, base_sha,
                     [("t1", "t1", heads["t1"]), ("t2", "t2", heads["t2"])])
    assert result.returncode == 0, result.stderr

    wave_dir = run_dir / "frontier" / "wave-1"
    index = json.loads((wave_dir / "conflicts.json").read_text())
    parked = [e for e in index if e["dispatchable"] is False]
    assert parked
    assert any("visible lines" in e["reason"] for e in parked)

    payload = last_json(result)
    assert payload["parked"] == len(parked)
    assert payload["selfChecks"] == "ok"


def test_fold_of_a_10k_line_single_writer_file_stays_inside_the_exit_contract(tmp_path):
    """A file far past any flat recursion ceiling must never crash the CLI.

    10,500 lines needs ~21,004 kernel frames — more than a flat 20,000 limit
    covers — and `_fold_text` merges it even though only one branch wrote it.
    Whatever the platform's stack allows, the invocation must stay inside the
    documented {0, 2, 3} exit contract, print its one-line JSON, and leave the
    wave's artifacts on disk; if the bound could not absorb it, the outcome is
    a NAMED kernel-limit park in the conflicts index, never an uncaught raise.
    """
    n = 10500
    repo, base_sha, t1_sha, t1_text = make_single_writer_repo(tmp_path, n)
    run_dir = tmp_path / "run"
    result = do_fold(repo, run_dir, 1, base_sha, [("t1", "t1", t1_sha)])

    assert result.returncode in (0, 2, 3), result.stderr
    payload = last_json(result)              # stdout JSON exists in every case
    wave_dir = run_dir / "frontier" / "wave-1"
    assert (wave_dir / "fold_log.jsonl").exists()
    index = json.loads((wave_dir / "conflicts.json").read_text())

    parks = [e for e in index if e["kind"] == "kernel-limit"]
    if parks:
        assert result.returncode == 3
        assert parks[0]["dispatchable"] is False
        assert "recursion" in parks[0]["reason"] and "huge.py" in parks[0]["reason"]
        assert payload["parked"] >= 1
        assert payload["selfChecks"].startswith("failed:")
    else:
        # The sized bound absorbed it: an ordinary clean single-task fold.
        assert result.returncode == 0
        assert payload == {"clean": True, "conflicts": 0, "dispatchable": 0,
                           "parked": 0, "selfChecks": "ok"}
        # In-process too: the kernel needs the sized bound wherever it is
        # driven, which is why the helper is the CLI's, not a local hack.
        with fw._recursion_headroom(n + 1):
            manifest = ff.rehydrate(repo, wave_dir / "fold_log.jsonl").manifest()
        assert manifest["huge.py"] == t1_text


def test_recursion_bound_is_sized_from_the_corpus_not_a_flat_ceiling(tmp_path):
    """The bound must scale with the files being folded.

    The kernel's merge walk needs ~2*entries+4 frames, so ANY flat ceiling has
    a cliff: at 10,500 lines the previous flat 20,000 is already short, and the
    park it would produce routes a perfectly foldable wave to fallback. This
    pins the sizing itself — platform stack behaviour never enters into it.
    """
    n = 10500
    repo, base_sha, t1_sha, _ = make_single_writer_repo(tmp_path, n)
    touched = ff._union_touched(repo, base_sha, [t1_sha])
    base = rw.snapshot_scoped(repo, base_sha, touched)
    states = {"t1": rw.publish(base, repo, base_sha, t1_sha, task_id="t1")}

    max_lines = fw._state_max_lines(base, states)
    assert max_lines == n + 1                 # split_lines' trailing "" entry
    bound = fw._recursion_headroom(max_lines).bound
    assert bound >= 2 * max_lines + 4         # what the kernel's walk needs
    assert bound > 20000                      # the flat ceiling this replaces

    # And it costs nothing on a small wave: the ambient limit is kept.
    small = fw._recursion_headroom(0)
    assert small.bound == max(sys.getrecursionlimit(), fw.RECURSION_MARGIN)


def test_fold_parks_a_named_kernel_limit_when_the_bound_is_insufficient(tmp_path,
                                                                        monkeypatch,
                                                                        capsys):
    """The residual-RecursionError path, forced deterministically.

    Zeroing the sizing constants makes `_recursion_headroom` fall back to the
    ambient limit, which a 3,000-line merge (~6,004 frames) cannot fit. The
    fold must then record a named kernel-limit park, write its artifacts,
    report a self-check failure, exit 3, and restore the recursion limit.
    """
    n_lines = 3000
    assert sys.getrecursionlimit() < 2 * n_lines + 4, (
        "ambient recursion limit is too high to force the kernel limit")

    repo, base_sha, t1_sha, _ = make_single_writer_repo(tmp_path, n_lines)
    run_dir = tmp_path / "run"
    monkeypatch.setattr(fw, "RECURSION_LINE_FACTOR", 0)
    monkeypatch.setattr(fw, "RECURSION_MARGIN", 0)

    before = sys.getrecursionlimit()
    code = fw.main(["fold", "--repo", str(repo), "--run-dir", str(run_dir),
                    "--wave", "1", "--base", base_sha,
                    "--branch", "t1=t1:%s" % t1_sha])
    assert sys.getrecursionlimit() == before      # restored on the way out
    assert code == 3

    payload = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert payload == {"clean": False, "conflicts": 1, "dispatchable": 0,
                       "parked": 1,
                       "selfChecks": "failed: kernel recursion limit folding task t1"}

    wave_dir = run_dir / "frontier" / "wave-1"
    index = json.loads((wave_dir / "conflicts.json").read_text())
    assert len(index) == 1
    park = index[0]
    assert park["i"] == 1
    assert park["kind"] == "kernel-limit"
    assert park["dispatchable"] is False
    assert park["path"] == "huge.py"
    assert "kernel recursion limit exceeded folding task t1" in park["reason"]
    # n_lines + 1: the file ends in a newline, so `split_lines` — the one
    # normalization on this path — yields a trailing "" entry.
    assert "huge.py (%d lines)" % (n_lines + 1) in park["reason"]
    assert park["epoch"] == 0                     # nothing folded

    # Every index entry keeps its conflict-<i>.txt, and the log truncates to
    # the folds that actually happened — here, none.
    assert (wave_dir / "conflict-1.txt").read_text() == park["reason"] + "\n"
    events = [json.loads(l) for l in
              (wave_dir / "fold_log.jsonl").read_text().splitlines()]
    assert events == [{"type": "base", "sha": base_sha}]


# --- resolve --------------------------------------------------------------


def test_resolve_applies_at_valid_epoch_and_appends_lines_event(tmp_path):
    repo, base_sha, heads = make_repo(tmp_path)
    run_dir = tmp_path / "run"
    fold_result = do_fold(repo, run_dir, 1, base_sha,
                          [("t1", "t1", heads["t1"]), ("t2", "t2", heads["t2"])])
    assert fold_result.returncode == 0, fold_result.stderr

    wave_dir = run_dir / "frontier" / "wave-1"
    entry = json.loads((wave_dir / "conflicts.json").read_text())[0]

    # No final newline — proves the round trip is byte-identical, not
    # silently re-normalized.
    reply_text = ("def a(x):\n    return x\n\ndef b(y):\n    return 0\n"
                  "\ndef c(z):\n    return z")
    reply_file = tmp_path / "reply.txt"
    reply_file.write_text(reply_text)

    result = run_cli("resolve", "--repo", str(repo), "--run-dir", str(run_dir),
                     "--wave", "1", "--path", entry["path"],
                     "--epoch", str(entry["epoch"]), "--reply-file", str(reply_file))
    assert result.returncode == 0, result.stderr
    assert last_json(result) == {"applied": True}

    events = [json.loads(l) for l in
              (wave_dir / "fold_log.jsonl").read_text().splitlines()]
    assert events[-1]["type"] == "resolve"
    assert events[-1]["path"] == entry["path"]
    assert events[-1]["lines"] == rw.split_lines(reply_text)

    manifest = ff.rehydrate(repo, wave_dir / "fold_log.jsonl").manifest()
    assert manifest[entry["path"]] == reply_text


def test_resolve_stale_renarrates_once_markerless(tmp_path):
    repo, base_sha, heads = make_repo(tmp_path)
    heads["t3"] = add_third_branch(repo, base_sha)
    run_dir = tmp_path / "run"
    fold_result = do_fold(repo, run_dir, 1, base_sha,
                          [("t1", "t1", heads["t1"]), ("t2", "t2", heads["t2"]),
                           ("t3", "t3", heads["t3"])])
    assert fold_result.returncode == 0, fold_result.stderr

    wave_dir = run_dir / "frontier" / "wave-1"
    index_before = json.loads((wave_dir / "conflicts.json").read_text())
    entry = [e for e in index_before if e["path"] == "app.py"][0]
    stale_epoch = entry["epoch"]  # captured after t2's fold, before t3's

    reply_file = tmp_path / "reply.txt"
    reply_file.write_text("def a(x):\n    return x\n")

    result = run_cli("resolve", "--repo", str(repo), "--run-dir", str(run_dir),
                     "--wave", "1", "--path", "app.py",
                     "--epoch", str(stale_epoch), "--reply-file", str(reply_file))
    assert result.returncode == 0, result.stderr
    payload = last_json(result)
    assert payload["applied"] is False and payload["stale"] is True
    assert payload["epoch"] == 3  # three folds now recorded

    renarration_path = Path(payload["renarrationFile"])
    assert renarration_path.exists()
    text = renarration_path.read_text()
    assert not any(line.startswith(rw.MARKERS) for line in text.splitlines())

    index_after = json.loads((wave_dir / "conflicts.json").read_text())
    new_entries = [e for e in index_after if e.get("renarration")]
    assert len(new_entries) == 1
    assert new_entries[0]["path"] == "app.py"
    assert new_entries[0]["epoch"] == 3

    # No log mutation on a stale attempt — nothing was actually applied.
    events = [json.loads(l) for l in
              (wave_dir / "fold_log.jsonl").read_text().splitlines()]
    assert not any(e["type"] == "resolve" for e in events)
