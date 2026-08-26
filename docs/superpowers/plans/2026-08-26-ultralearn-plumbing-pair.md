# ultralearn plumbing pair — Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the distill's parked-first-occurrence list issue-backed (#219) and the redirect-round canary computable via structured ledger fields (#220).

**Architecture:** Two independent surfaces. (1) Prose: the distill brief reads open `watch-item`-labeled GitHub issues as the authoritative parked list. (2) Schema+code: the lens readers' required redirect-round count finding gains `redirectRounds`/`implementationTasks` structured fields; `merge_ledger.py`'s digest gains a rate-by-engineVersion table; pass-through and tolerance of old-shape rows pinned by tests.

**Tech Stack:** Markdown skill prose; Python 3 (stdlib only); pytest.

**Spec:** docs/superpowers/specs/2026-08-26-ultralearn-plumbing-pair.md

**Acceptance:** suite — default disposition; the committed suite plus per-task review is the verification (no seal requested).

## Global Constraints

- The verification periphery (gate_check.py, ultra_gate.py, run_lock.sh, sealing scripts) has ZERO diff.
- `fleet/**` untouched.
- No Anthropic API calls or SDK anywhere in repo code.
- The observation ledger (`docs/superpowers/observations/ledger.jsonl`) is append-only and gitignored: no historical row is rewritten; every reader tolerates rows both with and without the new fields.
- The redirect-cause vocabulary is exactly the existing four: `infra`, `finding`, `plan`, `elective`.
- Commit messages reference the issue (`(#219)` / `(#220)`).

---

### Task 1: #219 — distill reads open `watch-item` issues as the parked list

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultralearn/references/distilling-proposals.md`
- Modify: `skills/ultralearn/SKILL.md`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: prose only — no symbols.

- [ ] **Step 1: Amend the "machinery is earned by recurrence" budget rule in `distilling-proposals.md`**

In the "Two budget rules keep the portfolio honest across cycles" list, replace the first bullet ("**Machinery is earned by recurrence.** A first occurrence gets a prose fix or a watch-item naming the recurrence that would justify a build; the build happens on the second occurrence. Never ship enforcement machinery around a prose rule that has not yet been given the chance to fail.") with:

```markdown
- **Machinery is earned by recurrence.** A first occurrence gets a prose fix
  or a watch-item naming the recurrence that would justify a build; the build
  happens on the second occurrence. Never ship enforcement machinery around a
  prose rule that has not yet been given the chance to fail. The parked
  first occurrences live as **open `watch-item`-labeled GitHub issues** —
  the authoritative list, never a memory note or local file. Before
  clustering, read it: `gh issue list --label watch-item --state open`.
  A new finding matching an open watch-item's named recurrence is a
  **second occurrence** — the build is licensed, and the proposal cites the
  watch-item issue number. On adoption, close the fired watch-item citing
  the evidence; park a new first occurrence by filing a new `watch-item`
  issue. Filing and closing stay operator-gated like all distill output.
```

- [ ] **Step 2: Add the one-line pointer in `SKILL.md` Verb 2**

In `skills/ultralearn/SKILL.md`, the Verb 2 paragraph contains "(first occurrence → prose or a watch-item; second → build)". Extend that parenthetical so the sentence reads:

```
machinery is earned by recurrence
(first occurrence → prose or a watch-item; second → build — the parked list
is the open `watch-item`-labeled GitHub issues, read at distill start via
`gh issue list --label watch-item --state open`), and at most one
additive guard per cycle is recommended for adoption.
```

(Keep surrounding text byte-identical; only the parenthetical grows.)

- [ ] **Step 3: Sanity-run the suite subset**

Run: `python3 -m pytest tests/test_merge_ledger.py tests/test_harvest_runs.py -q`
Expected: PASS (prose-only change; nothing should break).

- [ ] **Step 4: Commit**

```bash
git add skills/ultralearn/references/distilling-proposals.md skills/ultralearn/SKILL.md
git commit -m "docs(ultralearn): distill reads open watch-item issues as the parked-first-occurrence list (#219)"
```

### Task 2: #220 — structured redirect-round fields + digest rate table

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultralearn/references/reading-lenses.md`
- Modify: `skills/ultralearn/scripts/merge_ledger.py`
- Test: `tests/test_merge_ledger.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: ledger finding fields `redirectRounds` (dict: `total`,`infra`,`finding`,`plan`,`elective` — ints) and `implementationTasks` (int); digest section heading `## redirect-round rate by engineVersion`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_merge_ledger.py`:

```python
def test_structured_redirect_fields_pass_through(tmp_path):
    # #220: the canary fields must land in the ledger row intact.
    ledger = tmp_path / "ledger.jsonl"
    f = _finding(title="redirect count",
                 redirectRounds={"total": 3, "infra": 1, "finding": 2,
                                 "plan": 0, "elective": 0},
                 implementationTasks=7)
    m.merge_findings([f], ledger, lambda rid: "home")
    entry = json.loads(ledger.read_text().splitlines()[0])
    assert entry["redirectRounds"]["total"] == 3
    assert entry["implementationTasks"] == 7


def test_digest_renders_redirect_rate_table(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    m.merge_findings(
        [_finding(title="rr a", runId="r1",
                  redirectRounds={"total": 3, "infra": 1, "finding": 2,
                                  "plan": 0, "elective": 0},
                  implementationTasks=6),
         _finding(title="rr b", runId="r2",
                  redirectRounds={"total": 1, "infra": 0, "finding": 1,
                                  "plan": 0, "elective": 0},
                  implementationTasks=4)],
        ledger, lambda rid: "home", lambda rid: "0.2.21")
    digest = tmp_path / "ledger.md"
    m.regenerate_digest(ledger, digest)
    text = digest.read_text()
    assert "redirect-round rate by engineVersion" in text
    # 0.2.21: 2 runs, 4 rounds, 10 tasks, rate 0.40
    row = next(line for line in text.splitlines() if line.startswith("| 0.2.21"))
    assert "| 2 |" in row and "| 4 |" in row and "| 10 |" in row and "0.40" in row


def test_digest_tolerates_old_shape_rows(tmp_path):
    # Append-only ledger: historical rows carry no structured fields and
    # must neither crash the digest nor enter the rate table.
    ledger = tmp_path / "ledger.jsonl"
    m.merge_findings(
        [_finding(title="old prose-only count", runId="r1"),
         _finding(title="new structured", runId="r2",
                  redirectRounds={"total": 2, "infra": 0, "finding": 2,
                                  "plan": 0, "elective": 0},
                  implementationTasks=5)],
        ledger, lambda rid: "home")
    digest = tmp_path / "ledger.md"
    m.regenerate_digest(ledger, digest)
    text = digest.read_text()
    table_rows = [line for line in text.splitlines()
                  if line.startswith("|") and "engineVersion" not in line
                  and "---" not in line]
    assert len(table_rows) == 1  # only the structured row aggregates


def test_digest_skips_malformed_redirect_rounds(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    m.merge_findings(
        [_finding(title="bad shape", runId="r1", redirectRounds="three"),
         _finding(title="bad total", runId="r2",
                  redirectRounds={"total": "x"})],
        ledger, lambda rid: "home")
    digest = tmp_path / "ledger.md"
    m.regenerate_digest(ledger, digest)  # must not raise
    assert "redirect-round rate by engineVersion" not in digest.read_text()


def test_digest_rate_dash_when_tasks_unknown(tmp_path):
    # A structured count with no implementationTasks still aggregates —
    # rate renders as an em-dash instead of dividing by zero.
    ledger = tmp_path / "ledger.jsonl"
    m.merge_findings(
        [_finding(title="rr no tasks", runId="r1",
                  redirectRounds={"total": 2, "infra": 0, "finding": 2,
                                  "plan": 0, "elective": 0})],
        ledger, lambda rid: "home", lambda rid: "0.2.21")
    digest = tmp_path / "ledger.md"
    m.regenerate_digest(ledger, digest)
    row = next(line for line in digest.read_text().splitlines()
               if line.startswith("| 0.2.21"))
    assert "—" in row


def test_digest_dedupes_runid_last_row_wins(tmp_path):
    # Trim review F7b: a re-sensed run whose retitled count finding landed
    # twice (the ledger dedupes by runId+lens+title, so a retitle duplicates)
    # counts ONCE — the last qualifying ledger row wins.
    ledger = tmp_path / "ledger.jsonl"
    m.merge_findings(
        [_finding(title="rr first", runId="r1",
                  redirectRounds={"total": 5, "infra": 0, "finding": 5,
                                  "plan": 0, "elective": 0},
                  implementationTasks=10),
         _finding(title="rr resensed", runId="r1",
                  redirectRounds={"total": 2, "infra": 0, "finding": 2,
                                  "plan": 0, "elective": 0},
                  implementationTasks=10)],
        ledger, lambda rid: "home", lambda rid: "0.2.21")
    digest = tmp_path / "ledger.md"
    m.regenerate_digest(ledger, digest)
    row = next(line for line in digest.read_text().splitlines()
               if line.startswith("| 0.2.21"))
    assert "| 1 |" in row and "| 2 |" in row and "0.20" in row
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `python3 -m pytest tests/test_merge_ledger.py -q`
Expected: the digest-table tests FAIL (no table section exists yet); the pass-through test PASSES already (`redact_finding` copies the dict — that test is the pin, not a driver).

- [ ] **Step 3: Implement the rate table in `regenerate_digest`**

In `skills/ultralearn/scripts/merge_ledger.py`, add a helper and call it from `regenerate_digest` just before the per-lens sections are appended (after the header lines, keeping per-lens output unchanged):

```python
def _redirect_rate_table(findings):
    """#220: aggregate structured redirect-round counts by engineVersion.
    Rows lacking a well-formed redirectRounds (dict with int total) are
    skipped — historical prose-only rows never enter the table. One row per
    runId: the LAST qualifying ledger row wins (append-only → most recent;
    trim review F7b). A version's rate renders "—" unless every counted row
    carries an integer implementationTasks (partial denominators inflate)."""
    latest = {}
    for f in findings:
        rr = f.get("redirectRounds")
        if (isinstance(rr, dict) and isinstance(rr.get("total"), int)
                and not isinstance(rr.get("total"), bool)):
            latest[f.get("runId")] = f
    by_ver = {}
    for f in latest.values():
        ver = f.get("engineVersion") or "unknown"
        row = by_ver.setdefault(ver, {"runs": 0, "rounds": 0, "tasks": 0,
                                      "tasksKnown": True})
        row["runs"] += 1
        row["rounds"] += f["redirectRounds"]["total"]
        tasks = f.get("implementationTasks")
        if isinstance(tasks, int) and not isinstance(tasks, bool):
            row["tasks"] += tasks
        else:
            row["tasksKnown"] = False
    if not by_ver:
        return []
    lines = ["## redirect-round rate by engineVersion", "",
             "| engineVersion | n runs | Σ rounds | Σ tasks | rate |",
             "| --- | --- | --- | --- | --- |"]
    for ver in sorted(by_ver):
        row = by_ver[ver]
        if row["tasksKnown"] and row["tasks"] > 0:
            rate = f"{row['rounds'] / row['tasks']:.2f}"
        else:
            rate = "—"
        lines.append(f"| {ver} | {row['runs']} | {row['rounds']} "
                     f"| {row['tasks']} | {rate} |")
    lines.append("")
    return lines
```

Wire-in inside `regenerate_digest`, immediately after the existing header `lines = [...]` assignment:

```python
    lines.extend(_redirect_rate_table(findings))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_merge_ledger.py -q`
Expected: ALL PASS (new and pre-existing).

- [ ] **Step 5: Amend the reader schema in `reading-lenses.md`**

In "The redirect-round count (required, exactly one per bundle)", after the sentence ending "...platform weather never masquerades as rigor signal.", insert:

```markdown
Machine-readably: the count finding additionally carries
`redirectRounds` — `{"total": N, "infra": a, "finding": b, "plan": c,
"elective": d}`, non-negative integers (the cause counts should sum to
`total`) — and `implementationTasks` (integer). The title prose stays as
the human headline; the structured fields are what the canary aggregates
by `engineVersion`, so emit them on every count finding, including the
zero (`{"total": 0, ...}`).
```

In the "Output schema (one object per finding)" list, append two entries:

```markdown
- `redirectRounds` (object — required on the redirect-round count finding
  only) — `{total, infra, finding, plan, elective}`, non-negative integers.
- `implementationTasks` (integer — required on the redirect-round count
  finding only) — the run's implementation-task count.
```

- [ ] **Step 6: Commit**

```bash
git add skills/ultralearn/references/reading-lenses.md skills/ultralearn/scripts/merge_ledger.py tests/test_merge_ledger.py
git commit -m "feat(ultralearn): structured redirectRounds/implementationTasks fields + digest rate table (#220)"
```

### Task 3: Gate — full suite green

**Type:** gate
**Depends-on:** 1, 2

**Files:**
- Test: `tests/`

- [ ] **Step 1: Run the full suite**

Run: `python3 -m pytest`
Expected: PASS (~1153 tests, no regressions).

## Operator smoke

- do: `python3 -m pytest tests/test_merge_ledger.py -q`
- see: all tests pass, including the five new `redirect`/`tolerates` tests.

- do: `gh issue list --label watch-item --state open | head -5`
- see: the open watch-item issues (#227–#237 family) — the list the amended distill brief now names as the authoritative parked-first-occurrence store.

- do: read `docs/superpowers/observations/ledger.md` after the next sense pass merges a structured count finding
- see: a `## redirect-round rate by engineVersion` table with one row per version (historical prose-only rows absent from it, per-lens listing unchanged).
