# Durable docket `Notes` field + triage-disposition guard (#74) — Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give docket entries a durable `**Notes:**` field that survives lifecycle transitions (so triage rationale is no longer destroyed on the first `accepted→planned`), and stop triage from guessing an acceptance disposition it doesn't own.

**Architecture:** Mirror the existing `Engine` field in `docket_lib.py` — add `notes` to the `Entry` dataclass, the `_FIELD` regex, the `parse_docket` constructor, and `serialize_docket`. `transition` (already `dataclasses.replace`) copies it for free, so the field round-trips through every transition once it exists. Separately, a doc-only edit to `ultradocket/SKILL.md` triage prose keeps disposition out of triage and documents the new field.

**Tech Stack:** Python 3 (`docket_lib.py`, pytest), Markdown (`ultradocket/SKILL.md`).

## Global Constraints

- **Mirror the `Engine` field pattern exactly** — `Notes` is added in the same four places `Engine` was, and emitted **last** in `serialize_docket` (after `Engine`).
- **`Notes` is free text** — no validation, no lifecycle rules; it is a general durable annotation (triage rationale now; park reasons / re-scope notes later).
- **`transition` is not modified** — it already copies all fields via `dataclasses.replace`.
- **No version bump; no direct Anthropic API calls; worktree-pure** (the executor owns branching).

---

### Task 1: `docket_lib` — durable `Notes` field

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultradocket/scripts/docket_lib.py`
- Test: `tests/test_docket_lib.py`

**Interfaces:**
- Consumes: the existing `Entry` dataclass, `_FIELD` regex, `parse_docket`, `serialize_docket`, `transition` in `docket_lib.py`.
- Produces: `Entry.notes: str = None`; `parse_docket` populates it from a `**Notes:**` line; `serialize_docket` emits `**Notes:** <text>` (last, only when present); the field survives `transition`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_docket_lib.py`. The file loads the module via a `load()` helper (importlib) — use `m = load()` and `m.<fn>`, matching every existing test:

```python
def test_notes_field_parses_and_round_trips():
    m = load()
    text = ("# Docket\n\n### #9: t\n**State:** triaged\n**Score:** 8 — x\n"
            "**Est-files:** a.py\n**Notes:** core fix already landed; verify & close\n")
    e = m.parse_docket(text)[0]
    assert e.notes == "core fix already landed; verify & close"
    reparsed = m.parse_docket(m.serialize_docket([e]))[0]
    assert reparsed.notes == e.notes


def test_notes_survives_transition():
    """The exact bug: rationale was destroyed on the first accepted->planned."""
    m = load()
    text = ("# Docket\n\n### #9: t\n**State:** accepted\n**Score:** 8 — x\n"
            "**Est-files:** a.py\n**Notes:** partly landed; re-scope to remainder\n")
    e = m.parse_docket(text)[0]
    e2 = m.transition(e, "planned")
    out = m.serialize_docket([e2])
    assert "**Notes:** partly landed; re-scope to remainder" in out
    assert m.parse_docket(out)[0].notes == e.notes


def test_no_notes_emits_no_notes_line():
    m = load()
    text = ("# Docket\n\n### #9: t\n**State:** triaged\n**Score:** 8 — x\n"
            "**Est-files:** a.py\n")
    e = m.parse_docket(text)[0]
    assert e.notes is None
    assert "**Notes:**" not in m.serialize_docket([e])
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_docket_lib.py -k notes -q`
Expected: FAIL — `Entry` has no `notes` attribute (`AttributeError`) / the `**Notes:**` line is dropped on serialize.

- [ ] **Step 3: Add `notes` to the `Entry` dataclass**

In `skills/ultradocket/scripts/docket_lib.py`, add the field after `engine`:

```python
    plan: str = None
    seal: str = None
    engine: str = None
    notes: str = None
```

- [ ] **Step 4: Add `Notes` to the field regex + parse constructor**

Extend the `_FIELD` alternation to include `Notes`:

```python
_FIELD = re.compile(r"^\*\*(State|Score|Est-files|Plan|Seal|Engine|Notes):\*\*\s*(.*?)\s*$")
```

In `parse_docket`'s `flush()`, pass `notes` into the `Entry(...)` construction (alongside `engine=engine`):

```python
        entries.append(Entry(issue=cur[0], title=cur[1], state=fields["State"],
                             score=fields["Score"], est_files=est,
                             plan=fields.get("Plan") or None, seal=fields.get("Seal") or None,
                             engine=engine, notes=fields.get("Notes") or None))
```

- [ ] **Step 5: Emit `Notes` last in `serialize_docket`**

After the `if e.engine:` block, add:

```python
        if e.engine:
            out.append(f"**Engine:** {e.engine}")
        if e.notes:
            out.append(f"**Notes:** {e.notes}")
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_docket_lib.py -q`
Expected: PASS (the three new `notes` tests and every pre-existing `docket_lib` test).

- [ ] **Step 7: Commit**

```bash
git add skills/ultradocket/scripts/docket_lib.py tests/test_docket_lib.py
git commit -m "feat(docket): durable Notes field that survives lifecycle transitions (#74)"
```

---

### Task 2: `ultradocket/SKILL.md` — keep disposition out of triage + document `Notes`

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultradocket/SKILL.md`
- Test: `tests/test_ultradocket_skill.py`

**Interfaces:**
- Consumes: the "Mode: triage" section of `ultradocket/SKILL.md` (its entry-format example + the triage description).
- Produces: triage prose stating disposition is decided at planning (not guessed at triage), a documented `**Notes:**` field in the entry-format example, and a prose-contract test guarding both.

**Parallelization rationale:** doc + doc-test on files disjoint from Task 1's code + code-test — a reviewer can accept the field implementation while rejecting the prose (or vice versa), so they are honestly independent, not an authoring-order chain.

- [ ] **Step 1: Write the failing prose-contract test**

Append to `tests/test_ultradocket_skill.py` (it already reads `SKILL.md` — match its style):

```python
def test_triage_does_not_assign_disposition():
    low = SKILL.lower()
    # triage must state disposition is decided at planning, not guessed at triage
    assert "disposition" in low
    assert "planning" in low or "sweep step" in low


def test_notes_field_documented():
    assert "**Notes:**" in SKILL
```

If the file binds the skill text to a different variable name than `SKILL`, use that.

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/test_ultradocket_skill.py -k "triage or notes" -q`
Expected: FAIL — the triage-disposition rule and the `**Notes:**` field are not yet in `SKILL.md`.

- [ ] **Step 3: Edit the triage-mode prose**

In `skills/ultradocket/SKILL.md`, in the **Mode: triage** section:

1. Add the `**Notes:**` field to the entry-format example block (after `**Est-files:**`, before `**Plan:**`), e.g.:

```
**Est-files:** services/billing/*, lib/webhooks.py
**Notes:** triage rationale — durable, survives transitions (e.g. "already fixed in main, verify & close")
**Plan:** docs/superpowers/plans/2026-06-14-stripe-webhook-retry.md
```

2. In the triage description prose, add a sentence instructing triage to record its rationale in the durable `**Notes:**` field (rather than packing it into the `Score` line), and a disposition guard:

> Record each entry's triage rationale in the durable `**Notes:**` field.
> Triage does **not** assign an acceptance disposition — that is decided at
> planning (sweep step 3). Do not guess `sealed`/`suite` at triage.

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 -m pytest tests/test_ultradocket_skill.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/ultradocket/SKILL.md tests/test_ultradocket_skill.py
git commit -m "docs(docket): triage records rationale in Notes, never guesses disposition (#74)"
```

---

### Task 3: Full-suite gate

**Type:** gate

**Files:** none — verification only.

- [ ] **Step 1: Run the full suite**

Run: `python3 -m pytest`
Expected: PASS — all green, including the new `docket_lib` `notes` tests and the `ultradocket_skill` prose-contract tests.

---

## Acceptance

**Acceptance:** suite — ultrapowers' own docket-tooling + skill-prose change, verified by the committed pytest suite (the new `notes` round-trip/transition tests + the triage prose-contract tests) plus adversarial diff review; no held-out exam.
