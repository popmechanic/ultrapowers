"""hunks.py — derive/splice for hunk-scoped resolver briefs (spec §1a).
Round-trip oracle: splice(derive(A), kernel-merged block bodies) == strip_markers(A)."""
import sys
from pathlib import Path
import pytest

KERNEL = Path(__file__).resolve().parents[1] / "skills/ultrapowers/kernel"
sys.path.insert(0, str(KERNEL)); sys.path.insert(0, str(KERNEL / "vendor"))
import hunks
import repo_weave as rw
import manyana


def _annotate(base, left, right, task="task-2"):
    """Real kernel annotation, relabeled like _fold_text does (frontier/<task>)."""
    b = manyana.initial_state(rw.split_lines(base))
    l = manyana.update_state(b, rw.split_lines(left))
    r = manyana.update_state(b, rw.split_lines(right))
    _merged, ann = manyana.merge_states(l, r)
    return rw._relabel(ann, task)


def _block_bodies(annotated, blocks):
    """The kernel's own merged content per reply-owned block: added lines kept,
    deleted dropped. Scoped to start..bodyEnd — an EOF `added both` segment has
    already left the block for trailing context, and `splice` re-emits it."""
    lines = rw.split_lines(annotated)
    out = {}
    for b in blocks:
        body, keep = [], True
        for ln in lines[b["start"]:b["bodyEnd"] + 1]:
            if ln.startswith("<<<<<<< begin ") or ln.startswith("======= begin "):
                keep = " added " in ln
                continue
            if ln == ">>>>>>> end conflict":
                continue
            if keep:
                body.append(ln)
        out[b["id"]] = body
    return out


BASE = "a\nwire()\nz\n"


def test_derive_one_block_and_context():
    ann = _annotate(BASE, "a\nwire()\nx\nz\n", "a\nwire()\ny\nz\n")
    text, blocks = hunks.derive(ann)
    assert len(blocks) == 1 and blocks[0]["id"] == "h1"
    assert "HUNK h1 lines" in text and "--- context (read-only)" in text
    assert "<<<<<<< begin added frontier" in text and ">>>>>>> end conflict" in text
    assert "wire()" in text  # context carried


def test_round_trip_property_on_kernel_shapes():
    cases = [
        (BASE, "a\nwire()\nx\nz\n", "a\nwire()\ny\nz\n"),          # interior
        ("x\n", "x\na\n", "x\nb\n"),                                # EOF, ends \n
        ("x\n\n", "x\na\n\n", "x\nb\n\n"),                          # EOF, ends \n\n
        ("x", "x\na", "x\nb"),                                      # no final newline
        ("a\nb\nc\nd\n", "a\nB\nc\nd\n", "a\nb\nc\nD\n"),           # merges clean: zero blocks
    ]
    for base, left, right in cases:
        ann = _annotate(base, left, right)
        _text, blocks = hunks.derive(ann)
        replies = _block_bodies(ann, blocks)
        assert hunks.splice(ann, replies, blocks) == hunks.strip_markers(ann), (base, left, right)


def test_eof_added_both_segment_moves_to_context():
    ann = _annotate("x\n\n", "x\na\n\n", "x\nb\n\n")
    text, blocks = hunks.derive(ann)
    # the trailing ["", ""] is context, not inside the reply-owned block
    lines = rw.split_lines(ann)
    blk = lines[blocks[0]["start"]:blocks[0]["bodyEnd"] + 1]
    assert "======= begin added both" not in blk
    assert blocks[0]["eofTail"] == ["", ""]
    out = hunks.splice(ann, {"h1": ["a", "b"]}, blocks)
    assert rw.join_lines(out) == "x\na\nb\n\n"          # final newline + blank kept


def test_marker_shaped_content_parks():
    ann = _annotate(BASE, "a\nwire()\nx\nz\n", "a\nwire()\ny\nz\n")
    poisoned = ann.replace("z", ">>>>>>> end conflict")   # content line equal to a marker form
    with pytest.raises(hunks.HunkError) as e:
        hunks.derive(poisoned)
    assert e.value.reason == hunks.MARKER_SHAPED


def test_read_reply_dir_grammar(tmp_path):
    ann = _annotate(BASE, "a\nwire()\nx\nz\n", "a\nwire()\ny\nz\n")
    _t, blocks = hunks.derive(ann)
    d = tmp_path / "reply-1-1"; d.mkdir()
    (d / "h1.txt").write_text("x\ny\n")
    assert hunks.read_reply_dir(d, blocks) == {"h1": ["x", "y"]}
    (d / "h1.txt").write_text("")                                   # zero lines = deletion
    assert hunks.read_reply_dir(d, blocks) == {"h1": []}
    (d / "h1.txt").write_text("x\ny")                                # no final newline
    with pytest.raises(hunks.HunkError) as e: hunks.read_reply_dir(d, blocks)
    assert "final line" in e.value.reason
    (d / "h1.txt").write_text("x\n>>>>>>> end conflict\n")           # exact marker form
    with pytest.raises(hunks.HunkError) as e: hunks.read_reply_dir(d, blocks)
    assert "marker" in e.value.reason
    (d / "h1.txt").write_text("=======\n")                           # bare ======= is legal
    assert hunks.read_reply_dir(d, blocks) == {"h1": ["======="]}
    (d / "h1.txt").unlink()                                          # omitted hunk
    with pytest.raises(hunks.HunkError) as e: hunks.read_reply_dir(d, blocks)
    assert "missing" in e.value.reason
    (d / "h1.txt").write_text("x\n"); (d / "h9.txt").write_text("q\n")   # unknown hunk
    with pytest.raises(hunks.HunkError) as e: hunks.read_reply_dir(d, blocks)
    assert "unknown" in e.value.reason


def test_context_truncates_at_neighbouring_markers():
    base = "\n".join(f"l{i}" for i in range(10)) + "\n"
    left = base.replace("l3", "L3").replace("l6", "L6")
    right = base.replace("l3", "R3").replace("l6", "R6")
    ann = _annotate(base, left, right)
    text, blocks = hunks.derive(ann)
    assert len(blocks) == 2
    # no marker line appears in a context section
    in_ctx = False
    for ln in text.splitlines():
        if ln.startswith("--- context"): in_ctx = True
        elif ln.startswith("--- conflict") or ln.startswith("HUNK "): in_ctx = False
        elif in_ctx: assert not ln.strip().startswith(("<<<<<<< begin", "======= begin", ">>>>>>> end")), ln


def test_strip_markers_drops_deleted_segments():
    """The round-trip oracle's other half: `deleted` segment lines are not part
    of the kernel's merged content, whichever side they belong to."""
    annotated = "\n".join([
        "keep0",
        "<<<<<<< begin deleted frontier",
        "gone-left",
        "======= begin added task-2",
        "new-right",
        ">>>>>>> end conflict",
        "keep1",
        "",
    ])
    assert hunks.strip_markers(annotated) == ["keep0", "new-right", "keep1", ""]


def test_reply_with_invalid_utf8_is_rejected_not_replaced(tmp_path):
    annotated = "\n".join([
        "ctx",
        "<<<<<<< begin added left",
        "L",
        "======= begin added right",
        "R",
        ">>>>>>> end conflict",
        "tail",
    ])
    _text, blocks = hunks.derive(annotated)
    (tmp_path / "h1.txt").write_bytes(b"caf\xe9\n")
    with pytest.raises(hunks.HunkError) as exc:
        hunks.read_reply_dir(tmp_path, blocks)
    assert "not valid UTF-8" in exc.value.reason
    assert "h1" in exc.value.reason


def test_in_block_marker_with_unknown_head_parks_as_marker_shaped():
    annotated = "\n".join([
        "<<<<<<< begin added left",
        "L",
        "======= begin frobnicate zone",
        "R",
        ">>>>>>> end conflict",
    ])
    with pytest.raises(hunks.HunkError) as exc:
        hunks.derive(annotated)
    assert exc.value.reason == hunks.MARKER_SHAPED


def test_begin_marker_with_unknown_head_parks_as_marker_shaped():
    annotated = "\n".join([
        "<<<<<<< begin exploded sideways",
        "L",
        ">>>>>>> end conflict",
    ])
    with pytest.raises(hunks.HunkError) as exc:
        hunks.derive(annotated)
    assert exc.value.reason == hunks.MARKER_SHAPED


def test_content_line_equal_to_end_marker_inside_a_block_still_parks():
    # The in-block END-equal line terminates the block early; the real END
    # then sits at top level, where the existing defense parks it. Pinned
    # here so the indirect defense cannot be lost in a refactor.
    annotated = "\n".join([
        "<<<<<<< begin added left",
        ">>>>>>> end conflict",   # content byte-equal to the END marker
        "more",
        ">>>>>>> end conflict",
    ])
    with pytest.raises(hunks.HunkError) as exc:
        hunks.derive(annotated)
    assert exc.value.reason == hunks.MARKER_SHAPED


def test_two_block_narration_round_trips_through_splice():
    # Genuine two-block coverage for splice's pos-advance loop: l0..l9 with
    # l3 and l6 diverging. (#162's rider: the existing "# two blocks"
    # comment sat on a case the kernel annotates as ZERO blocks.)
    annotated = "\n".join([
        "l0", "l1", "l2",
        "<<<<<<< begin added left",
        "L3",
        "======= begin added right",
        "R3",
        ">>>>>>> end conflict",
        "l4", "l5",
        "<<<<<<< begin added left",
        "L6",
        "======= begin added right",
        "R6",
        ">>>>>>> end conflict",
        "l7", "l8", "l9",
    ])
    _text, blocks = hunks.derive(annotated)
    assert [b["id"] for b in blocks] == ["h1", "h2"]
    out = hunks.splice(annotated, {"h1": ["L3"], "h2": ["R6"]}, blocks)
    assert out == ["l0", "l1", "l2", "L3", "l4", "l5", "R6", "l7", "l8", "l9"]
