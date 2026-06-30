# Docket Plan-Sweep + Autonomous Build Drain Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/ultradocket plan` a continuous sweep that drains the accepted queue into sealed, engine-tagged plans, and build `/ultradocket run` as an exam-gated autonomous build drain that executes that queue.

**Architecture:** A small fail-loud contract change in `docket_lib.py` (a new `Engine` field on `Entry`) plus a `compile_docket.py` hardening (#34) underpin two `ultradocket/SKILL.md` prose rewrites: the `plan` mode becomes the sweep, and the `run` mode becomes the drain — the `/ultradocket run` agent loop dispatching each queued plan through its recorded engine (the `waves` workflow / subagent-driven / inline), gating each on its held-out sealed exam, stacking green plans onto a docket integration line and parking reds, all landing at one end gate.

**Tech Stack:** Python 3 + pytest (the test gate is `python3 -m pytest`, scoped by `pytest.ini`); markdown skill prose validated by `skills/ultrapowers/scripts/validate_skill.py`. The drain reuses the committed `waves` saved workflow and `run_acceptance.sh`; it builds no new harness.

## Global Constraints

- **Engine enum** is exactly `ultrapowers | subagent-driven | inline`; an unknown value raises `DocketError` (fail loud, catching a hand-edit typo before the drain chokes).
- `docket_lib.py` stays the **single source of truth** for the docket format; every state transition goes through `docket_lib.transition`, never hand-edited prose.
- **Anti-drift:** engine selection *references* the shared execution-fit rubric (`hooks/session_start.sh` + `ultraplan`, pinned by `tests/test_recommendation_rubric.py`); never restate its branch clauses inside `ultradocket`.
- **Exam-gated, not judgment-gated:** the drain's auto-approval only governs keep-going-vs-escalate; correctness is decided by the plan's held-out sealed exam via `run_acceptance.sh` (exit-code authority). Only a green exam merges a plan to the docket integration line.
- **Origin-agnostic drain:** the entry `issue` field is an opaque label; the drain core makes **no GitHub calls**; any `gh` close/comment is an optional operator post-step.
- **`main` is never touched unattended;** every plan outcome lands at the single end gate.
- **Red → park (v1).** Autonomous mid-drain salvage and cross-plan concurrency are out of scope (measured v2 seams).
- **Acceptance disposition:** `suite` — this is ultrapowers' own skill/lib/doc development; the committed suite + drift pins + adversarial review are the verification.
- Sweep/drain behavior is **skill-prose**, verified by the suite staying green plus a manual shakedown; the tightly-worded auto-advance discipline is the prose most worth pressure-testing.

---

### Task 1: Add the `Engine` field to docket entries

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultradocket/scripts/docket_lib.py`
- Test: `tests/test_docket_lib.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `Entry.engine` (optional `str`, one of `ultrapowers | subagent-driven | inline`, default `None`); an `ENGINES` tuple constant; parse/serialize/validate of a `**Engine:**` field (unknown value → `DocketError`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_docket_lib.py`:

```python
def test_parse_and_round_trip_engine():
    m = load()
    text = ("# Docket\n\n### #214: x\n**State:** queued\n**Score:** 8.5 — y\n"
            "**Est-files:** a.py\n**Plan:** p.md\n**Seal:** abc123\n"
            "**Engine:** ultrapowers\n")
    e = m.parse_docket(text)[0]
    assert e.engine == "ultrapowers"
    again = m.parse_docket(m.serialize_docket([e]))[0]
    assert again.engine == "ultrapowers"


def test_engine_optional_defaults_none():
    m = load()
    e = m.parse_docket("# D\n\n### #1: x\n**State:** accepted\n**Score:** 1 — x\n")[0]
    assert e.engine is None


def test_unknown_engine_fails_loud():
    m = load()
    bad = ("# D\n\n### #1: x\n**State:** queued\n**Score:** 1 — x\n"
           "**Est-files:** a.py\n**Plan:** p.md\n**Seal:** abc\n**Engine:** turbo\n")
    import pytest
    with pytest.raises(m.DocketError):
        m.parse_docket(bad)


def test_all_valid_engines_parse():
    m = load()
    for eng in ("ultrapowers", "subagent-driven", "inline"):
        text = (f"# D\n\n### #1: x\n**State:** queued\n**Score:** 1 — x\n"
                f"**Est-files:** a.py\n**Plan:** p.md\n**Seal:** abc\n**Engine:** {eng}\n")
        assert m.parse_docket(text)[0].engine == eng
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_docket_lib.py -q`
Expected: FAIL — `AttributeError: 'Entry' object has no attribute 'engine'` (and the unknown-engine case does not raise).

- [ ] **Step 3: Add the `ENGINES` constant and the `engine` dataclass field**

In `skills/ultradocket/scripts/docket_lib.py`, after the `TERMINAL` definition add the constant:

```python
LIFECYCLE = ["triaged", "accepted", "planned", "queued", "executed", "verified"]
TERMINAL = {"verified", "parked"}
ENGINES = ("ultrapowers", "subagent-driven", "inline")
```

Add `engine` to the `Entry` dataclass (after `seal`):

```python
@dataclasses.dataclass
class Entry:
    issue: str
    title: str
    state: str
    score: str
    est_files: list
    plan: str = None
    seal: str = None
    engine: str = None
```

- [ ] **Step 4: Parse, validate, and serialize the `Engine` field**

Add `Engine` to the `_FIELD` alternation:

```python
_FIELD = re.compile(r"^\*\*(State|Score|Est-files|Plan|Seal|Engine):\*\*\s*(.*?)\s*$")
```

In `flush()`, after the existing `State` unknown-value check and before the duplicate-issue check, validate the engine, then thread it into the `Entry(...)` construction:

```python
        if fields["State"] not in (set(LIFECYCLE) | {"parked"}):
            raise DocketError(f"issue #{cur[0]} has unknown State: {fields['State']!r}")
        engine = fields.get("Engine") or None
        if engine is not None and engine not in ENGINES:
            raise DocketError(f"issue #{cur[0]} has unknown Engine: {engine!r}")
        if cur[0] in seen:
            raise DocketError(f"duplicate issue #{cur[0]} in docket")
        seen.add(cur[0])
        est = [s.strip() for s in fields.get("Est-files", "").split(",") if s.strip()]
        entries.append(Entry(issue=cur[0], title=cur[1], state=fields["State"],
                             score=fields["Score"], est_files=est,
                             plan=fields.get("Plan") or None, seal=fields.get("Seal") or None,
                             engine=engine))
```

In `serialize_docket()`, emit `Engine` after the `Seal` block:

```python
        if e.seal:
            out.append(f"**Seal:** {e.seal}")
        if e.engine:
            out.append(f"**Engine:** {e.engine}")
        out.append("")
```

- [ ] **Step 5: Run the full docket_lib suite to verify green**

Run: `python3 -m pytest tests/test_docket_lib.py -q`
Expected: PASS (new tests pass; existing round-trip/lifecycle tests unchanged — entries without `Engine` round-trip with `engine=None`).

- [ ] **Step 6: Commit**

```bash
git add skills/ultradocket/scripts/docket_lib.py tests/test_docket_lib.py
git commit -m "feat(docket): add Engine field to docket entries (fail-loud enum)"
```

---

### Task 2: Harden `compile_docket` for the drain (#34)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultradocket/scripts/compile_docket.py`
- Test: `tests/test_compile_docket.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `plan_writes()` raises a friendly `ValueError` naming the plan on a missing/uncompilable Plan (never a raw `CalledProcessError`); the CLI `main()` and the real-resolver path inside `compile_docket()` are now under test.

**Parallelization rationale:** the #34 compile_docket hardening shares no file and no symbol with the Engine field — two unrelated changes a good engineer separates regardless; running them in one wave is real, not manufactured, width.

- [ ] **Step 1: Write the failing friendly-error test**

Append to `tests/test_compile_docket.py`:

```python
def test_uncompilable_plan_raises_friendly_error(tmp_path):
    """A queued entry whose Plan is missing/uncompilable must raise a friendly
    error naming the plan, not a raw CalledProcessError stack trace (#34)."""
    m = load()
    import subprocess, pytest
    missing = tmp_path / "does-not-exist.md"
    with pytest.raises(ValueError) as ei:
        m.plan_writes(missing)
    assert str(missing) in str(ei.value)
    assert not isinstance(ei.value, subprocess.CalledProcessError)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python3 -m pytest tests/test_compile_docket.py::test_uncompilable_plan_raises_friendly_error -q`
Expected: FAIL — `plan_writes()` raises `subprocess.CalledProcessError` (its `check=True`), not a friendly `ValueError`.

- [ ] **Step 3: Make `plan_writes` raise a friendly error**

Replace the body of `plan_writes()` in `skills/ultradocket/scripts/compile_docket.py`:

```python
def plan_writes(plan_path):
    """Authoritative write-set of a plan: union of its tasks' writes.

    A missing or uncompilable Plan raises a friendly ValueError naming the plan
    (so the drain parks that entry with a clear reason) rather than leaking a raw
    CalledProcessError stack trace (#34).
    """
    try:
        out = subprocess.run([sys.executable, str(COMPILE_PLAN), str(plan_path)],
                             capture_output=True, text=True, check=True).stdout
    except subprocess.CalledProcessError as e:
        detail = (e.stderr or e.stdout or "").strip().splitlines()
        reason = detail[-1] if detail else f"exit {e.returncode}"
        raise ValueError(f"queued plan {plan_path!r} failed to compile: {reason}") from e
    data = json.loads(out)
    writes = set()
    for t in data.get("tasks", []):
        writes.update(t.get("writes", []))
    return writes
```

- [ ] **Step 4: Run it to verify it passes**

Run: `python3 -m pytest tests/test_compile_docket.py::test_uncompilable_plan_raises_friendly_error -q`
Expected: PASS.

- [ ] **Step 5: Add the two #34 coverage tests (CLI entrypoint + real resolver)**

These exercise existing-but-untested paths, so they pass on first run (characterization tests closing the #34 coverage gap). Append to `tests/test_compile_docket.py`:

```python
def _fixture_plan(p, *creates):
    body = "# P\n\n**Acceptance:** suite — fixture\n\n"
    for i, c in enumerate(creates, 1):
        body += (f"### Task {i}: t{i}\n**Type:** implementation\n**Depends-on:** none\n"
                 f"**Files:**\n- Create: `{c}`\n- [ ] **Step 1: do**\n\n")
    p.write_text(body)


def test_compile_docket_real_resolver_over_real_plans(tmp_path):
    """Drive compile_docket() with the DEFAULT resolver (no injection) over real
    fixture plans on disk — the real plan_writes path inside compile_docket (#34)."""
    m = load()
    pa, pb = tmp_path / "pa.md", tmp_path / "pb.md"
    _fixture_plan(pa, "x/a.py")
    _fixture_plan(pb, "x/b.py")
    docket = (f"# Docket\n\n### #1: a\n**State:** queued\n**Score:** 9 — x\n"
              f"**Est-files:** x/a.py\n**Plan:** {pa}\n**Seal:** aaa\n\n"
              f"### #2: b\n**State:** queued\n**Score:** 5 — x\n"
              f"**Est-files:** x/b.py\n**Plan:** {pb}\n**Seal:** bbb\n")
    r = m.compile_docket(docket)  # default resolver → real plan_writes()
    assert r["order"] == [str(pa), str(pb)]
    assert r["collisions"] == []  # disjoint writes


def test_cli_main_prints_json(tmp_path, capsys):
    """compile_docket.main(): argparse + file read + JSON print + --budget-usd (#34)."""
    m = load()
    pa = tmp_path / "pa.md"
    _fixture_plan(pa, "x/a.py")
    docket = tmp_path / "docket.md"
    docket.write_text(f"# Docket\n\n### #1: a\n**State:** queued\n**Score:** 9 — x\n"
                      f"**Est-files:** x/a.py\n**Plan:** {pa}\n**Seal:** aaa\n")
    import sys, json
    saved = sys.argv
    sys.argv = ["compile_docket.py", str(docket), "--budget-usd", "12.5"]
    try:
        m.main()
    finally:
        sys.argv = saved
    out = json.loads(capsys.readouterr().out)
    assert out["budget_usd"] == 12.5
    assert out["order"] == [str(pa)]
```

- [ ] **Step 6: Run the full compile_docket suite to verify green**

Run: `python3 -m pytest tests/test_compile_docket.py -q`
Expected: PASS (the friendly-error test plus the two new coverage tests, alongside the existing suite).

- [ ] **Step 7: Commit**

```bash
git add skills/ultradocket/scripts/compile_docket.py tests/test_compile_docket.py
git commit -m "feat(docket): friendly compile error + CLI/real-resolver coverage (#34)"
```

---

### Task 3: Rewrite `plan` mode as the continuous sweep

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `skills/ultradocket/SKILL.md`

**Interfaces:**
- Consumes: `Entry.engine` / the `Engine` field and `docket_lib.transition` (from Task 1) — referenced in prose so the sweep's write-back instructions are accurate.
- Produces: the `## Mode: plan` sweep prose and an updated frontmatter `description` (later consumed only by humans/agents reading the skill, not by another task's code).

This task carries no failing unit test — its deliverable is skill prose, verified by the suite staying green (Step 3) plus the manual shakedown. The exact replacement text is given verbatim below; write it as shown.

- [ ] **Step 1: Replace the `## Mode: plan` section**

In `skills/ultradocket/SKILL.md`, replace the entire `## Mode: plan (`/ultradocket plan`)` section (from its heading through the line ending `...runs at machine speed.`) with this text:

~~~markdown
## Mode: plan (`/ultradocket plan`) — the continuous sweep

Bare `/ultradocket plan` is a **continuous sweep**: it drains the entire
`accepted` queue through back-to-back, pre-seeded brainstorms, in docket-rank
order, until the queue is empty or the operator stops. There is no single-issue
form — the sweep is the only planning entry point. Throughput is capped by
operator attention here, by design; everything downstream of the operator's
signature runs at machine speed in the drain (`run` mode).

One iteration:

1. **Pop** the highest-rank `accepted` entry.
2. **Pre-seed** a standard `superpowers:brainstorming` session with the issue
   body, the triage notes, and the matched line(s) of `docs/objectives.md`. A
   well-defined issue is half a spec, so the interview is short.
3. **Plan** through the normal pipeline: brainstorm → `superpowers:writing-plans`
   + `ultrapowers:ultraplan` → operator approval → the ultraplan sealing step.
4. **Choose the engine.** Apply the **shared execution-fit rubric** — the same
   one the routing hook and ultraplan use (pinned by
   `tests/test_recommendation_rubric.py`) — to the finished marked plan, and
   record the chosen engine. Do **not** restate the rubric's branch clauses
   here; reference it. The value is one of `ultrapowers | subagent-driven |
   inline`.
5. **Write back** in one atomic entry update — plan path, seal-id, and engine —
   advancing the entry `accepted → planned → queued` via `docket_lib.transition`
   (`planned` is the intermediate: approved, seal not yet issued). Never
   hand-edit the docket prose.
6. **Auto-advance** to the next `accepted` entry.

The sweep loops until no `accepted` entry remains or the operator stops. Docket
state is durable, so a sweep may span sittings freely: stopping is simply not
continuing; resuming re-reads the remaining `accepted` entries. No new
persistence mechanism is introduced.

**If sealing fails**, the entry stays `planned` (approved, unsealed) and the
sweep continues; it surfaces for a retry on a later sweep. It is never `queued`,
so the drain never picks up an unsealed plan.

**In-sweep controls**, offered at each iteration boundary:

- **continue** — the default; plan the next entry.
- **skip-park** — park this entry with a reason (covers both "I don't want to
  build this" and "this issue is underspecified / needs decomposition") via
  `docket_lib.transition` (→ `parked`), then continue.
- **stop** — end the sweep here; the remaining `accepted` entries are untouched
  and picked up on the next `/ultradocket plan`.
~~~

- [ ] **Step 2: Update the frontmatter `description`**

In `skills/ultradocket/SKILL.md`, replace the `description:` line in the YAML frontmatter with:

~~~markdown
description: Use when the operator has a backlog rather than a single idea — triage open issues into a ranked docket, sweep the accepted queue into sealed engine-tagged plans, and drain that queue through an autonomous build. Optional; the single-feature superpowers flow is unchanged when not summoned.
~~~

- [ ] **Step 3: Verify the skill still validates and the suite is green**

Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultradocket && python3 -m pytest -q`
Expected: `skill ok` then the full suite PASSES (no test asserts on this prose; this confirms nothing regressed).

- [ ] **Step 4: Commit**

```bash
git add skills/ultradocket/SKILL.md
git commit -m "feat(docket): rewrite plan mode as the continuous sweep"
```

---

### Task 4: Rewrite `run` mode as the autonomous build drain

**Type:** implementation
**Depends-on:** 1, 2, 3

**Files:**
- Modify: `skills/ultradocket/SKILL.md`

**Interfaces:**
- Consumes: `Entry.engine` / `docket_lib.transition` (Task 1); `compile_docket` order/collisions and its friendly missing-Plan error (Task 2); the sweep-mode rewrite (Task 3, same file). Referenced in prose so the drain's instructions are accurate.
- Produces: the `## Mode: run` drain prose (consumed only by humans/agents reading the skill).

**Coordination note (shared file):** this task and Task 3 both modify `skills/ultradocket/SKILL.md`. Task 3 rewrites the `## Mode: plan` section and the `description`; this task rewrites the `## Mode: run` section only. Leave the `## Mode: plan` section and the frontmatter exactly as Task 3 left them — edit only the `run` section.

This task carries no failing unit test — its deliverable is skill prose, verified by the suite staying green (Step 2) plus the manual shakedown. The auto-advance / exam-gated discipline below is the load-bearing prose: keep its decision rules keyed to observable signals (exam exit code), never to "looks done." Write the replacement text verbatim as shown.

- [ ] **Step 1: Replace the `## Mode: run` section**

In `skills/ultradocket/SKILL.md`, replace the entire `## Mode: run (`/ultradocket run`)` section (from its heading through the end of the trailing shell example) with this text:

~~~markdown
## Mode: run (`/ultradocket run`) — the autonomous build drain

`/ultradocket run` executes the `queued` plans. It is the machine-speed back
half of the docket: the operator kicks it off and walks away, and every plan's
outcome lands at a single end gate. **`main` is never touched unattended.**

The drain is **this agent loop** — not a headless workflow — because two of the
three engines are superpowers *skills* that run in the loop. It owns a docket
integration branch `ultra/docket-<stamp>` and walks the `queued` entries in
docket-rank order (the order `compile_docket` emits). For each entry, run one
**executor-agnostic wrapper**:

1. **Branch** off the current docket integration line HEAD.
2. **Dispatch by the entry's recorded `Engine`**, auto-advancing any
   human-in-the-loop checkpoint (see "The exam-gated auto-approve" below):
   - `ultrapowers` → launch the committed `waves` saved workflow via the
     Workflow tool (the same top-level launch `/ultrapowers` uses). It
     self-isolates with per-task worktrees and tiers per task.
   - `subagent-driven` → invoke `superpowers:subagent-driven-development` against
     the per-plan branch.
   - `inline` → invoke `superpowers:executing-plans` against the per-plan branch.
3. **Administer the sealed exam** against the plan's branch with
   `run_acceptance.sh <sealId> <branch> <sha256>` (exit-code authority; it makes
   its own detached worktree, so it is agnostic to the current checkout).
4. **Merge or park** — the deterministic step:
   - **Green exam** → merge the plan branch into the docket integration line;
     advance the entry `queued → executed` via `docket_lib.transition`; the next
     plan branches off the new HEAD.
   - **Red exam or executor failure** → **park**: keep the branch, transition the
     entry to `parked` with a reason (the exam's `redKind` or the failure), and
     skip the plan's collision-dependents (from `compile_docket`'s collision
     graph). Disjoint plans continue.
   - **Missing/uncompilable Plan** → `compile_docket`/`plan_writes` raises a
     friendly error naming the plan; park that entry with the reason before
     spending execution cost. Never surface a raw stack trace.
5. **Auto-advance** to the next `queued` entry. Stop on an empty queue or an
   operator-set budget ceiling (a stop condition between plans where cost is
   observable; v1 builds no new cost accounting).

### The exam-gated auto-approve

The drain runs unattended over non-deterministic executors, so the keep-going
decision is split from the correctness decision, and the merge keys stay on the
deterministic side:

- **Auto-advance, don't block.** When a sequential executor reaches a checkpoint
  that would normally ask the operator to review, advance it yourself — log the
  call for the end gate — so the run never blocks. This is catastrophe-only
  autonomy: only a dependency cycle or an inability to create the integration
  branch stops the drain early.
- **Trust the exam, not "looks done."** A "finished" signal from a
  non-deterministic executor is never enough to merge. Correctness is decided by
  the plan's held-out sealed exam (`run_acceptance.sh`, exit-code authority):
  exit 0 ⇒ merge; any non-zero ⇒ park. An over-eager auto-advance therefore
  cannot land broken work on the integration line — the exam it can't touch
  gates the merge.

The drain widens the set of trusted write-side executors to include the
committed superpowers executors (`subagent-driven-development`,
`executing-plans`) alongside the `waves` registry harness. Those are fixed,
audited skills — not orchestration improvised at runtime — and the safety
guarantee holds regardless of which one wrote a branch: nothing reaches the
docket integration line, or `main`, without clearing the deterministic sealed
exam and the single end gate.

### The single end gate

When the queue drains or the budget ceiling hits, present **one** pre-merge
portfolio gate. Per entry: exam evidence (raw runner JSON), engine, cost,
disposition (`executed`/merged or `parked` + reason), and branch; plus portfolio
totals and the could-have-parallelized projection. Then the operator disposes of
the portfolio: merge the docket integration line to base, or open per-issue PRs
(mind the GitHub closing-keyword gotcha in PR bodies). Accepting the portfolio
advances merged entries `executed → verified`. Parked branches are presented for
the operator to Salvage/Redirect with full context.

The drain is **origin-agnostic**: the entry `issue` field is an opaque label,
and any `gh issue close` / comment-back is an **optional** operator post-step you
offer at the gate — never part of the drain core, which makes no GitHub calls.
~~~

- [ ] **Step 2: Verify the skill still validates and the suite is green**

Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultradocket && python3 -m pytest -q`
Expected: `skill ok` then the full suite PASSES.

- [ ] **Step 3: Commit**

```bash
git add skills/ultradocket/SKILL.md
git commit -m "feat(docket): rewrite run mode as the exam-gated autonomous drain"
```

---

### Task 5: Full suite green

**Type:** gate

**Files:**
- Test: `tests/`

The committed suite is the acceptance for this `suite`-disposition plan. This gate runs the whole suite and the skill validator; it writes nothing.

- [ ] **Step 1: Run the full gate**

Run: `python3 -m pytest -q && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultradocket && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan`
Expected: the full pytest suite PASSES (including the new `docket_lib` and `compile_docket` tests) and both skills report `skill ok`.

---

**Acceptance:** suite — ultrapowers' own skill/lib/doc development; author and operator read the diffs, and the committed pytest suite (docket_lib Engine round-trip + fail-loud, compile_docket #34 coverage) plus `validate_skill` plus adversarial per-task review are the verification. The sweep and drain prose are exercised in a manual shakedown, not a held-out exam.
