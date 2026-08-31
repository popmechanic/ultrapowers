"""The replayer: a fold corpus in, the pre-registered readings out.

Spec: `docs/superpowers/specs/2026-08-31-fold-corpus-validation.md`
(Deliverable B and its Pre-registered readings). This is the glue over the
three modules that do the work — `corpuslib` (what a corpus is), `arm_weave`
(the kernel's answer, plus the integrity and determinism checks) and
`arm_git` + `classify` (the second, independent answer and the five-class
comparator). Per corpus entry, in order:

    integrity -> weave -> git -> classify -> ride-alongs

and every entry that cannot make it through that sequence lands in `skipped`
**by name, with a reason** — an unresolvable base sha, a failed integrity
check, an unreadable patch. A silent cap is the one failure mode that would
make the census a lie, so there isn't one: `replayed + len(skipped)` is always
the number of rows in the index.

The verdict is the spec's pre-registered rule, and nothing else:

    GO                  >= 50 folds replayed and no unexplained class 2
    NO                  any unexplained class 2, at any replayed count
    INSUFFICIENT-CORPUS otherwise

`render_results` emits the readings in the spec's own order, with every
class-2 instance dumped verbatim — the judgement on those is the operator's,
never the agent's, so the renderer reports and does not grade.

Offline and deterministic: git and Python only, no network, no model calls.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import arm_git  # noqa: E402
import arm_weave  # noqa: E402
import classify as classify_mod  # noqa: E402
import corpuslib  # noqa: E402

CLASSES = (1, 2, 3, 4, 5, "binary")
GATE = 50               # the spec's Tier-1 bar: >= 50 folds replayed on both arms


# --------------------------------------------------------------------------
# the verdict rule
# --------------------------------------------------------------------------

def verdict(replayed, class2):
    """`"GO"` / `"NO"` / `"INSUFFICIENT-CORPUS"` for a replay of this size.

    An unexplained class 2 outranks the count: a divergence nobody has
    explained is a finding whether it turned up on the 4th fold or the 400th.
    """
    if any(not row.get("mechanically_explained") for row in class2):
        return "NO"
    return "GO" if replayed >= GATE else "INSUFFICIENT-CORPUS"


# --------------------------------------------------------------------------
# per-entry replay
# --------------------------------------------------------------------------

def _empty_counts():
    return {cls: 0 for cls in CLASSES}


def _text(content):
    """A path's bytes as JSON-carriable text; `None` stays `None` (a deletion)."""
    if content is None:
        return None
    return content.decode("utf-8", errors="replace")


def _arm_text(arm, path):
    """This arm's content for `path` as text; `None` when the arm has no
    answer for it at all, which is a shape the renderer already reports."""
    answer = arm.per_path.get(path)
    if answer is None:
        return None
    return _text(answer.content)


def _resolvable(repo, sha):
    done = subprocess.run(["git", "-C", str(repo), "cat-file", "-e", "%s^{commit}" % sha],
                          capture_output=True, text=True)
    return done.returncode == 0


def _base_text(repo, base_sha, path):
    """The path's text at the wave base, or `""` when it has none there.

    A path the wave adds, and a path whose base blob is not text, both give
    `""` — neither can carry a line that repeats in a base it has no lines in.
    """
    done = subprocess.run(["git", "-C", str(repo), "show", "%s:%s" % (base_sha, path)],
                          capture_output=True)
    if done.returncode != 0:
        return ""
    try:
        return done.stdout.decode()
    except UnicodeDecodeError:
        return ""


def class2_instance(entry, row, weave, git):
    """One class-2 row: where it is, and both arms' contents verbatim.

    Verbatim is the point — the spec dumps every instance for hand reading,
    and a summarised diff would be the replayer grading its own finding. The
    `mechanically_explained` judgement is the comparator's, copied through
    unchanged; nothing here re-decides it.

    An arm may not have the path at all: `classify` emits an unexplained
    class 2 for a path only one arm ever answered for — a fold that stopped
    at a conflict leaves the git arm naming tasks the weave never reached.
    That row is exactly the signal the verdict turns on, so the missing side
    is carried as `None` (the renderer prints it as absent) rather than
    indexed into a `KeyError` that would abort the whole replay.
    """
    path = row["path"]
    return {"run": entry.run_id, "wave": entry.wave, "path": path,
            "mechanically_explained": bool(row["mechanically_explained"]),
            "weave": _arm_text(weave, path),
            "git": _arm_text(git, path)}


def replay_entry(repo, entry):
    """Replay one corpus wave; return its breakdown, or raise `ValueError`.

    `ValueError` is the skip channel: its message is the reason recorded
    against this entry by name. Everything else — a class-2 divergence, a
    determinism divergence, an incomplete arm — is data, not a skip.
    """
    if entry.skipped:
        raise ValueError(entry.skipped)
    if not entry.base_sha or not _resolvable(repo, entry.base_sha):
        raise ValueError("base sha %s does not resolve in %s"
                         % (entry.base_sha or "<none>", repo))

    failures = arm_weave.integrity_check(repo, entry)
    if failures:
        raise ValueError("integrity check failed: %s" % "; ".join(failures))

    try:
        weave = arm_weave.weave_answer(repo, entry)
        git = arm_git.git_answer(repo, entry, weave)
    except Exception as exc:            # noqa: BLE001 - reported by name, never raised
        raise ValueError("%s: %s" % (type(exc).__name__, exc))

    rows = classify_mod.classify(weave, git)
    counts = _empty_counts()
    class2, xaxbx = [], []
    patch_texts = [text for _, text in classify_mod.task_patches(entry)]
    for row in rows:
        counts[row["cls"]] += 1
        if row["cls"] == 2:
            class2.append(class2_instance(entry, row, weave, git))
        if row["cls"] == "binary":
            continue                    # no hunks to anchor: nothing to flag
        # The census covers every non-binary class, keyed by class, so the
        # spec's class-2/class-3 reading comes off `by_class` without a
        # second pass — and a flag on any other class stays visible.
        if classify_mod.xaxbx_flag(_base_text(repo, entry.base_sha, row["path"]),
                                   patch_texts, row["path"]):
            xaxbx.append({"run": entry.run_id, "wave": entry.wave,
                          "path": row["path"], "cls": row["cls"]})

    adjacency = [dict(run=entry.run_id, wave=entry.wave, **row)
                 for row in classify_mod.deletion_adjacency(entry)]
    determinism = arm_weave.determinism_check(repo, entry)
    return {"run": entry.run_id, "wave": entry.wave, "counts": counts,
            "complete": {"weave": weave.complete, "git": git.complete},
            "class2": class2, "xaxbx": xaxbx, "deletion_adjacency": adjacency,
            "determinism": determinism}


# --------------------------------------------------------------------------
# the whole corpus
# --------------------------------------------------------------------------

def replay(repo: Path, corpus_root: Path) -> dict:
    """Replay every wave in `corpus_root`'s index; return the results dict.

    Raises `FileNotFoundError` when the root carries no `corpus-index.json` —
    that is not a corpus, and the CLI turns it into a one-line refusal.
    """
    # Resolve both up front: Arm W chdirs into each wave dir and Arm G runs
    # `git -C <tempdir> clone <repo>`, so a relative `--repo`/`--corpus`
    # (the plan's own Task-8 command) would skip 100% of entries
    # (run-34 critic, blocking).
    repo, corpus_root = Path(repo).resolve(), Path(corpus_root).resolve()
    entries = corpuslib.load_corpus_index(corpus_root)

    rows, skipped = [], []
    for entry in entries:
        try:
            rows.append(replay_entry(repo, entry))
        except ValueError as exc:
            skipped.append({"run": entry.run_id, "wave": entry.wave,
                            "reason": str(exc)})

    counts = _empty_counts()
    per_run, class2, xaxbx, adjacency, divergences = {}, [], [], [], []
    for row in rows:
        run = per_run.setdefault(row["run"], _empty_counts())
        for cls in CLASSES:
            counts[cls] += row["counts"][cls]
            run[cls] += row["counts"][cls]
        class2.extend(row["class2"])
        xaxbx.extend(row["xaxbx"])
        adjacency.extend(row["deletion_adjacency"])
        if not row["determinism"]["matches"]:
            divergences.append({"run": row["run"], "wave": row["wave"],
                                "divergence": row["determinism"]["divergence"]})

    by_class = {}
    for row in xaxbx:
        by_class[row["cls"]] = by_class.get(row["cls"], 0) + 1
    unexplained = [row for row in class2 if not row["mechanically_explained"]]
    return {
        "replayed": len(rows),
        "counts": counts,
        "per_run": per_run,
        "entries": [{k: v for k, v in row.items() if k != "class2"} for row in rows],
        "class2": class2,
        "unexplained_class2": len(unexplained),
        "skipped": skipped,
        "skipped_count": len(skipped),
        "xaxbx": {"flagged": xaxbx, "count": len(xaxbx), "by_class": by_class},
        "deletion_adjacency": adjacency,
        "determinism": {"checked": len(rows), "divergences": divergences},
        "verdict": verdict(len(rows), class2),
    }


# --------------------------------------------------------------------------
# the readings
# --------------------------------------------------------------------------

def _count(counts, cls):
    """A class count, whether the dict came from `replay` or from JSON."""
    if cls in counts:
        return counts[cls]
    return counts.get(str(cls), 0)


def render_results(results: dict) -> str:
    """The spec's pre-registered readings, in the spec's order, as markdown."""
    counts = results.get("counts", {})
    replayed = results.get("replayed", 0)
    class2 = results.get("class2", [])
    out = ["# Fold corpus validation — replay results", ""]
    out += ["**Verdict:** %s" % results.get("verdict", "INSUFFICIENT-CORPUS"), ""]

    out += ["## GO on the Tier-1 gate", ""]
    out += ["- folds replayed on both arms: %d (gate: >= %d)" % (replayed, GATE)]
    out += ["- class 1 (agreement): %d" % _count(counts, 1)]
    out += ["- class 2 instances: %d, of which unexplained: %d"
            % (_count(counts, 2), results.get("unexplained_class2", 0))]
    out += ["- class 5 (agreement on contention): %d" % _count(counts, 5)]
    out += ["- binary paths excluded from content comparison: %d"
            % _count(counts, "binary"), ""]
    out += ["### Class 2 instances (both contents verbatim)", ""]
    if not class2:
        out += ["_none_", ""]
    for row in class2:
        out += ["#### %s wave %s — `%s` (mechanically explained: %s)"
                % (row["run"], row["wave"], row["path"],
                   "yes" if row.get("mechanically_explained") else "**no**"), ""]
        for arm in ("weave", "git"):
            out += ["%s:" % arm, "", "```"]
            out += [row.get(arm) if row.get(arm) is not None else "<path absent>"]
            out += ["```", ""]

    out += ["## Corpus padding", ""]
    if replayed >= GATE:
        out += ["- no padding: %d real folds replayed, at or above the gate."
                % replayed, ""]
    else:
        out += ["- %d real folds replayed, %d short of the gate. Any synthetic "
                "folds cut from this repo's history to reach %d are marked "
                "synthetic and reported separately — real-fold counts are never "
                "inflated." % (replayed, GATE - replayed, GATE), ""]

    out += ["## Class 3 (value) and class 4 (cost), per run", ""]
    out += ["| run | class 1 | class 2 | class 3 | class 4 | class 5 | binary |",
            "| --- | --- | --- | --- | --- | --- | --- |"]
    for run in sorted(results.get("per_run", {})):
        row = results["per_run"][run]
        out += ["| %s | %s |" % (run, " | ".join(str(_count(row, cls))
                                                 for cls in CLASSES))]
    out += [""]

    out += ["## Skips", ""]
    skipped = results.get("skipped", [])
    out += ["- skipped: %d" % len(skipped), ""]
    if not skipped:
        out += ["_none_", ""]
    for row in skipped:
        out += ["- %s wave %s: %s" % (row["run"], row["wave"], row["reason"])]
    if skipped:
        out += [""]

    out += ["## Determinism re-check", ""]
    determinism = results.get("determinism", {})
    out += ["- folds re-folded against today's kernel: %d"
            % determinism.get("checked", 0), ""]
    divergences = determinism.get("divergences", [])
    if not divergences:
        out += ["_no record-vs-today divergence_", ""]
    for row in divergences:
        out += ["- %s wave %s: %s" % (row["run"], row["wave"], row["divergence"])]
    if divergences:
        out += [""]

    out += ["## XaXbX census and deletion-flag counts", ""]
    xaxbx = results.get("xaxbx", {})
    out += ["- XaXbX-flagged paths: %d%s"
            % (xaxbx.get("count", 0),
               (" (by class: %s)" % ", ".join(
                   "%s=%d" % (cls, xaxbx["by_class"][cls])
                   for cls in sorted(xaxbx.get("by_class", {}), key=str)))
               if xaxbx.get("by_class") else "")]
    for row in xaxbx.get("flagged", []):
        out += ["  - %s wave %s: `%s` (class %s)"
                % (row["run"], row["wave"], row["path"], row["cls"])]
    adjacency = results.get("deletion_adjacency", [])
    out += ["- deletion-adjacency rows: %d" % len(adjacency)]
    for row in adjacency:
        out += ["  - %s wave %s: `%s` — task %s deletes base line %s near task %s"
                % (row["run"], row["wave"], row["path"], row["task_del"],
                   row["deleted_line"], row["task_near"])]
    out += [""]
    return "\n".join(out)


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--repo", required=True, type=Path,
                    help="repository the corpus's patches are diffs against")
    ap.add_argument("--corpus", required=True, type=Path,
                    help="corpus root (the directory holding %s)" % corpuslib.INDEX_NAME)
    ap.add_argument("--out", required=True, type=Path,
                    help="results JSON to write")
    args = ap.parse_args(argv)

    try:
        results = replay(args.repo, args.corpus)
    except FileNotFoundError as exc:
        # Not a corpus. One line, no traceback: the caller pointed at the
        # wrong directory, and the missing file is the whole diagnosis.
        print("replay_corpus: %s" % exc, file=sys.stderr)
        return 2

    args.out.parent.mkdir(parents=True, exist_ok=True)
    # Not `sort_keys`: the class counts are keyed 1..5 plus "binary", which
    # is not an orderable set. Every list here is already in a settled order.
    args.out.write_text(json.dumps(results, indent=2) + "\n")
    print(render_results(results))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
