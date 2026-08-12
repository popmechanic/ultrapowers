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
* a *presence pairing* — two incompatible records for one path (task-authored
  text and raw bytes; visible text and a delete; bytes and a delete). Each
  record flag is monotone across folds, so "both true for the first time"
  happens on exactly one fold in every order, and the pairing is reported
  exactly once.

The text side of the text/bytes pairing must be *task-authored*. A path whose
only text record is the base tree's own, rewritten as binary by a single task,
is one writer changing the file's type, not a pairing: git reports no conflict
there, so neither do we, and `manifest` hands the path to the bytes. Authorship
is recorded on `RepoState.text_pristine` rather than inferred by comparing a
weave with the base's — see `RepoState.text_authored` for why inference is
unsound, and order-sensitively so (#132).

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
    """Text content -> lines, dropping exactly one trailing newline."""
    if content == "":
        return []
    if content.endswith("\n"):
        content = content[:-1]
    return content.split("\n")


def join_lines(lines):
    """Lines -> text, one trailing newline for non-empty files."""
    return "\n".join(lines) + "\n" if lines else ""


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
    # Text paths whose weave is still the base tree's own, no folded task
    # having written them. `snapshot` seeds it with every base text path and
    # `fold` only ever removes from it, so it shrinks monotonically. It is
    # carried as this complement rather than as the authored set itself
    # because the default is then the conservative reading — a state rebuilt
    # without it reports one collision too many rather than silently handing
    # an authored weave's path to raw bytes.
    text_pristine: frozenset = frozenset()

    @property
    def raw_touched(self):
        """Binary paths some already-folded task wrote or deleted."""
        return frozenset(self.raw_candidates)

    @property
    def text_authored(self):
        """Text paths some already-folded task wrote (#132).

        Recorded, never inferred by comparing a weave with `base`'s:
        `manyana.update_state` returns its input state *unchanged* when the new
        lines equal the current ones, so a task that really did write the path
        can carry the base's own weave object — a trailing-newline-only commit,
        a mode-only commit, an edit-then-revert. Identity (and equality, which
        sees the same states) therefore under-reports authorship; worse, it
        under-reports it order-sensitively, because whether the surviving record
        is still the base object depends on which folds have run.
        """
        return frozenset(self.files) - self.text_pristine


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


def snapshot(repo, ref):
    """Read the tree at `ref` into a RepoState."""
    names = _git(repo, "ls-tree", "-r", "-z", "--name-only", ref).decode()
    files, raw = {}, {}
    for p in filter(None, names.split("\0")):
        blob = _git(repo, "show", f"{ref}:{p}")
        if is_binary(blob):
            raw[p] = blob
        else:
            files[p] = manyana.initial_state(split_lines(blob.decode()))
    return RepoState(files=files, deleted_marks=frozenset(), raw=raw,
                     text_pristine=frozenset(files))


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


def publish(base, repo, base_ref, ref, task_id):
    """Derive a TaskState from the git diff base_ref..ref."""
    out = _git(repo, "diff", "--name-status", "-z", "--no-renames", base_ref, ref).decode()
    parts = [x for x in out.split("\0") if x]
    contents = {}
    for status, p in zip(parts[0::2], parts[1::2]):
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


def _pairing_facts(files, pristine, candidates, deleted_marks, path):
    """(has task-written text, has visible text, has task bytes, is deleted).

    Every flag is monotone across folds:

    * a path never leaves `files`, `pristine` only shrinks, and
      `deleted_marks`/the candidate sets only grow;
    * visible text can only appear. Once a delete is folded, every base line of
      the path is invisible (the delete weave carries the higher, even count),
      so any line still visible after that was added by a task — and no other
      task, all of which branch from `base`, can carry a delete for a line it
      never saw.
    """
    marks = candidates.get(path, ())
    authored = path in files and path not in pristine
    visible = path in files and bool(manyana.current_lines(files[path]))
    return (authored, visible, bool(_byte_candidates(marks)), path in deleted_marks)


def _fold_presence(base, frontier, task, files, candidates, deleted_marks, conflicts):
    """One conflict per path whose incompatible presence records first pair up.

    Each flag is monotone (see `_pairing_facts`), so every not-both -> both
    transition happens on exactly one fold whatever the order: a task-written
    text weave meeting task-written bytes reports `binary`, and text content
    surviving a delete reports `delete/modify`. (bytes-vs-delete is reported by
    `_fold_binary`, where both records live in the same candidate set.)

    A lone type change is NOT a pairing: when the only text record is the base
    tree's own, a byte write is one writer changing the file's type, which git
    reports clean (#132). That is why the text side keys on authorship rather
    than on a weave merely being present.

    `base` is accepted for signature symmetry with `_fold_text` and is not
    consulted here: authorship is read off `RepoState.text_pristine`, never
    derived by comparing a weave against `base`'s, which under-reports it (see
    `RepoState.text_authored`).
    """
    pristine = frontier.text_pristine - set(task.weaves)
    touched = set(task.weaves) | set(task.raw) | set(task.deleted)
    for p in sorted(touched):
        was_authored, was_visible, had_bytes, was_deleted = _pairing_facts(
            frontier.files, frontier.text_pristine, frontier.raw_candidates,
            frontier.deleted_marks, p)
        authored, visible, has_bytes, deleted = _pairing_facts(
            files, pristine, candidates, deleted_marks, p)
        if authored and has_bytes and not (was_authored and had_bytes):
            # Which record `manifest` keeps: a text record survives while it
            # has visible lines OR was never deleted (see `manifest`).
            winner = ("text wins the manifest" if visible or p not in deleted_marks
                      else "bytes win the manifest")
            conflicts.append(Conflict(p, "binary", task.task_id,
                                      "path %s written as text and as binary "
                                      "concurrently; %s" % (p, winner)))
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
    # Every path this task weaves is task-authored from here on, whether or not
    # the weave changed a line: `update_state` hands back the state it was
    # given when the lines already match (see `RepoState.text_authored`).
    text_pristine = frontier.text_pristine - set(task.weaves)
    conflicts = []
    _fold_text(base, task, files, conflicts)
    _fold_binary(task, candidates, conflicts)
    _fold_presence(base, frontier, task, files, candidates, deleted_marks, conflicts)
    return (RepoState(files=files,
                      deleted_marks=deleted_marks,
                      raw=dict(frontier.raw),
                      raw_candidates={p: frozenset(c) for p, c in candidates.items()},
                      text_pristine=text_pristine),
            conflicts)


def manifest(state):
    """path -> normalized text (str) or raw bytes; deleted files omitted.

    Text wins any text/binary collision between writers (the collision itself is
    reported as a conflict by `fold`), so raw bytes never silently shadow a
    weave some task wrote. A *lone type change* is not such a collision: when
    the path's only text record is the base tree's own, the bytes are the sole
    write, so they take the path and `fold` reports nothing (#132).
    """
    out = {}
    for p, w in state.files.items():
        if p in state.text_pristine and _byte_candidates(
                state.raw_candidates.get(p, ())):
            continue                            # lone type change: bytes take it
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
