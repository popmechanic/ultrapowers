"""Repo-level weave layer over the vendored manyana kernel (frontier probe).

Lifts the line-level weave kernel to whole repositories: `snapshot` reads a git
tree into a `RepoState`, `publish` turns a task branch into a `TaskState`, and
`fold` merges a task into a frontier state, reporting `Conflict`s. `fold` is
functional (never mutates its inputs) and order-independent (K1), which is what
lets the probe replay every permutation of a task set and compare outcomes.

Text paths get order-independence from the kernel's weave. Binary paths get it
from a *candidate set*: every task that writes a binary path contributes its
bytes (and every task that deletes one contributes a tombstone) to a per-path
set. Set union is commutative, so the final state cannot depend on fold order;
a conflict is reported on the fold that introduces a new distinct candidate
beyond the path's first, which makes the conflict count `len(candidates) - 1`
in every order. The surviving bytes are the lexicographically smallest
candidate — an arbitrary but deterministic tiebreak.

Conflict *kinds* obey the same discipline. Each conflict comes from one of two
order-independent sources:

* the kernel merge, whose kind is read off `base` alone (`add/add` for a path
  no base tree carried, `lines` otherwise) — a per-path constant, so it cannot
  depend on which fold the kernel happened to report the conflict on;
* a *presence pairing* — two incompatible records for one path (task-touched
  text and raw bytes; visible text and a delete; bytes and a delete). Each
  pairing's conjunction is monotone across folds, so "both true for the first
  time" happens on exactly one fold in every order, and the pairing is reported
  exactly once.

The text side of the text/bytes pairing must be *task-touched*. A path whose
text side still records exactly what `base` carried, rewritten as binary, is a
type change by one writer: git reports no conflict there, so neither do we, and
the superseded base record leaves `files` (`_drop_superseded_text`, run by
`fold` between the merge and the reporting pass). "Still what base carried" is
decided by weave-state *content* plus the delete marks — never by object
identity, which is not a function of the merge result at all: `update_state`
returns its input state unchanged when the new lines equal the current ones, so
a task that did text-write a path can carry the base's own state object, and
which object `files[p]` ends up holding then depends on fold order. Content
does not: weave merge is an idempotent, commutative, associative join, so
`files[p]` is the same string in every order, and `base` is its bottom element
— once a task moves a path off `base`, no later fold moves it back. That makes
"still base's own" *anti*-monotone and the pairing conjunction monotone (#132).

Deliberately NOT done: relabelling the kernel's conflict `delete/modify` when a
delete record is present. Whether the delete is already folded is fold history,
and folding the same tasks in another order moves that relabelling to a
different conflict (or none). The delete/modify pairing is therefore reported
alongside the kernel conflict, not instead of it: one path can carry both a
`lines` conflict (the edits disagree) and a `delete/modify` conflict (content
survives a delete), which is what actually happened.
"""
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "vendor"))
import manyana

MARKERS = ("<<<<<<<", "=======", ">>>>>>>")


class _Tombstone:
    """Sentinel candidate: some task deleted this binary path."""
    __slots__ = ()

    def __repr__(self):
        return "<deleted>"


TOMBSTONE = _Tombstone()


def split_lines(content):
    """Bijection between byte strings and line lists for EXISTING files:
    the empty file is [""], and [] is not in the range — [] denotes absence
    (deletion mark / never-existed) and stays constructible only at the
    absence sites (`task_state_from_contents`'s delete mark, the shared empty
    ancestor for concurrent adds, `_resolved_state`'s default prior state).

    `join_lines(split_lines(c)) == c` for every c, so a folded file with no
    final newline materializes byte-identical instead of being silently
    rewritten — and an emptied file ([""] -> "") stops colliding with a
    deleted one ([] -> omitted from the manifest).
    """
    return content.split("\n")


def join_lines(lines):
    """Lines -> text. The inverse of `split_lines` on its range; `[]` is not
    in that range, and the manifest never joins it (absent paths are
    omitted), so no caller depends on `join_lines([]) == ""` meaning a file.
    """
    return "\n".join(lines)


def is_binary(data):
    if b"\x00" in data:
        return True
    try:
        data.decode("utf-8")
        return False
    except UnicodeDecodeError:
        return True


def _byte_candidates(candidates):
    """The bytes written for a path, tombstone excluded."""
    return [c for c in candidates if c is not TOMBSTONE]


@dataclass(frozen=True)
class RepoState:
    files: dict           # path -> weave state (text files)
    deleted_marks: frozenset
    raw: dict             # path -> bytes as of the base tree (binary files)
    # path -> frozenset of task-written candidates: bytes, and/or TOMBSTONE.
    # Base bytes are NOT candidates; they survive only while this is empty.
    raw_candidates: dict = field(default_factory=dict)

    @property
    def raw_touched(self):
        """Binary paths some already-folded task wrote or deleted."""
        return frozenset(self.raw_candidates)


@dataclass(frozen=True)
class TaskState:
    task_id: str
    weaves: dict
    deleted: frozenset
    raw: dict


@dataclass(frozen=True, eq=False)
class Conflict:
    path: str
    kind: str      # lines | add/add | delete/modify | binary
    task_id: str
    narration: str

    # Identity is (path, kind): narration and the reporting task_id vary with
    # fold order, so including them would break order-independent comparison.
    def __eq__(self, other):
        if not isinstance(other, Conflict):
            return NotImplemented
        return (self.path, self.kind) == (other.path, other.kind)

    def __hash__(self):
        return hash((self.path, self.kind))


def _git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args],
                          check=True, capture_output=True).stdout


def _read_tree(repo, ref, pathspecs):
    """The tree at `ref`, whole (`pathspecs is None`) or scoped, as a RepoState."""
    args = ["ls-tree", "-r", "-z", "--name-only", ref]
    if pathspecs is not None:
        # --literal-pathspecs: a repo path may legally begin with ":", which
        # git otherwise reads as pathspec magic and drops silently (exit 0,
        # no output) — the path would then be misread as an add/add.
        args = ["--literal-pathspecs"] + args + ["--", *pathspecs]
    names = _git(repo, *args).decode()
    files, raw = {}, {}
    for p in filter(None, names.split("\0")):
        blob = _git(repo, "show", f"{ref}:{p}")
        if is_binary(blob):
            raw[p] = blob
        else:
            files[p] = manyana.initial_state(split_lines(blob.decode()))
    return RepoState(files=files, deleted_marks=frozenset(), raw=raw)


def snapshot(repo, ref):
    """Read the tree at `ref` into a RepoState."""
    return _read_tree(repo, ref, None)


def snapshot_scoped(repo, ref, paths):
    """Read only `paths` from the tree at `ref` into a RepoState.

    Paths absent at `ref` (a task's adds) are simply not in the result, which
    is what makes `task_state_from_contents` classify them as adds. Whole-tree
    `snapshot` charges one subprocess per file in the repo; a wave only ever
    needs the union of its tasks' touched paths, derived BEFORE any fold.
    """
    paths = sorted(paths)
    if not paths:
        return RepoState(files={}, deleted_marks=frozenset(), raw={})
    return _read_tree(repo, ref, paths)


def task_state_from_contents(base, task_id, contents):
    """Pure/no-git TaskState builder: path -> str (text), None (delete), bytes."""
    weaves, raw, deleted = {}, {}, set()
    for p, c in contents.items():
        if c is None:
            deleted.add(p)
            if p in base.files:
                weaves[p] = manyana.update_state(base.files[p], [])
        elif isinstance(c, bytes):
            raw[p] = c
        elif p in base.files:
            weaves[p] = manyana.update_state(base.files[p], split_lines(c))
        else:
            # Weave over the empty base so concurrent adds share an ancestor.
            weaves[p] = manyana.update_state(manyana.initial_state([]), split_lines(c))
    return TaskState(task_id=task_id, weaves=weaves, deleted=frozenset(deleted), raw=raw)


def _diff_entries(repo, base_ref, ref):
    """[(status, path)] for the diff base_ref..ref."""
    out = _git(repo, "diff", "--name-status", "-z", "--no-renames", base_ref, ref).decode()
    parts = [x for x in out.split("\0") if x]
    return list(zip(parts[0::2], parts[1::2]))


def diff_paths(repo, base_ref, ref):
    """The paths base_ref..ref touches — the task's touched set. Shares one
    parse with `publish`, so a scoped base can never miss a path a fold
    then writes."""
    return [p for _, p in _diff_entries(repo, base_ref, ref)]


def publish(base, repo, base_ref, ref, task_id):
    """Derive a TaskState from the git diff base_ref..ref."""
    contents = {}
    for status, p in _diff_entries(repo, base_ref, ref):
        if status.startswith("D"):
            contents[p] = None
        else:
            blob = _git(repo, "show", f"{ref}:{p}")
            contents[p] = blob if is_binary(blob) else blob.decode()
    return task_state_from_contents(base, task_id, contents)


def _relabel(annotated, task_id):
    """Rewrite kernel conflict markers to name the frontier and the task."""
    out = []
    for line in annotated:
        if line.startswith(MARKERS):
            line = line.replace("left", "frontier").replace("right", task_id)
        out.append(line)
    return "\n".join(out)


def _text_kind(base, path):
    """Kind for a kernel-reported conflict: a per-path constant.

    Read off `base` only. Deriving it from the frontier instead — "delete/modify
    if some already-folded task deleted the path" — is order-sensitive: the
    same task set relabels a different conflict depending on when the deleting
    task arrives. Delete-vs-content is reported by `_fold_presence`, which sees
    it exactly once whatever the order.
    """
    if path not in base.files and path not in base.raw:
        return "add/add"
    return "lines"


def _fold_text(base, task, files, conflicts):
    """Fold the task's text weaves into `files`, appending any conflicts."""
    for p in sorted(task.weaves):
        w = task.weaves[p]
        if p in files:
            merged, annotated = manyana.merge_states(files[p], w)
            files[p] = merged
            if annotated != manyana.current_lines(merged):
                conflicts.append(Conflict(p, _text_kind(base, p), task.task_id,
                                          _relabel(annotated, task.task_id)))
        else:
            files[p] = w


def _fold_binary(task, candidates, conflicts):
    """Union the task's binary candidates into `candidates`.

    One conflict per candidate that is new *and* not the path's first, so the
    per-path total is `len(candidates) - 1` no matter what order tasks arrive
    in. A tombstone counts as a candidate; any pairing of a tombstone with
    bytes is reported as delete/modify, every other pairing as binary.
    """
    arrivals = [(p, task.raw[p]) for p in sorted(task.raw)]
    arrivals += [(p, TOMBSTONE) for p in sorted(task.deleted) if p not in task.weaves]
    for p, item in arrivals:
        prior = candidates.setdefault(p, set())
        if item in prior:
            continue
        if prior:
            if item is TOMBSTONE:
                kind, why = "delete/modify", "deleted here, rewritten concurrently"
            elif _byte_candidates(prior):
                kind, why = "binary", "divergent bytes written concurrently"
            else:
                kind, why = "delete/modify", "rewritten here, deleted concurrently"
            conflicts.append(Conflict(p, kind, task.task_id,
                                      "binary path %s: %s (by %s)" % (p, why, task.task_id)))
        prior.add(item)


def _base_text_untouched(base, files, deleted_marks, path):
    """True iff `path`'s text side still records exactly what `base` carried.

    Decided by weave-state *content* and the delete marks, never by object
    identity: `manyana.update_state` returns its input state unchanged when the
    new lines equal the current ones, so `files[path] is base.files[path]`
    holds for genuine text writers too, and which object survives a merge is
    fold-order-dependent. Content is not — the weave merge is a join, so the
    folded state string is the same in every order.

    A delete counts as touching the text side even when the weave is unchanged:
    the file was removed, and only `deleted_marks` records that.
    """
    return (path in files and files[path] == base.files.get(path)
            and path not in deleted_marks)


def _pairing_facts(base, files, candidates, deleted_marks, path):
    """(text side task-touched, has visible text, has task bytes, is deleted).

    The flags the pairings key on are monotone across folds:

    * `deleted_marks` and the candidate sets only grow;
    * `text_touched` only appears. A path leaves `files` only through
      `_drop_superseded_text`, and only while its text side is still base's
      own — i.e. only while `text_touched` is already False. Once a task moves
      the path off base, the join can never move it back, so `text_touched`
      stays True and the record stays;
    * visible text can only appear once a delete is folded: every base line of
      the path is then invisible (the delete weave carries the higher, even
      count), so any line still visible after that was added by a task — and no
      other task, all of which branch from `base`, can carry a delete for a
      line it never saw.
    """
    marks = candidates.get(path, ())
    has_text = path in files
    visible = has_text and bool(manyana.current_lines(files[path]))
    text_touched = has_text and not _base_text_untouched(
        base, files, deleted_marks, path)
    return (text_touched, visible, bool(_byte_candidates(marks)), path in deleted_marks)


def _drop_superseded_text(base, task, files, candidates, deleted_marks):
    """Type change by a single writer: retire the superseded base record.

    A path whose text side is still exactly base's (`_base_text_untouched`) and
    which some task has rewritten as bytes has had its *type* changed by one
    writer. The bytes are the merge result, so the superseded record leaves
    `files` — exactly as a base-*binary* path that never grew a text weave
    carries none, and exactly what git does with a lone type change.

    A merge decision, not a report: `fold` runs it after the text and binary
    folds and before `_fold_presence`, so the reporting pass never mutates the
    merge result. Its predicate is a function of the folded content alone, so
    the drop happens on the same paths in every fold order.
    """
    for p in sorted(set(task.weaves) | set(task.raw) | set(task.deleted)):
        if (_base_text_untouched(base, files, deleted_marks, p)
                and _byte_candidates(candidates.get(p, ()))):
            del files[p]


def _fold_presence(base, frontier, task, files, candidates, deleted_marks, conflicts):
    """One conflict per path whose incompatible presence records first pair up.

    Each pairing's conjunction is monotone (see `_pairing_facts`), so every
    not-both -> both transition happens on exactly one fold whatever the order:
    a task-touched text side meeting task-written bytes reports `binary`, and
    text content surviving a delete reports `delete/modify`. (bytes-vs-delete
    is reported by `_fold_binary`, where both records live in the same
    candidate set.)

    A lone type change is NOT a pairing: when the text side still records
    base's own content, a byte write is one writer changing the file's type
    (#132). `_drop_superseded_text` has already retired such a record, so
    `text_touched` is what remains — the flag states the requirement rather
    than leaning on the call order.

    Pure with respect to the merge result: reads `files`/`candidates`, writes
    only `conflicts`.
    """
    touched = set(task.weaves) | set(task.raw) | set(task.deleted)
    for p in sorted(touched):
        was_text, was_visible, had_bytes, was_deleted = _pairing_facts(
            base, frontier.files, frontier.raw_candidates,
            frontier.deleted_marks, p)
        is_text, visible, has_bytes, deleted = _pairing_facts(
            base, files, candidates, deleted_marks, p)
        if is_text and has_bytes and not (was_text and had_bytes):
            # `manifest` keeps the text record when its lines are visible OR
            # the path carries no delete mark; naming the other side there
            # would contradict the very state this fold returns.
            text_wins = visible or p not in deleted_marks
            conflicts.append(Conflict(p, "binary", task.task_id,
                                      "path %s written as text and as binary "
                                      "concurrently; %s the manifest"
                                      % (p, "text wins" if text_wins
                                         else "bytes win")))
        if visible and deleted and not (was_visible and was_deleted):
            conflicts.append(Conflict(p, "delete/modify", task.task_id,
                                      "path %s deleted concurrently with text that "
                                      "survives the delete; the text wins the "
                                      "manifest" % p))


def fold(base, frontier, task):
    """Merge `task` into `frontier`; returns (new RepoState, [Conflict])."""
    files = dict(frontier.files)
    candidates = {p: set(c) for p, c in frontier.raw_candidates.items()}
    deleted_marks = frontier.deleted_marks | task.deleted
    conflicts = []
    _fold_text(base, task, files, conflicts)
    _fold_binary(task, candidates, conflicts)
    _drop_superseded_text(base, task, files, candidates, deleted_marks)
    _fold_presence(base, frontier, task, files, candidates, deleted_marks, conflicts)
    return (RepoState(files=files,
                      deleted_marks=deleted_marks,
                      raw=dict(frontier.raw),
                      raw_candidates={p: frozenset(c) for p, c in candidates.items()}),
            conflicts)


def manifest(state):
    """path -> text (str) or raw bytes; deleted files omitted.

    Text is `join_lines` of the visible lines — the exact bytes of the folded
    file, final newline or not (`split_lines`/`join_lines` are inverses). The
    `lines or ...` predicate is the `[]`-as-absence rule: a path whose visible
    lines are `[]` AND which carries a delete mark is gone, while an emptied
    file is `[""]` and materializes as `""`.

    Text wins any text/binary collision that reaches this point, so raw bytes
    never silently shadow a visible weave — and every such collision was
    reported as a conflict by `fold`. A *lone type change* never reaches this
    point: `fold` retires the superseded base record (`_drop_superseded_text`)
    rather than reporting it, so those paths arrive here carrying bytes only
    (#132).
    """
    out = {}
    for p, w in state.files.items():
        lines = manyana.current_lines(w)
        if lines or p not in state.deleted_marks:
            out[p] = join_lines(lines)
    for p in set(state.raw) | set(state.raw_candidates):
        if p in out:
            continue
        written = _byte_candidates(state.raw_candidates.get(p, ()))
        if written:
            out[p] = min(written)               # bytes outlive a tombstone
        elif TOMBSTONE in state.raw_candidates.get(p, ()):
            continue                            # tombstone only: deleted
        elif p in state.raw and p not in state.deleted_marks:
            out[p] = state.raw[p]               # untouched base bytes
    return out


def materialize(state, dest):
    """Failure-artifact dump only — never on a comparison path."""
    dest = Path(dest)
    for p, content in manifest(state).items():
        target = dest / p
        target.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, bytes):
            target.write_bytes(content)
        else:
            target.write_text(content, encoding="utf-8")
