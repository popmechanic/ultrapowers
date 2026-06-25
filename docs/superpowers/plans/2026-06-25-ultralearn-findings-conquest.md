# Ultralearn Findings Conquest (P1–P6) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conquer the six actionable workstreams from the 2026-06-25 ultralearn cross-project scan — the pre-merge report must distinguish "green suite" from "done" (P1), worktree/checkout/concurrency become deterministic (P2), the harvester stops mis-counting non-engine runs (P3), the ultraplan compiler stops dropping/mis-edging tasks (P4), the launch contract degrades gracefully (P5), and the finishing handoff + version manifests stop drifting (P6).

**Architecture:** Two lanes. An **isolated lane** (Tasks 1–7) edits only its own files and fans out fully in parallel — harvester, compiler, P2/P5 deterministic helper scripts, sealed-runner, version guard. An **engine-core spine** (Tasks 8–13) serializes the edits that share `harnesses/waves.js`, the baked `references/*.md` prompt sources, `references/report-format.md`, and `SKILL.md`, because two worktrees editing one file collide at merge. The engine harness has **no shell, git, or runId**, so every filesystem/git/concurrency primitive lives in a deterministic helper script (pytest-driven) or the orchestrator (SKILL.md), never in `waves.js`; only agent-prompt assertions live in the baked prompts.

**Tech Stack:** JavaScript (`waves.js` harness), Python 3 standard library (`compile_plan.py`, `harvest_runs.py`, `audit_run.py`), POSIX shell (`run_acceptance.sh`, `sweep_worktrees.sh`, new helper scripts), pytest, and the `tests/sim_workflow.mjs` deterministic Node simulator (the only way to assert `waves.js` report behavior).

**Acceptance:** suite — this is ultrapowers self-development (engine harness, skills, scripts, baked prompts, docs). The operator reads every diff; the committed pytest suite + the `sim_workflow.mjs` scenarios + `test_no_prompt_drift` / `test_marker_contract` / `test_ultraplan_skill` pins + adversarial per-task review are the verification. No held-out exam. NOTE: `tests/sim_workflow.mjs` is **not** in CI — the gate must run it explicitly (`node tests/sim_workflow.mjs`).

**Source spec:** `docs/superpowers/specs/2026-06-25-ultralearn-findings-handoff.md`. Evidence anchors `[id]` index `docs/superpowers/observations/ledger.jsonl`.

## Global Constraints

- **Baked prompts.** The engine prompts in `harnesses/waves.js` are baked from `references/reviewer-prompts.md` (`GUARD`, `IMPLEMENTER_PROMPT`, `REVIEWER_PROMPT`, `IMPLEMENTER_SCHEMA`, `REVIEWER_SCHEMA`) and `references/wave-merge.md` (`SETUP_PROMPT_CREATE`, `SETUP_PROMPT_RESUME`, `MERGE_PROMPT`, `RECONCILE_PROMPT`, `COMPLETENESS_PROMPT`). Editing a baked prompt means editing the `<!-- BAKE:NAME -->` block in the `.md` source **and** the matching string in `waves.js`, then keeping `tests/test_no_prompt_drift.py` green. Re-bake is manual (procedure: `references/workflow-template.md`). The normalizer ignores formatting/punctuation — only the words must match.
- **NOT drift-pinned (edit freely, no re-bake):** `references/report-format.md`, and `REVIEW_SCHEMA` (the completeness-critic output schema at `waves.js` ~416–424). `report-format.md` IS governed by `tests/test_report_runbook.py`, which asserts documented strings and cross-checks that **every `reviewVerdict` literal emitted in `waves.js` is documented in backticks** — adding a new `reviewVerdict` value requires documenting it there.
- **`waves.js` has no shell/git/filesystem access and never receives the runId** (engine-assigned, surfaced only post-launch to the orchestrator). Any lockfile, HEAD snapshot/restore, or git ground-truthing is a deterministic helper script + SKILL.md wiring, OR a baked agent-prompt instruction the agent executes with its own shell — never inline `waves.js` logic. `waves.js` must stay launch-compatible: no change to the `args` contract.
- **The pytest gate is `python3 -m pytest`** (scoped by `pytest.ini`). `tests/sim_workflow.mjs` is NOT in CI — run `node tests/sim_workflow.mjs` explicitly; it prints `ALL SCENARIOS PASSED` only when every scenario passes, and `tests/test_workflow_sim.py` shells out to assert exactly that. CI also runs `validate_skill.py` on `skills/ultrapowers`, `skills/ultraplan`, and `skills/ultralearn`.
- **Marker-contract three-way pin.** The compiler heuristic regexes (`RELEASE_PATTERNS`, `MANUAL_PATTERNS`, `GATE_PATTERNS`) are pinned across `compile_plan.py` ↔ `references/plan-markers.md` by `tests/test_marker_contract.py`, and `plan-markers.md`'s `<!-- BAKE -->` blocks are mirrored verbatim into `skills/ultraplan/SKILL.md` by `tests/test_ultraplan_skill.py` (which also forbids SKILL.md from linking the `plan-markers.md` path). Any change to those regexes or the marker contract must update all three sides.
- **Versioning stays `0.0.x`; a release bumps BOTH `.claude-plugin/plugin.json` (`.version`) AND `.claude-plugin/marketplace.json` (`.plugins[0].version`) to the same value** — `plugin.json` wins silently if they drift. This release: `0.0.20` → `0.0.21`.
- **No direct Anthropic API calls** in any shipped or dev script (a distributed plugin must need no API key).
- **Test fixtures must encode REAL prompt/transcript shapes**, not invented ones — a fixture that drifts from the real prompt is the `[bcc72f2be9eebeeb]` failure mode. Mirror the existing fixtures in each test file.
- **Concurrency-safe tests.** Same-wave tasks run their suites simultaneously on one machine. Use `tmp_path`/`tempfile` for every on-disk fixture and unique names; never share an on-disk fixture path between tasks.
- **Serialize `/ultrapowers` runs in this repo.** If this plan is self-hosted via `/ultrapowers`, run exactly one at a time and sweep with `skills/ultrapowers/scripts/sweep_worktrees.sh` between runs (Task 4 makes this enforceable, but it is not yet in effect when this plan launches).

---

## Isolated lane (Tasks 1–7) — disjoint files, fan out in parallel

### Task 1: Harvester precision — engine-fingerprint, dedup, provenance, truncation, targeting (`harvest_runs.py`)

**Type:** implementation
**Depends-on:** none

Evidence: `[6f4b149bf481d212]` / `[c9b028bf4da18d99]` (non-engine Workflows swept in as `role:unknown` mega-runs), `[4fd31a3d81a71b36]` (one run double-emitted under two runIds), `[a2376d0fea405c08]` (a planning slice glued to a different run's audit). The extractor trio (`_plan_path`/`_transcript_dir`/`_gate_report`) is already fixed (PR #66) — do not touch it.

**Files:**
- Modify: `skills/ultralearn/scripts/harvest_runs.py`
- Test: `tests/test_harvest_runs.py`

**Interfaces:**
- Consumes: `audit_run.classify` / `audit_run.audit` (already imported via the `sys.path.insert` at the top of `harvest_runs.py`); recognized engine roles are `setup`/`merge`/`review`/`reconcile`/`integration`, unmatched → `unknown`.
- Produces: `classify_session_kind(records, audit, gate_report, planning_found) -> "engine" | "meta"` (a pure classifier reused by the build path); `build_bundle(...)` gains a `sessionKind` field and returns `None` for non-engine sessions; `harvest(projects_root, cache_dir, home_slug, *, project=None, session=None)` (new keyword-only targeting params, default `None` = scan all) deduped so one run (same `transcriptDir`) emits one bundle; `slice_transcript(records)` truncates oversized single user turns.

**Parallelization rationale:** the engine-fingerprint classifier is the single decision both the keep/drop (`[c9b028…]`) and the slice↔audit provenance tag (`[a2376d…]`) hinge on — factoring it into one `classify_session_kind` function (rather than duplicating the signal checks at two call sites) is the move a good engineer makes regardless; it also keeps this entire workstream in one file, off the engine spine.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_harvest_runs.py` (mirror the existing `_rec`/`_ts`/`REAL` helpers and the `build_bundle`/`harvest` idioms already in the file):

```python
# --- P3: engine-fingerprint, dedup, provenance, truncation, targeting ---
def _agent_file(d, n, first_user_text):
    """An agent-*.jsonl whose first user turn drives audit_run.classify's role."""
    d.mkdir(parents=True, exist_ok=True)
    rec = {"type": "user", "message": {"role": "user",
           "content": [{"type": "text", "text": first_user_text}]}}
    (d / f"agent-{n}.jsonl").write_text(json.dumps(rec) + "\n")


def _run_session(tdir, *, with_integration):
    """A session that passes is_real_run: a Workflow tool_use + a tool_result
    naming the transcript dir (and optionally an integrationBranch)."""
    tr = f"Transcript dir: {tdir}"
    if with_integration:
        tr += '\nresult {"integrationBranch":"ultra/x","waveMerges":[]}'
    return [
        _rec("assistant", [{"type": "tool_use", "name": "Workflow",
                            "input": {"name": "ultrapowers-run"}}]),
        _rec("user", [{"type": "tool_result", "content": [{"type": "text", "text": tr}]}]),
    ]


def test_non_engine_workflow_session_is_not_an_engine_run(tmp_path):
    # all agents role:unknown, no integration branch, no planning -> meta, dropped
    tdir = tmp_path / "projects" / "p" / "subagents" / "workflows" / "wf_meta"
    _agent_file(tdir, 1, "Search the web for X and draft an issue.")
    _agent_file(tdir, 2, "Summarize the findings.")
    session = tmp_path / "s.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in _run_session(tdir, with_integration=False)) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache", "-Users-x-home")
    assert out is None


def test_real_engine_session_is_kept_and_tagged(tmp_path):
    tdir = tmp_path / "projects" / "p" / "subagents" / "workflows" / "wf_real"
    _agent_file(tdir, 1, "You are the setup agent on the session repo main checkout.")
    _agent_file(tdir, 2, "You are the wave merge agent, operating on the session repo main checkout.")
    session = tmp_path / "s.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in _run_session(tdir, with_integration=True)) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache", "-Users-x-home")
    assert out is not None
    bundle = json.loads((out / "bundle.json").read_text())
    assert bundle["sessionKind"] == "engine"


def test_same_run_double_emitted_is_deduped(tmp_path):
    proj = tmp_path / "projects" / "-Users-x-proj"
    tdir = tmp_path / "projects" / "-Users-x-proj" / "subagents" / "workflows" / "wf_dup"
    _agent_file(tdir, 1, "You are the setup agent on the session repo main checkout.")
    for stem in ("s1", "s2"):
        (proj / f"{stem}.jsonl").parent.mkdir(parents=True, exist_ok=True)
        (proj / f"{stem}.jsonl").write_text(
            "\n".join(json.dumps(r) for r in _run_session(tdir, with_integration=True)) + "\n")
    bundles = h.harvest(tmp_path / "projects", tmp_path / "cache", "-Users-x-home")
    assert len(bundles) == 1  # one transcriptDir -> one bundle


def test_slice_truncates_oversized_user_turn():
    recs = [_rec("user", [{"type": "text", "text": "X" * 40000}]),
            _rec("user", [{"type": "text", "text": "build the thing"}])]
    out = h.slice_transcript(recs)
    assert "build the thing" in out
    assert "X" * 40000 not in out and len(out) < 40000


def test_harvest_targets_a_single_project(tmp_path):
    for slug in ("-Users-x-aaa", "-Users-x-bbb"):
        tdir = tmp_path / "projects" / slug / "subagents" / "workflows" / f"wf_{slug[-3:]}"
        _agent_file(tdir, 1, "You are the setup agent on the session repo main checkout.")
        sess = tmp_path / "projects" / slug / "s.jsonl"
        sess.write_text("\n".join(json.dumps(r) for r in _run_session(tdir, with_integration=True)) + "\n")
    bundles = h.harvest(tmp_path / "projects", tmp_path / "cache", "-Users-x-home", project="-Users-x-aaa")
    slugs = {json.loads((b / "bundle.json").read_text())["projectSlug"] for b in bundles}
    assert slugs == {"-Users-x-aaa"}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_harvest_runs.py -k "engine_run or deduped or truncates or targets" -v`
Expected: FAIL — `build_bundle` has no `sessionKind` and never returns `None` for meta sessions; `harvest` has no `project=` kwarg and double-emits; `slice_transcript` appends the full 40 000-char turn.

- [ ] **Step 3: Add the engine-fingerprint classifier**

In `harvest_runs.py`, add a pure classifier (place it just before `build_bundle`):

```python
ENGINE_ROLES = {"setup", "merge", "review", "reconcile", "integration"}


def classify_session_kind(records, audit, gate_report, planning_found):
    """Distinguish a real /ultrapowers engine run from a non-engine Workflow
    session (research fan-out, issue drafting) that merely used the Workflow
    tool. Engine signals: a recognized engine role among the audited agents, OR
    a real integration branch in the gate report, OR a captured plan. A session
    with none of these is 'meta' (e.g. [c9b028bf4da18d99]: ~200 role:unknown
    agents, planningFound=false, no integration branch)."""
    roles = {a.get("role", "").split(":", 1)[0] for a in (audit or {}).get("agents", [])}
    if roles & ENGINE_ROLES:
        return "engine"
    if gate_report and isinstance(gate_report.get("integrationBranch"), str):
        return "engine"
    if planning_found:
        return "engine"
    return "meta"
```

- [ ] **Step 4: Tag and gate in `build_bundle`**

In `build_bundle`, after `audit`, `gate_report`, and `planning_found` are computed and before the bundle dict is written, classify and drop meta sessions; add the field to the bundle:

```python
    session_kind = classify_session_kind(records, audit, gate_report, planning_found)
    if session_kind != "engine":
        return None
    # ... existing bundle = {...} ...
    bundle["sessionKind"] = session_kind
```

(Keep the field next to `origin`/`engineVersion` for readability.)

- [ ] **Step 5: Dedup by transcriptDir in `harvest`**

In `harvest`, track which `transcriptDir` values have already produced a bundle and skip duplicates (two session files can name the same `wf_*` run):

```python
    seen_tdirs = set()
    # inside the per-session loop, after build_bundle returns a dir:
    #   bundle = json.loads((out / "bundle.json").read_text())
    #   tdir = bundle.get("transcriptDir")
    #   if tdir and tdir in seen_tdirs: continue   # same run, already emitted
    #   if tdir: seen_tdirs.add(tdir)
    #   bundles.append(out)
```

Implement that guard against the actual loop variables (the existing loop already builds each bundle and appends its dir). Bundles whose `transcriptDir` is `None` are not deduped (no key to dedup on).

- [ ] **Step 6: Add slice truncation**

In `slice_transcript`, where a user text turn is appended (the `if rtype == "user" and b.get("type") == "text":` branch), cap an oversized single turn:

```python
SLICE_TURN_MAX = 4000  # chars; a pasted-file user turn beyond this is elided

            txt = b.get("text", "")
            if len(txt) > SLICE_TURN_MAX:
                txt = txt[:SLICE_TURN_MAX] + f"\n…[truncated {len(txt) - SLICE_TURN_MAX} chars]"
            lines.append(f"**user:** {txt}")
```

- [ ] **Step 7: Add `--project` / `--session` targeting**

In `harvest`, add keyword-only params and filter the project/session iteration:

```python
def harvest(projects_root, cache_dir, home_slug, *, project=None, session=None):
    # when iterating projects:  if project and proj.name != project: continue
    # when iterating sessions:  if session and sess.stem != session: continue
```

In `main()`, parse a `--project <slug>` / `--session <id>` flag from `sys.argv` (keep the existing positional projects-root behavior; a plain leading flag-free arg stays the root) and thread the values into `harvest(...)`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_harvest_runs.py -v`
Expected: PASS — all new tests plus the existing harvester suite (extractors, epoch, idempotency).

- [ ] **Step 9: Validate the skill and commit**

Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultralearn` → `skill ok`.

```bash
git add skills/ultralearn/scripts/harvest_runs.py tests/test_harvest_runs.py
git commit -m "feat(harvester): engine-fingerprint classifier, dedup, slice truncation, targeting flags"
```

---

### Task 2: Compiler parsing — Files-label coverage + empty-writes-gate classification (`compile_plan.py`)

**Type:** implementation
**Depends-on:** none

Evidence: `[76c7ef053adbf62e]` (Files parser drops `Test fixture(s):`, bare `- None`, and `.gitignore`-style dotfiles), `[c171bd23cbab3265]` (empty-`writes` build/QA task classified `implementation` → ambiguous-files fan-in → forced serial tail). Both = issue #65 family.

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `skills/ultrapowers/references/plan-markers.md`
- Modify: `skills/ultraplan/SKILL.md`
- Test: `tests/test_compile_plan.py`
- Test: `tests/test_marker_contract.py`

**Interfaces:**
- Consumes: nothing.
- Produces: a broadened `FILE_LINE` label set (adds `Test fixture(s)`/`Fixture(s)`); `_is_pathlike` accepts long-stem dotfiles; a bulleted `- None` inside a Files block is a no-op (no near-miss conflict); `classify()` returns `"gate"` for an empty-`writes` task whose prose is build/QA-only. No change to the parsed-task JSON shape beyond `disposition`/`writes`/`marker_conflicts` values.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_compile_plan.py` (use the existing `compile_plan_text` / `compile_text` string-in helpers and the `by_id`/`out["waves"]`/`out["marker_conflicts"]` assertion idioms):

```python
def test_files_parser_accepts_fixture_label_none_and_dotfiles():
    plan = '''### Task 1: Build
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
    plan = '''### Task 1: Verify
**Type:** gate

**Files:**
- None

- [ ] run pytest
'''
    out = compile_plan_text(plan)
    assert not any(c.get("task") == "1" for c in out["marker_conflicts"])


def test_empty_writes_buildqa_task_classifies_as_gate():
    plan = '''### Task 1: Build the bundle
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
    assert "2" in out["gates"]
    assert "2" not in [e["to"] for e in out["dag_edges"] if e.get("why", "").startswith("ambiguous")]
```

Append to `tests/test_marker_contract.py` a guard that the broadened gate heuristic stays documented (mirror its existing `test_contract_documents_compiler_*` pattern):

```python
def test_contract_documents_empty_writes_gate_rule():
    src = (ROOT / "skills/ultrapowers/scripts/compile_plan.py").read_text()
    doc = (ROOT / "skills/ultrapowers/references/plan-markers.md").read_text()
    # the empty-writes build/QA -> gate rule must be disclosed in the contract doc
    assert "empty" in doc.lower() and "writes" in doc.lower() and "gate" in doc.lower()
    assert "EMPTY_WRITES_GATE" in src  # the rule's named marker in the compiler
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_compile_plan.py -k "fixture_label or bulleted_none or buildqa" tests/test_marker_contract.py -k empty_writes -v`
Expected: FAIL — fixture/dotfile tokens drop to `files_near_miss`; bulleted `- None` becomes a near-miss; the empty-writes verify task classifies `implementation` and draws an `ambiguous-files` edge; the contract doc lacks the rule.

- [ ] **Step 3: Broaden the Files-label regex**

In `compile_plan.py` line 35, extend `FILE_LINE` to accept fixture labels:

```python
FILE_LINE = re.compile(r"^-\s*(Create|Modify|Test|Test fixture\(s\)|Fixture\(s\)):\s*(.+)$")
```

- [ ] **Step 4: Accept long-stem dotfiles in `_is_pathlike`**

In `compile_plan.py` (`_is_pathlike`, ~lines 63–77), add a leading-dot dotfile branch before the existing extension check so `.gitignore`/`.dockerignore` count as paths:

```python
    if t.startswith(".") and "/" not in t and len(t) > 1 and " " not in t:
        return True  # dotfile: .gitignore, .dockerignore, .gitattributes
```

- [ ] **Step 5: Treat a bulleted `- None` as an explicit empty Files block**

In the Files-block bullet loop (the "TOTAL rule" at ~lines 327–335), before appending a non-matching bullet to `files_near_miss`, skip a bare `None`:

```python
            if bullet_text.strip().lower() in ("none", "- none"):
                continue  # explicit "no files" — not a near-miss
```

(Match against the actual stripped bullet text variable in that loop.)

- [ ] **Step 6: Classify empty-writes build/QA tasks as gate**

In `classify()` (~lines 418–430), after the existing `GATE_EV` branch at line 428, add the absolute rule and name it for the contract pin:

```python
    # EMPTY_WRITES_GATE: a task that writes nothing and whose only steps are
    # build/verification (no implementation prose) is a gate, not implementation
    # — otherwise it draws an ambiguous-files fan-in from every upstream task and
    # forces a serial tail ([c171bd23cbab3265]).
    if not t["writes"] and not _has_implementation_prose(prose):
        return "gate", True
```

Add a small helper `_has_implementation_prose(prose)` returning `True` when the prose contains implementation verbs beyond build/QA (e.g. matches `\b(implement|add|create|write|refactor|fix|modify)\b` outside fenced code); when it only describes running build/test/QA, return `False`. Keep it conservative — a task with any genuine write or implementation verb stays `implementation`.

- [ ] **Step 7: Document the rule in the contract (three-way pin)**

In `references/plan-markers.md`, in the gate-heuristics disclosure paragraph, add one sentence: a task with no `writes` whose steps are build/verification-only is classified `gate`. Mirror the same sentence into `skills/ultraplan/SKILL.md`'s "Choose the right Type" section (do not link the `plan-markers.md` path — `test_ultraplan_skill.py` forbids it).

- [ ] **Step 8: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_compile_plan.py tests/test_marker_contract.py tests/test_ultraplan_skill.py tests/test_all_plans_compile.py -q`
Expected: PASS — new parsing/classification tests green, all existing compiler + contract + skill-mirror pins green, every committed plan still compiles.

- [ ] **Step 9: Commit**

```bash
git add skills/ultrapowers/scripts/compile_plan.py skills/ultrapowers/references/plan-markers.md skills/ultraplan/SKILL.md tests/test_compile_plan.py tests/test_marker_contract.py
git commit -m "feat(compiler): Files-label coverage (fixtures/None/dotfiles) + empty-writes gate classification"
```

---

### Task 3: Compiler diagnostics — description-edge warning, 0-markers flag, gate-heading boundary, absence lint (`compile_plan.py`)

**Type:** implementation
**Depends-on:** 2

Evidence: `[108894a8435da7c7]` (backticked filename in a `Produces:` description injects a phantom serializing edge), `[8f9af8d0c8afd37b]` (fully-heuristic unmarked plan compiled with no loud flag), `[c682212cdeb736ad]` (non-`### Task` gate heading folds its markers into the preceding task), `[a2fade95c36b2357]` (a task inserts token X and a later step asserts X absent — vacuous self-contradiction).

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `skills/ultraplan/SKILL.md`
- Test: `tests/test_compile_plan.py`
- Test: `tests/test_orchestrator_markers.py`

**Interfaces:**
- Consumes: Task 2's parsed-plan output shape (same `tasks`/`dag_edges`/`marker_conflicts`/`gates` keys; this task only adds fields/notes and preserves that shape).
- Produces: `marker_conflicts` entries gain a distinct `kind:"description-inferred"` for edges inferred from a description/Interfaces field (vs `kind:"inference"` for step-body prose); `result` gains `allHeuristic: bool` plus a `"0 markers — all dispositions inferred"` conflict note when no task carries a marker; a non-`### Task` gate/acceptance heading is a section boundary (its markers no longer fold into the preceding task); a `kind:"absence-assertion"` lint note when a task body inserts a literal token and a later step asserts that token absent.

**Parallelization rationale:** none — this task shares `compile_plan.py` with Task 2, so it is correctly sequenced after it (`Depends-on: 2`); the split is task right-sizing for review (parsing/classification vs diagnostics/lint), not an independence claim.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_compile_plan.py`:

```python
def test_description_inferred_edge_has_distinct_kind():
    plan = '''### Task 1: Ledger
**Type:** implementation

**Files:**
- Create: `merge_ledger.py`

- [ ] write it

### Task 2: Reader
**Type:** implementation

**Files:**
- Create: `reader.py`

**Interfaces:**
- Produces: a reader that complements `merge_ledger.py` by role.

- [ ] write it
'''
    out = compile_plan_text(plan)
    desc_edges = [c for c in out["marker_conflicts"] if c.get("kind") == "description-inferred"]
    assert desc_edges, "a backticked filename in a description must warn as description-inferred"


def test_zero_markers_plan_flags_all_heuristic():
    plan = '''### Task 1: A
**Files:**
- Create: `a.py`

- [ ] do

### Task 2: B
**Files:**
- Create: `b.py`

- [ ] do
'''
    out = compile_plan_text(plan)
    assert out["allHeuristic"] is True
    assert any("0 markers" in c["note"] or "all dispositions inferred" in c["note"]
               for c in out["marker_conflicts"])


def test_non_task_gate_heading_is_a_boundary():
    plan = '''### Task 1: Build
**Type:** implementation

**Files:**
- Create: `a.py`

- [ ] do

## Final Gate
**Type:** gate
**Depends-on:** 1

- [ ] run pytest
'''
    out = compile_plan_text(plan)
    # the gate heading's markers must NOT fold into Task 1 as stray-marker conflicts
    assert not any(c.get("task") == "1" and "outside the header block" in c["note"]
                   for c in out["marker_conflicts"])


def test_absence_assertion_self_contradiction_is_linted():
    plan = '''### Task 1: Add banner
**Type:** implementation

**Files:**
- Modify: `app.py`

- [ ] Insert the literal text `LEGACY_FLAG` into app.py.
- [ ] Verify: `grep LEGACY_FLAG app.py` returns no matches.
'''
    out = compile_plan_text(plan)
    assert any(c.get("kind") == "absence-assertion" for c in out["marker_conflicts"])
```

Append to `tests/test_orchestrator_markers.py` a render pin (mirror its doc-text-assertion style) that the Step-3 transparency render documents the all-heuristic surface:

```python
def test_step3_render_documents_zero_marker_flag():
    skill = (ROOT / "skills/ultrapowers/SKILL.md").read_text()
    assert "all dispositions inferred" in skill or "0 markers" in skill
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_compile_plan.py -k "description_inferred or zero_markers or gate_heading or absence_assertion" tests/test_orchestrator_markers.py -k zero_marker -v`
Expected: FAIL — inferred edges all carry `kind:"inference"`; no `allHeuristic` field/note; the `## Final Gate` markers fold into Task 1; no absence lint; SKILL.md lacks the render line.

- [ ] **Step 3: Distinguish description-inferred edges**

In the Tier-2.5 prose-reference loop (~lines 716–740), when the matched backticked token came from a description/Interfaces field rather than a step body, emit the conflict with `kind="description-inferred"` and a note naming the field. (The prose for a task already spans the body minus the heading at lines 400–401; detect whether the match offset falls inside a `Produces:`/`Consumes:`/`**Files:**`/description region vs a `- [ ]` step region, and set the kind accordingly.) Keep the edge itself (back-compat); only the warning class changes.

- [ ] **Step 4: Emit the all-heuristic flag**

In `main()`, the `marked = any(not t.get("heuristic") for t in out_tasks)` value already exists (~line 965). Add to the `result` dict (~lines 1028–1041) `"allHeuristic": not marked`, and — mirroring the acceptance-missing note at ~lines 970–972 — append a `marker_conflicts` entry when `not marked`:

```python
    if not marked:
        marker_conflicts.append({"task": "", "edge": "",
            "kind": "all-heuristic",
            "note": "0 markers — all dispositions inferred; the wave plan is heuristic-only"})
```

- [ ] **Step 5: Make non-`### Task` gate headings section boundaries**

In `split_tasks` / `_fence_aware_lines` (~lines 107–155), recognize a fence-aware heading that names a gate/acceptance section (e.g. matches `^#{1,4}\s+.*\b(gate|acceptance)\b`, case-insensitive, outside code fences) as a section boundary that closes the current task, so its `Type`/`Depends-on` markers no longer fold into the preceding task's `late_markers`. A recognized non-task gate section is captured as a gate entry (it writes nothing).

- [ ] **Step 6: Add the absence-assertion lint**

Add a lint pass beside the existing conflict-collection in `main()` (~lines 901–961): for each task, collect literal tokens it *inserts* (backticked tokens in `Insert`/`add the literal`/`write the text` steps) and tokens a later step asserts *absent* (a `grep …` paired with "no matches"/"returns nothing"/"absent"). When a task asserts the absence of a token it also inserts, append:

```python
        marker_conflicts.append({"task": tid, "edge": "",
            "kind": "absence-assertion",
            "note": f"task {tid} inserts `{tok}` and a later step asserts it absent — "
                    "a vacuous absence assertion (mirror the sealed-exam RED-at-BASE proof)"})
```

Keep it conservative (only flag a literal token that appears in both an insert step and an absence assertion of the same task).

- [ ] **Step 7: Document the Step-3 render line**

In `skills/ultrapowers/SKILL.md` Step 3 (the disposition/transparency render, ~lines 141–180), add one line stating that when `allHeuristic` is true the render shows "0 markers — all dispositions inferred". (This is the orchestrator-render pin; not a baked prompt.)

- [ ] **Step 8: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_compile_plan.py tests/test_orchestrator_markers.py tests/test_marker_contract.py tests/test_all_plans_compile.py -q`
Expected: PASS — new diagnostics green; existing compiler/contract/orchestrator/all-plans pins green.

- [ ] **Step 9: Commit**

```bash
git add skills/ultrapowers/scripts/compile_plan.py skills/ultraplan/SKILL.md tests/test_compile_plan.py tests/test_orchestrator_markers.py
git commit -m "feat(compiler): description-inferred edge class, 0-markers flag, gate-heading boundary, absence-assertion lint"
```

---

### Task 4: P2 determinism primitives — run-lock, HEAD snapshot/restore, scoped sweep (helper scripts)

**Type:** implementation
**Depends-on:** none

Evidence: `[40e2f6491024d6f4]` (post-run worktrees not swept; repo nearly committed 13+ embedded repos), `[d3329657e0b6fbec]` / `[02b3fec6c5122a9c]` (worktree binds to the session repo; concurrent runs corrupt each other's checkout), and the handoff's "serialize runs" rule made enforceable.

**Files:**
- Create: `skills/ultrapowers/scripts/run_lock.sh`
- Modify: `skills/ultrapowers/scripts/sweep_worktrees.sh`
- Test: `tests/test_run_lock.py`
- Test: `tests/test_sweep_worktrees.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `run_lock.sh acquire <runId>` — writes `.claude/ultrapowers/RUN_LOCK` (the live runId) iff absent or stale; exits non-zero with a refusal message if a different live runId holds it. `run_lock.sh check <runId>` — exit 0 iff the lock holds `<runId>`. `run_lock.sh release <runId>` — removes the lock iff it holds `<runId>`.
  - `run_lock.sh snapshot` — records the current branch + HEAD sha to `.claude/ultrapowers/CHECKOUT_SNAPSHOT`. `run_lock.sh restore` — checks the recorded branch/sha back out.
  - `sweep_worktrees.sh [--run <runId>] [--force]` — scopes removal to `.claude/worktrees/wf_<runId>-*` and branches `worktree-wf_<runId>-*` when `--run` is given (or `RUNID` env / `RUN_LOCK` is set); with no scope, the existing repo-wide `wf_*` behavior is unchanged.

**Parallelization rationale:** `waves.js` has no shell, git, or runId, so the lock/snapshot/restore logic cannot live in the harness — extracting it into a deterministic shell helper is the move a good engineer makes regardless (it is the only way to make it pytest-testable), and as a standalone script it builds in parallel with the engine spine, with the SKILL.md wiring (Task 9) consuming it contract-first.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_run_lock.py` (mirror `tests/test_sweep_worktrees.py`'s temp-git-repo + `subprocess` idiom):

```python
import subprocess, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]
LOCK = ROOT / "skills/ultrapowers/scripts/run_lock.sh"


def _git(repo, *args):
    subprocess.run(["git", "-C", str(repo), *args], check=True,
                   capture_output=True, text=True)


def _repo(tmp_path):
    r = tmp_path / "repo"; r.mkdir()
    _git(r, "init", "-b", "main")
    _git(r, "config", "user.email", "t@t"); _git(r, "config", "user.name", "t")
    (r / "f").write_text("x"); _git(r, "add", "."); _git(r, "commit", "-m", "init")
    return r


def _run(repo, *args):
    return subprocess.run(["bash", str(LOCK), *args], cwd=repo, capture_output=True, text=True)


def test_acquire_then_conflicting_acquire_refuses(tmp_path):
    repo = _repo(tmp_path)
    assert _run(repo, "acquire", "AAA").returncode == 0
    assert (repo / ".claude/ultrapowers/RUN_LOCK").read_text().strip() == "AAA"
    p = _run(repo, "acquire", "BBB")
    assert p.returncode != 0 and "AAA" in (p.stdout + p.stderr)
    assert _run(repo, "release", "AAA").returncode == 0
    assert _run(repo, "acquire", "BBB").returncode == 0


def test_snapshot_restore_returns_to_original_branch(tmp_path):
    repo = _repo(tmp_path)
    _git(repo, "checkout", "-b", "feature")
    assert _run(repo, "snapshot").returncode == 0
    _git(repo, "checkout", "-b", "ultra/integration")
    assert _run(repo, "restore").returncode == 0
    cur = subprocess.run(["git", "-C", str(repo), "branch", "--show-current"],
                         capture_output=True, text=True).stdout.strip()
    assert cur == "feature"
```

Append to `tests/test_sweep_worktrees.py` (reusing its `make_repo`/`add_engine_worktree`/`branches` helpers):

```python
def test_sweep_scoped_to_runid_spares_sibling_run(tmp_path):
    repo = make_repo(tmp_path)
    wt_a = add_engine_worktree(repo, "AAA-1")
    wt_b = add_engine_worktree(repo, "BBB-1")
    p = subprocess.run(["bash", str(SWEEP), "--run", "AAA", "--force"],
                       cwd=repo, capture_output=True, text=True)
    assert p.returncode == 0
    assert not wt_a.exists()
    assert wt_b.exists()  # sibling run survives
    assert any("BBB" in b for b in branches(repo))


def test_sweep_no_scope_is_repo_wide(tmp_path):
    repo = make_repo(tmp_path)
    wt_a = add_engine_worktree(repo, "AAA-1")
    wt_b = add_engine_worktree(repo, "BBB-1")
    subprocess.run(["bash", str(SWEEP), "--force"], cwd=repo, capture_output=True, text=True)
    assert not wt_a.exists() and not wt_b.exists()  # both removed (back-compat)
```

(Confirm the exact `add_engine_worktree` name suffix produces `wf_AAA-1` / `worktree-wf_AAA-1`; adjust the literals to the helper's real naming.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_run_lock.py tests/test_sweep_worktrees.py -k "refuses or snapshot or scoped or no_scope" -v`
Expected: FAIL — `run_lock.sh` does not exist; `sweep_worktrees.sh` removes both runs (no `--run` scope).

- [ ] **Step 3: Write `run_lock.sh`**

Create `skills/ultrapowers/scripts/run_lock.sh` — POSIX shell, derives the repo root from `git rev-parse --show-toplevel`, stores state under `<root>/.claude/ultrapowers/`:

```bash
#!/usr/bin/env bash
# Deterministic run-state actor for /ultrapowers concurrency safety. waves.js has
# no shell/git/runId, so the orchestrator (SKILL.md) drives this at setup/gate.
#   acquire <id> | check <id> | release <id> | snapshot | restore
# Turns silent concurrent-run corruption into a loud refusal; restores the
# session's original checkout at run end. Advisory: never force-moves a tree.
set -eu
ROOT="$(git rev-parse --show-toplevel)"
DIR="$ROOT/.claude/ultrapowers"; LOCK="$DIR/RUN_LOCK"; SNAP="$DIR/CHECKOUT_SNAPSHOT"
mkdir -p "$DIR"
cmd="${1:-}"; arg="${2:-}"
case "$cmd" in
  acquire)
    if [ -f "$LOCK" ] && [ "$(cat "$LOCK")" != "$arg" ]; then
      echo "RUN_LOCK held by $(cat "$LOCK") — another /ultrapowers run is live in this repo; serialize runs (see CLAUDE.md). Refusing $arg." >&2
      exit 1
    fi
    printf '%s' "$arg" > "$LOCK" ;;
  check) [ -f "$LOCK" ] && [ "$(cat "$LOCK")" = "$arg" ] ;;
  release) if [ -f "$LOCK" ] && [ "$(cat "$LOCK")" = "$arg" ]; then rm -f "$LOCK"; fi ;;
  snapshot) printf '%s\t%s' "$(git -C "$ROOT" branch --show-current)" "$(git -C "$ROOT" rev-parse HEAD)" > "$SNAP" ;;
  restore)
    [ -f "$SNAP" ] || { echo "no snapshot to restore" >&2; exit 1; }
    b="$(cut -f1 "$SNAP")"; h="$(cut -f2 "$SNAP")"
    if [ -n "$b" ]; then git -C "$ROOT" checkout "$b"; else git -C "$ROOT" checkout "$h"; fi ;;
  *) echo "usage: run_lock.sh acquire|check|release <id> | snapshot | restore" >&2; exit 2 ;;
esac
```

`chmod +x` it (and `git update-index --chmod=+x` on commit, matching the other scripts).

- [ ] **Step 4: Scope `sweep_worktrees.sh`**

In `sweep_worktrees.sh`: parse an optional `--run <id>` arg (kept distinct from the existing `--force` parse at ~lines 29–33), defaulting to `RUNID` env then the `RUN_LOCK` contents then `*`:

```bash
SCOPE="*"
# parse --run <id> (and keep --force); else: SCOPE="${RUNID:-}"; [ -z "$SCOPE" ] && [ -f "$ROOT/.claude/ultrapowers/RUN_LOCK" ] && SCOPE="$(cat "$ROOT/.claude/ultrapowers/RUN_LOCK")"; [ -z "$SCOPE" ] && SCOPE="*"
```

Then change the worktree glob (line ~44) to `for wt in "$ROOT"/.claude/worktrees/wf_${SCOPE}-*; do` and the branch list (line ~91) to `--list "worktree-wf_${SCOPE}-*"`. A `*` scope reproduces today's repo-wide behavior exactly. Update the script's header comment to document `--run`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_run_lock.py tests/test_sweep_worktrees.py -v`
Expected: PASS — lock acquire/refuse/release, snapshot/restore, scoped sweep spares the sibling, no-scope stays repo-wide.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/scripts/run_lock.sh skills/ultrapowers/scripts/sweep_worktrees.sh tests/test_run_lock.py tests/test_sweep_worktrees.py
git commit -m "feat(engine): run-lock + checkout snapshot/restore helper; scope sweep to a runId"
```

---

### Task 5: P5 launch-safety primitives — engine-skew check, stale-workflow GC, probe round-trip (helper scripts)

**Type:** implementation
**Depends-on:** none

Evidence: `[ae56a1205e971b82]` (version skew: `/ultrapowers` launches the stale cached engine while repo main differs), `[fb8635c59d4fea1c]` (saved-workflow-by-name silently dropped a non-tiny args payload while a tiny probe passed; stale duplicate workflow files on install).

**Files:**
- Create: `skills/ultrapowers/scripts/check_engine_skew.sh`
- Modify: `hooks/session_start.sh`
- Modify: `skills/ultrapowers/harnesses/probe.js`
- Test: `tests/test_engine_skew.py`
- Test: `tests/test_session_hook.py`
- Test: `tests/test_probe.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `check_engine_skew.sh <cached_dir> <repo_dir>` — exit 0 + `IN_SYNC` when the two `harnesses/waves.js` hash-match, non-zero + `SKEW` when they differ (consumed by Task 10's SKILL.md preflight); `session_start.sh` GCs `.claude/workflows/*.js` not in the current manifest set after install; `probe.js` echoes back a representative non-tiny payload (a small `waves` array) so a by-name launch's arg delivery is verified, not just `ping`.

**Parallelization rationale:** these three launch-safety mechanisms are deterministic and live entirely in their own scripts/hooks (not `waves.js`, not the spine); building them as standalone artifacts lets the SKILL.md preflight wiring (Task 10) consume `check_engine_skew.sh` and the probe echo contract-first, in a later wave.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_engine_skew.py`:

```python
import subprocess, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]
SKEW = ROOT / "skills/ultrapowers/scripts/check_engine_skew.sh"


def _engine(d, body):
    (d / "skills/ultrapowers/harnesses").mkdir(parents=True, exist_ok=True)
    (d / "skills/ultrapowers/harnesses/waves.js").write_text(body)
    return d


def test_in_sync_when_engines_match(tmp_path):
    a = _engine(tmp_path / "cache", "WAVES_V1"); b = _engine(tmp_path / "repo", "WAVES_V1")
    p = subprocess.run(["bash", str(SKEW), str(a), str(b)], capture_output=True, text=True)
    assert p.returncode == 0 and "IN_SYNC" in p.stdout


def test_skew_when_engines_differ(tmp_path):
    a = _engine(tmp_path / "cache", "OLD"); b = _engine(tmp_path / "repo", "NEW")
    p = subprocess.run(["bash", str(SKEW), str(a), str(b)], capture_output=True, text=True)
    assert p.returncode != 0 and "SKEW" in (p.stdout + p.stderr)
```

Append to `tests/test_session_hook.py` (mirror `test_session_start_installs_saved_workflows_before_registry_snapshot`'s `TemporaryDirectory` + `subprocess` idiom):

```python
def test_session_start_gcs_stale_workflow(tmp_path_factory):
    # pre-seed an orphan workflow not in the current manifest set; assert it's removed
    import tempfile, os, subprocess, pathlib
    proj = pathlib.Path(tempfile.mkdtemp())
    wf = proj / ".claude/workflows"; wf.mkdir(parents=True)
    (wf / "workflow.js").write_text("// stale 0.0.6 orphan\n")
    env = dict(os.environ, CLAUDE_PROJECT_DIR=str(proj))
    subprocess.run(["bash", str(HOOK)], env=env, capture_output=True, text=True)
    assert not (wf / "workflow.js").exists()           # orphan GC'd
    assert (wf / "waves.js").exists()                  # current manifest survives
```

(Reuse the file's existing `HOOK` constant / install-assertion helpers; align `waves.js` to whatever filename the current `*.harness.json` set installs.)

Append to `tests/test_probe.py` a representative-payload round-trip assertion (mirror the file's existing probe-exec idiom):

```python
def test_probe_echoes_representative_payload():
    # the probe must echo back a non-tiny waves payload, not just ping=pong,
    # so a by-name launch's arg delivery is actually verified ([fb8635c59d4fea1c])
    src = (ROOT / "skills/ultrapowers/harnesses/probe.js").read_text()
    assert "waves" in src and "echo" in src.lower()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_engine_skew.py tests/test_session_hook.py -k gcs_stale tests/test_probe.py -k representative -v`
Expected: FAIL — `check_engine_skew.sh` absent; `session_start.sh` leaves the orphan; `probe.js` only handles `ping`.

- [ ] **Step 3: Write `check_engine_skew.sh`**

Create `skills/ultrapowers/scripts/check_engine_skew.sh`:

```bash
#!/usr/bin/env bash
# Self-host preflight: compare the installed (cached) engine to the repo engine.
# When /ultrapowers self-hosts in the ultrapowers repo, the cache can lag repo
# main and the run would exercise the wrong engine ([ae56a1205e971b82]).
set -eu
cached="${1:?cached engine dir}"; repo="${2:?repo engine dir}"
cf="$cached/skills/ultrapowers/harnesses/waves.js"
rf="$repo/skills/ultrapowers/harnesses/waves.js"
if [ ! -f "$cf" ] || [ ! -f "$rf" ]; then echo "SKEW: missing engine file" >&2; exit 1; fi
if [ "$(shasum -a 256 "$cf" | cut -d' ' -f1)" = "$(shasum -a 256 "$rf" | cut -d' ' -f1)" ]; then
  echo "IN_SYNC"; exit 0
fi
echo "SKEW: cached engine differs from repo engine — install the repo engine into .claude/workflows/ before launch" >&2
exit 1
```

(Use `shasum -a 256` for macOS/Linux portability; the other scripts already assume it.)

- [ ] **Step 4: GC stale workflows in `session_start.sh`**

In the harness-install loop (~lines 22–29), after copying the current manifest set, remove any `.claude/workflows/*.js` whose basename is not among the just-installed set. Build the kept-set from the `*.harness.json` filenames being installed, then:

```bash
  for existing in "$dest"/*.js; do
    [ -e "$existing" ] || continue
    base="$(basename "$existing")"
    case " $installed_set " in *" $base "*) : ;; *) rm -f "$existing" ;; esac
  done
```

Keep the whole block guarded so it can never break the hook (the file's existing `|| true` discipline).

- [ ] **Step 5: Echo a representative payload from `probe.js`**

In `probe.js`, extend the result so it echoes back a representative slice of `args` (e.g. the first `waves` entry's `id`/`body` length) in addition to `ping`, so a by-name launch verifies real arg delivery:

```javascript
  return { ping: A && A.ping, echoWaves: (A && Array.isArray(A.waves)) ? A.waves.length : 0,
           echoFirstId: (A && A.waves && A.waves[0] && A.waves[0].id) || null }
```

(Keep `meta.name` and the harness contract unchanged; `probe.harness.json` stays as-is.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_engine_skew.py tests/test_session_hook.py tests/test_probe.py tests/test_harness_registry.py -q`
Expected: PASS — skew detection both ways, stale GC with current files preserved, probe echoes the payload, registry pins still green.

- [ ] **Step 7: Commit**

```bash
git add skills/ultrapowers/scripts/check_engine_skew.sh hooks/session_start.sh skills/ultrapowers/harnesses/probe.js tests/test_engine_skew.py tests/test_session_hook.py tests/test_probe.py
git commit -m "feat(launch): engine-skew preflight check, stale-workflow GC on install, representative probe echo"
```

---

### Task 6: Sealed runner — framework-agnostic "tests actually ran" detection (`run_acceptance.sh`)

**Type:** implementation
**Depends-on:** none

Evidence: `[f396cfe4bf66c1af]` — the anti-false-green guard keys on a marker only pytest writes (`.__ran__` via an injected `conftest.py`), so a passing non-pytest acceptance suite is falsely rejected with a blocking non-zero exit, and a non-pytest red is mislabeled `collection`. (The ledger mis-attributes the surface to `compile_plan.py`; the code is `run_acceptance.sh`.)

**Files:**
- Modify: `skills/ultrapowers/scripts/run_acceptance.sh`
- Test: `tests/test_run_acceptance.py`

**Interfaces:**
- Consumes: `runCmd` / `bootstrapCmd` (manifest fields already read by `run_acceptance.sh`).
- Produces: an optional manifest field `framework` (default `pytest` — unchanged behavior); for a non-pytest framework the runner skips the `conftest.py` injection and detects "tests ran" from the runner's own output (a configurable `ranPattern`, e.g. a pass/skip count regex over the captured `OUT`), so a green non-pytest suite certifies (`status:OK, passed:true`) and a non-pytest red labels `redKind:assertion` when tests executed.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_run_acceptance.py` (reuse its `make_repo`/`make_vault`/`_write_manifest` helpers and the `bash run_acceptance.sh` subprocess + JSON-parse idiom):

```python
def test_non_pytest_green_suite_certifies(tmp_path):
    repo = make_repo(tmp_path, feature_built=True)
    vault = make_vault(tmp_path, run_cmd="bash run.sh",
                       framework="generic", ran_pattern=r"[0-9]+ passed",
                       suite_files={"run.sh": 'echo "1 passed"; exit 0\n'})
    res = run_acceptance(repo, vault)          # helper that invokes the script + parses JSON
    assert res["status"] == "OK" and res["passed"] is True


def test_non_pytest_red_suite_is_assertion(tmp_path):
    repo = make_repo(tmp_path, feature_built=False)
    vault = make_vault(tmp_path, run_cmd="bash run.sh",
                       framework="generic", ran_pattern=r"[0-9]+ (passed|failed)",
                       suite_files={"run.sh": 'echo "1 failed"; exit 1\n'})
    res = run_acceptance(repo, vault)
    assert res["passed"] is False and res["redKind"] == "assertion"
```

(Extend `make_vault` / the manifest writer to accept `framework` and `ran_pattern`, writing them into `manifest.json`; add a tiny `run_acceptance(repo, vault)` wrapper if the file doesn't already have one, modeled on the existing pytest cases.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_run_acceptance.py -k "non_pytest" -v`
Expected: FAIL — the green non-pytest suite returns `status:ERROR` ("exited 0 but ran no sealed tests") because no `.__ran__` marker exists; the red one is labeled `collection`.

- [ ] **Step 3: Gate the conftest injection and ran-detection on `framework`**

In `run_acceptance.sh`: read `FRAMEWORK` from `manifest.json` (default `pytest`) and `RAN_PATTERN` (optional). Make the `conftest.py` write (~lines 84–88) conditional on `FRAMEWORK = pytest`. In the green-exit guard (~lines 103–112), accept "tests ran" when either the pytest `.__ran__` marker exists (pytest path) **or** `FRAMEWORK != pytest` and `OUT` matches `RAN_PATTERN`:

```bash
ran=0
if [ "$FRAMEWORK" = "pytest" ]; then
  [ -f "$RAN_MARKER" ] && ran=1
elif [ -n "${RAN_PATTERN:-}" ] && printf '%s' "$OUT" | grep -Eq "$RAN_PATTERN"; then
  ran=1
fi
```

Use `ran` in both the green-exit false-green guard (refuse only when `ran=0`) and the red `redKind` classification (`assertion` when `ran=1`, else `collection`). Default behavior for pytest manifests is byte-identical to today.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_run_acceptance.py -v`
Expected: PASS — non-pytest green certifies, non-pytest red is `assertion`, and every existing pytest case (bootstrap, false-green, assertion/collection, baseline) stays green.

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/run_acceptance.sh tests/test_run_acceptance.py
git commit -m "feat(sealed): framework-agnostic tests-actually-ran detection for non-pytest suites"
```

---

### Task 7: Version-sync guard — plugin.json must match marketplace.json

**Type:** implementation
**Depends-on:** none

Evidence: `[5000bc37c482ec5c]` — `marketplace.json` silently lagged `plugin.json` (the documented "plugin.json wins silently if they drift" gotcha, observed live). A pytest assertion catches it; CI already runs `pytest tests/`, so no `ci.yml` edit is needed.

**Files:**
- Test: `tests/test_version_sync.py` (new)

**Interfaces:**
- Consumes: `.claude-plugin/plugin.json` (`.version`), `.claude-plugin/marketplace.json` (`.plugins[]` entry where `name == "ultrapowers"`, `.version`).
- Produces: none — a forward CI guard only (a pytest assertion, no runtime symbols).

- [ ] **Step 1: Write the test**

Create `tests/test_version_sync.py`:

```python
"""Lockstep guard: plugin.json and marketplace.json must carry the SAME version.
A release bumps both; plugin.json wins silently if they drift (CLAUDE.md gotcha;
observed live as ledger finding 5000bc37c482ec5c)."""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
PLUGIN = ROOT / ".claude-plugin/plugin.json"
MARKETPLACE = ROOT / ".claude-plugin/marketplace.json"


def test_plugin_and_marketplace_versions_match():
    plugin_version = json.loads(PLUGIN.read_text())["version"]
    market = json.loads(MARKETPLACE.read_text())
    entry = next(p for p in market["plugins"] if p["name"] == "ultrapowers")
    assert entry["version"] == plugin_version, (
        f"version drift: plugin.json={plugin_version!r} but marketplace.json "
        f"plugins[ultrapowers]={entry['version']!r} — a release must bump BOTH"
    )
```

- [ ] **Step 2: Prove it bites (RED-at-base), then confirm GREEN**

The manifests currently match (`0.0.20`), so prove the guard works:

Run: `python3 -c "import json,pathlib; p=pathlib.Path('.claude-plugin/marketplace.json'); d=json.loads(p.read_text()); d['plugins'][0]['version']='0.0.19'; p.write_text(json.dumps(d,indent=2)+chr(10))"`
Run: `python3 -m pytest tests/test_version_sync.py -v` → Expected: FAIL (drift detected).
Run: `git checkout .claude-plugin/marketplace.json` (revert the mutation).
Run: `python3 -m pytest tests/test_version_sync.py -v` → Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/test_version_sync.py
git commit -m "test(release): assert plugin.json and marketplace.json versions stay in lockstep"
```

---

## Engine-core spine (Tasks 8–13) — shared waves.js / baked prompts / report-format.md / SKILL.md

### Task 8: Report structural signals — coverage column + missing-deliverables list (`waves.js`)

**Type:** implementation
**Depends-on:** none

Evidence: `[e13115e8fb3275f6]` (false-green: tasks 4–6 never merged, suite 28/28 green because only existing tests can fail), `[fbbfab723f1eab2e]` (a transient-overload-killed mid-DAG task left no trace; green because its tests were absent), `[33605b21f5894b14]` (a correct task's branch silently dropped during integration). The engine has no git, so it emits only the *structural* coverage/deliverable signals; the git tree-diff is the critic's job (Task 9).

**Files:**
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Modify: `skills/ultrapowers/references/report-format.md`
- Test: `tests/sim_workflow.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: run-report fields at both return sites (main ~1196–1209, budget-exhausted ~845–857) — `coverage: { tasks_merged, tasks_planned, complete: bool }` where `tasks_planned = WAVES.flat().length` and `tasks_merged = |union of waveMerges[].branches over status==='MERGED'|`; and `missingDeliverables: [{ task, files }]` for every `failed` or cascade-blocked task. Task 9 reads both (gitVerified surfacing + the SKILL.md gate).

- [ ] **Step 1: Add the failing sim scenario**

In `tests/sim_workflow.mjs`, add a scenario modeled on `scenarioBlockedCascade` / `scenarioAcceptanceSuiteGreen` (drive a run where one task fails so `tasks_merged < tasks_planned` while the integration suite is green), immediately before the runner block at the bottom:

```javascript
async function scenarioCoverageAndMissingDeliverables() {
  // Two tasks; B fails at impl. A merges, suite is green -> classic false green.
  const WAVES = [[{ id: 'A', title: 'a', body: 'b', files: ['a.py'] },
                  { id: 'B', title: 'b', body: 'b', files: ['b.py'] }]]
  const agent = async (prompt, opts) => {
    const label = opts.label || ''
    if (label === 'setup') return { branch: 'ultra/integration-sim', headSha: 'int0' }
    if (label === 'impl:A') return { status: 'DONE', summary: 's', branch: 'wt-A', headSha: 'sha-A', commit: 'c-A' }
    if (label === 'impl:B') throw new Error('persistent agent error')
    if (label.startsWith('review:')) return { verdict: 'PASS', issues: [] }
    if (label.startsWith('merge:')) return { status: 'MERGED', headSha: 'm', branches: ['A'] }
    if (label === 'integration') return { command: 'pytest', testsPassed: true, output: 'ok', findings: [] }
    throw new Error('unexpected agent label: ' + label)
  }
  const r = await runWorkflow({ agent, args: { ...baseArgs, waves: WAVES, dependencyEdges: [] }, budget: undefined })
  eq(r.coverage.tasks_planned, 2, 'coverage: 2 tasks planned')
  eq(r.coverage.tasks_merged, 1, 'coverage: 1 task merged')
  eq(r.coverage.complete, false, 'coverage: not complete (merged<planned)')
  assert(r.tests.passed === true, 'coverage: suite green despite incompleteness (the false-green)')
  assert(r.missingDeliverables.some(m => m.task === 'B' && m.files.includes('b.py')),
         'missingDeliverables: B\'s b.py flagged as unmerged')
  console.log('scenario coverage-and-missing-deliverables: OK')
}
```

Register it by adding `await scenarioCoverageAndMissingDeliverables()` to the run list at the bottom.

- [ ] **Step 2: Run the sim to verify it fails**

Run: `node tests/sim_workflow.mjs`
Expected: FAIL — `r.coverage` and `r.missingDeliverables` are `undefined`.

- [ ] **Step 3: Compute the signals before each return**

In `waves.js`, just before the main report `return` (~1196), compute:

```javascript
  const mergedBranches = new Set()
  for (const wm of waveMerges) if (wm && wm.status === 'MERGED') for (const b of (wm.branches || [])) mergedBranches.add(b)
  const tasksPlanned = WAVES.flat().length
  const coverage = { tasks_merged: mergedBranches.size, tasks_planned: tasksPlanned,
                     complete: mergedBranches.size >= tasksPlanned }
  const blockedIds = new Set(unfinished.map((u) => (typeof u === 'string' ? u : u && u.task)).filter(Boolean))
  const missingDeliverables = taskResults
    .filter((t) => t.status === 'failed' || blockedIds.has(t.task))
    .map((t) => ({ task: t.task, files: (WAVES.flat().find((w) => w.id === t.task) || {}).files || [] }))
    .filter((m) => m.files.length)
```

Add `coverage` and `missingDeliverables` to the main return object. Then add the same two keys to the budget-exhausted early return (~845–857), where no merges occurred: `coverage: { tasks_merged: 0, tasks_planned: WAVES.flat().length, complete: false }` and `missingDeliverables: []`. (Adjust to the exact variable names available at each return.)

- [ ] **Step 4: Run the sim to verify it passes**

Run: `node tests/sim_workflow.mjs`
Expected: PASS — `scenario coverage-and-missing-deliverables: OK`, and every pre-existing scenario still prints `OK`, ending with `ALL SCENARIOS PASSED`.

- [ ] **Step 5: Document the new report fields**

In `references/report-format.md`, add `coverage` and `missingDeliverables` to the field reference and the `required`/optional schema list, and add a presentation note: when `coverage.complete` is false, the report shows a ⚠ "green suite but N/M tasks merged" beside the test result. Do not introduce a new `reviewVerdict` literal (that would trip `test_report_runbook.py`'s cross-check).

- [ ] **Step 6: Confirm no prompt drift and run the gate**

Run: `python3 -m pytest tests/test_no_prompt_drift.py tests/test_report_runbook.py tests/test_workflow_sim.py -q`
Expected: PASS (this task changes harness logic + report doc only; no baked prompt moved).

- [ ] **Step 7: Commit**

```bash
git add skills/ultrapowers/harnesses/waves.js skills/ultrapowers/references/report-format.md tests/sim_workflow.mjs
git commit -m "feat(report): coverage column + structural missing-deliverables list (green-suite != done)"
```

---

### Task 9: Git-verified ground-truth — critic head-assert surfaced, deliverable tree-diff, visual-eyeball channel (`waves.js` + baked `COMPLETENESS_PROMPT` + gate)

**Type:** implementation
**Depends-on:** 8

Evidence: `[cec1d591d298df39]` / #29 (completeness critic reviewed a STALE DETACHED tree and raised false-alarm gaps — "the critic doesn't verify the tree it reviews is the tree it was asked to review"), `[12211b649f4f7336]` (stale codegen → narrowed testCmd green while the full gate was red), `[4afb72b815e86d8b]` (whole runtime/UI layers untested by design — needs a first-class "needs a browser" channel). Builds on Task 8's `coverage`/`missingDeliverables`.

**Files:**
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Modify: `skills/ultrapowers/references/wave-merge.md`
- Modify: `skills/ultrapowers/references/report-format.md`
- Modify: `skills/ultrapowers/SKILL.md`
- Test: `tests/sim_workflow.mjs`
- Test: `tests/test_no_prompt_drift.py`

**Interfaces:**
- Consumes: `coverage` / `missingDeliverables` from Task 8 (same report object); the `COMPLETENESS_PROMPT(mergeHeadSha, cannotVerifyChecklist)` baked function (~339–351) that already instructs the critic to `git checkout --detach {{MERGE_HEAD_SHA}}`, `git rev-parse HEAD`, confirm equality, and report BLOCKED on mismatch.
- Produces: `REVIEW_SCHEMA` (un-pinned, ~416–424) gains `onIntegrationHead: bool` and `visualEyeball: string[]`; the report gains `gitVerified: bool` (true iff the critic confirmed it reviewed the recorded merge HEAD) and `visualEyeballItems: string[]`; the `COMPLETENESS_PROMPT` additionally diffs the plan's `Create:` paths for failed/blocked tasks against the integration tree and lists genuinely-absent deliverables, and reports verified-by-construction-but-needs-a-browser items; SKILL.md Step 5 gates Approve on `coverage.complete`, empty confirmed-missing deliverables, and `gitVerified`.

- [ ] **Step 1: Add the failing sim scenario**

In `tests/sim_workflow.mjs`, add a scenario where the completeness critic returns the new fields, modeled on `scenarioCannotVerifyEscalation`:

```javascript
async function scenarioGitVerifiedAndVisualEyeball() {
  const WAVES = [[{ id: 'A', title: 'a', body: 'b', files: ['ui.tsx'] }]]
  const agent = async (prompt, opts) => {
    const label = opts.label || ''
    if (label === 'setup') return { branch: 'ultra/integration-sim', headSha: 'int0' }
    if (label === 'impl:A') return { status: 'DONE', summary: 's', branch: 'wt-A', headSha: 'sha-A', commit: 'c-A' }
    if (label.startsWith('review:')) return { verdict: 'PASS', issues: [] }
    if (label.startsWith('merge:')) return { status: 'MERGED', headSha: 'mfinal', branches: ['A'] }
    if (label === 'integration') return { command: 'pytest', testsPassed: true, output: 'ok',
      findings: [], onIntegrationHead: true, visualEyeball: ['ui.tsx renders the new panel — verify in a browser'] }
    throw new Error('unexpected agent label: ' + label)
  }
  const r = await runWorkflow({ agent, args: { ...baseArgs, waves: WAVES, dependencyEdges: [] }, budget: undefined })
  eq(r.gitVerified, true, 'gitVerified: critic confirmed it reviewed the merge HEAD')
  assert(r.visualEyeballItems.some(v => /browser/i.test(v)), 'visualEyeballItems: browser item surfaced')
  console.log('scenario git-verified-and-visual-eyeball: OK')
}
```

Add a second assertion case (a critic returning `onIntegrationHead: false` → `r.gitVerified === false` and a judgment call). Register both in the runner block.

- [ ] **Step 2: Run the sim to verify it fails**

Run: `node tests/sim_workflow.mjs`
Expected: FAIL — `r.gitVerified` and `r.visualEyeballItems` are `undefined`.

- [ ] **Step 3: Extend `REVIEW_SCHEMA` and surface the fields (un-pinned schema)**

In `waves.js` `REVIEW_SCHEMA` (~416–424), add `onIntegrationHead` (boolean) and `visualEyeball` (array of strings) as optional properties. Where `review` is consumed (~1128+), derive:

```javascript
  const gitVerified = !!(review && review.onIntegrationHead)
  const visualEyeballItems = (review && Array.isArray(review.visualEyeball)) ? review.visualEyeball : []
  if (review && review.onIntegrationHead === false)
    judgmentCalls.push('completeness critic could NOT confirm it reviewed the recorded merge HEAD — possible checkout drift (#29); verify the integration tree before merging')
```

Add `gitVerified` and `visualEyeballItems` to both report return objects (main + the budget-exhausted early return, where `gitVerified: false`, `visualEyeballItems: []`).

- [ ] **Step 4: Extend the baked `COMPLETENESS_PROMPT` (edit source + waves.js, keep drift green)**

In `references/wave-merge.md`, inside `<!-- BAKE:COMPLETENESS_PROMPT -->`, after the existing HEAD self-assert, add two instructions (verbatim wording must also go into the `completenessPrompt(...)` string in `waves.js`):

```
After confirming HEAD equals the recorded merge sha, set onIntegrationHead true in
your result (false if you could not confirm it). Read the plan at the provided
planPath; for every task reported failed or blocked, check whether its declared
Create: paths exist in the tree — list any that are genuinely absent as missing
deliverables. For any deliverable that is present and structurally complete but
whose behavior can only be confirmed in a browser or live UI, list it under
visualEyeball so the operator's attention goes exactly there.
```

Mirror the same words into the `completenessPrompt` function body in `waves.js`. Then iterate `python3 -m pytest tests/test_no_prompt_drift.py -q` until the `COMPLETENESS_PROMPT` fragments match in order.

- [ ] **Step 5: Gate on the new signals at Step 5 (SKILL.md)**

In `skills/ultrapowers/SKILL.md` Step 5 (the pre-merge gate, ~323–352), add to the Approve criteria (prose, not code — the orchestrator runs it):
- Surface the `coverage` ⚠ when `coverage.complete` is false (green suite but tasks unmerged → do not Approve without explicit operator acknowledgement).
- If `missingDeliverables` is non-empty after the critic's tree-diff (i.e. the critic confirmed absent paths), treat as `BLOCKED`.
- If `gitVerified` is false, treat the completeness review as unverified — `BLOCKED` pending a manual integration-tree check; this hardens the existing `git rev-parse <integrationBranch>` == `waveMerges[last].headSha` prose (~line 333) into a report-driven gate.
- Present `visualEyeballItems` as the explicit "verify in a browser" checklist alongside the live viewer.

- [ ] **Step 6: Document the new fields**

In `references/report-format.md`, add `gitVerified` and `visualEyeballItems` to the field reference and note the Step-5 gating semantics. No new `reviewVerdict` literal.

- [ ] **Step 7: Run the sim and the gate**

Run: `node tests/sim_workflow.mjs` → Expected: PASS (both new scenarios + all prior, ending `ALL SCENARIOS PASSED`).
Run: `python3 -m pytest tests/test_no_prompt_drift.py tests/test_report_runbook.py tests/test_workflow_sim.py -q` → Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add skills/ultrapowers/harnesses/waves.js skills/ultrapowers/references/wave-merge.md skills/ultrapowers/references/report-format.md skills/ultrapowers/SKILL.md tests/sim_workflow.mjs
git commit -m "feat(report): git-verified critic flag (#29 hard gate), deliverable tree-diff, visual-eyeball channel"
```

---

### Task 10: Prompt determinism — merge/reconcile HEAD-assert + cleanup-out-of-prompt (baked `MERGE_PROMPT`/`RECONCILE_PROMPT`)

**Type:** implementation
**Depends-on:** 9

Evidence: `[33605b21f5894b14]` (a merged task's branch silently dropped — the merge agent doesn't assert it's on the integration HEAD), and the P2 directive that cleanup be a deterministic actor (Task 4's sweep), never a merge-prompt instruction. The completeness critic already self-asserts HEAD (Task 9 surfaces it); this brings the merge/reconcile agents to the same bar and removes the agent-side cleanup.

**Files:**
- Modify: `skills/ultrapowers/references/wave-merge.md`
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Test: `tests/test_no_prompt_drift.py`

**Interfaces:**
- Consumes: no sibling-produced symbols — operates on the baked `MERGE_PROMPT`/`RECONCILE_PROMPT` (distinct from Task 9's `COMPLETENESS_PROMPT`).
- Produces: `MERGE_PROMPT` and `RECONCILE_PROMPT` instruct the agent to echo `git rev-parse HEAD` + `git branch --show-current` and report BLOCKED on mismatch with the integration branch; the `MERGE_PROMPT` no longer instructs the agent to remove worktrees / delete branches (cleanup is Task 4's `sweep_worktrees.sh` at the Step-5 gate).

**Parallelization rationale:** the baked-prompt edits (`waves.js` + `wave-merge.md`) and the orchestrator wiring (Task 11, `SKILL.md`) touch disjoint files, so both depend on Task 9 but run concurrently — splitting prompt-text determinism from orchestrator procedure is a genuine responsibility seam a good engineer keeps separate, and it wins a parallel wave.

- [ ] **Step 1: Write the failing drift + negative-assertion tests**

The HEAD-assert (additions) are caught by the existing `test_wave_prompt_is_baked[MERGE_PROMPT]`/`[RECONCILE_PROMPT]` once added to the `.md` but not `waves.js`. For the cleanup *removal* (drift can't catch a deletion from both copies), add a negative assertion to `tests/test_no_prompt_drift.py`:

```python
def test_merge_prompt_does_not_instruct_cleanup():
    wf = normalize(WORKFLOW.read_text())
    # the merge agent must NOT be told to remove worktrees or delete branches —
    # cleanup is the deterministic sweep at the Step-5 gate, not a merge-prompt step
    for forbidden in ("worktree remove", "git branch d", "delete the branch", "clean up the merged branches"):
        assert normalize(forbidden) not in wf, f"merge prompt still instructs cleanup: {forbidden!r}"
```

Add a positive assertion that the HEAD-assert words are present in the merge region:

```python
def test_merge_prompt_asserts_head():
    wf = normalize(WORKFLOW.read_text())
    assert normalize("git rev-parse HEAD") in wf and normalize("git branch --show-current") in wf
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_no_prompt_drift.py -k "cleanup or asserts_head" -v`
Expected: FAIL — `git branch --show-current` not yet in the merge region; the cleanup instruction is still present (`waves.js` ~322–326).

- [ ] **Step 3: Add the HEAD-assert to both prompts (source + waves.js)**

In `references/wave-merge.md`, inside `<!-- BAKE:MERGE_PROMPT -->` and `<!-- BAKE:RECONCILE_PROMPT -->`, add (and mirror verbatim into the matching `waves.js` strings ~316–332):

```
Before merging, echo git rev-parse HEAD and git branch --show-current; if the
branch is not the integration branch you were asked to operate on, report BLOCKED
and merge nothing — do not detach or move any other checkout.
```

- [ ] **Step 4: Remove the cleanup instruction from `MERGE_PROMPT` (source + waves.js)**

In `references/wave-merge.md` `<!-- BAKE:MERGE_PROMPT -->`, delete the sentence instructing the agent to `git worktree remove` / `git branch -d` merged branches (the "After ALL branches … clean up the merged branches only …" clause). Delete the identical clause from the `MERGE_PROMPT` string in `waves.js` (~322–326). Update the supporting (un-pinned) worktree-facts prose in `wave-merge.md` (~lines 55–58) to say the deterministic Step-5 sweep removes worktrees/branches, not the merge agent.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_no_prompt_drift.py -q`
Expected: PASS — all baked blocks match in order (HEAD-assert present in both copies), the negative cleanup assertion passes (instruction gone from both), `MERGE_PROMPT`/`RECONCILE_PROMPT` fragments still align.

- [ ] **Step 6: Run the sim (no regression)**

Run: `node tests/sim_workflow.mjs`
Expected: PASS — `ALL SCENARIOS PASSED` (prompt-text changes don't alter the simulated control flow).

- [ ] **Step 7: Commit**

```bash
git add skills/ultrapowers/references/wave-merge.md skills/ultrapowers/harnesses/waves.js tests/test_no_prompt_drift.py
git commit -m "feat(engine): merge/reconcile agents assert integration HEAD; cleanup moved out of the merge prompt"
```

---

### Task 11: Orchestrator concurrency wiring — run-lock + snapshot/restore + scoped sweep (`SKILL.md`)

**Type:** implementation
**Depends-on:** 4, 9

Evidence: `[40e2f6491024d6f4]` / `[d3329657e0b6fbec]` / `[02b3fec6c5122a9c]` — wires Task 4's deterministic primitives into the run lifecycle so concurrent runs are refused loudly, the session checkout is restored exactly, and the sweep is scoped to this run.

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`
- Test: `tests/test_report_runbook.py` (string-presence pin for the new gate steps)

**Interfaces:**
- Consumes: `run_lock.sh acquire|check|release|snapshot|restore` and `sweep_worktrees.sh --run <runId>` (Task 4).
- Produces: SKILL.md Step 4 acquires the lock with the launch runId and snapshots the session checkout before launch; Step 5 checks the lock, restores the snapshot (instead of assuming `baseBranch`), and sweeps scoped to `--run <runId>`; on a lock held by a different runId the orchestrator refuses to launch.

**Parallelization rationale:** SKILL.md (orchestrator procedure) is disjoint from Task 10's baked-prompt files, so this runs in the same wave as Task 10 after Task 9 — see Task 10's rationale.

- [ ] **Step 1: Write the failing pin test**

Append to `tests/test_report_runbook.py` (mirror its `SKILL.md`-string-presence style):

```python
def test_skill_wires_run_lock_and_scoped_sweep():
    skill = (ROOT / "skills/ultrapowers/SKILL.md").read_text()
    assert "run_lock.sh acquire" in skill and "run_lock.sh snapshot" in skill
    assert "run_lock.sh restore" in skill
    assert "sweep_worktrees.sh --run" in skill
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/test_report_runbook.py -k run_lock -v`
Expected: FAIL — SKILL.md does not yet reference the helper.

- [ ] **Step 3: Wire the lock + snapshot at Step 4 (launch)**

In SKILL.md Step 4, before the `Workflow(...)` launch, add (prose + the exact command), using the `.claude/ultrapowers/` dir already used for the wavesPath temp file:

```
Acquire the run lock and snapshot the session checkout (the deterministic actor —
the engine cannot do this; it has no shell or runId):
  bash ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/run_lock.sh acquire <runId>
  bash ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/run_lock.sh snapshot
If acquire exits non-zero, another /ultrapowers run holds this repo — STOP and tell
the operator to serialize runs; do not launch.
```

(The orchestrator learns `<runId>` from the launch result's transcript dir name `wf_<runId>`; acquire/snapshot run with a provisional id, then the lock is re-pointed once the runId is known — or acquire after the launch returns the runId. Specify whichever ordering the Step-4 flow supports; the lock must be held for the run's duration and the snapshot taken before any branch switch.)

- [ ] **Step 4: Wire check + restore + scoped sweep at Step 5 (gate)**

In SKILL.md Step 5, replace the bare "restore the session checkout (`git checkout <baseBranch>`)" instruction (~325–326) with the snapshot restore, and scope the sweep:

```
Restore the exact session checkout this run started from (not an assumed base):
  bash ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/run_lock.sh restore
Confirm this run still owns the lock before any merge:
  bash ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/run_lock.sh check <runId>
... (existing porcelain + rev-parse==waveMerges[last].headSha guards) ...
On Approve, sweep only this run's worktrees, then release the lock:
  bash ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/sweep_worktrees.sh --run <runId>
  bash ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/run_lock.sh release <runId>
```

Keep the existing `git checkout <integrationBranch>` (Step-1-verifies-on-current-checkout) ordering note intact.

- [ ] **Step 4b: Run the test to verify it passes**

Run: `python3 -m pytest tests/test_report_runbook.py -k run_lock -v`
Expected: PASS.

- [ ] **Step 5: Validate the skill and commit**

Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` → `skill ok`.

```bash
git add skills/ultrapowers/SKILL.md tests/test_report_runbook.py
git commit -m "feat(orchestrator): wire run-lock, checkout snapshot/restore, and run-scoped sweep into the lifecycle"
```

---

### Task 12: Launch gate hardening — result-schema degrade + skew preflight + probe round-trip (`SKILL.md`)

**Type:** implementation
**Depends-on:** 5, 11

Evidence: `[cbf0d886651f723c]` (Step-5 merge-sha guard crashed on a missing `waveMerges` key), `[ae56a1205e971b82]` (cache-vs-repo engine skew at launch), `[fb8635c59d4fea1c]` (by-name launch dropped a non-tiny payload; a tiny probe passed). Wires Task 5's primitives into the launch/gate procedure.

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultrapowers/references/report-format.md`
- Test: `tests/test_report_runbook.py`

**Interfaces:**
- Consumes: `check_engine_skew.sh` and the `probe.js` representative-payload echo (Task 5); the SKILL.md lifecycle edits from Task 11 (same file).
- Produces: a Step-0/1 self-host skew preflight that runs `check_engine_skew.sh` and installs the repo engine on `SKEW`; a Step-4a½ probe assertion that the representative payload round-trips through the by-name launch (else fall back to Step 6); a Step-5 result-schema degrade clause — if `waveMerges` is missing/empty or the last entry has no `headSha`, surface "merge-sha guard unavailable" as `BLOCKED` rather than crashing; and a `report-format.md` note pinning `waveMerges` shape so drift is caught by a test, not at a live gate.

- [ ] **Step 1: Write the failing pin test**

Append to `tests/test_report_runbook.py`:

```python
def test_skill_has_skew_preflight_probe_roundtrip_and_schema_degrade():
    skill = (ROOT / "skills/ultrapowers/SKILL.md").read_text()
    assert "check_engine_skew.sh" in skill
    assert "round-trip" in skill or "roundtrip" in skill or "echoWaves" in skill
    assert "merge-sha guard unavailable" in skill
    fmt = (ROOT / "skills/ultrapowers/references/report-format.md").read_text()
    assert "waveMerges" in fmt and ("may be empty" in fmt or "missing" in fmt)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/test_report_runbook.py -k skew_preflight -v`
Expected: FAIL — none of the three clauses exist yet.

- [ ] **Step 3: Add the self-host skew preflight (Step 0/1)**

In SKILL.md Step 1 (preflight), add: when the working directory is the ultrapowers repo (self-hosting), run `check_engine_skew.sh "${CLAUDE_PLUGIN_ROOT}" "$(git rev-parse --show-toplevel)"`; on `SKEW`, install the repo engine into `.claude/workflows/` before launch (so the self-test exercises repo `main`, not the stale cache). On `IN_SYNC`, proceed.

- [ ] **Step 4: Add the probe round-trip assertion (Step 4a½)**

In SKILL.md Step 4a½ (the probe launch), assert the probe's result echoes the representative payload it was sent (`echoWaves` equals the count sent and `echoFirstId` matches) — not merely `ping`. On mismatch, the by-name launch is dropping args ([fb8635c5]); fall back to Step 6 (sequential).

- [ ] **Step 5: Add the result-schema degrade clause (Step 5)**

In SKILL.md Step 5, before the `git rev-parse <integrationBranch>` == `waveMerges[last].headSha` guard, add: if the report has no `waveMerges`, an empty `waveMerges`, or a last entry lacking `headSha` (a budget-exhausted or SKIPPED-only run), do not index it — surface "merge-sha guard unavailable — result lacks waveMerges[last].headSha" as a non-Approve `BLOCKED`. In `references/report-format.md`, note that `waveMerges` may be empty/absent and consumers must degrade gracefully (pin the schema expectation).

- [ ] **Step 6: Run the test to verify it passes**

Run: `python3 -m pytest tests/test_report_runbook.py -k skew_preflight -v`
Expected: PASS.

- [ ] **Step 7: Validate and commit**

Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` → `skill ok`.

```bash
git add skills/ultrapowers/SKILL.md skills/ultrapowers/references/report-format.md tests/test_report_runbook.py
git commit -m "feat(launch): self-host skew preflight, probe round-trip check, graceful merge-sha degrade"
```

---

### Task 13: Finishing handoff — merge-method/squash detection + deploy-scope warning (`finishing-notes.md`)

**Type:** implementation
**Depends-on:** 12

Evidence: `[b117ab5d53e5b96a]` (accumulated per-wave merge commits made the integration branch un-rebaseable; the target repo forbade merge commits), `[64016ca13dd763a4]` (a tiny fix on a long branch would deploy the whole branch). Kept off the engine spine as an isolated reference doc the orchestrator reads, with a one-line pointer.

**Files:**
- Create: `skills/ultrapowers/references/finishing-notes.md`
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultrapowers/references/report-format.md`
- Test: `tests/test_finishing_notes.py` (new)

**Interfaces:**
- Consumes: `finishing-a-development-branch` handoff in SKILL.md Step 5 + the report-format.md item-10 runbook (both touched by Tasks 11/12 — hence `Depends-on: 12`).
- Produces: `references/finishing-notes.md` carrying the two checks (detect allowed merge methods → recommend squash when accumulated merge commits would block rebase; warn when the integration base is far ahead of the deploy target), a one-line SKILL.md pointer at the finishing handoff, and a report-format.md item-10 reference.

- [ ] **Step 1: Write the failing test**

Create `tests/test_finishing_notes.py`:

```python
import pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]
NOTES = ROOT / "skills/ultrapowers/references/finishing-notes.md"
SKILL = ROOT / "skills/ultrapowers/SKILL.md"
FMT = ROOT / "skills/ultrapowers/references/report-format.md"


def test_finishing_notes_cover_merge_method_and_deploy_scope():
    assert NOTES.exists()
    txt = NOTES.read_text().lower()
    assert "squash" in txt and ("merge method" in txt or "allow_squash_merge" in txt) and "rebase" in txt
    assert "deploy target" in txt and ("rev-list" in txt or "far ahead" in txt)


def test_finishing_notes_are_referenced_not_orphaned():
    assert "finishing-notes.md" in SKILL.read_text()
    assert "finishing-notes.md" in FMT.read_text()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/test_finishing_notes.py -v`
Expected: FAIL — the doc and references don't exist.

- [ ] **Step 3: Write `finishing-notes.md`**

Create `skills/ultrapowers/references/finishing-notes.md` with two operator checks (the orchestrator has a shell at Step 5):

```markdown
# Finishing notes (orchestrator-read; carried into the post-merge runbook)

## Merge method — recommend squash up front
The engine accumulates a per-wave merge commit per wave plus reconciliation
commits, so the integration branch is rich in merge commits and is often
un-rebaseable. Before recommending a merge style, detect the target repo's
allowed methods:
  gh api repos/{owner}/{repo} --jq '.allow_squash_merge,.allow_merge_commit,.allow_rebase_merge'
If merge commits are forbidden (rebase-only) or the branch has many merge
commits, recommend **squash** in the finishing handoff so the operator is not
forced to discover it at the disabled merge button ([b117ab5d53e5b96a]).

## Deploy scope — warn when the base is far ahead of the deploy target
A small approved fix can sit on a long-lived feature branch; a "pull the default
branch on prod" deploy would ship the whole branch. Before the release ritual,
compare the integration base to the deploy target:
  git rev-list --count <deploy-target>..<base>
If the base is far ahead (dozens of commits), warn that finishing this branch
deploys far more than the reviewed change ([64016ca13dd763a4]).
```

- [ ] **Step 4: Add the references (one line each, off the spine)**

In `SKILL.md` Step 5, at the `finishing-a-development-branch` handoff, add a one-line pointer to `references/finishing-notes.md` (merge-method + deploy-scope checks). In `references/report-format.md`, near the item-10 "Post-merge runbook" presentation, add a one-line reference that the runbook surfaces the finishing-notes checks.

- [ ] **Step 5: Run the test to verify it passes**

Run: `python3 -m pytest tests/test_finishing_notes.py -v`
Expected: PASS.

- [ ] **Step 6: Validate and commit**

Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` → `skill ok`.

```bash
git add skills/ultrapowers/references/finishing-notes.md skills/ultrapowers/SKILL.md skills/ultrapowers/references/report-format.md tests/test_finishing_notes.py
git commit -m "feat(finishing): merge-method/squash detection + deploy-scope warning reference notes"
```

---

## Gate & release

### Task 14: Verification gate

**Type:** gate

**Files:** none — verification only; writes nothing.

Verification expectations (the suite is the acceptance authority):

- `python3 -m pytest tests/` → all pass, including the new `test_version_sync.py`, `test_run_lock.py`, `test_engine_skew.py`, `test_finishing_notes.py`, and the extended `test_harvest_runs.py` / `test_compile_plan.py` / `test_marker_contract.py` / `test_orchestrator_markers.py` / `test_sweep_worktrees.py` / `test_session_hook.py` / `test_probe.py` / `test_run_acceptance.py` / `test_report_runbook.py` / `test_no_prompt_drift.py` / `test_ultraplan_skill.py`.
- `node tests/sim_workflow.mjs` → every scenario prints `OK`, including `coverage-and-missing-deliverables` and `git-verified-and-visual-eyeball`, ending with `ALL SCENARIOS PASSED`. (NOT in CI — run explicitly.)
- `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` → `skill ok`; same for `skills/ultraplan` and `skills/ultralearn`.

`testCmd`: `python3 -m pytest`

---

### Task 15: Release (post-merge runbook)

**Type:** release

**Files:**
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`

Carried verbatim into the post-merge runbook — not waved:

- Bump **both** `.claude-plugin/plugin.json` (`.version`) and `.claude-plugin/marketplace.json` (`.plugins[0].version`) from `0.0.20` to `0.0.21` (they must match — Task 7's guard now enforces this in CI).
- Commit on `main`: `chore(release): 0.0.21 — report incompleteness + worktree/concurrency determinism + harvester/compiler/launch/finishing fixes`.
- The installed plugin picks up the new version only after `/plugin` re-resolves it and a new session starts.
- If self-hosting confirmed engine skew at launch (Task 12 preflight), note in the runbook that the next session should re-resolve the cache.

---

## Self-review

**Spec coverage (handoff §4 workstreams → tasks):**
- P1 (report incompleteness): Task 8 (coverage column #1, structural missing-deliverables #2-engine) + Task 9 (git-verified split #3, deliverable tree-diff #2-critic, visualEyeballItems #4, Step-5 gating). ✓
- P2 (worktree/concurrency): Task 4 (run-lock #1, snapshot/restore #4, scoped sweep #2 — primitives) + Task 10 (HEAD-assert #3, cleanup-out-of-prompt #5) + Task 11 (orchestrator wiring). ✓
- P3 (harvester precision): Task 1 (engine-fingerprint #1, dedup #2, provenance #3, truncation #4, targeting #5). Extractor trio already #66 — excluded. ✓
- P4 (compiler robustness): Task 2 (Files-parser #1, empty-writes-gate #3) + Task 3 (description-edge #2, 0-markers #4, gate-heading #6, absence-lint #5). ✓
- P5 (launch/sealed/result-schema): Task 5 (skew #4, GC #3-seamB, probe #3-seamA — primitives) + Task 6 (non-pytest sealed #5) + Task 12 (result-schema degrade #2, skew preflight + probe wiring). Raw-path #1 confirmed STALE → dropped. ✓
- P6 (finishing/version): Task 7 (version guard) + Task 13 (merge-method, deploy-scope). ✓
- Residual "other" bucket (incl. the `/goal` non-terminating loop): deferred — a foreign project's surface, not ours.

**Decomposition shaping:** the isolated lane (Tasks 1–7) is genuine independent mass (disjoint files) — fans out fully. The spine (Tasks 8–13) is serialized only where files are truly shared (`waves.js`, baked `references/*.md`, `report-format.md`, `SKILL.md`); within it, Tasks 10 and 11 fan out after Task 9 along a real file seam (baked prompts vs SKILL.md), each carrying a `**Parallelization rationale:**`. Contract-first producers (Tasks 4, 5) are consumed by their wiring tasks (11, 12). No contract or split was introduced solely to fan out — each passes the good-engineer test.

**Type markers:** every task carries an explicit `**Type:**`; Task 14 is `gate`, Task 15 is `release` (both excluded from waves). **Depends-on** encodes every shared-file and consumes/produces edge; no ordering lives in prose. **Interfaces** populated per task (load-bearing — the compiler cross-checks Consumes↔Produces). **Acceptance:** suite (engine self-development). Backticked sibling filenames in task bodies are matched by a `**Depends-on:**` (e.g. Task 11/12 → 4/5; Task 9/10 baked prompts → 8/9 chain).
