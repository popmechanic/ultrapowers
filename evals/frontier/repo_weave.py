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
    return RepoState(files=files, deleted_marks=frozenset(), raw=raw)


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


def _fold_text(base, frontier, task, files, conflicts):
    """Fold the task's text weaves into `files`, appending any conflicts."""
    for p in sorted(task.weaves):
        w = task.weaves[p]
        if p in files:
            merged, annotated = manyana.merge_states(files[p], w)
            files[p] = merged
            if annotated != manyana.current_lines(merged):
                if p in task.deleted or p in frontier.deleted_marks:
                    kind = "delete/modify"
                elif p not in base.files and p not in base.raw:
                    kind = "add/add"
                else:
                    kind = "lines"
                conflicts.append(Conflict(p, kind, task.task_id,
                                          _relabel(annotated, task.task_id)))
        else:
            # A delete of a path with no base text weave is recorded as a
            # tombstone candidate, so text-vs-delete on this path is reported
            # by _fold_pairings — reporting it here would depend on arrival
            # order (the delete may not have been folded yet).
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


def _pairing_facts(files, candidates, path):
    """(has text weave, has task-written bytes, has a delete tombstone)."""
    marks = candidates.get(path, ())
    return (path in files, bool(_byte_candidates(marks)), TOMBSTONE in marks)


def _fold_pairings(frontier, task, files, candidates, conflicts):
    """One conflict per path that first pairs a text weave with a binary record.

    "Has a text weave", "has task-written bytes" and "has a tombstone" are all
    monotone across folds, so each not-both -> both transition happens exactly
    once per path whatever the order: text-vs-bytes reports `binary`,
    text-vs-delete reports `delete/modify`. (bytes-vs-delete is reported by
    _fold_binary, where both records live in the same candidate set.)
    """
    touched = set(task.weaves) | set(task.raw) | set(task.deleted)
    for p in sorted(touched):
        was_text, had_bytes, had_tomb = _pairing_facts(
            frontier.files, frontier.raw_candidates, p)
        is_text, has_bytes, has_tomb = _pairing_facts(files, candidates, p)
        if is_text and has_bytes and not (was_text and had_bytes):
            conflicts.append(Conflict(p, "binary", task.task_id,
                                      "path %s written as text and as binary "
                                      "concurrently; text wins the manifest" % p))
        if is_text and has_tomb and not (was_text and had_tomb):
            conflicts.append(Conflict(p, "delete/modify", task.task_id,
                                      "path %s deleted and written as text "
                                      "concurrently; text wins the manifest" % p))


def fold(base, frontier, task):
    """Merge `task` into `frontier`; returns (new RepoState, [Conflict])."""
    files = dict(frontier.files)
    candidates = {p: set(c) for p, c in frontier.raw_candidates.items()}
    conflicts = []
    _fold_text(base, frontier, task, files, conflicts)
    _fold_binary(task, candidates, conflicts)
    _fold_pairings(frontier, task, files, candidates, conflicts)
    return (RepoState(files=files,
                      deleted_marks=frontier.deleted_marks | task.deleted,
                      raw=dict(frontier.raw),
                      raw_candidates={p: frozenset(c) for p, c in candidates.items()}),
            conflicts)


def manifest(state):
    """path -> normalized text (str) or raw bytes; deleted files omitted.

    Text wins any text/binary collision (the collision itself is reported as a
    conflict by `fold`), so raw bytes never silently shadow a visible weave.
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
