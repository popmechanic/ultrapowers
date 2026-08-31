"""Synthetic corpus entries cut from this repository's own merge history.

Every two-parent merge commit is a real fold instance: base = merge-base of
the parents, one "task" per parent (its diff against base), and git's own
answer to the same inputs is history. Each synthesized wave is driven through
the REAL kernel CLI (like `corpuslib.make_fixture_corpus`), then appended to
an existing corpus index with run id `synth-<sha7>` so real and synthetic
folds are never conflated (spec pre-registration: real-fold counts are never
inflated).

Usage:
    python3 evals/frontier/synth_corpus.py --repo . --corpus <root> --count 40
"""
import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import corpuslib  # noqa: E402


def _git(repo, *args, text=True):
    return subprocess.run(["git", "-C", str(repo), *args], check=True,
                          capture_output=True, text=text).stdout


def merge_points(repo, count):
    """Recent two-parent merge commits as (sha, p1, p2, base), newest first."""
    out = []
    for line in _git(repo, "rev-list", "--merges", "--first-parent",
                     "--max-count", str(count * 3), "HEAD").split():
        p1, p2 = _git(repo, "rev-parse", line + "^1", line + "^2").split()
        try:
            base = _git(repo, "merge-base", p1, p2).strip()
        except subprocess.CalledProcessError:
            continue
        if base in (p1, p2):
            continue                      # fast-forward shape: one empty side
        if not _git(repo, "diff", "--name-only", base, p1).strip():
            continue
        if not _git(repo, "diff", "--name-only", base, p2).strip():
            continue
        out.append((line, p1, p2, base))
        if len(out) >= count:
            break
    return out


def synthesize(repo, corpus_root, count):
    repo, corpus_root = Path(repo).resolve(), Path(corpus_root).resolve()
    entries = corpuslib.load_corpus_index(corpus_root)
    made, parked = 0, 0
    for sha, p1, p2, base in merge_points(repo, count):
        run_id = "synth-" + sha[:7]
        dest_wave = corpuslib.wave_dir(corpus_root, run_id, 1)
        if dest_wave.exists():
            continue
        with tempfile.TemporaryDirectory() as td:
            work = Path(td)
            specs = []
            for tid, parent in (("a", p1), ("b", p2)):
                patch = work / ("task-%s.patch" % tid)
                patch.write_bytes(_git(repo, "diff", "--binary", "--full-index",
                                       "--no-renames", base, parent, text=False))
                specs.append((tid, patch))
            cmd = [sys.executable, str(HERE.parents[1] / "skills" / "ultrapowers"
                                       / "kernel" / "fold_wave.py"),
                   "fold", "--repo", str(repo), "--run-dir", str(work / "run"),
                   "--wave", "1", "--base", base]
            for tid, patch in specs:
                cmd += ["--patch", "%s=%s" % (tid, patch)]
            result = subprocess.run(cmd, capture_output=True, text=True)
            log_dir = work / "run" / "frontier" / "wave-1"
            if not (log_dir / "fold_log.jsonl").exists():
                parked += 1          # kernel refused outright; named, not silent
                print("synth: %s produced no fold log (exit %d) — skipped"
                      % (run_id, result.returncode))
                continue
            dest_wave.mkdir(parents=True)
            for item in log_dir.iterdir():
                shutil.copy2(item, dest_wave / item.name)
            names = {}
            for tid, patch in specs:
                shutil.copy2(patch, dest_wave / patch.name)
                names[tid] = patch.name
            _localize(dest_wave, names)
            entries.append(corpuslib.CorpusEntry(
                run_id=run_id, wave=1, base_sha=base, mode="patch",
                wave_dir=dest_wave, tasks=[t for t, _ in specs]))
            made += 1
    corpuslib.write_corpus_index(corpus_root, entries)
    print("synth_corpus: %d synthesized, %d kernel-refused, index now %d rows"
          % (made, parked, len(entries)))


def _localize(dest_wave, names):
    log = dest_wave / "fold_log.jsonl"
    lines = []
    for line in log.read_text().splitlines():
        event = json.loads(line)
        if event.get("type") == "fold" and "patch" in event:
            event["patch"] = names[event["task"]]
        lines.append(json.dumps(event))
    log.write_text("".join(line + "\n" for line in lines))
    index_path = dest_wave / "conflicts.json"
    if index_path.exists():
        rows = json.loads(index_path.read_text())
        for row in rows:
            if row.get("hunksFile"):
                row["hunksFile"] = Path(row["hunksFile"]).name
        index_path.write_text(json.dumps(rows, indent=2) + "\n")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--corpus", required=True)
    ap.add_argument("--count", type=int, default=40)
    args = ap.parse_args()
    synthesize(args.repo, args.corpus, args.count)
