"""Repo-level weave layer over the vendored manyana kernel (frontier probe).

Lifts the line-level weave kernel to whole repositories: `snapshot` reads a git
tree into a `RepoState`, `publish` turns a task branch into a `TaskState`, and
`fold` merges a task into a frontier state, reporting `Conflict`s. `fold` is
functional (never mutates its inputs) and order-independent (K1), which is what
lets the probe replay every permutation of a task set and compare outcomes.
"""
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "vendor"))
import manyana

MARKERS = ("<<<<<<<", "=======", ">>>>>>>")


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


@dataclass(frozen=True)
class RepoState:
    files: dict           # path -> weave state (text files)
    deleted_marks: frozenset
    raw: dict             # path -> bytes (binary files)
    raw_touched: frozenset = frozenset()


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


def fold(base, frontier, task):
    """Merge `task` into `frontier`; returns (new RepoState, [Conflict])."""
    files = dict(frontier.files)
    raw = dict(frontier.raw)
    conflicts = []
    for p, w in task.weaves.items():
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
                conflicts.append(Conflict(p, kind, task.task_id, _relabel(annotated, task.task_id)))
        else:
            files[p] = w
            if p in frontier.deleted_marks and p not in task.deleted:
                conflicts.append(Conflict(p, "delete/modify", task.task_id,
                                          "file deleted in frontier; re-modified by " + task.task_id))
    raw_touched = set(frontier.raw_touched)
    for p, b in task.raw.items():
        if (p in raw_touched and raw.get(p) != b) or p in files:
            conflicts.append(Conflict(p, "binary", task.task_id,
                                      "binary path touched concurrently: " + p))
            if p in raw:
                raw[p] = min(raw[p], b)  # deterministic tiebreak: K1 holds for binaries
        else:
            raw[p] = b
        raw_touched.add(p)
    for p in task.deleted:
        if p in raw:
            del raw[p]
    return (RepoState(files=files,
                      deleted_marks=frontier.deleted_marks | task.deleted,
                      raw=raw,
                      raw_touched=frozenset(raw_touched)),
            conflicts)


def manifest(state):
    """path -> normalized text (str) or raw bytes; deleted files omitted."""
    out = {}
    for p, w in state.files.items():
        lines = manyana.current_lines(w)
        if lines or p not in state.deleted_marks:
            out[p] = join_lines(lines)
    out.update(state.raw)
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
            target.write_text(content)
