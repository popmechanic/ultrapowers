# ultralearn Feedback Loop Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `ultralearn` — a sensor that harvests real ultrapowers runs across projects, reads them through five lenses, and accumulates redaction-guarded findings into a committed ledger that distills into human-gated improvement proposals.

**Architecture:** A developer-facing skill under `skills/ultralearn/`. Deterministic Python (`scripts/`) does detection, slicing, planning-stitch, origin classification, and ledger merge with a fail-closed redaction guard; subagents dispatched in-session do the qualitative reading against a rubric in `references/`. Raw bundles live in a gitignored local cache; only abstracted findings reach the committed ledger.

**Tech Stack:** Python 3 standard library only. pytest. Markdown + JSONL artifacts. No new dependencies.

**Acceptance:** suite — ultrapowers self-development; the operator reads every diff, and the committed pytest suite + `validate_skill.py` + adversarial per-task review are the verification. No held-out exam.

## Global Constraints

- Python 3 **standard library only** — no new dependencies, no `anthropic` SDK, no `ANTHROPIC_API_KEY`, no direct API calls. All LLM work happens inside Claude Code.
- Deterministic scripts are **read-only and advisory**: a missing dir, empty input, or drifted schema prints/returns one diagnostic and continues; a harvest sweep never crashes.
- **Two-tier privacy** (the repo is public): raw bundles, full slices, and verbatim evidence live under the gitignored `.claude/ultralearn/` cache; the committed ledger under `docs/superpowers/observations/` carries only abstracted findings, metrics, and local pointers. The redaction guard **fails closed** — unclassifiable origin is treated as foreign.
- All tests live in `tests/` (CI runs `validate_skill.py` per skill, then `pytest tests/`). Tests use unique temp paths (pytest `tmp_path`) so same-wave suites run concurrently without collision.
- Skills are auto-discovered from `skills/`; no `plugin.json` edit needed. Versioning stays `0.0.x`; a release bumps **both** `plugin.json` and `marketplace.json` to the same value.
- Test imports of skill scripts use: `sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/ultralearn/scripts"))` (pytest runs from repo root per `pytest.ini`).

---

### Task 1: Reader rubric (the lenses + finding schema)

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `skills/ultralearn/references/reading-lenses.md`
- Test: `tests/test_reading_lenses.py`

**Interfaces:**
- Consumes: nothing.
- Produces: the documented finding schema (keys `runId, lens, title, novelty, severity, evidence, evidenceAbstracted, implication, surface`) and the five lens names (`friction, routing, operator, cost, frontier`) that the reader subagents emit and the ledger-merge step validates.

**Parallelization rationale:** the rubric is a pure prompt-source doc with no code dependency — front-loading it as its own task lets the merge and harvester tasks proceed without waiting, and gives the reader contract a single readable home. (Survives the good-engineer test: a prompt source belongs in its own reviewable file regardless of parallelism.)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_reading_lenses.py
from pathlib import Path

DOC = Path(__file__).resolve().parents[1] / "skills/ultralearn/references/reading-lenses.md"

REQUIRED_LENSES = ["friction", "routing", "operator", "cost", "frontier"]
REQUIRED_KEYS = ["runId", "lens", "title", "novelty", "severity",
                 "evidence", "evidenceAbstracted", "implication", "surface"]

def test_rubric_documents_all_lenses_and_schema_keys():
    text = DOC.read_text()
    for lens in REQUIRED_LENSES:
        assert lens in text, f"lens {lens!r} missing from rubric"
    for key in REQUIRED_KEYS:
        assert key in text, f"schema key {key!r} missing from rubric"

def test_rubric_names_the_emergent_seed_and_foreign_rule():
    text = DOC.read_text().lower()
    assert "test-driven development" in text or "tdd" in text, "emergent-behavior seed example missing"
    assert "foreign" in text and "abstract" in text, "foreign-run abstraction rule missing"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_reading_lenses.py -v`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Write the rubric**

Create `skills/ultralearn/references/reading-lenses.md` with these sections (prose, written for a subagent reader):

```markdown
# ultralearn — Reading Lenses

You are reading ONE ultrapowers run bundle (`bundle.json` + `slice.md`). Apply
the five lenses below and return findings as a JSON array. Return raw data only.

## The five lenses

1. **friction** — where the run broke or strained: merge conflicts, blocked or
   cascade-blocked waves, fix-loop exhaustion, gate rejections, lost
   coordinates, operator interventions, re-runs.
2. **routing** — was ultrapowers the right call; did the routing recommendation
   match how the run actually went; were Type/Depends-on markers and wave shape
   good, or did poor marking cause serialization or conflicts.
3. **operator** — the human's qualitative arc: confusion, surprise,
   trust/distrust, what they said at planning and at the gate, where they spent
   attention versus where the design intended.
4. **cost** — tokens, turns, tier choices, parallelism payoff, anything the
   metrics in `bundle.json` reveal about effort versus benefit.
5. **frontier** — OPEN-ENDED. How large/complex did the work get and still
   succeed? What did the agents do that the design did NOT anticipate —
   self-limiting, self-correcting, or otherwise surprising behavior? Seed
   example to calibrate novelty: a planning agent that declined to author a full
   implementation plan in one pass, reasoning that test-driven development is
   impossible against files that do not yet exist. Flag anything of that
   character.

## Output schema (one object per finding)

- `runId` (string) — copy from `bundle.json`.
- `lens` (string) — one of friction | routing | operator | cost | frontier.
- `title` (string) — a one-line headline.
- `novelty` (integer 0–2) — 0 routine, 1 notable, 2 never-seen.
- `severity` (integer 0–3) — 0 informational … 3 blocking/harmful.
- `evidence` (string) — what in the run supports this.
- `evidenceAbstracted` (boolean) — see the foreign rule below.
- `implication` (string) — what it suggests changing.
- `surface` (string) — the repo area a fix would touch (e.g. references/*.md,
  the routing hook, ultraplan, report-format.md, SKILL.md, README).

## The foreign rule (mandatory)

`bundle.json` carries `origin`: `home` or `foreign`. For a **foreign** run
(any project other than ultrapowers itself), you MUST set
`evidenceAbstracted: true` and write `evidence` as the *shape* of the behavior
with identifiers and domain specifics stripped — never quote verbatim text from
a foreign project. For a `home` run, verbatim evidence is allowed and
`evidenceAbstracted` may be false.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_reading_lenses.py -v`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add skills/ultralearn/references/reading-lenses.md tests/test_reading_lenses.py
git commit -m "feat(ultralearn): reader rubric — five lenses + finding schema"
```

---

### Task 2: Extract `audit()` from audit_run.py

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/audit_run.py`
- Test: `tests/test_audit_refactor.py`
- Create: `tests/fixtures/ultralearn/audit/agent-1.jsonl`

**Interfaces:**
- Consumes: nothing.
- Produces: `audit(transcript_dir) -> dict` with keys `agents` (list of `{role, model, turns, outputTokens}`), `totals` (`{turns, outputTokens}`), `misrankCandidates` (list), and optional `note`. Advisory: a missing/empty dir returns `{"agents": [], "totals": {"turns": 0, "outputTokens": 0}, "misrankCandidates": [], "note": "..."}`.

**Parallelization rationale:** `audit_run.py` is a separate file from every other task; extracting its core into a reusable function is a self-contained refactor the harvester later imports. (Survives the good-engineer test: turning duplicated inline logic into one callable function is correct independent of parallelism.)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_audit_refactor.py
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/ultrapowers/scripts"))
import audit_run

FIX = Path(__file__).resolve().parents[1] / "tests/fixtures/ultralearn/audit"

def test_audit_returns_structured_dict():
    out = audit_run.audit(FIX)
    assert isinstance(out, dict)
    assert set(out) >= {"agents", "totals", "misrankCandidates"}
    assert isinstance(out["agents"], list) and len(out["agents"]) == 1
    a = out["agents"][0]
    assert set(a) >= {"role", "model", "turns", "outputTokens"}
    assert out["totals"]["turns"] == a["turns"]

def test_audit_missing_dir_is_advisory():
    out = audit_run.audit(Path("/no/such/dir"))
    assert out["agents"] == []
    assert "note" in out
```

- [ ] **Step 2: Create the fixture and run the test to verify it fails**

Create `tests/fixtures/ultralearn/audit/agent-1.jsonl` (two JSONL records — a user task turn the classifier reads, and an assistant turn carrying a model + usage):

```jsonl
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"You are an implementer subagent. Implement the object whose \"id\" is \"1\"."}]}}
{"type":"assistant","message":{"role":"assistant","model":"claude-sonnet-4-6","usage":{"output_tokens":120},"content":[{"type":"text","text":"done"}]}}
```

Run: `python3 -m pytest tests/test_audit_refactor.py -v`
Expected: FAIL with `AttributeError: module 'audit_run' has no attribute 'audit'`.

- [ ] **Step 3: Add the `audit()` function**

In `skills/ultrapowers/scripts/audit_run.py`, add this function above `main()` (it reuses the existing `first_user_text`, `classify`, `collect` helpers and the existing agent-file discovery glob):

```python
def audit(transcript_dir):
    """Structured effort audit for one per-run engine transcript dir.

    Advisory by contract: a missing/empty/drifted dir returns a dict with an
    empty 'agents' list and a 'note' — never raises."""
    d = Path(transcript_dir)
    files = sorted(d.glob("agent-*.jsonl")) if d.is_dir() else []
    if not files:
        return {"agents": [], "totals": {"turns": 0, "outputTokens": 0},
                "misrankCandidates": [], "note": f"no agent-*.jsonl under {transcript_dir}"}
    agents = []
    for f in files:
        role = classify(first_user_text(f))
        model, turns, out_tokens = collect(f)
        agents.append({"role": role, "model": model, "turns": turns,
                       "outputTokens": out_tokens})
    agents.sort(key=lambda a: -a["turns"])
    impls = [a for a in agents if a["role"].startswith("impl")]
    by_model = {}
    for a in impls:
        by_model.setdefault(a["model"], []).append(a)
    misrank = []
    for group in by_model.values():
        if len(group) < 2:
            continue
        med = statistics.median(a["turns"] for a in group)
        misrank.extend(a for a in group if med and a["turns"] > 1.5 * med)
    totals = {"turns": sum(a["turns"] for a in agents),
              "outputTokens": sum(a["outputTokens"] for a in agents)}
    return {"agents": agents, "totals": totals, "misrankCandidates": misrank}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 -m pytest tests/test_audit_refactor.py -v`
Expected: PASS (both tests).

- [ ] **Step 5: Verify the existing CLI still runs (no regression)**

Run: `python3 skills/ultrapowers/scripts/audit_run.py /no/such/dir`
Expected: exit 0 with the existing "nothing to audit" diagnostic (the inline `main()` path is untouched; `audit()` is purely additive).

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/scripts/audit_run.py tests/test_audit_refactor.py tests/fixtures/ultralearn/audit/agent-1.jsonl
git commit -m "refactor(ultrapowers): extract reusable audit() from audit_run.py"
```

---

### Task 3: Harvester — detect, slice, stitch, classify, bundle

**Type:** implementation
**Depends-on:** 2

**Files:**
- Create: `skills/ultralearn/scripts/harvest_runs.py`
- Modify: `.gitignore`
- Test: `tests/test_harvest_runs.py`
- Create: `tests/fixtures/ultralearn/projects/`

Files-note — `tests/fixtures/ultralearn/projects/` (synthetic transcripts, created in the test steps)

**Interfaces:**
- Consumes: `audit(transcript_dir) -> dict` (from Task 2, importable from `skills/ultrapowers/scripts/audit_run.py`).
- Produces:
  - `is_real_run(records: list[dict]) -> bool`
  - `classify_origin(project_slug: str, home_slug: str) -> str` (`"home"`/`"foreign"`)
  - `slice_transcript(records: list[dict]) -> str`
  - `stitch_planning(plan_path: str, projects_root: Path, session_records: list[dict]) -> dict` (`{planningFound, planningSlice, planningSource}`)
  - `build_bundle(session_path: Path, project_slug: str, cache_dir: Path, home_slug: str) -> Path | None`
  - `harvest(projects_root: Path, cache_dir: Path, home_slug: str) -> list[Path]`
  - bundle.json keys: `runId, sessionId, projectSlug, origin, planPath, transcriptDir, gateReport, audit, planningFound`.

**Parallelization rationale:** the harvester is a brand-new file with no consumer in this plan except the SKILL doc (Task 5, a later wave); its only code dependency is the `audit()` function (Task 2). Nothing else in wave-1 touches it. (Survives the good-engineer test: detection/slicing/classification is a cohesive module on its own.)

- [ ] **Step 1: Write the failing detection + classification test**

```python
# tests/test_harvest_runs.py
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/ultralearn/scripts"))
import harvest_runs as h

def _rec(type_, content):
    return {"type": type_, "message": {"role": type_, "content": content}}

REAL = [
    _rec("user", [{"type": "text", "text": "build the thing"}]),
    _rec("assistant", [{"type": "tool_use", "name": "Workflow", "input": {"name": "ultrapowers-run"}}]),
    _rec("user", [{"type": "tool_result", "content": [{"type": "text",
        "text": "Transcript dir: /tmp/run-x\n{\"integrationBranch\":\"ultra/x\"}"}]}]),
]
DISCUSSION = [
    _rec("user", [{"type": "text", "text": "let's discuss /ultrapowers and integrationBranch"}]),
    _rec("assistant", [{"type": "text", "text": "integrationBranch is a report field; Transcript dir: explained"}]),
]

def test_real_run_detected():
    assert h.is_real_run(REAL) is True

def test_discussion_only_not_detected():
    assert h.is_real_run(DISCUSSION) is False

def test_classify_origin_home_and_worktree_variants():
    home = "-Users-marcusestes-Websites-ultrapowers"
    assert h.classify_origin(home, home) == "home"
    assert h.classify_origin(home + "--claude-worktrees-foo", home) == "home"
    assert h.classify_origin("-Users-marcusestes-Documents-Legal-x", home) == "foreign"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/test_harvest_runs.py -v`
Expected: FAIL — module `harvest_runs` does not exist.

- [ ] **Step 3: Implement detection, classification, and the block-text helper**

Create `skills/ultralearn/scripts/harvest_runs.py`:

```python
#!/usr/bin/env python3
"""ultralearn harvester — detect real ultrapowers runs across projects and
build per-run bundles into a local cache. Read-only and advisory: malformed or
missing input is skipped with a diagnostic, never raised."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ultrapowers/scripts"))
import audit_run  # noqa: E402  (provides audit())

SLICE_KEYWORDS = ("wave", "integrationbranch", "/ultrapowers", "gate",
                  "transcript dir", "recommended", "depends-on")


def _block_text(block):
    """Flatten a content block's text (handles nested tool_result content)."""
    if not isinstance(block, dict):
        return ""
    t = block.get("text")
    if isinstance(t, str):
        return t
    c = block.get("content")
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return "\n".join(_block_text(b) for b in c)
    return ""


def _iter_blocks(records):
    for r in records:
        content = (r.get("message") or {}).get("content")
        if isinstance(content, list):
            for b in content:
                yield r, b


def is_real_run(records):
    saw_workflow, saw_dir, saw_report = False, False, False
    for _r, b in _iter_blocks(records):
        if isinstance(b, dict) and b.get("type") == "tool_use" and b.get("name") == "Workflow":
            saw_workflow = True
        if isinstance(b, dict) and b.get("type") == "tool_result":
            txt = _block_text(b)
            if "Transcript dir:" in txt:
                saw_dir = True
            if "integrationBranch" in txt:
                saw_report = True
    return saw_workflow and (saw_dir or saw_report)


def classify_origin(project_slug, home_slug):
    if project_slug == home_slug or project_slug.startswith(home_slug + "--"):
        return "home"
    return "foreign"
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 -m pytest tests/test_harvest_runs.py -v`
Expected: PASS (the three tests).

- [ ] **Step 5: Write the failing slice + bundle test**

Append to `tests/test_harvest_runs.py`:

```python
def test_slice_keeps_user_turns_and_run_turns_drops_noise():
    recs = [
        _rec("user", [{"type": "text", "text": "build the thing"}]),
        _rec("assistant", [{"type": "text", "text": "Wave 1: tasks A, B"}]),
        _rec("assistant", [{"type": "text", "text": "unrelated chatter about lunch"}]),
    ]
    out = h.slice_transcript(recs)
    assert "build the thing" in out
    assert "Wave 1" in out
    assert "lunch" not in out

def test_build_bundle_writes_json_and_slice(tmp_path):
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in REAL) + "\n")
    cache = tmp_path / "cache"
    home = "-Users-marcusestes-Websites-ultrapowers"
    out = h.build_bundle(session, "-Users-marcusestes-Documents-Legal-x", cache, home)
    assert out is not None
    bundle = json.loads((out / "bundle.json").read_text())
    assert bundle["origin"] == "foreign"
    assert bundle["planPath"] is None or isinstance(bundle["planPath"], str)
    assert set(bundle) >= {"runId", "sessionId", "projectSlug", "origin", "gateReport", "audit"}
    assert (out / "slice.md").exists()

def test_build_bundle_skips_non_run(tmp_path):
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in DISCUSSION) + "\n")
    out = h.build_bundle(session, "any", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    assert out is None
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `python3 -m pytest tests/test_harvest_runs.py -v`
Expected: FAIL — `slice_transcript` / `build_bundle` not defined.

- [ ] **Step 7: Implement slice, plan-path extraction, stitch, and bundle**

Append to `skills/ultralearn/scripts/harvest_runs.py`:

```python
def slice_transcript(records):
    lines = []
    for r, b in _iter_blocks(records):
        rtype = r.get("type")
        txt = _block_text(b).strip()
        if not txt:
            continue
        if rtype == "user" and b.get("type") == "text":
            lines.append(f"**user:** {txt}")
        elif any(k in txt.lower() for k in SLICE_KEYWORDS):
            lines.append(f"**{rtype}:** {txt}")
    return "\n\n".join(lines)


def _plan_path(records):
    for _r, b in _iter_blocks(records):
        txt = _block_text(b)
        if "/ultrapowers " in txt:
            tail = txt.split("/ultrapowers ", 1)[1].split()[0].strip()
            return tail or None
    return None


def stitch_planning(plan_path, projects_root, session_records):
    if not plan_path:
        return {"planningFound": False, "planningSlice": "", "planningSource": None}
    for _r, b in _iter_blocks(session_records):
        if isinstance(b, dict) and b.get("type") == "tool_use" \
                and b.get("name") in ("Write", "Edit") \
                and (b.get("input") or {}).get("file_path", "").endswith(plan_path.lstrip(".")):
            return {"planningFound": True,
                    "planningSlice": slice_transcript(session_records),
                    "planningSource": "same-session"}
    return {"planningFound": False, "planningSlice": "", "planningSource": None}


def _records(session_path):
    out = []
    for line in Path(session_path).read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def _gate_report(records):
    for _r, b in _iter_blocks(records):
        txt = _block_text(b)
        i = txt.find('{"integrationBranch"')
        if i == -1:
            i = txt.find('"integrationBranch"')
            if i != -1:
                i = txt.rfind("{", 0, i)
        if i != -1:
            try:
                return json.loads(txt[i:txt.rindex("}") + 1])
            except (json.JSONDecodeError, ValueError):
                continue
    return None


def _transcript_dir(records):
    for _r, b in _iter_blocks(records):
        txt = _block_text(b)
        if "Transcript dir:" in txt:
            tail = txt.split("Transcript dir:", 1)[1].strip().splitlines()[0]
            return tail.strip().rstrip("\\").strip() or None
    return None


def build_bundle(session_path, project_slug, cache_dir, home_slug):
    try:
        records = _records(session_path)
    except OSError:
        return None
    if not is_real_run(records):
        return None
    session_id = Path(session_path).stem
    run_id = hashlib.sha256(f"{project_slug}/{session_id}".encode()).hexdigest()[:16]
    tdir = _transcript_dir(records)
    bundle = {
        "runId": run_id,
        "sessionId": session_id,
        "projectSlug": project_slug,
        "origin": classify_origin(project_slug, home_slug),
        "planPath": _plan_path(records),
        "transcriptDir": tdir,
        "gateReport": _gate_report(records),
        "audit": audit_run.audit(tdir) if tdir else {"agents": [], "note": "no transcript dir"},
        "planningFound": stitch_planning(_plan_path(records),
                                         Path(session_path).parent.parent, records)["planningFound"],
    }
    out = Path(cache_dir) / "runs" / run_id
    out.mkdir(parents=True, exist_ok=True)
    (out / "bundle.json").write_text(json.dumps(bundle, indent=2))
    (out / "slice.md").write_text(slice_transcript(records))
    return out
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `python3 -m pytest tests/test_harvest_runs.py -v`
Expected: PASS (all harvester tests).

- [ ] **Step 9: Write the failing incremental-harvest test**

Append to `tests/test_harvest_runs.py`:

```python
def test_harvest_is_incremental_and_idempotent(tmp_path):
    projects = tmp_path / "projects" / "-Users-marcusestes-Documents-Legal-x"
    projects.mkdir(parents=True)
    (projects / "s1.jsonl").write_text("\n".join(json.dumps(r) for r in REAL) + "\n")
    cache = tmp_path / "cache"
    home = "-Users-marcusestes-Websites-ultrapowers"
    first = h.harvest(tmp_path / "projects", cache, home)
    assert len(first) == 1
    second = h.harvest(tmp_path / "projects", cache, home)
    assert second == []  # watermark → nothing new
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `python3 -m pytest tests/test_harvest_runs.py::test_harvest_is_incremental_and_idempotent -v`
Expected: FAIL — `harvest` not defined.

- [ ] **Step 11: Implement `harvest()` with a watermark and a CLI**

Append to `skills/ultralearn/scripts/harvest_runs.py`:

```python
def _load_watermark(cache_dir):
    wm = Path(cache_dir) / "watermark.json"
    if wm.exists():
        try:
            return set(json.loads(wm.read_text()))
        except (json.JSONDecodeError, OSError):
            return set()
    return set()


def _save_watermark(cache_dir, seen):
    Path(cache_dir).mkdir(parents=True, exist_ok=True)
    (Path(cache_dir) / "watermark.json").write_text(json.dumps(sorted(seen)))


def harvest(projects_root, cache_dir, home_slug):
    projects_root, cache_dir = Path(projects_root), Path(cache_dir)
    seen = _load_watermark(cache_dir)
    new_bundles = []
    if not projects_root.is_dir():
        print(f"ultralearn: no projects root at {projects_root}", file=sys.stderr)
        return []
    for proj in sorted(projects_root.iterdir()):
        if not proj.is_dir():
            continue
        for session in sorted(proj.glob("*.jsonl")):
            key = f"{proj.name}/{session.stem}"
            if key in seen:
                continue
            try:
                bundle = build_bundle(session, proj.name, cache_dir, home_slug)
            except Exception as exc:  # advisory: never crash a sweep
                print(f"ultralearn: skipped {key}: {exc}", file=sys.stderr)
                bundle = None
            seen.add(key)
            if bundle is not None:
                new_bundles.append(bundle)
    _save_watermark(cache_dir, seen)
    return new_bundles


def _default_home_slug():
    return str(Path(__file__).resolve().parents[3]).replace("/", "-")


def main(argv=None):
    argv = argv or sys.argv[1:]
    projects = Path(argv[0]) if argv else Path.home() / ".claude/projects"
    cache = Path.home() / ".claude/ultralearn"
    bundles = harvest(projects, cache, _default_home_slug())
    print(f"ultralearn: {len(bundles)} new run bundle(s) under {cache}/runs")
    for b in bundles:
        print(f"  - {b}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 12: Add the cache to .gitignore**

Add to `.gitignore` (under the existing run-artifacts block):

```
# ultralearn local cache — raw bundles, slices, verbatim evidence (never committed)
.claude/ultralearn/
```

- [ ] **Step 13: Run the full harvester suite**

Run: `python3 -m pytest tests/test_harvest_runs.py -v`
Expected: PASS (all tests).

- [ ] **Step 14: Commit**

```bash
git add skills/ultralearn/scripts/harvest_runs.py tests/test_harvest_runs.py .gitignore
git commit -m "feat(ultralearn): harvester — detect, slice, stitch, classify, bundle"
```

---

### Task 4: Ledger merge + fail-closed redaction guard

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `skills/ultralearn/scripts/merge_ledger.py`
- Test: `tests/test_merge_ledger.py`

**Interfaces:**
- Consumes: nothing (the finding schema is defined here in code; it mirrors the rubric doc from Task 1).
- Produces:
  - `finding_id(finding: dict) -> str`
  - `redact_finding(finding: dict, origin: str) -> dict | None`
  - `merge_findings(findings: list[dict], ledger_path: Path, origin_lookup) -> dict` (`{added, skipped}`)
  - `regenerate_digest(ledger_path: Path, digest_path: Path) -> None`

**Parallelization rationale:** the merge module operates purely on finding dicts and a ledger file path; it shares no file and no code symbol with any wave-1 sibling, so it builds against the documented schema independently. (Survives the good-engineer test: the privacy-critical redaction guard deserves its own focused, heavily tested module.)

- [ ] **Step 1: Write the failing redaction + id test**

```python
# tests/test_merge_ledger.py
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/ultralearn/scripts"))
import merge_ledger as m

def _finding(**kw):
    base = {"runId": "r1", "lens": "frontier", "title": "t", "novelty": 2,
            "severity": 1, "evidence": "raw quote", "evidenceAbstracted": False,
            "implication": "x", "surface": "SKILL.md"}
    base.update(kw)
    return base

def test_home_verbatim_allowed():
    out = m.redact_finding(_finding(), "home")
    assert out is not None and "id" in out and out["origin"] == "home"

def test_foreign_verbatim_rejected():
    assert m.redact_finding(_finding(evidenceAbstracted=False), "foreign") is None

def test_foreign_abstracted_allowed():
    out = m.redact_finding(_finding(evidenceAbstracted=True, evidence="shape only"), "foreign")
    assert out is not None and out["origin"] == "foreign"

def test_unknown_origin_fails_closed():
    assert m.redact_finding(_finding(evidenceAbstracted=False), "mystery") is None

def test_finding_id_is_stable():
    assert m.finding_id(_finding()) == m.finding_id(_finding())
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/test_merge_ledger.py -v`
Expected: FAIL — module `merge_ledger` does not exist.

- [ ] **Step 3: Implement id + redaction guard**

Create `skills/ultralearn/scripts/merge_ledger.py`:

```python
#!/usr/bin/env python3
"""ultralearn ledger merge — append reader findings to the committed ledger
behind a fail-closed redaction guard, then regenerate the markdown digest.
Only abstracted findings from foreign runs may be committed."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

LENSES = ["friction", "routing", "operator", "cost", "frontier"]


def finding_id(finding):
    key = json.dumps({k: finding.get(k) for k in ("runId", "lens", "title")},
                     sort_keys=True)
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def redact_finding(finding, origin):
    """Return the finding (with id + origin) if safe to commit, else None.
    Fails closed: any origin other than 'home' requires evidenceAbstracted."""
    if origin != "home" and not finding.get("evidenceAbstracted"):
        return None
    out = dict(finding)
    out["id"] = finding_id(finding)
    out["origin"] = origin
    return out
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 -m pytest tests/test_merge_ledger.py -v`
Expected: PASS (the five tests).

- [ ] **Step 5: Write the failing merge + digest test**

Append to `tests/test_merge_ledger.py`:

```python
def test_merge_dedups_and_is_idempotent(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    origin = lambda rid: "home"
    f = [_finding(title="a"), _finding(title="b")]
    s1 = m.merge_findings(f, ledger, origin)
    assert s1["added"] == 2
    s2 = m.merge_findings(f, ledger, origin)  # same findings again
    assert s2["added"] == 0
    assert len(ledger.read_text().splitlines()) == 2

def test_merge_applies_redaction(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    origin = lambda rid: "foreign"
    f = [_finding(title="leak", evidenceAbstracted=False)]
    stats = m.merge_findings(f, ledger, origin)
    assert stats["added"] == 0  # foreign verbatim never lands
    assert not ledger.exists() or ledger.read_text().strip() == ""

def test_regenerate_digest_groups_by_lens(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    m.merge_findings([_finding(title="a", lens="friction"),
                      _finding(title="b", lens="frontier")],
                     ledger, lambda rid: "home")
    digest = tmp_path / "ledger.md"
    m.regenerate_digest(ledger, digest)
    text = digest.read_text()
    assert "friction" in text and "frontier" in text
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `python3 -m pytest tests/test_merge_ledger.py -v`
Expected: FAIL — `merge_findings` / `regenerate_digest` not defined.

- [ ] **Step 7: Implement merge + digest**

Append to `skills/ultralearn/scripts/merge_ledger.py`:

```python
def _read_jsonl(path):
    path = Path(path)
    if not path.exists():
        return []
    out = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if line:
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


def merge_findings(findings, ledger_path, origin_lookup):
    ledger_path = Path(ledger_path)
    existing = _read_jsonl(ledger_path)
    seen = {f.get("id") for f in existing}
    added = []
    for f in findings:
        origin = origin_lookup(f.get("runId"))
        red = redact_finding(f, origin)
        if red is None or red["id"] in seen:
            continue
        seen.add(red["id"])
        added.append(red)
    if added:
        ledger_path.parent.mkdir(parents=True, exist_ok=True)
        with ledger_path.open("a") as fh:
            for f in added:
                fh.write(json.dumps(f, sort_keys=True) + "\n")
    return {"added": len(added), "skipped": len(findings) - len(added)}


def regenerate_digest(ledger_path, digest_path):
    findings = _read_jsonl(ledger_path)
    by_lens = {lens: [] for lens in LENSES}
    for f in findings:
        by_lens.setdefault(f.get("lens", "other"), []).append(f)
    lines = ["# ultralearn — observation ledger (digest)", "",
             f"{len(findings)} finding(s) across {len({f.get('runId') for f in findings})} run(s).", ""]
    for lens in LENSES:
        items = by_lens.get(lens, [])
        if not items:
            continue
        lines.append(f"## {lens} ({len(items)})")
        for f in sorted(items, key=lambda x: -(x.get("severity", 0) * (x.get("novelty", 0) + 1))):
            tag = "" if f.get("origin") == "home" else " _(abstracted)_"
            lines.append(f"- **{f.get('title','')}** — {f.get('implication','')} "
                         f"`{f.get('surface','')}`{tag}")
        lines.append("")
    Path(digest_path).parent.mkdir(parents=True, exist_ok=True)
    Path(digest_path).write_text("\n".join(lines))
```

- [ ] **Step 8: Run the full merge suite**

Run: `python3 -m pytest tests/test_merge_ledger.py -v`
Expected: PASS (all tests).

- [ ] **Step 9: Commit**

```bash
git add skills/ultralearn/scripts/merge_ledger.py tests/test_merge_ledger.py
git commit -m "feat(ultralearn): ledger merge + fail-closed redaction guard"
```

---

### Task 5: SKILL.md orchestration + CI wiring

**Type:** implementation
**Depends-on:** 1, 3, 4

**Files:**
- Create: `skills/ultralearn/SKILL.md`
- Create: `docs/superpowers/observations/.gitkeep`
- Modify: `.github/workflows/ci.yml`
- Test: `tests/test_ultralearn_skill.py`

**Interfaces:**
- Consumes: the rubric (`references/reading-lenses.md`, Task 1); `harvest()` / bundle format (Task 3); `merge_findings()` / `regenerate_digest()` (Task 4).
- Produces: the operator-facing skill doc and the CI registration; no code symbols.

**Parallelization rationale:** none — this task documents the real interfaces of Tasks 1, 3, and 4 and must follow them so the operator steps match the shipped CLIs (it is intentionally in the final wave).

- [ ] **Step 1: Write the failing skill-shape test**

```python
# tests/test_ultralearn_skill.py
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/ultralearn/SKILL.md"
CI = ROOT / ".github/workflows/ci.yml"

def test_skill_has_frontmatter_and_both_verbs():
    text = SKILL.read_text()
    assert text.startswith("---"), "missing YAML frontmatter"
    assert "name:" in text and "description:" in text
    assert "harvest_runs.py" in text and "merge_ledger.py" in text
    assert "distill" in text  # the second verb is documented

def test_skill_documents_human_gate_and_two_tier_privacy():
    text = SKILL.read_text().lower()
    assert "human" in text and "approv" in text  # nothing files without approval
    assert "foreign" in text and "abstract" in text

def test_ci_validates_ultralearn():
    assert "skills/ultralearn" in CI.read_text()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/test_ultralearn_skill.py -v`
Expected: FAIL — SKILL.md does not exist.

- [ ] **Step 3: Write SKILL.md**

Create `skills/ultralearn/SKILL.md` with frontmatter and the orchestration body:

```markdown
---
name: ultralearn
description: Use when the operator wants to learn from real ultrapowers runs — harvest runs across projects, read them through five lenses, accumulate a redaction-guarded observation ledger, and distill human-gated improvement proposals. Two verbs - "ultralearn" (sense) and "ultralearn distill" (propose).
---

# ultralearn — feedback loop from in-practice use

A developer tool that closes the loop from real ultrapowers runs back into the
plugin. Deterministic Python harvests and merges; subagents read. All LLM work
runs inside Claude Code — no API key, no external calls.

## Verb 1 — `ultralearn` (sense)

1. **Harvest.** Run the harvester to detect real runs and build local bundles:
   `python3 skills/ultralearn/scripts/harvest_runs.py`
   It scans `~/.claude/projects`, detects runs by an actual `Workflow`
   tool_result (not string mentions), and writes bundles to the gitignored
   cache `~/.claude/ultralearn/runs/<runId>/` (`bundle.json` + `slice.md`).
   Incremental: a watermark means re-runs only process new sessions.
2. **Read.** For each new bundle, dispatch a subagent with
   `references/reading-lenses.md` as its instructions plus the bundle's
   `bundle.json` and `slice.md`. The agent returns a JSON array of findings.
   Dispatch readers in parallel. Every reader applies all five lenses,
   including the open-ended `frontier` pass that catches emergent behavior.
3. **Merge.** Collect the findings and merge them behind the redaction guard:
   `merge_findings(findings, "docs/superpowers/observations/ledger.jsonl", origin_lookup)`
   where `origin_lookup(runId)` reads `origin` from the cached `bundle.json`
   (fail closed to `foreign`). Then `regenerate_digest(...)` rewrites
   `docs/superpowers/observations/ledger.md`. **Foreign verbatim evidence never
   lands** — the guard drops it.

## Verb 2 — `ultralearn distill` (propose)

Read the accumulated `ledger.jsonl`, cluster recurring/co-occurring findings
across runs, rank by frequency × severity × novelty, and draft improvement
proposals — each mapped to a real surface (`references/*.md`, the routing hook,
ultraplan, `report-format.md`/`SKILL.md`, `README`). Output draft GitHub issues
and/or spec stubs under `docs/superpowers/specs/`. **Nothing is filed or
committed without operator approval** — present the drafts and let the operator
choose. This human gate is the loop's governor, mirroring the pre-merge gate.

## Privacy (two tiers — the repo is public)

- Local, gitignored (`~/.claude/ultralearn/`): raw bundles, full slices,
  verbatim evidence, watermark.
- Committed (`docs/superpowers/observations/`): abstracted findings, metrics,
  local pointers only. Runs are classified `home` (this repo — verbatim OK) or
  `foreign` (any other project — evidence must be abstracted).
```

- [ ] **Step 4: Create the committed ledger directory placeholder**

Create `docs/superpowers/observations/.gitkeep` (empty file) so the committed-tier directory exists in the repo.

- [ ] **Step 5: Add ultralearn to CI validation**

In `.github/workflows/ci.yml`, after the "Validate ultraplan skill" step, add:

```yaml
      - name: Validate ultralearn skill
        run: python skills/ultrapowers/scripts/validate_skill.py skills/ultralearn
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `python3 -m pytest tests/test_ultralearn_skill.py -v`
Expected: PASS (all three tests).

- [ ] **Step 7: Validate the new skill directory**

Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultralearn`
Expected: validation passes (exit 0). If it reports a structural requirement, fix it before committing.

- [ ] **Step 8: Commit**

```bash
git add skills/ultralearn/SKILL.md docs/superpowers/observations/.gitkeep .github/workflows/ci.yml tests/test_ultralearn_skill.py
git commit -m "feat(ultralearn): SKILL.md orchestration + CI validation wiring"
```

---

### Task 6: Full verification gate

**Type:** gate

**Files:** none — verification only; writes nothing.

Verification expectations (the suite is the acceptance authority for this plan):

- `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultralearn` → exit 0.
- `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` → exit 0 (audit_run.py change did not break it).
- `python3 -m pytest tests/` → all pass, including the existing suite (no regression) and the new `test_reading_lenses.py`, `test_audit_refactor.py`, `test_harvest_runs.py`, `test_merge_ledger.py`, `test_ultralearn_skill.py`.

`testCmd`: `python3 -m pytest tests/`

---

### Task 7: Release (post-merge runbook)

**Type:** release

**Files:**
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`

Carried verbatim into the post-merge runbook — not waved:

- Bump **both** `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` from `0.0.18` to `0.0.19` (they must match — `plugin.json` wins silently if they drift).
- Commit on `main`: `chore(release): 0.0.19 — ultralearn feedback loop`.
- The installed plugin only picks up the new version after `/plugin` re-resolves it and a new session starts.
