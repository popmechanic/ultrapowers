"""The extractor: rescued fleet evidence tarballs -> the committed fold corpus.

Spec: `docs/superpowers/specs/2026-08-31-fold-corpus-validation.md`
(Deliverable A, step 2). Each fleet run's evidence arrives as one
`sandbox-logs.tgz` holding the whole sandbox — transcripts, worker records,
events, clones. Exactly three things in it are corpus material:

    <runDir>/frontier/wave-<n>/fold_log.jsonl   the fold record
    <runDir>/frontier/wave-<n>/*                its conflict/resolve siblings
    <runDir>/patches/task-<id>.patch            the inputs the log names

Everything else stays in the archive: the corpus is committed to this
repository, and patches and fold logs are diffs of this repo's own code while
transcripts are not.

The one rewrite performed on the kernel's own output is the pair of absolute
sandbox paths it records — every `fold` event's `patch`, and `conflicts.json`'s
`hunksFile`. Both point into the sandbox that produced them, so a corpus read
on another machine would fail `rehydrate` verbatim; wave-relative names make
the wave directory the whole record. This mirrors `corpuslib`'s fixture
builder exactly, so the replayer cannot tell a rescued corpus from a synthetic
one.

Silence is the one thing the extractor may not do: a tarball with no fold logs
still contributes an index row carrying `skipped: "no fold logs"`, as does a
wave whose log is malformed or whose patch inputs did not survive.

    python3 evals/frontier/corpus_extract.py --evidence <dir-of-tgz> --out <corpus_root>

Offline and deterministic: tarfile and json only, no network, no model calls.
"""
import argparse
import json
import re
import sys
import tarfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from corpuslib import CorpusEntry, wave_dir, write_corpus_index  # noqa: E402

BUNDLE_NAME = "sandbox-logs.tgz"
LOG_NAME = "fold_log.jsonl"
_WAVE = re.compile(r"^wave-(\d+)$")
# `fleet-run-<n>-<stamp>` is what `fleet_fetch.fetch_bundles` names a bundle
# directory; its run id is `run-<n>`.
_BUNDLE_DIR = re.compile(r"^fleet-run-(\d+)-")

NO_LOGS = "no fold logs"
NO_BASE = "log does not open with a base event"


# --------------------------------------------------------------------------
# reading the tarball
# --------------------------------------------------------------------------

def _run_id(run_dir_name: str) -> str:
    """`run-run-30` -> `run-30`. A fleet run directory is `run-<runId>`, and
    the ids the fleet reports are themselves `run-<n>` (`fleet_fetch`)."""
    return run_dir_name[4:] if run_dir_name.startswith("run-") else run_dir_name


def _wave_logs(members):
    """Every `<runDir>/frontier/wave-<n>/fold_log.jsonl` member, as
    `(member, runDirPath, waveNumber)`, in run/wave order."""
    found = []
    for member in members:
        parts = Path(member.name).parts
        if len(parts) < 4 or parts[-1] != LOG_NAME or parts[-3] != "frontier":
            continue
        match = _WAVE.match(parts[-2])
        if match:
            found.append((member, "/".join(parts[:-3]), int(match.group(1))))
    return sorted(found, key=lambda f: (_run_id(Path(f[1]).name), f[2]))


def _bundle_run_id(tgz: Path, members) -> str:
    """The run a tarball with no fold logs belongs to — still named in the
    index, never dropped. The bundle directory names it; failing that, any
    `<runDir>` inside the tarball does."""
    match = _BUNDLE_DIR.match(tgz.parent.name)
    if match:
        return "run-%s" % match.group(1)
    for member in members:
        parts = Path(member.name).parts
        for i, part in enumerate(parts[:-1]):
            if part == "ultrapowers" and i + 1 < len(parts):
                return _run_id(parts[i + 1])
    return tgz.parent.name


def _read_events(member, tf):
    """The log's events, or `None` if it is unreadable as JSONL."""
    try:
        text = tf.extractfile(member).read().decode()
        return [json.loads(line) for line in text.splitlines() if line.strip()]
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, tarfile.TarError):
        return None


# --------------------------------------------------------------------------
# writing the corpus
# --------------------------------------------------------------------------

def _copy(tf, member, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(tf.extractfile(member).read())


def _localize(dest_wave: Path, events, patch_names) -> None:
    """Write the log with every `fold` event's `patch` rewritten to its
    wave-relative name, and rewrite `conflicts.json`'s `hunksFile` the same
    way. The two absolute sandbox paths the kernel records are the only
    fields the corpus touches."""
    lines = []
    for event in events:
        if event.get("type") == "fold" and "patch" in event:
            event = dict(event, patch=patch_names[event["task"]])
        lines.append(json.dumps(event))
    (dest_wave / LOG_NAME).write_text("".join(line + "\n" for line in lines))

    index_path = dest_wave / "conflicts.json"
    if index_path.exists():
        try:
            entries = json.loads(index_path.read_text())
        except json.JSONDecodeError:
            return          # copied verbatim; a corrupt index is evidence too
        for entry in entries:
            if isinstance(entry, dict) and entry.get("hunksFile"):
                entry["hunksFile"] = Path(entry["hunksFile"]).name
        index_path.write_text(json.dumps(entries, indent=2) + "\n")


def extract_tarball(tgz, out_root):
    """Pull one `sandbox-logs.tgz`'s corpus subset into `out_root`.

    Returns one `CorpusEntry` per wave found, in run/wave order — including
    the rows that carry a `skipped` reason instead of a replayable wave. A
    tarball with no fold logs returns exactly one such row.
    """
    tgz, out_root = Path(tgz), Path(out_root)
    entries = []
    with tarfile.open(tgz) as tf:
        # Regular files only, read by name: nothing is ever extracted to a
        # path the tarball chose, so absolute names, `..` escapes and links
        # have no way through.
        members = [m for m in tf.getmembers() if m.isfile()]
        logs = _wave_logs(members)
        if not logs:
            run_id = _bundle_run_id(tgz, members)
            return [CorpusEntry(run_id, 0, "", "",
                                wave_dir(out_root, run_id, 0), skipped=NO_LOGS)]
        by_name = {m.name: m for m in members}
        for log_member, run_dir, wave in logs:
            entries.append(_extract_wave(tf, by_name, log_member, run_dir,
                                         wave, out_root))
    return entries


def _extract_wave(tf, by_name, log_member, run_dir, wave, out_root):
    """One wave: its log, its wave-dir siblings, and the patches it names."""
    run_id = _run_id(Path(run_dir).name)
    dest = wave_dir(out_root, run_id, wave)
    events = _read_events(log_member, tf)
    if not events or events[0].get("type") != "base":
        return CorpusEntry(run_id, wave, "", "", dest, skipped=NO_BASE)

    base_sha = events[0].get("sha", "")
    folds = [e for e in events if e.get("type") == "fold"]
    tasks = [e.get("task") for e in folds]
    mode = "patch" if any("patch" in e for e in folds) else "branch"

    # The wave directory's own files — conflicts.json, conflict-<i>.txt and
    # its hunks brief, fold_stats.json, whatever else the kernel left beside
    # the log. Direct children only: the record is flat by contract.
    src_wave = str(Path(log_member.name).parent)
    dest.mkdir(parents=True, exist_ok=True)
    for name, member in sorted(by_name.items()):
        parent, _, leaf = name.rpartition("/")
        if parent == src_wave:
            _copy(tf, member, dest / leaf)

    patch_names, missing = {}, []
    for event in folds:
        if "patch" not in event:
            continue
        leaf = "task-%s.patch" % event.get("task")
        patch_names[event.get("task")] = leaf
        member = by_name.get("%s/patches/%s" % (run_dir, leaf))
        if member is None:
            missing.append(leaf)
        else:
            _copy(tf, member, dest / leaf)

    _localize(dest, events, patch_names)
    skipped = "missing patches: %s" % ", ".join(missing) if missing else None
    return CorpusEntry(run_id, wave, base_sha, mode, dest,
                       tasks=tasks, skipped=skipped)


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def find_bundles(evidence: Path):
    """Every `sandbox-logs.tgz` under `--evidence` (or the file itself)."""
    evidence = Path(evidence)
    if evidence.is_file():
        return [evidence]
    return sorted(p for p in evidence.rglob(BUNDLE_NAME) if p.is_file())


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--evidence", required=True, type=Path,
                    help="directory of rescued %s bundles (or one bundle)" % BUNDLE_NAME)
    ap.add_argument("--out", required=True, type=Path,
                    help="corpus root to write (<runId>/wave-<n>/… + corpus-index.json)")
    args = ap.parse_args(argv)

    bundles = find_bundles(args.evidence)
    if not bundles:
        print("corpus_extract: no %s under %s" % (BUNDLE_NAME, args.evidence),
              file=sys.stderr)
        return 1

    entries = []
    for tgz in bundles:
        try:
            found = extract_tarball(tgz, args.out)
        except (OSError, tarfile.TarError) as exc:
            # An unreadable bundle is reported, never dropped on the floor.
            print("corpus_extract: cannot read %s (%s)" % (tgz, exc),
                  file=sys.stderr)
            continue
        entries.extend(found)
        for entry in found:
            print("%s wave %d: %s" % (entry.run_id, entry.wave,
                                      entry.skipped or "%s, %d task(s)"
                                      % (entry.mode, len(entry.tasks))))

    entries.sort(key=lambda e: (e.run_id, e.wave))
    write_corpus_index(args.out, entries)
    replayable = [e for e in entries if e.skipped is None]
    print("corpus_extract: %d wave(s) from %d bundle(s), %d replayable, "
          "%d skipped" % (len(entries), len(bundles), len(replayable),
                          len(entries) - len(replayable)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
