"""The fold-corpus contract: on-disk layout, the two-arm answer shape, and a
fixture corpus built by the real kernel.

Spec: `docs/superpowers/specs/2026-08-31-fold-corpus-validation.md`
(Deliverable A). Everything the replayer reads is a *corpus*: one directory
per run, one directory per wave, self-sufficient by the kernel's own fold-log
contract (`skills/ultrapowers/kernel/FOLD_LOG.md`).

    <corpus_root>/corpus-index.json
    <corpus_root>/<runId>/wave-<n>/fold_log.jsonl   # `patch` fields corpus-relative
    <corpus_root>/<runId>/wave-<n>/task-<id>.patch
    <corpus_root>/<runId>/wave-<n>/conflicts.json + conflict-<i>{,.hunks}.txt

The one rewrite the corpus performs on the kernel's own output is the
`patch` field of every `fold` event (and, for the same reason, `hunksFile` in
`conflicts.json`): both are recorded as absolute paths inside the sandbox that
produced them, so a corpus moved to another machine would fail `rehydrate`
verbatim. Corpus-relative names make the wave directory the whole record.

`make_fixture_corpus` is the suite's synthetic corpus: a scratch repo and four
one-wave scenarios, each folded by the REAL CLI
(`skills/ultrapowers/kernel/fold_wave.py fold --patch …`) so the logs are the
kernel's output rather than an imitation. The four scenarios are the seeds the
replayer's tests assert on — one known instance of each comparison class:

    wave 1  a.txt / b.txt   two patches on disjoint files          -> class 1
    wave 2  c.txt           two appends at the SAME anchor, both
                            declared commutative: the weave unions,
                            git conflicts                          -> class 3
                            (and the union-vs-git ordering is what
                            the class-2 mechanical-equivalence
                            check exists to explain)
    wave 3  d.txt           one patch rewrites the region the other
                            edits inside; the region's context
                            carries a line occurring twice in the
                            base (the XaXbX seed)                  -> class 5
    wave 4  b.txt, bin.dat  one patch deletes base lines within 3
                            of the other's hunk span (the
                            deletion-adjacency seed), and the other
                            rewrites the binary path (the
                            binary-exclusion seed)

Offline and deterministic by construction: no network, no model calls, fixed
identities and commit dates, and every byte written under the caller's `dest`.
"""
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
# Import path per the mechanism `tests/test_frontier_kernel.py` already uses.
KERNEL = ROOT / "skills" / "ultrapowers" / "kernel"
FOLD_WAVE = KERNEL / "fold_wave.py"

INDEX_NAME = "corpus-index.json"
FIXTURE_RUN_ID = "fixture-run"


# --------------------------------------------------------------------------
# the data model
# --------------------------------------------------------------------------

@dataclass
class CorpusEntry:
    """One wave of one run: everything needed to replay it, plus where it lives.

    `wave_dir` is derived from the corpus root on load, never recorded — a
    corpus that moves keeps working. `tasks`, `skipped` and `commutes` carry
    the index's remaining columns; `commutes` is the `--commutes` declaration
    the wave was folded with, without which a determinism re-check of an
    auto-unioned wave would re-fold under different rules than the record.
    """
    run_id: str
    wave: int
    base_sha: str
    mode: str                       # "patch" | "branch"
    wave_dir: Path
    tasks: list = field(default_factory=list)
    skipped: object = None          # None | str reason
    commutes: dict = field(default_factory=dict)   # taskId -> [path, ...]


@dataclass
class PathAnswer:
    """One arm's answer for one path: `"clean"` (with content), `"contended"`,
    or `"binary"` (excluded from content comparison and counted)."""
    status: str
    content: object = None          # bytes | None


@dataclass
class ArmResult:
    """An arm's answer for a whole fold."""
    per_path: dict
    complete: bool


# --------------------------------------------------------------------------
# index I/O
# --------------------------------------------------------------------------

def write_corpus_index(corpus_root: Path, entries) -> None:
    """Write `<corpus_root>/corpus-index.json` — the spec's Deliverable A shape."""
    corpus_root = Path(corpus_root)
    corpus_root.mkdir(parents=True, exist_ok=True)
    rows = [{"runId": e.run_id, "wave": e.wave, "baseSha": e.base_sha,
             "mode": e.mode, "tasks": list(e.tasks), "skipped": e.skipped,
             "commutes": {k: list(v) for k, v in e.commutes.items()}}
            for e in entries]
    (corpus_root / INDEX_NAME).write_text(json.dumps(rows, indent=2) + "\n")


def load_corpus_index(corpus_root: Path):
    """The index, with each entry's `wave_dir` resolved against `corpus_root`."""
    corpus_root = Path(corpus_root)
    path = corpus_root / INDEX_NAME
    if not path.exists():
        raise FileNotFoundError("no %s under %s" % (INDEX_NAME, corpus_root))
    return [CorpusEntry(run_id=row["runId"], wave=row["wave"],
                        base_sha=row["baseSha"], mode=row["mode"],
                        wave_dir=wave_dir(corpus_root, row["runId"], row["wave"]),
                        tasks=list(row.get("tasks") or []),
                        skipped=row.get("skipped"),
                        commutes={k: list(v) for k, v
                                  in (row.get("commutes") or {}).items()})
            for row in json.loads(path.read_text())]


def wave_dir(corpus_root: Path, run_id: str, wave: int) -> Path:
    return Path(corpus_root) / run_id / ("wave-%d" % wave)


# --------------------------------------------------------------------------
# the fixture corpus
# --------------------------------------------------------------------------

# Base contents. a.txt/b.txt/c.txt carry no repeated line, so the XaXbX
# ride-along is False on every wave but the one seeded for it; d.txt carries
# `--` twice, which is that seed.
A_TXT = "a one\na two\na three\na four\na five\na six\n"
B_TXT = "".join("b %s\n" % n for n in
                ("one", "two", "three", "four", "five", "six",
                 "seven", "eight", "nine", "ten"))
C_TXT = "c one\nc two\nc anchor\nc three\nc four\n"
D_TXT = "d header\n--\nd alpha\n--\nd beta\nd footer\n"
BIN_DAT = b"\x89BIN\r\n\x1a\n" + bytes(range(48))

BASE_FILES = {"a.txt": A_TXT, "b.txt": B_TXT, "c.txt": C_TXT, "d.txt": D_TXT,
              "bin.dat": BIN_DAT}

# wave -> {task id -> {path: new content}}; content `None` is a deletion.
SCENARIOS = {
    1: {  # disjoint files: every path lands class 1
        "1a": {"a.txt": A_TXT.replace("a four\n", "a four (task 1a)\n")},
        "1b": {"b.txt": B_TXT.replace("b two\n", "b two (task 1b)\n")},
    },
    2: {  # commuting appends at the same anchor
        "2a": {"c.txt": C_TXT.replace("c anchor\n", "c anchor\nc left addition\n")},
        "2b": {"c.txt": C_TXT.replace("c anchor\n", "c anchor\nc right addition\n")},
    },
    3: {  # 3a rewrites the region 3b edits inside; `--` occurs twice in the base
        "3a": "d header\n--\nd alpha rewritten\nd beta rewritten\n--\nd footer\n",
        "3b": D_TXT.replace("d alpha\n", "d alpha tuned\n"),
    },
    4: {  # deletion adjacency on b.txt, plus the binary path
        "4a": {"b.txt": B_TXT.replace("b five\nb six\n", "")},
        "4b": {"b.txt": B_TXT.replace("b eight\n", "b eight\nb eight and a half\n"),
               "bin.dat": BIN_DAT[:4] + b"\x00\xffPATCHED" + BIN_DAT[12:]},
    },
    5: {  # agreed whole-file deletion: both arms report ("clean", None) -> class 1
        "5a": {"a.txt": None},
        "5b": {"b.txt": B_TXT.replace("b three\n", "b three (task 5b)\n")},
    },
}
# Wave 3's dict is written as bare file bodies above for readability; normalize.
SCENARIOS[3] = {tid: {"d.txt": body} for tid, body in SCENARIOS[3].items()}

# The wave folded with `--commutes`: the assume rung is what turns the
# same-anchor appends into the corpus's class-3 instance (weave clean, git
# conflicted) instead of a second class-5.
FIXTURE_COMMUTES = {2: {"2a": ["c.txt"], "2b": ["c.txt"]}}

_FIXED_DATE = "2026-08-31T00:00:00+00:00"


def _env():
    """A git environment with no identity, config or clock of its own — the
    same base commit sha on every machine, every run."""
    return dict(os.environ,
                GIT_AUTHOR_NAME="fold corpus fixture",
                GIT_AUTHOR_EMAIL="fixture@example.invalid",
                GIT_COMMITTER_NAME="fold corpus fixture",
                GIT_COMMITTER_EMAIL="fixture@example.invalid",
                GIT_AUTHOR_DATE=_FIXED_DATE,
                GIT_COMMITTER_DATE=_FIXED_DATE,
                GIT_CONFIG_GLOBAL=os.devnull,
                GIT_CONFIG_SYSTEM=os.devnull,
                TZ="UTC")


def _git(repo, *args, text=True):
    return subprocess.run(["git", "-C", str(repo), *args], check=True,
                          capture_output=True, text=text, env=_env()).stdout


def _build_base_repo(repo: Path) -> str:
    """`git init` + one base commit of four text files and one small binary."""
    repo.mkdir(parents=True)
    _git(repo, "init", "--quiet", "--initial-branch=main")
    for name, body in BASE_FILES.items():
        path = repo / name
        path.write_bytes(body if isinstance(body, bytes) else body.encode())
    _git(repo, "add", "-A")
    _git(repo, "commit", "--quiet", "-m", "base")
    return _git(repo, "rev-parse", "HEAD").strip()


def _capture_patch(repo: Path, base_sha: str, clone: Path, edits, dest: Path) -> Path:
    """One task's whole contribution as content, captured the way the driver
    captures it: a `git diff --binary --full-index --no-renames <BASE>` taken
    in the task's own throwaway clone."""
    _git(repo.parent, "clone", "--quiet", str(repo), str(clone))
    for name, body in edits.items():
        path = clone / name
        if body is None:
            path.unlink()
        else:
            path.write_bytes(body if isinstance(body, bytes) else body.encode())
    _git(clone, "add", "-A")
    dest.parent.mkdir(parents=True, exist_ok=True)
    # `--binary` is not optional: wave 4 rewrites a binary path, and without it
    # git emits an unappliable "Binary files differ" stub.
    dest.write_bytes(_git(clone, "diff", "--binary", "--full-index",
                          "--no-renames", base_sha, text=False))
    return dest


def _fold(repo: Path, run_dir: Path, wave: int, base_sha: str, specs, commutes):
    """Drive the real kernel CLI over one wave; raise on anything but a fold."""
    cmd = [sys.executable, str(FOLD_WAVE), "fold", "--repo", str(repo),
           "--run-dir", str(run_dir), "--wave", str(wave), "--base", base_sha]
    for task_id, patch in specs:
        cmd += ["--patch", "%s=%s" % (task_id, patch)]
    for task_id, paths in sorted(commutes.items()):
        cmd += ["--commutes", "%s=%s" % (task_id, ",".join(paths))]
    result = subprocess.run(cmd, capture_output=True, text=True, env=_env())
    log = run_dir / "frontier" / ("wave-%d" % wave) / "fold_log.jsonl"
    if result.returncode != 0 or not log.exists():
        raise RuntimeError("fixture wave %d did not fold (exit %d): %s%s"
                           % (wave, result.returncode, result.stdout, result.stderr))
    return log.parent


def _localize(dest_wave: Path, patch_names):
    """Rewrite the two absolute sandbox paths the kernel records — every `fold`
    event's `patch`, and `conflicts.json`'s `hunksFile` — to corpus-relative
    names, so the wave directory is the whole record."""
    log = dest_wave / "fold_log.jsonl"
    lines = []
    for line in log.read_text().splitlines():
        event = json.loads(line)
        if event.get("type") == "fold" and "patch" in event:
            event["patch"] = patch_names[event["task"]]
        lines.append(json.dumps(event))
    log.write_text("".join(line + "\n" for line in lines))

    index_path = dest_wave / "conflicts.json"
    if index_path.exists():
        entries = json.loads(index_path.read_text())
        for entry in entries:
            if entry.get("hunksFile"):
                entry["hunksFile"] = Path(entry["hunksFile"]).name
        index_path.write_text(json.dumps(entries, indent=2) + "\n")


def make_fixture_corpus(dest: Path):
    """Build the synthetic corpus under `dest`; return `(repo, corpus_root)`.

    `dest/repo` is the scratch repository every patch is a diff against, and
    `dest/corpus` is a corpus in exactly the shape the extractor produces, so
    the replayer cannot tell the two apart.
    """
    dest = Path(dest)
    repo = dest / "repo"
    corpus_root = dest / "corpus"
    work = dest / "work"
    base_sha = _build_base_repo(repo)

    entries = []
    for wave in sorted(SCENARIOS):
        tasks = SCENARIOS[wave]
        specs = [(task_id,
                  _capture_patch(repo, base_sha, work / "clones" / ("w%d-%s" % (wave, task_id)),
                                 edits, work / "patches" / ("wave-%d" % wave)
                                 / ("task-%s.patch" % task_id)))
                 for task_id, edits in sorted(tasks.items())]
        commutes = FIXTURE_COMMUTES.get(wave, {})
        folded = _fold(repo, work / "run", wave, base_sha, specs, commutes)

        dest_wave = wave_dir(corpus_root, FIXTURE_RUN_ID, wave)
        dest_wave.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(folded, dest_wave)
        names = {}
        for task_id, patch in specs:
            names[task_id] = "task-%s.patch" % task_id
            shutil.copyfile(patch, dest_wave / names[task_id])
        _localize(dest_wave, names)

        entries.append(CorpusEntry(FIXTURE_RUN_ID, wave, base_sha, "patch", dest_wave,
                                   tasks=[task_id for task_id, _ in specs],
                                   commutes=commutes))

    write_corpus_index(corpus_root, entries)
    return repo, corpus_root
