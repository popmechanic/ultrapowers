"""The five-class comparator and the two ride-along predicates.

Spec: `docs/superpowers/specs/2026-08-31-fold-corpus-validation.md`
(Deliverable C). This module is the verdict core: given the weave arm's answer
and the git arm's answer for the same fold, it says — per path — which of the
five comparison classes the pair landed in.

    1  both arms clean, byte-identical content        the fold agreed
    2  both arms clean, content differs               divergence
    3  weave clean, git contended                     the weave resolved more
    4  weave contended, git clean                     the weave resolved less
    5  both arms contended                            both stopped
    binary  either arm called the path binary         excluded from comparison

Class 2 is the only class that carries a judgement: `mechanically_explained`
is True when the two contents are the same multiset of lines in a different
order — the shape an auto-unioned same-anchor append produces against git's
own ordering — and False when the contents genuinely disagree. Every other
class carries `None`, because there is no content pair to explain. A path only
one arm answered for is class 2 and never explained: a missing answer is a
defect signal, not an agreement. So is a path one arm kept and the other
deleted — a clean answer with `None` content — which is class 2, unexplained,
because absence is not a reordering of any file's lines.

The two ride-alongs are pure functions over the corpus's own patch text —
exact unified-diff hunk parsing, no git calls, no repository:

* `xaxbx_flag` — does any hunk touching a path lean on context that is not
  unique in the base file? That is the XaXbX shape, where a rename-blind
  three-way merge can splice a hunk against the wrong occurrence.
* `deletion_adjacency` — did one task delete base lines within `k` of another
  task's hunk span on the same file? That is the neighbourhood where a
  deletion silently swallows a neighbour's edit.
"""
import json
import re
from collections import Counter
from pathlib import Path

HUNK_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")
DIFF_GIT_RE = re.compile(r"^diff --git a/(.+?) b/(.+)$")


# --------------------------------------------------------------------------
# the comparator
# --------------------------------------------------------------------------

def _lines(b):
    return b.split(b"\n")


def classify(weave, git):
    out = []
    for path in sorted(set(weave.per_path) | set(git.per_path)):
        w, g = weave.per_path.get(path), git.per_path.get(path)
        if (w and w.status == "binary") or (g and g.status == "binary"):
            out.append({"path": path, "cls": "binary", "mechanically_explained": None, "xaxbx": False})
            continue
        if w is None or g is None:  # one arm never produced an answer: a defect signal, never silent
            out.append({"path": path, "cls": 2, "mechanically_explained": False, "xaxbx": False})
            continue
        wc, gc = w.status == "contended", g.status == "contended"
        if wc and gc:
            cls, expl = 5, None
        elif not wc and gc:
            cls, expl = 3, None
        elif wc and not gc:
            cls, expl = 4, None
        elif w.content == g.content:
            cls, expl = 1, None
        elif w.content is None or g.content is None:
            # One arm kept the path the other deleted (a clean answer with no
            # content is how both arms report a deletion that survived). Absence
            # is not a line multiset, and it is not a reordering of a present
            # file either — not even of an empty one — so this divergence is
            # class 2 and never mechanically explained.
            cls, expl = 2, False
        else:
            cls = 2
            expl = sorted(_lines(w.content)) == sorted(_lines(g.content))  # line-multiset equality
        out.append({"path": path, "cls": cls, "mechanically_explained": expl, "xaxbx": False})
    return out


# --------------------------------------------------------------------------
# reading a wave's patches back out of the corpus
# --------------------------------------------------------------------------

def task_patches(entry):
    """`[(taskId, patch text)]` for one wave, in the fold log's recorded order.

    The fold log is the authority for what folded (`FOLD_LOG.md`), so it — not
    the index's task list — is what the ride-alongs read. Patch names are
    corpus-relative, resolved against the entry's own `wave_dir`. Fold events
    with no `patch` field are branch-mode tasks, which carry no patch text to
    parse; they are skipped here and refused outright by `arm_git.git_answer`.
    """
    out = []
    log = Path(entry.wave_dir) / "fold_log.jsonl"
    for line in log.read_text().splitlines():
        if not line.strip():
            continue
        event = json.loads(line)
        if event.get("type") == "fold" and event.get("patch"):
            patch = Path(entry.wave_dir) / event["patch"]
            out.append((event["task"], patch.read_text(errors="replace")))
    return out


# --------------------------------------------------------------------------
# unified-diff parsing (exact hunk headers; no git)
# --------------------------------------------------------------------------

def _strip_prefix(name):
    """`a/x` / `b/x` -> `x`; a bare name is returned as-is."""
    name = name.split("\t", 1)[0]
    return name[2:] if name[:2] in ("a/", "b/") else name


def parse_hunks(patch_text):
    """`{path: [hunk]}`, each hunk `{"base_start", "base_end", "deleted", "kept"}`.

    `base_start`/`base_end` are the inclusive base-file span the hunk header
    declares (for a zero-length span — a pure insertion, `@@ -0,0 ...` — the
    end is the start). `deleted` is the base line numbers the hunk removes;
    `kept` is every context and added line body, which is what the XaXbX
    predicate looks up in the base.

    Binary diffs (`GIT binary patch`) carry no hunks and appear here with an
    empty list, so a binary path is still named — see `patch_paths`.
    """
    out = {}
    path = None
    minus_name = None
    hunk = None
    old_left = new_left = 0
    base_line = 0
    for line in patch_text.split("\n"):
        m = DIFF_GIT_RE.match(line)
        if m:
            path, hunk = _strip_prefix("b/" + m.group(2)), None
            out.setdefault(path, [])
            continue
        if line.startswith("--- "):
            minus_name, hunk = line[4:], None
            continue
        if line.startswith("+++ "):
            name = line[4:]
            path = _strip_prefix(minus_name if name.startswith("/dev/null") else name)
            out.setdefault(path, [])
            hunk = None
            continue
        m = HUNK_RE.match(line)
        if m and path is not None:
            start = int(m.group(1))
            old_left = 1 if m.group(2) is None else int(m.group(2))
            new_left = 1 if m.group(4) is None else int(m.group(4))
            hunk = {"base_start": start,
                    "base_end": start + old_left - 1 if old_left else start,
                    "deleted": [], "kept": []}
            out.setdefault(path, []).append(hunk)
            base_line = start
            continue
        if hunk is None:
            continue
        if old_left <= 0 and new_left <= 0:      # the hunk body ended
            hunk = None
            continue
        if line.startswith("\\"):                # "\ No newline at end of file"
            continue
        if line.startswith("-"):
            hunk["deleted"].append(base_line)
            base_line += 1
            old_left -= 1
        elif line.startswith("+"):
            hunk["kept"].append(line[1:])
            new_left -= 1
        elif line.startswith(" ") or line == "":  # a blank context line may be bare
            hunk["kept"].append(line[1:])
            base_line += 1
            old_left -= 1
            new_left -= 1
        else:
            hunk = None
    return out


def patch_paths(patch_text):
    """Every path the patch touches, in first-seen order — text and binary alike."""
    return list(parse_hunks(patch_text))


# --------------------------------------------------------------------------
# the ride-along predicates
# --------------------------------------------------------------------------

def xaxbx_flag(base_text, patch_texts, path):
    """True iff a hunk targeting `path` leans on a line that is not unique in the base.

    Every context line and every added line of every hunk targeting `path` is
    collected; the flag is True as soon as one of them occurs twice or more
    among `base_text`'s lines. That non-uniqueness is what lets a three-way
    merge anchor a hunk at the wrong occurrence.
    """
    counts = Counter(base_text.splitlines())
    for text in patch_texts:
        for hunk in parse_hunks(text).get(path, []):
            for line in hunk["kept"]:
                if counts[line] >= 2:
                    return True
    return False


def deletion_adjacency(entry, k=3):
    """Ordered task pairs on a shared path where one deletes near the other's hunk.

    One row per ordered `(path, task_del, task_near)` that qualifies:
    `task_del` removed a base line lying within `[start - k, end + k]` of some
    hunk span of `task_near` on the same file. `deleted_line` is the lowest
    such base line. Rows come out in recorded task order, then path order.
    """
    patches = task_patches(entry)
    hunks = {task_id: parse_hunks(text) for task_id, text in patches}
    order = [task_id for task_id, _ in patches]
    rows = []
    for task_del in order:
        for task_near in order:
            if task_del == task_near:
                continue
            for path, mine in sorted(hunks[task_del].items()):
                theirs = hunks[task_near].get(path)
                if not theirs:
                    continue
                hit = None
                for hunk in mine:
                    for line in hunk["deleted"]:
                        if any(other["base_start"] - k <= line <= other["base_end"] + k
                               for other in theirs):
                            hit = line if hit is None else min(hit, line)
                if hit is not None:
                    rows.append({"path": path, "task_del": task_del,
                                 "task_near": task_near, "deleted_line": hit})
    return rows
