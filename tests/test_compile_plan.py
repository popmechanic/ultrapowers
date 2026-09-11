"""compile_plan.py turns a marked plan into the Step-3 transparency block,
deterministically. These are the tests of the machinery both grammars share
(the Files block and its strict refusals, fences and headings, wave labels,
--emit-launch/--emit-args, Interfaces placeholders, the **Review:** values,
gate classification, Global Constraints); the tests of the ordering and
classification the claims-v1 grammar refuses outright left with the compiler
tier cut of 2026-09-11."""
import json
import pathlib
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
from compile_plan import FILES_EXEMPT_MARKERS  # noqa: E402

def _run_compiler(path, *extra):
    """Run the compiler on `path`; returns the CompletedProcess."""
    return subprocess.run(
        [sys.executable, str(COMPILER), str(path)] + list(extra),
        capture_output=True, text=True)


def compile_plan(path):
    p = _run_compiler(path)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def compile_plan_serialize(path):
    """Explicit-serialize compile: for tests pinning serialize-mode contention
    semantics (same-file writers serialize), which remain fully supported after
    the spec-§5 default flip to fold."""
    p = _run_compiler(path, "--overlap", "serialize")
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def compile_plan_raw(path):
    return _run_compiler(path)


def compile_plan_raw_with(path, extra):
    return _run_compiler(path, *extra)


def test_duplicate_task_ids_are_a_loud_error(tmp_path):
    plan = tmp_path / "dup.md"
    plan.write_text(
        "# Plan: Dup\n\n"
        "### Task 1: first\n\n**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n\n"
        "### Task 1: second\n\n**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    p = compile_plan_raw(plan)
    assert p.returncode == 1
    assert "duplicate task id" in p.stderr
    assert "cycle" not in p.stderr.lower()


def test_backward_write_after_create_compiles_without_cycle(tmp_path):
    plan = tmp_path / "wac-back.md"
    plan.write_text(
        "# Plan: WAC backward\n\n"
        "### Task A: modifier first\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `f.py`\n\n- [ ] **Step 1:** edit f\n\n"
        "### Task B: creator second\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `f.py`\n\n- [ ] **Step 1:** create f\n"
    )
    out = compile_plan(plan)   # must NOT exit 1 with a spurious cycle
    assert {"from": "B", "to": "A", "why": "write-after-create"} in out["dag_edges"]
    assert not any(e["from"] == "A" and e["to"] == "B" for e in out["dag_edges"])
    assert out["waves"] == [["B"], ["A"]]


def test_genuine_cycle_still_errors(tmp_path):
    # Each task creates the file the other modifies, so the surviving semantic
    # tier (write-after-create — un-cycle-guarded by design) records both
    # directions. That is a real plan contradiction, not a guess.
    plan = tmp_path / "genuine.md"
    plan.write_text(
        "# Plan: Genuine cycle\n\n"
        "### Task A: needs B's file\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.out`\n- Modify: `b.out`\n\n- [ ] **Step 1:** a\n\n"
        "### Task B: needs A's file\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.out`\n- Modify: `a.out`\n\n- [ ] **Step 1:** b\n"
    )
    p = compile_plan_raw(plan)
    assert p.returncode == 1
    assert "cycle" in p.stderr.lower()


def test_tilde_fenced_heading_is_content_not_a_task(tmp_path):
    plan = tmp_path / "tilde.md"
    plan.write_text(
        "# Plan: Tilde\n\n"
        "### Task A: embeds an example\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.txt`\n\n"
        "- [ ] **Step 1:** document the format:\n\n"
        "~~~markdown\n### Task 42: fenced by tildes, not a task\n~~~\n\n"
        "### Task B: second\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    assert [t["id"] for t in out["tasks"]] == ["A", "B"]


def test_wave_labels_are_derived_per_wave(tmp_path):
    # compile emits a deterministic, meaningful label per wave (single source the
    # engine reads via args.waveLabels and the swarm viewer reads from build_dag).
    plan = tmp_path / "wl.md"
    plan.write_text(
        "# Plan: WL\n\n**Acceptance:** suite — pytest\n\n"
        "### Task 1: Data layer\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `src/db.js`\n\n**Interfaces:**\n- Produces: `x`\n\n- [ ] **Step 1:** a\n\n"
        "### Task 2: Contacts module\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `src/contacts.js`\n\n**Interfaces:**\n- Consumes: `x`\n\n- [ ] **Step 1:** b\n\n"
        "### Task 3: Deals module\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `src/deals.js`\n\n**Interfaces:**\n- Consumes: `x`\n\n- [ ] **Step 1:** c\n"
    )
    out = compile_plan(plan)
    labels = out["waveLabels"]
    assert len(labels) == len(out["waves"])
    # wave 1 = [Task 1] single → its title; wave 2 = [Task 2, Task 3] share "module" → "2 Modules"
    assert labels[0] == "Data layer"
    assert "2 Modules" in labels


def test_zero_implementation_plan_warns_loudly(tmp_path):
    plan = tmp_path / "zeroimpl.md"
    plan.write_text(
        "# Plan: Gates only\n\n"
        "### Task A: suite gate\n\n**Type:** gate\n\n"
        "**Files:** none\n\n- [ ] **Step 1:** Run: `pytest -q`\n"
    )
    p = compile_plan_raw(plan)
    assert p.returncode == 0
    assert "no implementation tasks" in p.stderr
    import json as _json
    assert _json.loads(p.stdout)["waves"] == []


def test_tilde_wrapper_with_backtick_inner_keeps_following_task(tmp_path):
    # Regression: a tilde fence (~~~) wrapping a backtick example (```bash ... ```)
    # must close cleanly so a following task is still parsed. A nesting tracker that
    # compares closers against the OUTERMOST frame instead of the innermost leaves
    # the outer ~~~ open forever and silently drops Task B.
    plan = tmp_path / "tildewrap.md"
    plan.write_text(
        "# Plan: Tilde wrapper\n\n"
        "### Task A: documents a shell example inside a tilde wrapper\n\n"
        "**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.txt`\n\n"
        "- [ ] **Step 1:** show the deploy command:\n\n"
        "~~~\n"
        "```bash\n"
        "git push origin main\n"
        "```\n"
        "~~~\n\n"
        "### Task B: still here\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    assert [t["id"] for t in out["tasks"]] == ["A", "B"]
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["A"]["disposition"] == "implementation"   # fenced git push inert


def test_blank_line_closes_the_files_block(tmp_path):
    plan = tmp_path / "blankfiles.md"
    plan.write_text(
        "# Plan: Blank closes files\n\n"
        "### Task A: writer\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.txt`\n\n"
        "- Test: run the suite manually against `x.txt`\n\n"
        "- [ ] **Step 1:** a\n\n"
        "### Task B: independent\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `x.txt`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    # The dash bullet after the blank line is prose, not a Files entry: no
    # phantom 'run' or 'x.txt' read for task A — so nothing orders the pair.
    assert by_id["A"]["writes"] == ["a.txt"]
    assert out["dag_edges"] == []


def test_blank_after_files_header_does_not_discard_entries(tmp_path):
    plan = tmp_path / "blankhead.md"
    plan.write_text(
        "# Plan: Blank after Files\n\n"
        "### Task A: spaced formatting\n\n**Type:** implementation\n\n"
        "**Files:**\n\n- Create: `parser.py`\n\n- [ ] **Step 1:** a\n\n"
        "### Task B: modifier\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `parser.py`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["A"]["writes"] == ["parser.py"]
    assert {"from": "A", "to": "B", "why": "write-after-create"} in out["dag_edges"]


def test_indented_valid_heading_is_a_real_task(tmp_path):
    plan = tmp_path / "indenthead.md"
    plan.write_text(
        "# Plan: Indented heading\n\n"
        "### Task 1: first\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n\n"
        " ### Task 2: one leading space, still a CommonMark heading\n\n"
        "**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    assert [t["id"] for t in out["tasks"]] == ["1", "2"]
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["1"]["writes"] == ["a.txt"]      # task 2's files did NOT fold in
    assert by_id["2"]["writes"] == ["b.txt"]


# The malformed-heading net: every case routes to the single frozen heading
# diagnostic. must_raw is checked against stderr as-is, must_lower against
# stderr.lower(), absent_raw must NOT appear. FROZEN vocabulary — needles
# change only for an eval-measured regression.
HEADING_CASES = [
    pytest.param("### Task 1.5: dotted id folds away silently today",
                 ["1.5"], ["heading"], [], id="dotted-id"),
    pytest.param("#### Task 2: four hashes",
                 [], ["heading"], [], id="four-hashes"),
    pytest.param("##### Task 2: five hashes",
                 [], ["heading"], [], id="five-hashes"),
    pytest.param("####Task 2: four hashes no space",
                 ["EXACTLY three hashes"], [], [], id="no-space"),
    pytest.param("## Task 2: two hashes",
                 ["EXACTLY three hashes"], ["did you mean"], [],
                 id="two-hashes-hint"),
    # `### TASK 2:` is the right level (three hashes); the fault is the case,
    # so the three-hash hint must NOT fire (it would mislead).
    pytest.param("### TASK 2: all caps",
                 [], ["heading"], ["EXACTLY three hashes"], id="caps-no-hint"),
    # `## Task 2:` would fold its content into the previous task silently —
    # the net must keep refusing it, naming the heading "not recognized".
    pytest.param("## Task 2: mis-leveled",
                 ["not recognized"], [], [], id="mis-leveled-refuses"),
]


@pytest.mark.parametrize("bad,must_raw,must_lower,absent_raw", HEADING_CASES)
def test_bad_task_heading_diagnostics(tmp_path, bad, must_raw, must_lower,
                                      absent_raw):
    plan = tmp_path / "badhead.md"
    plan.write_text(
        "# Plan: Bad heading\n\n"
        "### Task 1: first\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.py`\n\n- [ ] **Step 1:** a\n\n"
        + bad + "\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.py`\n\n- [ ] **Step 1:** b\n"
    )
    p = compile_plan_raw(plan)
    assert p.returncode == 1, bad
    for needle in must_raw:
        assert needle in p.stderr, (bad, needle, p.stderr)
    for needle in must_lower:
        assert needle in p.stderr.lower(), (bad, needle, p.stderr)
    for needle in absent_raw:
        assert needle not in p.stderr, (bad, needle, p.stderr)


def test_lowercase_files_label_is_a_loud_violation(tmp_path):
    # #85: a wrong-case label (`- modify:`) is an unknown label under the strict
    # grammar — a loud compile error with a did-you-mean, not a silent near-miss.
    plan = tmp_path / "lowerlabel.md"
    plan.write_text(
        "# Plan: Lowercase label\n\n"
        "### Task 1: lowercase label\n\n**Type:** implementation\n\n"
        "**Files:**\n- modify: `shared.py`\n\n- [ ] **Step 1:** b\n"
    )
    p = compile_plan_raw(plan)
    assert p.returncode == 1
    assert "modify" in p.stderr and "Create/Modify/Test" in p.stderr


def test_section_titles_with_task_word_stay_legal(tmp_path):
    plan = tmp_path / "sections.md"
    plan.write_text(
        "# Plan: Sections\n\n"
        "## Tasks\n\n## Task Structure\n\n"
        "### Task 1: only\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.py`\n\n- [ ] **Step 1:** a\n"
    )
    out = compile_plan(plan)
    assert [t["id"] for t in out["tasks"]] == ["1"]


def test_asterisk_bullet_files_entry_keeps_block_open(tmp_path):
    # A `* Modify:` bullet (wrong bullet char) is not a canonical entry, but the
    # Files block stays open so a valid `- Modify:` entry after it still parses.
    plan = tmp_path / "starbullet.md"
    plan.write_text(
        "# Plan: Star bullet\n\n"
        "### Task 1: mixed bullets\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.py`\n* Modify: `b.py`\n- Modify: `c.py`\n\n"
        "- [ ] **Step 1:** a\n\n"
        "### Task 2: writer\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `b.py`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    assert "c.py" in by_id["1"]["writes"]          # valid entry after the star survives


def test_unparsed_bullets_in_files_block_surface_and_keep_block_open(tmp_path):
    # #85: an unknown Files label (`- Remove:`) is now a LOUD compile error with a
    # did-you-mean, not a silent near-miss drop. (A colon-less natural-English
    # bullet stays a soft near-miss, but the Remove violation bails first.) Same
    # scenario as the old tolerant pin, flipped to the strict grammar. `Delete:`
    # became canonical at #896, so the example unknown label is `Remove:`.
    plan = tmp_path / "bullets.md"
    plan.write_text(
        "# Plan: Unparsed bullets\n\n"
        "### Task 1: unknown label\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify `src/app.py` to wire it in\n- Remove: `old.py`\n- Modify: `keep.py`\n\n"
        "- [ ] **Step 1:** a\n\n"
        "### Task 2: writer\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `src/app.py`\n\n- [ ] **Step 1:** b\n"
    )
    p = compile_plan_raw(plan)
    assert p.returncode == 1
    assert "Remove" in p.stderr and "old.py" in p.stderr
    assert "Delete" in p.stderr      # the did-you-mean suggestion


def test_prosey_unbackticked_value_is_not_a_phantom_path(tmp_path):
    plan = tmp_path / "phantom.md"
    plan.write_text(
        "# Plan: Phantom\n\n"
        "### Task 1: prose test line\n\n**Type:** implementation\n\n"
        "**Files:**\n- Test: run pytest manually and confirm green\n\n- [ ] **Step 1:** a\n\n"
        "### Task 2: other\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    p = compile_plan_raw(plan)
    # 'run' must not become a phantom read path — and the proof is that the
    # Files-less refusal fires on task 1: had the prose token been admitted,
    # the task would carry a path and compile.
    assert p.returncode == 1
    assert "Task 1: implementation task declares no file paths" in p.stderr


def test_all_wrong_level_plan_gets_the_heading_diagnostic(tmp_path):
    plan = tmp_path / "h2only.md"
    plan.write_text(
        "# Plan: Legacy levels\n\n"
        "## Task 1: first\n\n**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n\n"
        "## Task 2: second\n\n**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    p = compile_plan_raw(plan)
    assert p.returncode == 1
    assert "## Task 1:" in p.stderr           # the diagnostic NAMES the heading (not the generic bail)


# ---------------------------------------------------------------------------
# Text-based compile helpers (thin wrappers to avoid duplicating subprocess logic)
# ---------------------------------------------------------------------------

def _with_plan_file(plan_md, fn):
    """Write `plan_md` to a temp .md file, call `fn(path)`, always clean up."""
    import tempfile, os
    fd, p = tempfile.mkstemp(suffix=".md"); os.close(fd)
    pathlib.Path(p).write_text(plan_md)
    try:
        return fn(pathlib.Path(p))
    finally:
        pathlib.Path(p).unlink(missing_ok=True)


def compile_plan_text(plan_md):
    return _with_plan_file(plan_md, compile_plan)


def _serialize_text(plan_md):
    return _with_plan_file(plan_md, compile_plan_serialize)


def compile_raw_text(plan_md):
    return _with_plan_file(plan_md, compile_plan_raw)


# ---------------------------------------------------------------------------
# Problem 3: writes parsing must count only path-like tokens
# ---------------------------------------------------------------------------

def test_modify_function_names_and_routes_are_not_writes(tmp_path):
    # A Modify block naming functions, and a body mentioning API routes, must not
    # land in `writes` — bare identifiers and routes are not files, and treating
    # them as writes fabricates spurious overlap edges between unrelated tasks.
    plan = tmp_path / "funcs.md"
    plan.write_text(
        "# Plan: Functions and routes\n\n"
        "### Task 1: parser\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `cmd_apply_create`, `_build_parser`\n- Modify: `apistub/cli.py`\n\n"
        "- [ ] **Step 1:** Wire the `/api/ledger` and `/api/session/start` routes into `apistub/cli.py`.\n\n"
        "### Task 2: handlers\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `apistub/handlers.py`\n\n"
        "- [ ] **Step 1:** Implement the `/api/ledger` handler.\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    # Only the real path is a write; functions and routes are dropped.
    assert by_id["1"]["writes"] == ["apistub/cli.py"]
    assert "cmd_apply_create" not in by_id["1"]["writes"]
    assert "_build_parser" not in by_id["1"]["writes"]
    assert not any("/api/" in w for w in by_id["1"]["writes"])
    # The two tasks edit disjoint real files -> no fabricated edge of ANY kind.
    assert out["dag_edges"] == []
    assert out["waves"] == [["1", "2"]]


def test_extensionless_real_files_are_kept_identifiers_dropped(tmp_path):
    # Bare conventional filenames (Capitalized / ALL-CAPS, no dot, no underscore)
    # ARE files and must keep their write-after-write overlap; snake_case
    # identifiers and dotted attribute refs are not files and are dropped.
    plan = tmp_path / "makef.md"
    plan.write_text(
        "# Plan: Makefile\n\n"
        "### Task 1: edits the build files\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `Makefile`, `Dockerfile`, `LICENSE`\n- Modify: `helper_func`, `schema.User`\n\n"
        "- [ ] **Step 1:** a\n\n"
        "### Task 2: also edits Makefile\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `Makefile`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan_serialize(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["1"]["writes"] == ["Dockerfile", "LICENSE", "Makefile"]  # real files kept
    assert "helper_func" not in by_id["1"]["writes"]   # snake_case identifier dropped
    assert "schema.User" not in by_id["1"]["writes"]   # dotted attribute ref dropped
    # the shared Makefile produces a real overlap edge (not lost to identifier noise)
    assert {"from": "1", "to": "2", "why": "write-after-write"} in out["dag_edges"]


def test_dotted_attribute_ref_is_not_a_write(tmp_path):
    # `schema.User` (CamelCase attribute) must not be admitted as a write — that
    # was the P3 gap: extension-only detection treated `.User` as an extension.
    plan = tmp_path / "attr.md"
    plan.write_text(
        "# Plan: Attr ref\n\n"
        "### Task 1: returns a model\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `schema.User`, `Foo.Bar`\n- Modify: `apistub/schema.py`\n\n"
        "- [ ] **Step 1:** a\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["1"]["writes"] == ["apistub/schema.py"]
    # ... and the dropped identifiers fabricate no edge of any kind.
    assert out["dag_edges"] == []


def test_inline_files_all_nonpath_tokens_have_no_writes(tmp_path):
    # An inline **Files:** line whose backticked tokens are all non-path
    # identifiers contributes no writes — so a marked implementation task
    # written that way is refused as Files-less rather than compiling with an
    # invisible write set.
    plan = tmp_path / "inlinemiss.md"
    plan.write_text(
        "# Plan: Inline nonpath\n\n"
        "### Task 1: only identifiers\n\n**Type:** implementation\n\n"
        "**Files:** `cmd_foo` `cmd_bar`\n\n- [ ] **Step 1:** a\n"
    )
    p = compile_plan_raw(plan)
    assert p.returncode == 1
    assert "Task 1: implementation task declares no file paths" in p.stderr


# ---------------------------------------------------------------------------
# Problem 1 / 2: launch-ready task objects (single source of truth) + emit-launch
# ---------------------------------------------------------------------------

LAUNCH_PLAN = (
    "# Demo Implementation Plan\n\n"
    "**Acceptance:** waived — demo\n\n"
    "### Task 1: schema\n\n**Type:** implementation\n\n"
    "**Files:**\n- Create: `apistub/schema.py`\n- Test: `tests/test_schema.py`\n\n"
    "- [ ] **Step 1:** Define the `User` dataclass.\n\n"
    "### Task 2: store\n\n**Type:** implementation\n\n"
    "**Files:**\n- Create: `apistub/store.py`\n- Modify: `apistub/schema.py`\n\n"
    "- [ ] **Step 1:** Build the store on top of the schema.\n"
)
# Task 2 modifies the file Task 1 creates, so the 1 -> 2 edge is derived from
# the Files blocks — ordering is never declared in a task body.


def test_emit_launch_writes_verbatim_bodies(tmp_path):
    plan = tmp_path / "launch.md"
    plan.write_text(LAUNCH_PLAN)
    launch = tmp_path / "out" / "waves.json"   # parent dir does not exist yet
    p = subprocess.run([sys.executable, str(COMPILER), str(plan),
                        "--emit-launch", str(launch)],
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    out = json.loads(p.stdout)
    assert out["launch_file"] == str(launch)
    payload = json.loads(launch.read_text())
    # full, verbatim, fence-aware bodies — one entry per implementation task, by id
    ids = [t["id"] for t in payload["tasks"]]
    assert ids == ["1", "2"]
    body1 = next(t["body"] for t in payload["tasks"] if t["id"] == "1")
    assert "### Task 1: schema" in body1            # verbatim, includes the heading
    assert "Define the `User` dataclass." in body1
    assert payload["edges"] == [["1", "2"]]
    assert payload["waves"] == out["waves"]
    # files carried for FILES-scope/sibling threading
    assert next(t for t in payload["tasks"] if t["id"] == "1")["files"] == \
        ["apistub/schema.py", "tests/test_schema.py"]


def test_emit_launch_preserves_fenced_headings_in_bodies(tmp_path):
    # A `### Task 99:` inside a code fence is content, not a task; the verbatim
    # body the compiler writes must keep it intact (fence-aware extraction).
    plan = tmp_path / "fenced.md"
    plan.write_text(
        "# Demo Implementation Plan\n\n"
        "**Acceptance:** waived — demo\n\n"
        "### Task 1: documents a format\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.txt`\n\n"
        "- [ ] **Step 1:** embed this example:\n\n"
        "```markdown\n### Task 99: not a real task\n```\n"
    )
    launch = tmp_path / "waves.json"
    p = subprocess.run([sys.executable, str(COMPILER), str(plan),
                        "--emit-launch", str(launch)], capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    payload = json.loads(launch.read_text())
    assert [t["id"] for t in payload["tasks"]] == ["1"]   # 99 stayed fenced content
    assert "### Task 99: not a real task" in payload["tasks"][0]["body"]


def test_emit_launch_is_opt_in(tmp_path):
    # Without the flag, no launch_file key and no file written (back-compat).
    plan = tmp_path / "launch.md"
    plan.write_text(LAUNCH_PLAN)
    out = compile_plan(plan)
    assert "launch_file" not in out
    assert "launch_waves" in out            # the light grouping is always present


def test_global_constraints_and_interfaces_parse_into_new_fields(tmp_path):
    plan = tmp_path / "v6.md"
    plan.write_text(
        "# Plan: V6 blocks\n\n"
        "**Acceptance:** waived — inline test plan\n\n"
        "## Global Constraints\n\n"
        "- Python 3.11+ only; no new third-party deps.\n"
        "- All public names use snake_case.\n\n"
        "---\n\n"
        "### Task 1: schema\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `apistub/schema.py`\n\n"
        "**Interfaces:**\n"
        "- Produces: `User` dataclass (id: int, name: str, email: str)\n"
        "- Produces: `FIELDS` dict\n\n"
        "- [ ] **Step 1:** write schema\n\n"
        "### Task 2: store\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `apistub/store.py`\n\n"
        "**Interfaces:**\n"
        "- Consumes: `User` dataclass (id: int, name: str, email: str)\n\n"
        "- [ ] **Step 1:** write store\n"
    )
    out = compile_plan(plan)
    # Top-level Global Constraints captured verbatim (body only, header stripped).
    assert "Python 3.11+ only; no new third-party deps." in out["globalConstraints"]
    assert "All public names use snake_case." in out["globalConstraints"]
    assert "## Global Constraints" not in out["globalConstraints"]
    # Per-task interfaces, preserving the text after the Consumes:/Produces: label.
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["1"]["interfaces"]["produces"] == [
        "`User` dataclass (id: int, name: str, email: str)",
        "`FIELDS` dict",
    ]
    assert by_id["1"]["interfaces"]["consumes"] == []
    assert by_id["2"]["interfaces"]["consumes"] == [
        "`User` dataclass (id: int, name: str, email: str)",
    ]
    assert by_id["2"]["interfaces"]["produces"] == []
    # The fields ride into the launch-ready objects the engine consumes.
    lw_by_id = {t["id"]: t for wave in out["launch_waves"] for t in wave}
    assert lw_by_id["1"]["interfaces"]["produces"][0].startswith("`User` dataclass")
    # The Interfaces sub-lines are NOT mis-read as malformed Files entries.
    assert not any(c["task"] in ("1", "2") and "Files" in c["note"]
                   for c in out["marker_conflicts"])
    # And they did not leak into the write sets (Files parsing stopped cleanly).
    assert by_id["1"]["writes"] == ["apistub/schema.py"]
    assert by_id["2"]["writes"] == ["apistub/store.py"]


def test_interfaces_consumes_line_is_not_a_files_entry(tmp_path):
    plan = tmp_path / "exempt.md"
    plan.write_text(
        "# Plan: Exemption\n\n"
        "**Acceptance:** waived — inline test plan\n\n"
        "### Task 1: consumer\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `app.py`\n\n"
        "**Interfaces:**\n"
        "- Consumes: `validate_payload(payload) -> list[str]`\n"
        "- Produces: `route(store, method, path, payload=None)`\n\n"
        "- [ ] **Step 1:** wire it\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["1"]["interfaces"]["consumes"] == [
        "`validate_payload(payload) -> list[str]`"]
    assert by_id["1"]["interfaces"]["produces"] == [
        "`route(store, method, path, payload=None)`"]
    assert by_id["1"]["writes"] == ["app.py"]
    assert not any(c["task"] == "1" and "Files" in c["note"]
                   for c in out["marker_conflicts"])


EVAL_FLAWED = ROOT / "evals/fixtures/flawed/plan.md"


def test_flawed_fixture_interface_edge_orders_task4_after_task1():
    out = compile_plan(EVAL_FLAWED)
    assert {"from": "1", "to": "4", "why": "interface"} in out["dag_edges"]
    wave_of = {tid: i for i, wave in enumerate(out["waves"]) for tid in wave}
    assert wave_of["4"] > wave_of["1"]
    assert "4" not in out["waves"][0]


def test_interface_edge_requires_exact_token_match(tmp_path):
    plan = tmp_path / "nearmiss-iface.md"
    plan.write_text(
        "# Plan: Near-miss interface\n\n"
        "**Acceptance:** waived — inline test plan\n\n"
        "### Task 1: producer\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.py`\n\n"
        "**Interfaces:**\n- Produces: `User`\n\n"
        "- [ ] **Step 1:** a\n\n"
        "### Task 2: near consumer\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.py`\n\n"
        "**Interfaces:**\n- Consumes: `Users`\n\n"
        "- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    assert not any(e["why"] == "interface" for e in out["dag_edges"])
    assert not any(c.get("kind") == "undeclared-dependency"
                   for c in out["marker_conflicts"])
    assert out["waves"] == [["1", "2"]]


# ---------------------------------------------------------------------------
# Task 1 (grammar-hardening plan, issue #85): interface placeholders parse as
# empty; symbol-list violations. 2026-07-03 foreign-run regression: a
# 'Produces: nothing' / 'Consumes: nothing' pairing fabricated an interface
# edge (and an undeclared-dependency finding) out of pure authoring prose,
# wasting a wave. Placeholder Consumes/Produces values must never pair.
# ---------------------------------------------------------------------------

PLACEHOLDER_PLAN = """# P

**Acceptance:** suite — test

### Task 1: Cleanup

**Type:** implementation

**Files:**
- Modify: `data/fixtures.json`

**Interfaces:**
- Consumes: nothing
- Produces: nothing (test-data-only change)

- [ ] **Step 1: do it**

### Task 2: Leaf A

**Type:** implementation

**Files:**
- Modify: `src/a.py`

**Interfaces:**
- Consumes: nothing (standalone)
- Produces: `helper_a() -> str`

- [ ] **Step 1: do it**

### Task 3: Leaf B

**Type:** implementation

**Files:**
- Modify: `src/b.py`

**Interfaces:**
- Consumes: none
- Produces: `helper_b() -> str`

- [ ] **Step 1: do it**
"""


def test_placeholder_interfaces_produce_zero_edges():
    # 2026-07-03 foreign-run regression: 'Produces: nothing' paired with
    # 'Consumes: nothing' created two spurious edges and a wasted wave.
    out = compile_plan_text(PLACEHOLDER_PLAN)
    interface_edges = [e for e in out["dag_edges"] if e.get("why") == "interface"]
    assert interface_edges == []


def test_placeholder_token_set():
    from compile_plan import _interface_token
    for raw in ("nothing", "none", "N/A", "na", "nothing (test-data-only change)",
                "`nothing`", "none — standalone"):
        assert _interface_token(raw) == "", raw
    assert _interface_token("`User` dataclass (id: int)") == "User"
    assert _interface_token("validate_payload(payload) -> list[str]") == "validate_payload"


def test_symbol_lead_with_prose_tail_still_tokens():
    # The tokenizer hardening (#85 redirect): a SYMBOL lead tokens (a backticked
    # symbol, any prose tail allowed; or a bare identifier alone / immediately
    # followed by a `(`-signature, `->`, or `=`), but a bare word followed by
    # more prose words is documentation and can never pair.
    from compile_plan import _interface_token
    assert _interface_token("`User` dataclass (id, name)") == "User"
    assert _interface_token("compiler `**Review:**` marker semantics") == ""
    assert _interface_token("validate_payload(payload) -> list[str]") == "validate_payload"
    assert _interface_token("every task object in the file carries a key") == ""


PROSE_INTERFACE_PLAN = """# P

**Acceptance:** suite — test

### Task 1: Bake the reviewer prompt

**Type:** implementation

**Files:**
- Modify: `harnesses/waves.js`

**Interfaces:**
- Consumes: nothing
- Produces: the baked reviewer prompt instructs regenerate-and-byte-compare

- [ ] **Step 1: do it**

### Task 2: Rework the reviewer source

**Type:** implementation

**Files:**
- Modify: `references/reviewer-prompts.md`

**Interfaces:**
- Consumes: the reviewer-prompt source layout
- Produces: `helper() -> str`

- [ ] **Step 1: do it**
"""


def test_prose_interfaces_never_pair():
    # 2026-07-03 live incident (this cycle's redirect round): a leading bare
    # word 'the' tokenized identically across two prose Interfaces values, so
    # 'Produces: the baked reviewer prompt …' paired 'Consumes: the reviewer-
    # prompt source layout …' into a spurious interface edge that over-serialized
    # a real run. Prose contract descriptions are this repo's house style; they
    # must be structurally inert — zero interface edges, zero undeclared-
    # dependency findings.
    out = compile_plan_text(PROSE_INTERFACE_PLAN)
    assert [e for e in out["dag_edges"] if e.get("why") == "interface"] == []
    assert [c for c in out["marker_conflicts"]
            if c.get("kind") == "undeclared-dependency"] == []


# ---------------------------------------------------------------------------
# Strict Files grammar (#85): annotations, unknown labels, and globs are loud
# violations. An annotated Files line contributes NOTHING silently — it always
# surfaces with the extracted-path fix, so a same-wave write race can never hide
# behind a parenthetical (2026-07-03 foreign run: the two most contended files
# silently lost overlap coverage).
# ---------------------------------------------------------------------------

ANNOTATED_PLAN = """# P

**Acceptance:** suite — test

### Task 1: Shared file owner

**Type:** implementation

**Files:**
- Modify: `src/lib/db.js` (only the pool init, lines 12-40)

- [ ] **Step 1: do it**

### Task 2: Other writer

**Type:** implementation

**Files:**
- Modify: `src/lib/db.js`

- [ ] **Step 1: do it**
"""


def test_annotated_files_line_is_a_violation_with_extract_fix():
    from compile_plan import _files_violations
    v = _files_violations({"id": "1", "files_raw": [
        ("Modify", "`src/lib/db.js` (only the pool init, lines 12-40)")]})
    assert len(v) == 1
    assert "src/lib/db.js" in v[0]          # the extracted path is shown
    assert "annotation" in v[0].lower()      # named for what it is


def test_unknown_label_is_a_violation_with_did_you_mean():
    from compile_plan import _files_violations
    v = _files_violations({"id": "3", "files_raw": [("Remove", "`old/x.py`")]})
    assert len(v) == 1 and "Delete" in v[0]


def test_glob_is_a_violation():
    from compile_plan import _files_violations
    v = _files_violations({"id": "4", "files_raw": [("Modify", "`src/**/*.py`")]})
    assert len(v) == 1 and "enumerate" in v[0].lower()


def test_annotated_line_fails_plain_compile_loudly():
    # front-door: plain compile on a violating plan is a loud error, not a silent
    # overlap drop (#85). Adapted to the subprocess helper (compile_raw_text):
    # SystemExit surfaces as a non-zero exit with the path on stderr.
    r = compile_raw_text(ANNOTATED_PLAN)
    assert r.returncode != 0
    assert "src/lib/db.js" in r.stderr


def test_canonical_files_block_compiles_clean():
    # The strict gate must not fire on a canonical block: bare labels, backticked
    # paths, no annotation. Multiple backticked paths on one bullet and the
    # `- none` empty declaration both stay legal.
    plan = """# P

**Acceptance:** suite — test

### Task 1: writer

**Type:** implementation

**Files:**
- Create: `src/a.py`
- Modify: `src/b.py`

- [ ] **Step 1: do it**

### Task 2: gate

**Type:** gate

**Files:**
- None

- [ ] run pytest
"""
    out = compile_plan_text(plan)
    assert not [c for c in out["marker_conflicts"] if "annotation" in c["note"].lower()]
    assert "src/a.py" in {f for t in out["tasks"] for f in t["writes"]}


# ---------------------------------------------------------------------------
# Task 2: Files-label coverage (fixtures / bulleted None / dotfiles) +
# empty-writes build/QA -> gate classification (issue #65 family)
# ---------------------------------------------------------------------------

def test_files_parser_accepts_fixture_label_none_and_dotfiles():
    plan = '''# Plan: fixture/dotfile coverage

### Task 1: Build
**Type:** implementation

**Files:**
- Modify: `.gitignore`
- Test fixture(s): `evals/fixtures/x/plan.md`

- [ ] step
'''
    out = compile_plan_text(plan)
    t1 = {t["id"]: t for t in out["tasks"]}["1"]
    assert ".gitignore" in t1["writes"]
    assert "evals/fixtures/x/plan.md" in (t1["writes"] + t1.get("reads", []))
    assert not any("ignored" in c["note"] or "near" in c["note"].lower()
                   for c in out["marker_conflicts"] if c.get("task") == "1")


def test_bulleted_none_in_files_is_not_a_conflict():
    plan = '''# Plan: bulleted none

### Task 1: Verify
**Type:** gate

**Files:**
- None

- [ ] run pytest
'''
    out = compile_plan_text(plan)
    assert not any(c.get("task") == "1" for c in out["marker_conflicts"])


def test_empty_writes_buildqa_task_classifies_as_gate():
    plan = '''# Plan: empty-writes build/QA gate

### Task 1: Build the bundle
**Type:** implementation

**Files:**
- Create: `src/a.py`

- [ ] write code

### Task 2: Final verification
**Files:**
- None

- [ ] Run the full build and the QA acceptance check.
'''
    out = compile_plan_text(plan)
    t2 = {t["id"]: t for t in out["tasks"]}["2"]
    assert t2["disposition"] == "gate"
    assert "2" not in [e["to"] for e in out["dag_edges"] if e.get("why", "").startswith("ambiguous")]


# ---------------------------------------------------------------------------
# Task 3: compiler diagnostics — the bare `- None` Files entry.
# ---------------------------------------------------------------------------

def test_bare_none_files_entry_is_silent():
    """A gate task whose `**Files:**` block is only `- None` is an explicit
    empty-Files declaration: it must contribute no writes and raise no near-miss
    / marker_conflicts entry for the `- None` line ([76c7ef053adbf62e], #65)."""
    plan = '''# Plan: bare None Files

### Task 1: Build the module
**Type:** implementation

**Files:**
- Create: `a.txt`

- [ ] **Step 1:** write a

### Task 2: Suite gate
**Type:** gate

**Files:**
- None

- [ ] **Step 1:** run the full pytest suite
'''
    out = compile_plan_text(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    # The gate task's bare `- None` Files block contributes no writes ...
    assert by_id["2"]["writes"] == []
    # ... and surfaces no near-miss / marker_conflicts entry for that line.
    assert not any(c.get("task") == "2" for c in out["marker_conflicts"])
    assert not any(
        "None" in (c.get("note", "") + c.get("edge", ""))
        for c in out["marker_conflicts"])


def test_mixed_case_attr_ref_still_dropped_from_files(tmp_path):
    """`schema.User` in a Files entry is an identifier, not a path — it must
    stay dropped, or it fabricates overlap edges."""
    plan = tmp_path / "p.md"
    plan.write_text(
        "# Plan: Attr\n\n**Acceptance:** waived — inline\n\n"
        "### Task A: uses attr ref\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `schema.User`\n- Modify: `real.py`\n\n"
        "- [ ] **Step 1:** work\n")
    out = compile_plan(plan)
    a = next(t for t in out["tasks"] if t["id"] == "A")
    assert a["writes"] == ["real.py"]


def test_prose_section_heading_with_task_word_and_colon_compiles(tmp_path):
    """Fable review MEDIUM finding: `## Task tracking: overview` refused the
    whole plan with a misleading three-hashes hint."""
    plan = tmp_path / "p.md"
    plan.write_text(
        "# Plan: Sections\n\n**Acceptance:** waived — inline\n\n"
        "### Task A: real work\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `a.py`\n\n- [ ] **Step 1:** work\n\n"
        "## Task tracking: overview\n\nprose about tracking\n\n"
        "## Task list: what remains\n\nmore prose\n")
    out = compile_plan(plan)
    assert [t["id"] for t in out["tasks"]] == ["A"]


def test_global_constraints_stop_at_first_task_heading(tmp_path):
    """Found at launch of this very plan: a `## Global Constraints` section
    followed directly by `### Task` headings swallowed the entire rest of the
    document (54KB) into globalConstraints — which the engine then appends to
    every implementer/reviewer prompt."""
    plan = tmp_path / "p.md"
    plan.write_text(
        "# Plan: GC\n\n**Acceptance:** waived — inline\n\n"
        "## Global Constraints\n\n- Rule one.\n- Rule two.\n\n---\n\n"
        "### Task A: work\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `a.py`\n\n- [ ] **Step 1:** do it\n")
    out = compile_plan(plan)
    gc = out["globalConstraints"]
    assert "Rule one." in gc and "Rule two." in gc
    assert "Task A" not in gc and "Step 1" not in gc


def test_emit_args_writes_complete_launch_skeleton(tmp_path):
    launch = tmp_path / "waves.json"
    argsf = tmp_path / "args.json"
    p = compile_plan_raw_with(ROOT / "tests/fixtures/marked-plan.md",
                              ["--emit-launch", str(launch),
                               "--emit-args", str(argsf)])
    assert p.returncode == 0, p.stderr
    out = json.loads(p.stdout)
    skel = json.loads(argsf.read_text())
    assert skel["waves"] == out["launch_waves"]
    assert skel["wavesPath"] == str(launch.resolve())
    assert skel["edges"] == [[e["from"], e["to"]] for e in out["dag_edges"]]
    assert skel["dependencyEdges"] == [
        f"{e['from']} -> {e['to']} ({e['why']})" for e in out["dag_edges"]]
    assert skel["waveLabels"] == out["waveLabels"]
    assert skel["globalConstraints"] == out["globalConstraints"]
    assert pathlib.Path(skel["planPath"]).is_absolute()
    assert out["args_file"] == str(argsf)


def test_emit_args_requires_emit_launch(tmp_path):
    argsf = tmp_path / "args.json"
    p = compile_plan_raw_with(ROOT / "tests/fixtures/marked-plan.md",
                              ["--emit-args", str(argsf)])
    assert p.returncode != 0
    assert "--emit-args requires --emit-launch" in (p.stderr + p.stdout)
    assert not argsf.exists()


def sh(cmd, cwd=None, check=True):
    return subprocess.run(cmd, cwd=cwd, check=check, capture_output=True, text=True)


def test_emit_args_pre_emits_knob_slots(tmp_path):
    """Per-task knob slots ride the args wave entries — the object waves.js
    actually reads (#89: launch-file slots were filled but never consumed).
    tier is a null slot the orchestrator fills; review is plan-authored."""
    plan = tmp_path / "plan.md"
    plan.write_text(
        "# P\n\n**Acceptance:** waived — test fixture\n\n"
        "### Task 1: A\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.py`\n\n- [ ] **Step 1: do**\n\n"
        "### Task 2: B\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.py`\n\n- [ ] **Step 1: do**\n"
    )
    launch = tmp_path / "launch.json"
    args = tmp_path / "args.json"
    sh([sys.executable, str(COMPILER), str(plan),
        "--emit-launch", str(launch), "--emit-args", str(args)])
    skel = json.loads(args.read_text())
    entries = [t for wave in skel["waves"] for t in wave]
    assert entries, "no wave entries emitted"
    for t in entries:
        assert "tier" in t and t["tier"] is None
        assert t["review"] == "lean"


def test_emit_launch_carries_no_knob_slots(tmp_path):
    """The launch file is bodies + context only. A tier/review key here is
    the dual channel regrowing — the exact defect #89 removed."""
    plan = tmp_path / "plan.md"
    plan.write_text(
        "# P\n\n**Acceptance:** waived — test fixture\n\n"
        "### Task 1: A\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.py`\n\n- [ ] **Step 1: do**\n"
    )
    launch = tmp_path / "launch.json"
    args = tmp_path / "args.json"
    sh([sys.executable, str(COMPILER), str(plan),
        "--emit-launch", str(launch), "--emit-args", str(args)])
    payload = json.loads(launch.read_text())
    assert payload["tasks"], "no tasks emitted"
    for t in payload["tasks"]:
        assert "tier" not in t and "review" not in t


# ---------------------------------------------------------------------------
# **Review:** marker (#87) — authored review-depth slot, pre-emitted like tier
# ---------------------------------------------------------------------------

REVIEW_PLAN = """# P

**Acceptance:** suite — test

### Task 1: Risky core

**Type:** implementation
**Review:** adversarial

**Files:**
- Modify: `src/a.py`

- [ ] **Step 1: do it**

### Task 2: Quiet follower

**Type:** implementation

**Files:**
- Modify: `src/b.py`

- [ ] **Step 1: do it**
"""


def _emit_launch_payload(tmp_path, plan_markdown, name="plan.md"):
    """Write plan_markdown to tmp_path and compile it with --emit-launch,
    returning the parsed launch-file payload. Asserts a clean compile —
    callers that expect a compile error use _compile_raw instead."""
    plan = tmp_path / name
    plan.write_text(plan_markdown)
    launch = tmp_path / "launch.json"
    p = sh([sys.executable, str(COMPILER), str(plan),
            "--emit-launch", str(launch)])
    assert p.returncode == 0, p.stderr
    return json.loads(launch.read_text())


def _emit_args_entries(tmp_path, plan_markdown, name="plan.md"):
    """Compile plan_markdown with --emit-launch/--emit-args and return the
    args skeleton's wave entries keyed by task id — the knob channel the
    engine reads (#89). Asserts a clean compile."""
    plan = tmp_path / name
    plan.write_text(plan_markdown)
    launch = tmp_path / "launch.json"
    argsf = tmp_path / "args.json"
    p = sh([sys.executable, str(COMPILER), str(plan),
            "--emit-launch", str(launch), "--emit-args", str(argsf)])
    assert p.returncode == 0, p.stderr
    skel = json.loads(argsf.read_text())
    return {t["id"]: t for wave in skel["waves"] for t in wave}


def _compile_raw(tmp_path, plan_markdown, name="plan.md"):
    """Write plan_markdown to tmp_path and run the compiler, returning the
    completed subprocess (non-zero exit allowed, not checked here)."""
    plan = tmp_path / name
    plan.write_text(plan_markdown)
    return sh([sys.executable, str(COMPILER), str(plan)], check=False)


def test_review_marker_emits_adversarial_slot(tmp_path):
    # #556: `adversarial` is still an accepted marker value, but it is the
    # legacy spelling — the wave entry carries the documented `peer`.
    by_id = _emit_args_entries(tmp_path, REVIEW_PLAN)
    assert by_id["1"]["review"] == "peer"


def test_unmarked_task_emits_lean_review_slot(tmp_path):
    by_id = _emit_args_entries(tmp_path, REVIEW_PLAN)
    assert by_id["2"]["review"] == "lean"


def test_invalid_review_value_is_a_compile_error(tmp_path):
    bad = REVIEW_PLAN.replace("**Review:** adversarial", "**Review:** paranoid")
    p = _compile_raw(tmp_path, bad, name="bad.md")
    assert p.returncode != 0
    assert "Task 1" in p.stderr and "adversarial" in p.stderr and "lean" in p.stderr


def test_duplicate_review_marker_is_a_compile_error(tmp_path):
    dup = REVIEW_PLAN.replace(
        "**Review:** adversarial",
        "**Review:** adversarial\n**Review:** lean")
    p = _compile_raw(tmp_path, dup, name="dup.md")
    assert p.returncode != 0
    assert "duplicate" in p.stderr.lower() and "Task 1" in p.stderr


# Cases are LITERAL, not derived from FILES_EXEMPT_MARKERS: a parametrization
# that reads the constant shrinks with it and goes vacuously green on exactly
# the narrowing it exists to catch.
@pytest.mark.parametrize("marker", ["gate", "manual", "release"])
def test_exempt_marker_files_noise_does_not_block_compile(tmp_path, marker):
    # Parametrized over the WHOLE exemption set, not gate alone: dropping
    # `manual` or `release` from FILES_EXEMPT_MARKERS is a narrowing that a
    # gate-only test could not see, and it would start blocking compiles on
    # plans whose non-implementation tasks carry placeholder Files text.
    plan = tmp_path / "p.md"
    plan.write_text(
        "# P\n\n**Acceptance:** waived — test\n\n"
        "### Task 1: A\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.py`\n\n- [ ] **Step 1: do**\n\n"
        "### Task 2: Exempt\n\n**Type:** %s\n\n"
        "**Files:**\n- Verify: `(none)`\n\n- [ ] **Step 1: run the suite**\n"
        % marker)
    out = compile_plan(plan)
    assert out["waves"] == [["1"]]


def test_files_exempt_markers_is_exactly_the_non_implementation_set():
    # The parametrization above lists its cases LITERALLY (so it catches a
    # NARROWING of the set); an ADDITION to the constant would silently widen
    # the exemption without any test noticing. This literal membership pin
    # catches the widening.
    assert FILES_EXEMPT_MARKERS == frozenset({"gate", "manual", "release"})


def test_implementation_files_noise_still_blocks_compile(tmp_path):
    plan = tmp_path / "p.md"
    plan.write_text(
        "# P\n\n**Acceptance:** waived — test\n\n"
        "### Task 1: A\n\n**Type:** implementation\n\n"
        "**Files:**\n- Tweak: `a.py`\n\n- [ ] **Step 1: do**\n")
    p = compile_plan_raw(plan)
    assert p.returncode != 0
    assert "unknown files label" in (p.stdout + p.stderr).lower()


# ---------------------------------------------------------------------------
# Compiler subtraction (spec 2026-08-18 §2a): the ordering-guess tiers are
# gone, so what the compiler cannot see it REFUSES instead of serializing on a
# guess. Three refusals carry that weight — a Files-less marked implementation
# task, a brace glob, and the retired `catch-all` label.
# ---------------------------------------------------------------------------

PLAN_HEADER = "# Plan: grammar refusals\n\n**Acceptance:** waived — inline test plan\n\n"


def test_files_less_marked_implementation_task_is_refused(tmp_path):
    plan = tmp_path / "p.md"
    plan.write_text(PLAN_HEADER + """### Task 1: A
**Type:** implementation

**Files:**
- none

- [ ] **Step 1: do it**
""")
    proc = compile_plan_raw(plan)
    assert proc.returncode != 0
    assert "declares no file paths under Files:" in proc.stderr


def test_test_only_files_block_satisfies_the_refusal(tmp_path):
    # Two archived marked plans carry Test-only implementation tasks — a
    # `Test:` path is a declared path, so they stay OK.
    plan = tmp_path / "p.md"
    plan.write_text(PLAN_HEADER + """### Task 1: A
**Type:** implementation

**Files:**
- Test: `tests/test_a.py`

- [ ] **Step 1: verify**
""")
    proc = compile_plan_raw(plan)
    assert proc.returncode == 0, proc.stderr


def test_brace_glob_is_a_hard_violation(tmp_path):
    # A `{a,b}` brace used to fall through to the soft ambiguous-files
    # serialization; that tier is gone, so every glob char now bails.
    plan = tmp_path / "p.md"
    plan.write_text(PLAN_HEADER + """### Task 1: A
**Type:** implementation

**Files:**
- Modify: `src/{a,b}.py`

- [ ] **Step 1: do it**
""")
    proc = compile_plan_raw(plan)
    assert proc.returncode != 0
    assert "glob" in proc.stderr


def test_catch_all_label_is_a_violation_with_did_you_mean(tmp_path):
    # `- catch-all:` was a parsed construct; the tier that consumed it is gone,
    # so the bullet is now just an unknown label with a did-you-mean fix.
    plan = tmp_path / "p.md"
    plan.write_text(PLAN_HEADER + """### Task 1: A
**Type:** implementation

**Files:**
- catch-all: `src/`

- [ ] **Step 1: do it**
""")
    proc = compile_plan_raw(plan)
    assert proc.returncode != 0
    assert "Task 1: unknown Files label 'catch-all' for `src/` — use Modify" in proc.stderr


KEPT_EDGE_WHYS = {"marker", "text", "interface", "write-after-create"}


def test_compiled_edge_vocabulary_is_the_kept_set(tmp_path):
    # Every `why` the compiler can emit under the shipped default, across the
    # whole committed fixture corpus: the four kept labels and nothing else.
    # `write-after-write` appears only under the `serialize` rollback knob.
    fixtures = sorted((ROOT / "evals/fixtures").glob("*/plan.md"))
    assert fixtures, "eval fixture plans must be part of the pin"
    seen = set()
    for plan in fixtures + [ROOT / "tests/fixtures/marked-plan.md"]:
        seen |= {e["why"] for e in compile_plan(plan)["dag_edges"]}
    assert seen <= KEPT_EDGE_WHYS, seen - KEPT_EDGE_WHYS


def test_uppercase_extension_path_stays_in_write_set():
    # Orphaned by the tier-test deletion (was a Fable-review HIGH regression
    # pin): `Config.YAML` is a file, not a Mixed.Case attribute — two tasks
    # modifying it overlap, and both carry it in `writes`. Bare (no `/`) on
    # purpose: a slash would satisfy _is_pathlike before the extension rule runs.
    plan = PLAN_HEADER + """### Task 1: A
**Type:** implementation

**Files:**
- Modify: `Config.YAML`

- [ ] **Step 1: do it**

### Task 2: B
**Type:** implementation

**Files:**
- Modify: `Config.YAML`

- [ ] **Step 1: do it**
"""
    out = compile_plan_text(plan)
    assert [t["writes"] for t in out["tasks"]] == [["Config.YAML"], ["Config.YAML"]]
    ser = _serialize_text(plan)
    assert [(e["from"], e["to"], e["why"]) for e in ser["dag_edges"]] == [("1", "2", "write-after-write")]


def test_line_range_suffix_is_stripped_from_write_set():
    # `src/existing.py:123-145` and `src/existing.py:200-210` are ONE file:
    # the suffix is stripped, so the write sets match and the pair overlaps.
    plan = PLAN_HEADER + """### Task 1: A
**Type:** implementation

**Files:**
- Modify: `src/existing.py:123-145`

- [ ] **Step 1: do it**

### Task 2: B
**Type:** implementation

**Files:**
- Modify: `src/existing.py:200-210`

- [ ] **Step 1: do it**
"""
    out = compile_plan_text(plan)
    assert [t["writes"] for t in out["tasks"]] == [["src/existing.py"], ["src/existing.py"]]
    assert [e["files"] for w in out["launch_waves"] for e in w] == [["src/existing.py"], ["src/existing.py"]]
    ser = _serialize_text(plan)
    assert [(e["from"], e["to"], e["why"]) for e in ser["dag_edges"]] == [("1", "2", "write-after-write")]


# Restored 2026-09-11 after the cut: Files-parsing tolerances the claims-v1 grammar
# still relies on (unbackticked paths, comma lists) and the placeholder wave fact.


def test_unbackticked_path_drops_trailing_prose(tmp_path):
    plan = tmp_path / "plainpath.md"
    plan.write_text(
        "# Plan: Plain path\n\n"
        "### Task A: creator\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: src/app.py — the new module\n\n- [ ] **Step 1:** a\n\n"
        "### Task B: modifier\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `src/app.py`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    assert {"from": "A", "to": "B", "why": "write-after-create"} in out["dag_edges"]



def test_unbackticked_comma_paths_lose_no_overlap(tmp_path):
    # An unbackticked comma list keeps the first path in the write set, so the
    # write-after-create overlap edge is not lost.
    plan = tmp_path / "commapaths.md"
    plan.write_text(
        "# Plan: Comma paths\n\n"
        "### Task 1: creator\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: src/app.py, src/other.py\n\n- [ ] **Step 1:** a\n\n"
        "### Task 2: modifier\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `src/app.py`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    assert {"from": "1", "to": "2", "why": "write-after-create"} in out["dag_edges"]



def test_all_three_tasks_share_wave_one():
    out = compile_plan_text(PLACEHOLDER_PLAN)
    assert sorted(out["waves"][0]) == ["1", "2", "3"]

