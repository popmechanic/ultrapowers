# Docket Pipeline (triage + portfolio compile) — Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Acceptance:** suite — new engine-internal tooling (docket parser, portfolio compiler) + a new skill; verified by the committed pytest suite + skill validator + adversarial review, not a held-out exam.

**Goal:** Build the read-and-plan half of the docket — a `/ultradocket` skill that triages GitHub issues against business objectives into a ranked `docket.md`, seeds superpowers planning per issue, and a deterministic portfolio compiler that turns the approved plans into a collision-aware execution order with an instrumented cross-plan-parallelism seam — everything up to but not including execution.

**Architecture:** Three units. `docket_lib.py` parses/serializes `docket.md` and enforces the issue lifecycle. `compile_docket.py` reads the queued entries, asks the authoritative `compile_plan.py` for each plan's write-set, builds the cross-plan collision graph, and emits an execution order + budget ceiling + could-have-parallelized projection (recorded, not acted on — the v2 seam). The `/ultradocket` skill (frontmatter + modes) drives the human-facing flow: a first-run objectives interview, a read-only triage harness (improvised per the read/write boundary — it mutates nothing), and a plan mode that seeds a normal superpowers brainstorm from a docket entry. The write-side drain (`docket-run`) is part 3c and is deliberately out of scope here — it rides the harness ratchet that part 2 establishes.

**Tech Stack:** python3 + pytest, `gh` (mocked in tests), the existing `compile_plan.py` as the authoritative plan-writes parser.

**Spec:** `docs/superpowers/specs/2026-06-12-docket-design.md` (this plan covers the triage/plan/compile portions; the drain harness + report + run mode are deferred to part 3c, written against part 2's merged ratchet).

**Shared contract (each task restates what it needs):**
- `docket.md` entry format:
  ```
  ### #214: Stripe webhooks dropped on retry
  **State:** accepted
  **Score:** 8.5 — revenue-reliability objective
  **Est-files:** services/billing/*, lib/webhooks.py
  **Plan:** docs/superpowers/plans/2026-06-14-stripe-webhook-retry.md
  **Seal:** a1b2c3d4e5f6
  ```
  `Plan`/`Seal` absent until the entry reaches `planned`/`queued`.
- Lifecycle order: `triaged → accepted → planned → queued → executed → verified`; any non-terminal state → `parked`. `docket_lib` is the only implementation of parsing, serialization, and transition rules.
- A plan's write-set = the union of its tasks' `writes`, obtained by running `skills/ultrapowers/scripts/compile_plan.py <plan>` and unioning `tasks[].writes` from its JSON (queued plans carry a disposition and therefore compile).

---

### Task 1: `docket_lib` — parse, serialize, lifecycle

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `skills/ultradocket/scripts/docket_lib.py`
- Create: `tests/test_docket_lib.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_docket_lib.py`:

```python
"""docket.md is parsed, serialized, and lifecycle-transitioned by exactly one
module. Round-trip must be lossless; illegal transitions must raise; a
malformed entry must fail loud (never silently drop work)."""
import importlib.util
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
LIB = ROOT / "skills/ultradocket/scripts/docket_lib.py"


def load():
    spec = importlib.util.spec_from_file_location("docket_lib", LIB)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


SAMPLE = """# Docket

### #214: Stripe webhooks dropped on retry
**State:** accepted
**Score:** 8.5 — revenue-reliability objective
**Est-files:** services/billing/*, lib/webhooks.py

### #230: Slow dashboard query
**State:** queued
**Score:** 6.0 — performance objective
**Est-files:** lib/dashboard.py
**Plan:** docs/superpowers/plans/2026-06-14-dashboard.md
**Seal:** abc123def456
"""


def test_parse_reads_all_fields():
    m = load()
    entries = m.parse_docket(SAMPLE)
    assert [e.issue for e in entries] == ["214", "230"]
    e = entries[0]
    assert e.title.startswith("Stripe webhooks")
    assert e.state == "accepted"
    assert e.est_files == ["services/billing/*", "lib/webhooks.py"]
    assert e.plan is None and e.seal is None
    assert entries[1].plan.endswith("dashboard.md") and entries[1].seal == "abc123def456"


def test_round_trip_is_lossless():
    m = load()
    entries = m.parse_docket(SAMPLE)
    again = m.parse_docket(m.serialize_docket(entries))
    assert [vars(e) for e in again] == [vars(e) for e in entries]


def test_legal_transition():
    m = load()
    e = m.parse_docket(SAMPLE)[0]  # accepted
    e2 = m.transition(e, "planned")
    assert e2.state == "planned"


def test_illegal_transition_raises():
    m = load()
    e = m.parse_docket(SAMPLE)[0]  # accepted
    with pytest.raises(m.DocketError):
        m.transition(e, "verified")  # cannot skip planned/queued/executed


def test_park_allowed_from_any_active_state():
    m = load()
    e = m.parse_docket(SAMPLE)[1]  # queued
    assert m.transition(e, "parked").state == "parked"


def test_malformed_entry_fails_loud():
    m = load()
    bad = "### #99: no state line\n**Score:** 1.0 — x\n"
    with pytest.raises(m.DocketError):
        m.parse_docket(bad)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_docket_lib.py -q`
Expected: FAIL — `docket_lib.py` does not exist.

- [ ] **Step 3: Implement `docket_lib.py`**

Create `skills/ultradocket/scripts/docket_lib.py`:

```python
#!/usr/bin/env python3
"""Parse, serialize, and lifecycle-transition docket.md entries.

The single source of truth for the docket format. Fail loud on malformed
entries — a dropped issue is silently lost work. Spec:
docs/superpowers/specs/2026-06-12-docket-design.md
"""
import dataclasses
import re

LIFECYCLE = ["triaged", "accepted", "planned", "queued", "executed", "verified"]
TERMINAL = {"verified", "parked"}


class DocketError(Exception):
    pass


@dataclasses.dataclass
class Entry:
    issue: str
    title: str
    state: str
    score: str
    est_files: list
    plan: str = None
    seal: str = None


_HEAD = re.compile(r"^###\s+#(\d+):\s+(.*?)\s*$")
_FIELD = re.compile(r"^\*\*(State|Score|Est-files|Plan|Seal):\*\*\s*(.*?)\s*$")


def parse_docket(text):
    entries = []
    cur = None
    fields = {}

    def flush():
        if cur is None:
            return
        if "State" not in fields or "Score" not in fields:
            raise DocketError(f"issue #{cur[0]} missing State or Score")
        est = [s.strip() for s in fields.get("Est-files", "").split(",") if s.strip()]
        entries.append(Entry(issue=cur[0], title=cur[1], state=fields["State"],
                             score=fields["Score"], est_files=est,
                             plan=fields.get("Plan") or None, seal=fields.get("Seal") or None))

    for line in text.splitlines():
        h = _HEAD.match(line)
        if h:
            flush()
            cur, fields = (h.group(1), h.group(2)), {}
            continue
        f = _FIELD.match(line)
        if f and cur is not None:
            fields[f.group(1)] = f.group(2)
    flush()
    return entries


def serialize_docket(entries):
    out = ["# Docket", ""]
    for e in entries:
        out.append(f"### #{e.issue}: {e.title}")
        out.append(f"**State:** {e.state}")
        out.append(f"**Score:** {e.score}")
        out.append(f"**Est-files:** {', '.join(e.est_files)}")
        if e.plan:
            out.append(f"**Plan:** {e.plan}")
        if e.seal:
            out.append(f"**Seal:** {e.seal}")
        out.append("")
    return "\n".join(out)


def transition(entry, new_state):
    if new_state == "parked":
        if entry.state in TERMINAL:
            raise DocketError(f"#{entry.issue}: cannot park from terminal {entry.state}")
        return dataclasses.replace(entry, state="parked")
    if entry.state not in LIFECYCLE or new_state not in LIFECYCLE:
        raise DocketError(f"#{entry.issue}: unknown state {entry.state}->{new_state}")
    if LIFECYCLE.index(new_state) != LIFECYCLE.index(entry.state) + 1:
        raise DocketError(f"#{entry.issue}: illegal {entry.state}->{new_state} (must advance one step)")
    return dataclasses.replace(entry, state=new_state)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_docket_lib.py -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add skills/ultradocket/scripts/docket_lib.py tests/test_docket_lib.py
git commit -m "feat: docket_lib — parse/serialize/lifecycle for docket.md"
```

---

### Task 2: `compile_docket` — collision-aware portfolio compiler

**Type:** implementation
**Depends-on:** 1

**Files:**
- Create: `skills/ultradocket/scripts/compile_docket.py`
- Create: `tests/test_compile_docket.py`

Depends on Task 1: imports `docket_lib` to read the docket. A plan's write-set is obtained authoritatively by running `skills/ultrapowers/scripts/compile_plan.py <plan>` and unioning `tasks[].writes` (do NOT re-implement plan parsing). Two queued plans *collide* when their write-sets intersect; colliding plans are sequenced (higher docket score first), non-colliding plans keep score order; the could-have-parallelized projection groups mutually-disjoint plans and reports the critical-path length the drain *could* achieve if it ran disjoint plans concurrently (recorded only — v1 executes sequentially).

- [ ] **Step 1: Write the failing tests**

Create `tests/test_compile_docket.py`:

```python
"""Portfolio compiler: collision graph + execution order + parallelism
projection over queued docket entries. compile_plan is stubbed via a fake on
PATH-free direct call by pointing the module at a fake writes-resolver."""
import importlib.util
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
MOD = ROOT / "skills/ultradocket/scripts/compile_docket.py"


def load():
    spec = importlib.util.spec_from_file_location("compile_docket", MOD)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# Three queued plans: A and B share a file (collide); C is disjoint.
WRITES = {
    "pa.md": {"lib/billing.py", "lib/webhooks.py"},
    "pb.md": {"lib/billing.py"},          # collides with A on lib/billing.py
    "pc.md": {"lib/dashboard.py"},        # disjoint
}
DOCKET = """# Docket

### #1: A
**State:** queued
**Score:** 9.0 — x
**Est-files:** lib/billing.py
**Plan:** pa.md
**Seal:** aaa111aaa111

### #2: B
**State:** queued
**Score:** 5.0 — x
**Est-files:** lib/billing.py
**Plan:** pb.md
**Seal:** bbb222bbb222

### #3: C
**State:** queued
**Score:** 7.0 — x
**Est-files:** lib/dashboard.py
**Plan:** pc.md
**Seal:** ccc333ccc333
"""


def test_collisions_detected():
    m = load()
    r = m.compile_docket(DOCKET, writes_resolver=lambda p: WRITES[p])
    pairs = {tuple(sorted(c["plans"])) for c in r["collisions"]}
    assert ("pa.md", "pb.md") in pairs
    assert ("pa.md", "pc.md") not in pairs


def test_order_sequences_collisions_by_score():
    m = load()
    r = m.compile_docket(DOCKET, writes_resolver=lambda p: WRITES[p])
    # A (9.0) before B (5.0) since they collide; C disjoint, ordered by score
    ia, ib = r["order"].index("pa.md"), r["order"].index("pb.md")
    assert ia < ib


def test_parallelism_projection_groups_disjoint_plans():
    m = load()
    r = m.compile_docket(DOCKET, writes_resolver=lambda p: WRITES[p])
    proj = r["could_have_parallelized"]
    # A and C are mutually disjoint -> could run concurrently; B must follow A
    assert proj["max_concurrent"] >= 2
    assert proj["critical_path_len"] == 2  # A->B chain is the longest


def test_only_queued_entries_considered():
    m = load()
    docket = DOCKET.replace("**State:** queued\n**Score:** 7.0", "**State:** accepted\n**Score:** 7.0")
    r = m.compile_docket(docket, writes_resolver=lambda p: WRITES[p])
    assert "pc.md" not in r["order"]  # #3 is no longer queued
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_compile_docket.py -q`
Expected: FAIL — `compile_docket.py` does not exist.

- [ ] **Step 3: Implement `compile_docket.py`**

Create `skills/ultradocket/scripts/compile_docket.py`:

```python
#!/usr/bin/env python3
"""Compile queued docket entries into a collision-aware execution order plus a
could-have-parallelized projection (recorded, not executed — the v2 seam).

A plan's write-set comes from the authoritative compiler: run
skills/ultrapowers/scripts/compile_plan.py <plan> and union tasks[].writes.
Spec: docs/superpowers/specs/2026-06-12-docket-design.md
"""
import argparse
import json
import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import docket_lib  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[3]
COMPILE_PLAN = ROOT / "skills/ultrapowers/scripts/compile_plan.py"


def plan_writes(plan_path):
    """Authoritative write-set of a plan: union of its tasks' writes."""
    out = subprocess.run([sys.executable, str(COMPILE_PLAN), str(plan_path)],
                         capture_output=True, text=True, check=True).stdout
    data = json.loads(out)
    writes = set()
    for t in data.get("tasks", []):
        writes.update(t.get("writes", []))
    return writes


def compile_docket(docket_text, writes_resolver=plan_writes, budget_usd=None):
    entries = [e for e in docket_lib.parse_docket(docket_text) if e.state == "queued"]
    plans = [e.plan for e in entries]
    by_score = sorted(entries, key=lambda e: -float(e.score.split()[0]))
    wsets = {e.plan: set(writes_resolver(e.plan)) for e in entries}

    collisions = []
    for i, a in enumerate(by_score):
        for b in by_score[i + 1:]:
            shared = wsets[a.plan] & wsets[b.plan]
            if shared:
                collisions.append({"plans": [a.plan, b.plan], "shared": sorted(shared)})

    # Execution order: score-descending, but a colliding plan never precedes a
    # higher-scored plan it collides with (already guaranteed by score order).
    order = [e.plan for e in by_score]

    # Could-have-parallelized: greedily pack disjoint plans into concurrent
    # groups; critical path = number of groups (sequential depth that remains).
    remaining = list(order)
    groups = []
    while remaining:
        group, used = [], set()
        for p in list(remaining):
            if not (wsets[p] & used):
                group.append(p)
                used |= wsets[p]
                remaining.remove(p)
        groups.append(group)
    projection = {
        "groups": groups,
        "max_concurrent": max(len(g) for g in groups) if groups else 0,
        "critical_path_len": len(groups),
    }

    return {"order": order, "collisions": collisions,
            "budget_usd": budget_usd, "could_have_parallelized": projection}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("docket", help="path to docket.md")
    ap.add_argument("--budget-usd", type=float, default=None)
    args = ap.parse_args()
    text = pathlib.Path(args.docket).read_text()
    print(json.dumps(compile_docket(text, budget_usd=args.budget_usd), indent=2))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_compile_docket.py -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add skills/ultradocket/scripts/compile_docket.py tests/test_compile_docket.py
git commit -m "feat: compile_docket — collision-aware portfolio compiler with parallelism seam"
```

---

### Task 3: The `/ultradocket` skill (objectives, triage, plan modes)

**Type:** implementation
**Depends-on:** 1

**Files:**
- Create: `skills/ultradocket/SKILL.md`

Depends on Task 1: the skill references `scripts/docket_lib.py`, and `validate_skill.py` checks that referenced `scripts/` files exist. The drain (`run` mode) is part 3c; here it is a forward reference only. The triage harness is improvised at runtime and READ-ONLY per the harness library's read/write boundary — this skill provides its instructions, not a committed harness file.

- [ ] **Step 1: Write the skill**

Create `skills/ultradocket/SKILL.md` (valid frontmatter: `name` is letters/digits/hyphens; `description` 20–1024 chars):

```markdown
---
name: ultradocket
description: Use when the operator has a backlog rather than a single idea — triage open GitHub issues against business objectives into a ranked docket, plan accepted issues one at a time via superpowers, and compile the approved plans into a collision-aware portfolio. The execution drain is /ultradocket run (part 3c). Optional; the single-feature superpowers flow is unchanged when not summoned.
---

# Ultradocket

The docket is the portfolio layer above single-plan execution. It never
authors plans — superpowers does, interactively, with the operator. The
docket decides *which* issues are worth planning, holds their state between
sessions, and reasons about the approved plans *as a set*.

## First run: objectives

If `docs/objectives.md` does not exist, interview the operator (ten minutes,
brainstorm-style) and write it: what the business is optimizing for this
quarter, in plain English. Triage scores against whatever it currently says.
It is a versioned doc the operator edits freely.

## Mode: triage (bare `/ultradocket`)

A READ-ONLY discovery pass — it mutates nothing, so it is an improvised
dynamic workflow per the harness read/write boundary, never a committed
harness. Fan out over `gh issue list` and the repository: for each open,
well-defined issue, score well-definedness, alignment to `docs/objectives.md`,
estimated blast radius (likely files), and risk; cluster duplicates and
shared root causes. Write the ranked slate to `docs/superpowers/docket.md`
using the entry format below, every entry `State: triaged`. Then present the
**docket gate**: the operator strikes, reorders, and sets a budget ceiling;
accepted entries become `State: accepted`.

Entry format (parsed by `scripts/docket_lib.py` — the single source of truth):

​```
### #214: Stripe webhooks dropped on retry
**State:** accepted
**Score:** 8.5 — revenue-reliability objective
**Est-files:** services/billing/*, lib/webhooks.py
**Plan:** docs/superpowers/plans/2026-06-14-stripe-webhook-retry.md
**Seal:** a1b2c3d4e5f6
​```

Lifecycle: `triaged → accepted → planned → queued → executed → verified`; any
non-terminal state → `parked`. Transitions go through `docket_lib.transition`,
never hand-edited prose.

## Mode: plan (`/ultradocket plan`)

Pop the next `accepted` entry (highest score). Open a normal superpowers
brainstorm pre-seeded with the issue body, the triage notes, and the relevant
line(s) of `docs/objectives.md` — a well-defined issue is half a spec, so the
interview is short. Hand off to the standard brainstorm → writing-plans →
ultraplan → sealing pipeline. On completion, record the plan path and seal
into the entry (`State: queued`; `planned` is the intermediate where the plan
is approved but the seal is not yet issued). Throughput is capped by operator
attention here, by design — everything downstream of the operator's signature
runs at machine speed.

## Mode: run (`/ultradocket run`)

Compile and drain the queue. **Not yet implemented** — this is part 3c
(`docket-run`), the write-side harness born via the ratchet that part 2's
harness library establishes. Until it lands, compile a preview with
`python3 skills/ultradocket/scripts/compile_docket.py docs/superpowers/docket.md`
to see the collision-aware order, budget, and could-have-parallelized
projection for the queued plans.
```

(Note: in the actual file, the triage entry-format example must be wrapped in a
real triple-backtick fence — shown above with zero-width markers only to nest
it inside this plan. Use plain ``` fences.)

- [ ] **Step 2: Validate the skill**

Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultradocket`
Expected: `skill ok` (frontmatter valid; the only `scripts/` reference,
`scripts/docket_lib.py`, exists from Task 1).

- [ ] **Step 3: Run the full suite**

Run: `python3 -m pytest tests/ -q`
Expected: green (no test regressions; the new skill is prose + a validated reference).

- [ ] **Step 4: Commit**

```bash
git add skills/ultradocket/SKILL.md
git commit -m "feat: /ultradocket skill — objectives interview, triage, plan modes"
```

---

### Task 4: Full-suite verification

**Type:** gate
**Depends-on:** 1, 2, 3

Run: `python3 -m pytest tests/ -q`
Expected: every test passes, including `test_docket_lib.py` and `test_compile_docket.py`. Also: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultradocket` prints `skill ok`, and `python3 -m pytest tests/test_all_plans_compile.py -q` still passes (this plan carries its `**Acceptance:** suite` line).

---

## Self-review notes

- Spec coverage (triage/plan/compile portions): objectives interview + triage + docket gate (Task 3), docket format + lifecycle + parser (Task 1), plan-mode seeding (Task 3), portfolio compiler with collision graph + budget + could-have-parallelized seam (Task 2). Deferred to part 3c, explicitly: the `docket-run` drain harness, the unattended-with-evidence gate, the morning portfolio report, and the `run` mode body — all of which depend on part 2's ratchet.
- Type consistency: the `Entry` shape and `LIFECYCLE`/`transition` rules defined in Task 1 are exactly what Task 2 imports and what Task 3's skill prose describes; `compile_docket`'s output keys (`order`, `collisions`, `budget_usd`, `could_have_parallelized`) are fixed in Task 2 and consumed by part 3c later.
- Collisions: Tasks 1/2/3 touch disjoint files (`docket_lib.py`+test / `compile_docket.py`+test / `SKILL.md`). Edges 2→1 (import) and 3→1 (validate_skill reference) are explicit `Depends-on`. Waves: [1] → [2, 3].
- Execution ordering across plans: this plan is independent of part 2 and can ship anytime. Part 3c (drain) must follow BOTH this plan and part 2 (it consumes `compile_docket`'s output and is born via the harness ratchet).
