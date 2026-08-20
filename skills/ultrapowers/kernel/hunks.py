"""Hunk-scoped resolver briefs (spec 2026-08-18-fold-native-authoring-program §1a).

derive():  annotated narration -> (hunks text, block index)
splice():  annotated narration + per-hunk replies -> whole-file line list
The kernel and the fold log never see any of this: the splice output is the
whole-file line list `FrontierEngine.apply_resolution` always took.
"""
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
sys.path.insert(0, str(_HERE / "vendor"))
import repo_weave as rw

CONTEXT_LINES = 40
MARKER_SHAPED = "marker-shaped content"
_BEGIN, _SEP, _END = "<<<<<<< begin ", "======= begin ", ">>>>>>> end conflict"
_KINDS = {"added", "deleted"}


def _valid_head(ln):
    # Kind is a closed annotator vocabulary; the side is `left`/`right`/`both`
    # only pre-relabel — repo_weave._relabel rewrites it to `frontier` or the
    # task id — so it can only be required non-empty, never enumerated.
    kind, side = _seg_head(ln)
    return kind in _KINDS and side != ""


class HunkError(Exception):
    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


def _is_marker(ln):
    return ln.startswith(_BEGIN) or ln.startswith(_SEP) or ln == _END


def _seg_head(ln):
    """(kind, side) off a `<<<<<<< begin ` / `======= begin ` segment marker."""
    head = ln[len(_BEGIN):] if ln.startswith(_BEGIN) else ln[len(_SEP):]
    kind, _, side = head.partition(" ")
    return kind, side


def _blocks(lines):
    """[(start, end)] inclusive indices of every marker block; raises on a
    content line byte-equal to a marker form (undelimitable) and on any
    marker head outside the annotator vocabulary (silently restructures
    segments otherwise)."""
    out, i, n = [], 0, len(lines)
    while i < n:
        ln = lines[i]
        if ln.startswith(_BEGIN):
            if not _valid_head(ln):
                raise HunkError(MARKER_SHAPED)
            j = i + 1
            while j < n and lines[j] != _END:
                if lines[j].startswith(_BEGIN):
                    raise HunkError(MARKER_SHAPED)
                if lines[j].startswith(_SEP) and not _valid_head(lines[j]):
                    raise HunkError(MARKER_SHAPED)
                j += 1
            if j >= n:
                raise HunkError(MARKER_SHAPED)
            out.append((i, j)); i = j + 1
        elif _is_marker(ln):
            raise HunkError(MARKER_SHAPED)     # SEP/END outside a block
        else:
            i += 1
    return out


def _segments(lines, start, end):
    """[(kind, side, [content lines])] for a block, in order."""
    segs, cur = [], None
    for ln in lines[start:end + 1]:
        if ln.startswith(_BEGIN) or ln.startswith(_SEP):
            kind, side = _seg_head(ln)
            cur = (kind, side, []); segs.append(cur)
        elif ln == _END:
            break
        else:
            cur[2].append(ln)
    return segs


def _eof_both_tail(lines, start, end):
    """Spec §1a EOF rule: block ends at EOF and its final segment is `added both`
    -> that (whitespace-only) segment leaves the block. Returns the trailing
    context lines to carry, or []."""
    if end != len(lines) - 1:
        return []
    segs = _segments(lines, start, end)
    if segs and segs[-1][0] == "added" and segs[-1][1] == "both":
        return list(segs[-1][2])
    return []


def derive(annotated):
    lines = rw.split_lines(annotated)
    spans = _blocks(lines)
    blocks, out = [], []
    for k, (start, end) in enumerate(spans, start=1):
        hid = "h%d" % k
        tail = _eof_both_tail(lines, start, end)
        prev_end = spans[k - 2][1] if k >= 2 else -1
        next_start = spans[k][0] if k < len(spans) else len(lines)
        before = lines[max(prev_end + 1, start - CONTEXT_LINES):start]
        after = tail if tail else lines[end + 1:min(next_start, end + 1 + CONTEXT_LINES)]
        body_end = end
        if tail:
            # the tail segment occupies its `======= begin added both` separator
            # plus its own lines, all sitting just before `_END`
            body_end = end - len(tail) - 2
        blocks.append({"id": hid, "start": start, "end": end, "bodyEnd": body_end,
                       "eofTail": tail})
        out.append("HUNK %s lines %d-%d" % (hid, start + 1, end + 1))
        out.append("--- context (read-only)"); out.extend("  " + l for l in before)
        out.append("--- conflict"); out.extend(lines[start:body_end + 1])
        if tail:
            out.append(_END)
        out.append("--- context (read-only)"); out.extend("  " + l for l in after)
        out.append("")
    return "\n".join(out), blocks


def strip_markers(annotated):
    lines = rw.split_lines(annotated)
    out, keep = [], True
    for ln in lines:
        if ln.startswith(_BEGIN) or ln.startswith(_SEP):
            keep = _seg_head(ln)[0] == "added"
            continue
        if ln == _END:
            keep = True
            continue
        if keep:
            out.append(ln)
    return out


def read_reply_dir(reply_dir, blocks):
    reply_dir = Path(reply_dir)
    ids = [b["id"] for b in blocks]
    present = {p.stem for p in reply_dir.glob("h*.txt")}
    unknown = sorted(present - set(ids))
    if unknown:
        raise HunkError("unknown hunk file(s): %s" % ", ".join(unknown))
    replies = {}
    for hid in ids:
        f = reply_dir / (hid + ".txt")
        if not f.is_file():
            raise HunkError("missing reply for %s" % hid)
        try:
            data = f.read_bytes().decode("utf-8")
        except UnicodeDecodeError:
            raise HunkError("%s: reply not valid UTF-8" % hid)
        if data == "":
            replies[hid] = []
            continue
        if not data.endswith("\n"):
            raise HunkError("%s: final line without newline" % hid)
        body = data[:-1].split("\n")
        for ln in body:
            if _is_marker(ln):
                raise HunkError("%s: reply contains a kernel marker form" % hid)
        replies[hid] = body
    return replies


def splice(annotated, replies, blocks):
    lines = rw.split_lines(annotated)
    out, pos = [], 0
    for b in blocks:
        out.extend(lines[pos:b["start"]])
        out.extend(replies[b["id"]])
        out.extend(b["eofTail"])
        pos = b["end"] + 1
    out.extend(lines[pos:])
    return out
