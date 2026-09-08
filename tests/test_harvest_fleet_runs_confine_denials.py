"""`confineDenials` is derived from the envelopes and the slices, and null when
unknown — the exam for task 2.

The Claim under test: the harvester derives `confineDenials` from the sources
the record does carry — each worker's `permission_denials` in its
envelope/receipt and the #702 transcript slices — with a `source` per line, and
emits `confineDenials: null` (unknown), never `[]`, when neither source is
present.

What each clause asserts, and the leg that pins it:

* M1 / leg (a) — a run dir whose `workers/<dir>/envelope.json` joins on the
  `sessionId` of a `worker:start` and lists two `permission_denials` yields two
  lines, each `source == "envelope"` with that worker's `label` and `role` and
  the entry's `tool_name` as `tool`.
* M2 / leg (b) — a run dir whose only source is a #702 transcript slice
  carrying an `is_error` `tool_result` containing `Permission to use` yields
  exactly one line, `source == "transcript"`, with the worker's `label`/`role`,
  the `tool_use` block's `name` as `tool`, and `Permission to use` in `reason`.
* M3 / leg (c) — a run dir whose only source is `confine-denials.jsonl` yields
  that file's object lines, in file order, as parsed. The BASE shape.
* M4 / leg (d) — no `workers/`, no `transcripts/`, no file: `confineDenials` is
  JSON `null` after a round-trip of `bundle.json`, and `bundle.json` writes.
* M4 / leg (e) — an envelope with an empty `permission_denials`, a slice with
  no error result, no file: `[]`. Counted, and zero — not unknown.
* M5 / leg (f) — `reading-lenses.md`'s `1. **friction**` item names
  `bundle.confineDenials`, then `envelope`, `transcript`, `hook` and `null` in
  order, and no longer calls `confine-denials.jsonl` the one place to look.

Self-contained: every run directory here is built under `tmp_path` and goes
through `hfr.build_fleet_bundle` with an explicit `engine_version`, so no `gh`,
no `git`, and no network.
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/ultralearn/scripts"))
import harvest_fleet_runs as hfr  # noqa: E402

REPO = Path(__file__).resolve().parents[1]
LENSES = REPO / "skills/ultralearn/references/reading-lenses.md"

T0 = 1788130000000

# The denial as the #702 reducer writes it: the error's first 200 characters
# behind a `[tool_result: <n> chars, is_error] ` size prefix, inside a `user`
# record's `message.content` list.
DENIAL_TEXT = ("Permission to use Bash has been denied because Claude Code is "
               "running in don't ask mode. IMPORTANT: the command was not run.")
DENIAL_CONTENT = f"[tool_result: 727 chars, is_error] {DENIAL_TEXT}"

# The two `Run:` legs of the Proof, verbatim.
FRICTION_ITEM = (r"sed -n '/^1\. \*\*friction\*\*/,/^2\. \*\*routing\*\*/p' "
                 r"skills/ultralearn/references/reading-lenses.md")
RUN_NAMES_THE_BUNDLE_KEY = (
    FRICTION_ITEM + r" | tr '\n' ' ' | "
    r"grep -q 'bundle.confineDenials.*envelope.*transcript.*hook.*null'")
RUN_DROPS_THE_BASE_SENTENCE = (
    FRICTION_ITEM + r" | grep -c 'is now the one place to' | grep -qx 0")


# ---------- fixtures: run directories, built locally ----------

def _ev(i, off, **f):
    return dict(f, id=f"01AAA{i:03d}", ts=T0 + off)


def _write_run(root, run_id, events):
    """A run directory carrying just an `events.jsonl`: the one file
    `discover_run_dirs` and `build_fleet_bundle` both require."""
    d = root / run_id
    d.mkdir(parents=True, exist_ok=True)
    (d / "events.jsonl").write_text(
        "\n".join(json.dumps(e) for e in events) + "\n")
    return d


def _worker_events(run_id, label, role, session_id, *, with_end=True):
    events = [
        _ev(1, 0, kind="run:open", runId=run_id, base="",
            source="fleet/run-main.mjs"),
        _ev(2, 1000, kind="engine:phase", phase="Wave 1"),
        _ev(3, 2000, kind="worker:start", label=label, role=role,
            sessionId=session_id, cwd="/clones/task-1", model="opus"),
    ]
    if with_end:
        events.append(_ev(4, 61000, kind="worker:end", label=label, role=role,
                          sessionId=session_id, exitCode=0, timedOut=False,
                          outcome="ok", status=None,
                          meter={"input": 30, "output": 640, "cacheRead": 4520,
                                 "cacheCreation": 200, "costUsd": 0.06,
                                 "models": ["claude-opus-5"]}))
    return events


def _write_envelope(run_dir, worker_dir, payload):
    """`workers/<label with ':' -> '_'>/envelope.json` — the `claude -p` result
    envelope a local sandbox-logs tarball carries."""
    d = run_dir / "workers" / worker_dir
    d.mkdir(parents=True, exist_ok=True)
    (d / "envelope.json").write_text(json.dumps(payload))
    return d / "envelope.json"


def _write_slice(run_dir, session_id, records):
    """`transcripts/<sessionId>.jsonl` — the #702 slice shape."""
    d = run_dir / "transcripts"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{session_id}.jsonl").write_text(
        "\n".join(json.dumps(r) for r in records) + "\n")
    return d / f"{session_id}.jsonl"


def _slice_records(session_id, tool_use, tool_result):
    return [
        {"type": "assistant", "uuid": "u1", "sessionId": session_id,
         "message": {"role": "assistant", "model": "claude-opus-5",
                     "content": [{"type": "text", "text": "Running the suite."},
                                 tool_use]}},
        {"type": "user", "uuid": "u2", "parentUuid": "u1",
         "sessionId": session_id,
         "message": {"role": "user", "content": [tool_result]}},
    ]


def _bundle(run_dir, tmp_path):
    """Build the bundle and read it back off disk — the bundle a lens reads is
    the JSON file, so every assertion here goes through the round-trip."""
    out = hfr.build_fleet_bundle(run_dir, tmp_path / "cache",
                                 engine_version="0.3.0")
    assert out is not None, f"build_fleet_bundle refused {run_dir}"
    written = out / "bundle.json"
    assert written.is_file(), f"no bundle.json under {out}"
    return json.loads(written.read_text()), out


# ---------- M1, leg (a): the envelopes ----------

def test_two_envelope_denials_become_two_envelope_sourced_lines(tmp_path):
    """M1, leg (a): `workers/review_1_1/envelope.json` carries
    `session_id: "sess-r1"` — the session of the `review:1:1` / `reviewer`
    worker:start/worker:end pair — and two `permission_denials` entries with
    `tool_name: "Bash"`. `bundle.confineDenials` is a list of exactly two
    objects, each `source == "envelope"`, `label == "review:1:1"`,
    `role == "reviewer"` and `tool == "Bash"`.

    A harvester that still reads only `confine-denials.jsonl` yields `[]` here
    and fails the length."""
    run_dir = _write_run(tmp_path / "src", "run-51",
                         _worker_events("run-51", "review:1:1", "reviewer",
                                        "sess-r1"))
    _write_envelope(run_dir, "review_1_1", {
        "session_id": "sess-r1",
        "subtype": "success",
        "result": "the review found two concerns",
        "permission_denials": [
            {"tool_name": "Bash", "tool_use_id": "toolu_1",
             "tool_input": {"command": "git push origin HEAD"}},
            {"tool_name": "Bash", "tool_use_id": "toolu_2",
             "tool_input": {"command": "cat ../outside-the-clone/notes.md"}},
        ],
    })

    bundle, _ = _bundle(run_dir, tmp_path)
    denials = bundle["confineDenials"]

    assert isinstance(denials, list), (
        f"M1: confineDenials must be a list here, got {denials!r}")
    assert len(denials) == 2, (
        "M1, leg (a): two `permission_denials` entries in the envelope are two "
        f"denial lines; got {len(denials)}: {denials!r}")
    assert [(d.get("source"), d.get("label"), d.get("role"), d.get("tool"))
            for d in denials] == [("envelope", "review:1:1", "reviewer", "Bash"),
                                  ("envelope", "review:1:1", "reviewer", "Bash")], (
        "M1, leg (a): every line carries source 'envelope', the worker's label "
        f"and role, and the entry's tool_name as `tool`; got {denials!r}")


def test_an_envelope_line_carries_the_entrys_tool_input_as_a_json_string(tmp_path):
    """M1: the envelope line is shaped as `recordEnvelopeDenials` shapes its
    lines — `toolInput` is the entry's `tool_input` as a JSON string, so the
    command a lens reads survives the fold."""
    run_dir = _write_run(tmp_path / "src", "run-52",
                         _worker_events("run-52", "review:1:1", "reviewer",
                                        "sess-r1"))
    _write_envelope(run_dir, "review_1_1", {
        "session_id": "sess-r1",
        "permission_denials": [
            {"tool_name": "Bash", "tool_use_id": "toolu_1",
             "tool_input": {"command": "git push origin HEAD"}},
        ],
    })

    bundle, _ = _bundle(run_dir, tmp_path)
    denials = bundle["confineDenials"]

    assert len(denials) == 1, f"M1: one entry is one line; got {denials!r}"
    line = denials[0]
    for key in ("source", "label", "role", "tool", "reason", "toolInput"):
        assert key in line, (
            f"M1: an envelope line carries `{key}`; got keys {sorted(line)}")
    assert isinstance(line["toolInput"], str), (
        f"M1: `toolInput` is the tool_input as a JSON string; got "
        f"{line['toolInput']!r}")
    assert "git push origin HEAD" in line["toolInput"], (
        f"M1: `toolInput` carries the denied command; got {line['toolInput']!r}")


# ---------- M2, leg (b): the #702 transcript slices ----------

def test_a_denied_tool_result_in_a_slice_becomes_one_transcript_line(tmp_path):
    """M2, leg (b): a run dir with a `worker:start` for session `sess-c1`
    (label `critic:1`, role `critic`) and `transcripts/sess-c1.jsonl` holding
    an assistant `tool_use` `{"id": "toolu_9", "name": "Bash"}` and a user
    `tool_result` `{"tool_use_id": "toolu_9", "is_error": true, "content":
    "[tool_result: 727 chars, is_error] Permission to use Bash …"}`, with no
    `workers/` and no `confine-denials.jsonl`, yields exactly one line:
    `source == "transcript"`, `label == "critic:1"`, `role == "critic"`,
    `tool == "Bash"`, and `"Permission to use" in reason`."""
    run_dir = _write_run(tmp_path / "src", "run-53",
                         _worker_events("run-53", "critic:1", "critic",
                                        "sess-c1", with_end=False))
    _write_slice(run_dir, "sess-c1", _slice_records(
        "sess-c1",
        {"type": "tool_use", "id": "toolu_9", "name": "Bash",
         "input": {"command": "python3 -m pytest -q"}},
        {"type": "tool_result", "tool_use_id": "toolu_9", "is_error": True,
         "content": DENIAL_CONTENT}))
    assert not (run_dir / "workers").exists()
    assert not (run_dir / "confine-denials.jsonl").exists()

    bundle, _ = _bundle(run_dir, tmp_path)
    denials = bundle["confineDenials"]

    assert isinstance(denials, list), (
        f"M2: confineDenials must be a list here, got {denials!r}")
    assert len(denials) == 1, (
        "M2, leg (b): one denied tool_result is one denial line; got "
        f"{len(denials)}: {denials!r}")
    line = denials[0]
    assert (line.get("source"), line.get("label"), line.get("role"),
            line.get("tool")) == ("transcript", "critic:1", "critic", "Bash"), (
        "M2, leg (b): source 'transcript', the label and role of the worker "
        "whose sessionId names the file, and the `name` of the tool_use block "
        f"whose id the result's tool_use_id matches; got {line!r}")
    assert "Permission to use" in (line.get("reason") or ""), (
        f"M2, leg (b): the reason carries the denial text; got "
        f"{line.get('reason')!r}")


def test_a_transcript_line_names_its_session_and_strips_the_size_prefix(tmp_path):
    """M2: the transcript line is `{source, label, role, sessionId, tool,
    reason}` — `sessionId` is the file's, and `reason` is the content with its
    `[tool_result: N chars, is_error] ` prefix stripped, so a lens reads the
    denial and not the reducer's bookkeeping."""
    run_dir = _write_run(tmp_path / "src", "run-54",
                         _worker_events("run-54", "critic:1", "critic",
                                        "sess-c1", with_end=False))
    _write_slice(run_dir, "sess-c1", _slice_records(
        "sess-c1",
        {"type": "tool_use", "id": "toolu_9", "name": "Bash",
         "input": {"command": "python3 -m pytest -q"}},
        {"type": "tool_result", "tool_use_id": "toolu_9", "is_error": True,
         "content": DENIAL_CONTENT}))

    bundle, _ = _bundle(run_dir, tmp_path)
    denials = bundle["confineDenials"]

    assert len(denials) == 1, f"M2: one denial line; got {denials!r}"
    line = denials[0]
    assert line.get("sessionId") == "sess-c1", (
        f"M2: the line names the slice's session; got {line.get('sessionId')!r}")
    assert line.get("reason") == DENIAL_TEXT, (
        "M2: `reason` is the content with its `[tool_result: N chars, "
        f"is_error] ` prefix stripped; got {line.get('reason')!r}")


# ---------- M3, leg (c): the hook's own file, verbatim ----------

def test_the_file_lines_are_carried_verbatim_in_file_order(tmp_path):
    """M3, leg (c): a run dir with `confine-denials.jsonl` of two object lines
    and no `workers/` and no `transcripts/` yields a list equal to those two
    objects, in file order, each as parsed — the BASE shape, unchanged."""
    run_dir = _write_run(tmp_path / "src", "run-55",
                         _worker_events("run-55", "impl:1", "implementer",
                                        "sess-i1"))
    rows = [
        {"ts": T0 + 3000, "source": "hook", "label": "impl:1",
         "role": "implementer", "tool": "Write", "reason": "outside clone",
         "toolInput": "{\"file_path\": \"/etc/hosts\"}"},
        {"ts": T0 + 4000, "source": "envelope", "label": "impl:1",
         "role": "implementer", "tool": "Bash", "reason": "outside clone",
         "toolInput": "{\"command\": \"git push\"}"},
    ]
    (run_dir / "confine-denials.jsonl").write_text(
        "\n".join(json.dumps(r) for r in rows) + "\n")
    assert not (run_dir / "workers").exists()
    assert not (run_dir / "transcripts").exists()

    bundle, _ = _bundle(run_dir, tmp_path)

    assert bundle["confineDenials"] == rows, (
        "M3, leg (c): the file's object lines, in file order, each as parsed; "
        f"got {bundle['confineDenials']!r}")


# ---------- M4, legs (d) and (e): null is unknown, [] is counted zero ----------

def test_no_source_at_all_is_json_null_and_the_bundle_still_writes(tmp_path):
    """M4, leg (d): a run directory holding none of `workers/*/envelope.json`,
    `transcripts/*.jsonl` and `confine-denials.jsonl` yields
    `bundle["confineDenials"] is None` after a JSON round-trip of
    `bundle.json`, and `bundle.json` exists. `null` means the record carried
    nothing to count — not zero."""
    run_dir = _write_run(tmp_path / "src", "run-56",
                         _worker_events("run-56", "impl:1", "implementer",
                                        "sess-i1"))
    assert not (run_dir / "workers").exists()
    assert not (run_dir / "transcripts").exists()
    assert not (run_dir / "confine-denials.jsonl").exists()

    bundle, out = _bundle(run_dir, tmp_path)

    assert (out / "bundle.json").is_file(), (
        "M4, leg (d): the run still bundles when it carries no denial source")
    assert "confineDenials" in bundle, (
        "M4: the key keeps its name whatever its value; got keys "
        f"{sorted(bundle)}")
    assert bundle["confineDenials"] is None, (
        "M4, leg (d): no source at all is JSON null (unknown), never `[]`; got "
        f"{bundle['confineDenials']!r}")


def test_a_present_but_empty_source_is_an_empty_list(tmp_path):
    """M4, leg (e): a run directory with one envelope whose
    `permission_denials` is `[]`, one transcript slice whose only `tool_result`
    is not an error, and no `confine-denials.jsonl` yields
    `bundle["confineDenials"] == []` — counted, and zero."""
    run_dir = _write_run(tmp_path / "src", "run-57",
                         _worker_events("run-57", "impl:1", "implementer",
                                        "sess-i1"))
    _write_envelope(run_dir, "impl_1", {
        "session_id": "sess-i1",
        "subtype": "success",
        "result": "done",
        "permission_denials": [],
    })
    _write_slice(run_dir, "sess-i1", _slice_records(
        "sess-i1",
        {"type": "tool_use", "id": "toolu_3", "name": "Read",
         "input": {"file_path": "README.md"}},
        {"type": "tool_result", "tool_use_id": "toolu_3", "is_error": False,
         "content": "[tool_result: 812 chars]"}))
    assert not (run_dir / "confine-denials.jsonl").exists()

    bundle, _ = _bundle(run_dir, tmp_path)

    assert bundle["confineDenials"] is not None, (
        "M4, leg (e): the sources exist, so this is counted-zero (`[]`), not "
        "unknown (`null`)")
    assert bundle["confineDenials"] == [], (
        "M4, leg (e): an empty `permission_denials` and a non-error "
        f"tool_result count to zero; got {bundle['confineDenials']!r}")


def test_an_unreadable_envelope_is_a_diagnostic_and_never_a_traceback(
        tmp_path, capsys):
    """The harvester stays advisory and loud (global constraint): a source that
    is unreadable costs a line on stderr, not the run's bundle. The denial
    count is whatever the readable sources say — the point is that
    `build_fleet_bundle` returns and `bundle.json` writes."""
    run_dir = _write_run(tmp_path / "src", "run-58",
                         _worker_events("run-58", "impl:1", "implementer",
                                        "sess-i1"))
    d = run_dir / "workers" / "impl_1"
    d.mkdir(parents=True)
    (d / "envelope.json").write_text("{ this is not json")

    bundle, out = _bundle(run_dir, tmp_path)
    capsys.readouterr()

    assert (out / "bundle.json").is_file(), (
        "an unreadable envelope must not cost the run its bundle")
    assert bundle["confineDenials"] in (None, []), (
        "an envelope that will not parse yields no denial line; got "
        f"{bundle['confineDenials']!r}")


# ---------- M5, leg (f): the friction lens ----------

def _shell(cmd):
    return subprocess.run(["bash", "-c", cmd], cwd=str(REPO),
                          capture_output=True, text=True)


def test_the_friction_lens_names_the_bundle_key_and_the_three_sources():
    """M5, leg (f): the second `Run:` — the friction item's text, joined,
    matches `bundle.confineDenials` followed in order by `envelope`,
    `transcript`, `hook` and `null` — exits 0."""
    proc = _shell(RUN_NAMES_THE_BUNDLE_KEY)
    assert proc.returncode == 0, (
        "M5, leg (f): the `1. **friction**` item of "
        "skills/ultralearn/references/reading-lenses.md must name "
        "`bundle.confineDenials` and then, in order, the source values "
        "`envelope`, `transcript` and `hook`, and `null` as unknown.\n"
        f"stderr:\n{proc.stderr}")


def test_the_friction_lens_no_longer_calls_the_file_the_one_place_to_look():
    """M5, leg (f): the third `Run:` exits 0 only when the BASE sentence
    `is now the one place to` is absent from that item."""
    proc = _shell(RUN_DROPS_THE_BASE_SENTENCE)
    assert proc.returncode == 0, (
        "M5, leg (f): the `1. **friction**` item must no longer say "
        "`confine-denials.jsonl` `is now the one place to look` — the bundle "
        "key is.\n"
        f"stderr:\n{proc.stderr}")


def test_the_friction_item_is_still_findable_by_the_run_legs_own_sed():
    """A guard on the two greps above: the `sed` range they both depend on
    still selects a non-empty `1. **friction**` item, so a failure above reads
    as the doc's wording and not as a range that stopped matching."""
    proc = _shell(FRICTION_ITEM)
    assert proc.returncode == 0 and proc.stdout.strip(), (
        "the `1. **friction**` … `2. **routing**` range selects nothing in "
        f"{LENSES}; stdout={proc.stdout!r} stderr={proc.stderr!r}")


# =====================================================================
# Task 1: the file's envelope rows are dropped when the envelopes were
# read directly — `confineDenials` counts each denial once.
#
# What each clause of THIS task asserts, and the leg that pins it:
#
# * M1 / leg (a) — one `workers/review_1_1/envelope.json` with one
#   `permission_denials` entry, plus a `confine-denials.jsonl` holding one
#   `source: "envelope"` row describing that same denial and one
#   `source: "hook"` row, yields exactly two objects: exactly one
#   `source == "envelope"` and exactly one `source == "hook"`. BASE
#   concatenates and yields three.
# * M1 / the Claim — the row that is dropped is the FILE's `envelope` row;
#   the line the harvester derived from the envelope itself survives, and
#   the `hook` row comes through verbatim.
# * M2 / leg (b) — a `source: "envelope"` row in the file with no
#   `workers/*/envelope.json` is kept: the drop applies only when THIS
#   run's envelopes were read directly. (The existing leg (c) test
#   `test_the_file_lines_are_carried_verbatim_in_file_order` pins the same
#   fixture's file order and stays unedited.)
# * M3 / legs (c), (d), (e) — the three `Run:` legs against the
#   `1. **friction**` item of `reading-lenses.md`.
# =====================================================================

# The three `Run:` legs of this task's Proof, verbatim, over the same `sed`
# range leg (f) above already uses.
RUN_SAYS_COUNTED_ONCE = (
    FRICTION_ITEM + r" | tr '\n' ' ' | "
    r"grep -q 'counted once.*drops.*envelope.*hook'")
RUN_DROPS_NEVER_THE_TOTAL = (
    FRICTION_ITEM + r" | grep -c 'never the total' | grep -qx 0")
RUN_DROPS_23_LINES = (
    FRICTION_ITEM + r" | grep -c '23 lines' | grep -qx 0")

# M3 is about the PHRASE, and the item is a wrapped markdown paragraph: at BASE
# `never the total` is split across two source lines, which the line-oriented
# `Run:` leg above cannot see. The clause is pinned on the joined item too,
# whitespace squeezed, so a phrase that merely moved its line break is still
# caught.
_JOINED = FRICTION_ITEM + r" | tr '\n' ' ' | tr -s ' '"
JOINED_DROPS_NEVER_THE_TOTAL = (
    _JOINED + r" | grep -c 'never the total' | grep -qx 0")
JOINED_DROPS_23_LINES = _JOINED + r" | grep -c '23 lines' | grep -qx 0"

# The `confine-denials.jsonl` rows of leg (a): `recordEnvelopeDenials`'
# own record of the envelope denial below, and a hook row for another
# worker. The envelope row is deliberately distinguishable from the line
# the harvester derives (no `role`, its own `reason` and `toolInput`) so
# leg (a) can say WHICH of the two was dropped.
FILE_ENVELOPE_ROW = {
    "ts": T0 + 3000, "source": "envelope", "label": "review:1:1",
    "tool": "Bash", "reason": "recorded by the worker at exit",
    "toolInput": "{\"command\": \"git push origin HEAD\"}",
}
FILE_HOOK_ROW = {
    "ts": T0 + 4000, "source": "hook", "label": "impl:1",
    "role": "implementer", "tool": "Write", "reason": "outside clone",
    "toolInput": "{\"file_path\": \"/etc/hosts\"}",
}


def _write_denial_file(run_dir, rows):
    """`confine-denials.jsonl` — one JSON object per line, as
    `fleet/run-worker.mjs` appends them."""
    (run_dir / "confine-denials.jsonl").write_text(
        "\n".join(json.dumps(r) for r in rows) + "\n")
    return run_dir / "confine-denials.jsonl"


def _run_with_both_sources(tmp_path, run_id, rows):
    """A run directory that carries BOTH readers of the same denial: one
    `workers/review_1_1/envelope.json` with `session_id: "sess-r1"` and one
    `permission_denials` entry (`tool_name: "Bash"`), and the file rows given.
    No `transcripts/`, so the count is envelope + file only."""
    run_dir = _write_run(tmp_path / "src", run_id,
                         _worker_events(run_id, "review:1:1", "reviewer",
                                        "sess-r1"))
    _write_envelope(run_dir, "review_1_1", {
        "session_id": "sess-r1",
        "subtype": "success",
        "result": "the review found one concern",
        "permission_denials": [
            {"tool_name": "Bash", "tool_use_id": "toolu_1",
             "tool_input": {"command": "git push origin HEAD"}},
        ],
    })
    _write_denial_file(run_dir, rows)
    assert not (run_dir / "transcripts").exists()
    return run_dir


# ---------- M1, leg (a): each denial is counted once ----------

def test_a_denial_read_from_the_envelope_is_not_counted_again_from_the_file(
        tmp_path):
    """M1, leg (a): one envelope denial plus a `confine-denials.jsonl` holding
    that same denial as a `source: "envelope"` row and one `source: "hook"` row
    yields `bundle.confineDenials` of length exactly 2, with
    `[d["source"] for d in denials].count("envelope") == 1` and
    `.count("hook") == 1`.

    A harvester that concatenates the three readers without reconciling yields
    3 here and fails the length."""
    run_dir = _run_with_both_sources(tmp_path, "run-59",
                                     [FILE_ENVELOPE_ROW, FILE_HOOK_ROW])

    bundle, _ = _bundle(run_dir, tmp_path)
    denials = bundle["confineDenials"]

    assert isinstance(denials, list), (
        f"M1, leg (a): confineDenials must be a list here, got {denials!r}")
    assert len(denials) == 2, (
        "M1, leg (a): one envelope denial recorded by both readers is ONE "
        "line, and the hook row is the other — exactly two; got "
        f"{len(denials)}: {denials!r}")
    sources = [d.get("source") for d in denials]
    assert sources.count("envelope") == 1, (
        "M1, leg (a): exactly one line has source == 'envelope'; got "
        f"{sources!r} from {denials!r}")
    assert sources.count("hook") == 1, (
        "M1, leg (a): exactly one line has source == 'hook'; got "
        f"{sources!r} from {denials!r}")


def test_the_dropped_row_is_the_files_and_the_hook_row_survives_verbatim(
        tmp_path):
    """M1, the Claim: it is the FILE's `source: "envelope"` row that is
    dropped — the line the harvester derived from `workers/*/envelope.json`
    survives, so it still carries the `role` the `session_id` join supplies
    (`reviewer`), which the file's row does not have. Every other file line,
    the `hook` row included, comes through verbatim."""
    run_dir = _run_with_both_sources(tmp_path, "run-60",
                                     [FILE_ENVELOPE_ROW, FILE_HOOK_ROW])

    bundle, _ = _bundle(run_dir, tmp_path)
    denials = bundle["confineDenials"]

    envelope_lines = [d for d in denials if d.get("source") == "envelope"]
    assert len(envelope_lines) == 1, (
        f"M1: one envelope-sourced line; got {envelope_lines!r}")
    assert envelope_lines[0].get("role") == "reviewer", (
        "M1, the Claim: the surviving `envelope` line is the one the harvester "
        "read out of `workers/review_1_1/envelope.json` — it carries the role "
        "of the worker whose session_id it joins on; got "
        f"{envelope_lines[0]!r}")
    assert FILE_ENVELOPE_ROW not in denials, (
        "M1, the Claim: the file's own `source: \"envelope\"` row is dropped "
        f"when this run's envelopes were read directly; got {denials!r}")
    assert FILE_HOOK_ROW in denials, (
        "M1: every file line that is not `source: \"envelope\"` is kept, as "
        f"parsed; got {denials!r}")


def test_a_file_line_with_no_source_key_survives_the_drop(tmp_path):
    """M1: the drop is keyed on the string `"envelope"` and nothing else — a
    file line with no `source` key at all (the shape
    `tests/test_harvest_fleet_runs.py` and `tests/test_harvest_evidence.py`
    write) still comes through verbatim beside the envelope-read line."""
    sourceless = {"tool": "Bash", "reason": "outside clone"}
    run_dir = _run_with_both_sources(tmp_path, "run-61",
                                     [FILE_ENVELOPE_ROW, sourceless])

    bundle, _ = _bundle(run_dir, tmp_path)
    denials = bundle["confineDenials"]

    assert sourceless in denials, (
        "M1: a file line with no `source` key is not an `envelope` row and is "
        f"kept as parsed; got {denials!r}")
    assert len(denials) == 2, (
        "M1: the derived envelope line plus the source-less file line — the "
        f"file's `envelope` row is the only drop; got {denials!r}")


# ---------- M2, leg (b): no envelope file, so nothing was read twice ----------

def test_a_file_envelope_row_is_kept_when_this_run_has_no_envelope_file(
        tmp_path):
    """M2, leg (b): a run directory whose `confine-denials.jsonl` includes a
    `source: "envelope"` line and which has no `workers/*/envelope.json` still
    carries that line — it is the only record of a denial by a worker that died
    before the harvester ran, and the drop applies only when THIS run's
    envelopes were read directly.

    Beside the existing leg (c) test, which pins the same two rows in file
    order."""
    run_dir = _write_run(tmp_path / "src", "run-62",
                         _worker_events("run-62", "impl:1", "implementer",
                                        "sess-i1"))
    rows = [FILE_HOOK_ROW, FILE_ENVELOPE_ROW]
    _write_denial_file(run_dir, rows)
    assert not (run_dir / "workers").exists()
    assert not (run_dir / "transcripts").exists()

    bundle, _ = _bundle(run_dir, tmp_path)
    denials = bundle["confineDenials"]

    assert FILE_ENVELOPE_ROW in denials, (
        "M2, leg (b): with no `workers/*/envelope.json` for this run, the "
        "file's `source: \"envelope\"` row is the only record of that denial "
        f"and is kept; got {denials!r}")
    assert denials == rows, (
        "M2, leg (b): with no envelope read, the file's lines are still "
        f"carried whole and in file order; got {denials!r}")


# ---------- M3, legs (c), (d), (e): the friction lens ----------

def test_the_friction_lens_says_each_denial_is_counted_once():
    """M3, leg (c): the first `Run:` — the friction item's text, joined with
    `tr`, matches `counted once` then `drops` then `envelope` then `hook`, in
    that order — exits 0."""
    proc = _shell(RUN_SAYS_COUNTED_ONCE)
    assert proc.returncode == 0, (
        "M3, leg (c): the `1. **friction**` item of "
        "skills/ultralearn/references/reading-lenses.md must say, in order, "
        "that each denial is `counted once`, that the harvester `drops` the "
        "file's `envelope` rows when it read the envelopes itself, and that "
        "the `hook` lines are kept.\n"
        f"stderr:\n{proc.stderr}")


def test_the_friction_lens_no_longer_says_never_the_total():
    """M3, leg (d): the second `Run:` exits 0 only when the phrase
    `never the total` is absent from the friction item — the overlap it warned
    about is reconciled by the harvester now, not by the reader."""
    proc = _shell(RUN_DROPS_NEVER_THE_TOTAL)
    assert proc.returncode == 0, (
        "M3, leg (d): the `1. **friction**` item must no longer contain the "
        "phrase `never the total`.\n"
        f"stderr:\n{proc.stderr}")
    joined = _shell(JOINED_DROPS_NEVER_THE_TOTAL)
    assert joined.returncode == 0, (
        "M3, leg (d): the phrase `never the total` must be gone from the "
        "`1. **friction**` item, not merely re-wrapped across two source "
        "lines — it is absent from the joined item too.\n"
        f"stderr:\n{joined.stderr}")


def test_the_friction_lens_no_longer_cites_23_lines_for_20_denials():
    """M3, leg (e): the third `Run:` exits 0 only when the phrase `23 lines`
    is absent from the friction item — the run-32-shaped arithmetic no longer
    describes what the bundle holds."""
    proc = _shell(RUN_DROPS_23_LINES)
    assert proc.returncode == 0, (
        "M3, leg (e): the `1. **friction**` item must no longer contain the "
        "phrase `23 lines`.\n"
        f"stderr:\n{proc.stderr}")
    joined = _shell(JOINED_DROPS_23_LINES)
    assert joined.returncode == 0, (
        "M3, leg (e): the phrase `23 lines` must be gone from the "
        "`1. **friction**` item, not merely re-wrapped across two source "
        "lines — it is absent from the joined item too.\n"
        f"stderr:\n{joined.stderr}")
