# Docket suite-disposition path — Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the docket drain build `suite`-disposition plans (ultrapowers's own engine/skill work) through a deterministic committed-suite gate, instead of hard-failing because they carry no held-out seal.

**Architecture:** Three surgical touch points, each a worktree-pure diff. `compile_docket.py` resolves each queued plan's `(writes, acceptance.mode)` from the single `compile_plan` call it already makes, then requires a `Seal` *only* for `sealed`-mode plans. `run_acceptance.sh` gains a `--suite-gate` mode that runs the committed test suite on a plan's branch in a detached worktree and emits the same JSON contract as the sealed path. `ultradocket/SKILL.md` drain step-3 dispatches the correctness gate on the plan's disposition. The sealed path is untouched.

**Tech Stack:** Python 3 (`compile_docket.py`, pytest), Bash (`run_acceptance.sh`), Markdown skill prose.

## Global Constraints

- **Disposition source of truth is the plan's `**Acceptance:**` line**, read as `acceptance.mode` (`sealed` | `suite` | `waived` | `missing`) from `compile_plan.py` output. No new docket field; no new persisted state.
- **The committed-suite gate command is `python3 -m pytest`** — the documented repo gate (`pytest.ini` scopes it to `tests/`). Exit-code authority.
- **The sealed path stays byte-for-byte unchanged** — `run_acceptance.sh <sealId> <branch> <sha256>` and its tests are not modified in behavior.
- **No direct Anthropic API calls** anywhere in shipped or dev code (no `anthropic` SDK, no `ANTHROPIC_API_KEY`).
- **Worktree-pure tasks**: no `git checkout -b` / push / deploy steps inside implementation tasks; the executor owns branching.
- **No version bump** in this plan (a release is a separate ritual; versioning stays `0.0.x`).

---

### Task 1: `compile_docket` — compile-then-validate, seal required only for sealed plans

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultradocket/scripts/compile_docket.py`
- Test: `tests/test_compile_docket.py`

**Interfaces:**
- Consumes: `compile_plan.py` JSON output (already has `tasks[].writes` and `acceptance.mode`); `docket_lib.parse_docket(text) -> [Entry]` with `Entry.plan`, `Entry.seal`, `Entry.score`, `Entry.state`.
- Produces: `plan_facts(plan_path) -> (set[str] writes, str mode)`; `plan_writes(plan_path) -> set[str]` (thin wrapper, unchanged signature); `compile_docket(docket_text, facts_resolver=plan_facts, budget_usd=None) -> dict` (the `writes_resolver` kwarg is renamed to `facts_resolver` and now returns `(writes, mode)`).

- [ ] **Step 1: Write the failing tests**

In `tests/test_compile_docket.py`, update every injected resolver from a writes-only lambda to a `(writes, mode)` lambda, re-scope the seal test to `sealed`-mode, and add two new tests. Replace the bodies of `test_collisions_detected`, `test_order_sequences_collisions_by_score`, `test_parallelism_projection_groups_disjoint_plans`, `test_only_queued_entries_considered`, `test_duplicate_plan_paths_fail_loud`, and `test_budget_passes_through` so each call passes `facts_resolver=lambda p: (WRITES[p], "sealed")` (or `({"a.py"}, "sealed")` etc.) instead of `writes_resolver=...`. Then replace the seal test and add the two new ones:

```python
def test_sealed_entry_without_seal_fails_loud():
    """A sealed-disposition queued entry with no Seal still fails loud."""
    m = load()
    docket = ("# Docket\n\n### #1: a\n**State:** queued\n**Score:** 9 — x\n"
              "**Est-files:** a.py\n**Plan:** p.md\n")  # Plan present, Seal absent
    import pytest
    with pytest.raises(Exception):
        m.compile_docket(docket, facts_resolver=lambda p: ({"a.py"}, "sealed"))


def test_suite_entry_without_seal_compiles():
    """A suite-disposition queued entry needs no Seal — it compiles."""
    m = load()
    docket = ("# Docket\n\n### #1: a\n**State:** queued\n**Score:** 9 — x\n"
              "**Est-files:** a.py\n**Plan:** p.md\n")  # no Seal — legal for suite
    r = m.compile_docket(docket, facts_resolver=lambda p: ({"a.py"}, "suite"))
    assert r["order"] == ["p.md"]


def test_mixed_sealed_and_suite_queue_compiles():
    """A queue mixing a sealed (sealed entry) and a suite (seal-less) plan
    compiles; order is score-descending."""
    m = load()
    docket = ("# Docket\n\n"
              "### #1: sealed\n**State:** queued\n**Score:** 9 — x\n"
              "**Est-files:** a.py\n**Plan:** pa.md\n**Seal:** aaa111aaa111\n\n"
              "### #2: suite\n**State:** queued\n**Score:** 5 — x\n"
              "**Est-files:** b.py\n**Plan:** pb.md\n")  # suite, no Seal
    modes = {"pa.md": "sealed", "pb.md": "suite"}
    writes = {"pa.md": {"a.py"}, "pb.md": {"b.py"}}
    r = m.compile_docket(docket, facts_resolver=lambda p: (writes[p], modes[p]))
    assert r["order"] == ["pa.md", "pb.md"]
    assert r["collisions"] == []
```

Delete the old `test_queued_entry_without_seal_fails_loud` (replaced by `test_sealed_entry_without_seal_fails_loud`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_compile_docket.py -x -q`
Expected: FAIL — `compile_docket()` has no `facts_resolver` kwarg yet (`TypeError: unexpected keyword argument 'facts_resolver'`), and `test_suite_entry_without_seal_compiles` raises instead of compiling.

- [ ] **Step 3: Add `plan_facts`, rewrite `plan_writes`, update `compile_docket`**

In `skills/ultradocket/scripts/compile_docket.py`, replace the `plan_writes` function (lines ~26-44) with `plan_facts` + a thin `plan_writes`:

```python
def plan_facts(plan_path):
    """Authoritative (writes, acceptance-mode) of a plan, from ONE compile_plan
    invocation. A missing/uncompilable Plan raises a friendly ValueError naming
    the plan (so the drain parks that entry with a clear reason) rather than a raw
    CalledProcessError stack trace (#34)."""
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
    mode = (data.get("acceptance") or {}).get("mode", "missing")
    return writes, mode


def plan_writes(plan_path):
    """Write-set only (union of task writes), for callers that don't need the
    disposition. Thin wrapper over plan_facts."""
    return plan_facts(plan_path)[0]
```

Then update `compile_docket` so it resolves facts up front and scopes the seal check to `sealed` plans:

```python
def compile_docket(docket_text, facts_resolver=plan_facts, budget_usd=None):
    """Compile queued docket entries into execution order and parallelism
    projection. A Seal is required only for `sealed`-disposition plans; `suite`
    and `waived` plans are verified by the committed suite / operator and carry
    no held-out seal. Order is pure score-descending (v1)."""
    entries = [e for e in docket_lib.parse_docket(docket_text) if e.state == "queued"]

    missing = [e.issue for e in entries if not e.plan]
    if missing:
        raise ValueError(f"queued docket entries missing a Plan: {missing}")

    # Resolve each plan once: (writes, acceptance mode). Uncompilable -> friendly raise.
    facts = {e.plan: facts_resolver(e.plan) for e in entries}

    no_seal = [e.issue for e in entries if facts[e.plan][1] == "sealed" and not e.seal]
    if no_seal:
        raise ValueError(f"queued sealed-disposition entries missing a Seal: {no_seal}")

    plan_paths = [e.plan for e in entries]
    dupes = sorted({p for p in plan_paths if plan_paths.count(p) > 1})
    if dupes:
        raise ValueError(f"queued docket entries share a Plan path: {dupes}")

    by_score = sorted(entries, key=lambda e: -float(e.score.split()[0]))
    wsets = {e.plan: set(facts[e.plan][0]) for e in entries}
```

Leave the collisions / order / projection / return block below `wsets` exactly as-is (it already reads `wsets`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_compile_docket.py -q`
Expected: PASS (all, including the two new suite tests and the re-scoped sealed test).

- [ ] **Step 5: Commit**

```bash
git add skills/ultradocket/scripts/compile_docket.py tests/test_compile_docket.py
git commit -m "feat(docket): seal required only for sealed-disposition queued plans"
```

---

### Task 2: `run_acceptance.sh --suite-gate` — committed-suite gate on a branch

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/run_acceptance.sh`
- Test: `tests/test_run_acceptance.py`

**Interfaces:**
- Consumes: existing `emit()` helper and the `cleanup`/`EXAM_WT` worktree-removal trap in `run_acceptance.sh`.
- Produces: CLI mode `run_acceptance.sh --suite-gate --branch <branch> [--run <cmd>] [--repo <dir>]` — creates a detached worktree of `<branch>`, runs `<cmd>` (default `python3 -m pytest`), emits the same JSON shape as the sealed path (`{sealId:"(suite)", status, passed, exitCode, output, redKind?}`); exit 0 iff the suite passed and at least one test ran.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_run_acceptance.py` (it already has `sh`, `RUN`, and `import json`):

```python
def make_suite_repo(tmp_path, test_body, *, name="repo"):
    """A repo whose COMMITTED suite is tests/test_committed.py."""
    repo = tmp_path / name
    (repo / "tests").mkdir(parents=True)
    sh(["git", "init", "-q", "-b", "main"], cwd=repo)
    sh(["git", "config", "user.email", "t@t"], cwd=repo)
    sh(["git", "config", "user.name", "t"], cwd=repo)
    (repo / "tests" / "test_committed.py").write_text(test_body)
    sh(["git", "add", "."], cwd=repo)
    sh(["git", "commit", "-qm", "base"], cwd=repo)
    return repo


def suite_gate(repo, branch="main", run=None):
    cmd = ["bash", str(RUN), "--suite-gate", "--branch", branch, "--repo", str(repo)]
    if run:
        cmd += ["--run", run]
    r = sh(cmd, check=False)
    return r.returncode, json.loads(r.stdout)


def test_suite_gate_green_passes(tmp_path):
    repo = make_suite_repo(tmp_path, "def test_ok():\n    assert True\n")
    code, out = suite_gate(repo)            # default run cmd = python3 -m pytest
    assert code == 0 and out["status"] == "OK" and out["passed"] is True
    assert out["sealId"] == "(suite)"


def test_suite_gate_red_parks(tmp_path):
    repo = make_suite_repo(tmp_path, "def test_ok():\n    assert False\n")
    code, out = suite_gate(repo)
    assert code != 0 and out["passed"] is False and out["exitCode"] != 0


def test_suite_gate_no_tests_never_false_greens(tmp_path):
    repo = make_suite_repo(tmp_path, "# no tests here\n")
    code, out = suite_gate(repo)            # pytest exits 5 (no tests collected)
    assert code != 0 and out["passed"] is False and out["status"] == "ERROR"


def test_suite_gate_worktree_cleaned_up(tmp_path):
    repo = make_suite_repo(tmp_path, "def test_ok():\n    assert True\n")
    suite_gate(repo)
    listed = sh(["git", "worktree", "list"], cwd=repo).stdout.strip().splitlines()
    assert len(listed) == 1, "suite-gate worktree leaked"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_run_acceptance.py -k suite_gate -q`
Expected: FAIL — `run_acceptance.sh` rejects `--suite-gate` as an unknown first argument (it falls into the sealed branch and treats `--suite-gate` as a seal-id), so stdout is not the expected JSON.

- [ ] **Step 3: Add the `--suite-gate` mode**

In `skills/ultrapowers/scripts/run_acceptance.sh`, extend the top-of-file mode dispatch. Add a `suite-gate` branch to the leading `if`/`else` that currently distinguishes `--baseline` from sealed. After the existing `--baseline` block's `fi` is reached only in the else; instead change the opening conditional to a three-way:

Replace the header dispatch (the `if [ "${1:-}" = "--baseline" ]; then ... else ... fi` block, lines ~18-45) so it also recognizes `--suite-gate`:

```bash
SEAL_ID="(baseline)"; BRANCH=""; EXPECTED=""
VAULT="${HOME}/.ultrapowers/acceptance"
REPO="$(pwd)"
B_SUITE=""; B_RUN=""; B_BOOT=""
SG_RUN="python3 -m pytest"
MODE="sealed"
if [ "${1:-}" = "--baseline" ]; then
  MODE="baseline"; shift
  while [ $# -gt 0 ]; do
    case "$1" in
      --suite)     B_SUITE="$2"; shift 2 ;;
      --branch)    BRANCH="$2";  shift 2 ;;
      --run)       B_RUN="$2";   shift 2 ;;
      --bootstrap) B_BOOT="$2";  shift 2 ;;
      --repo)      REPO="$2";    shift 2 ;;
      *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
  done
  : "${B_SUITE:?--baseline requires --suite}"
  : "${BRANCH:?--baseline requires --branch}"
  : "${B_RUN:?--baseline requires --run}"
elif [ "${1:-}" = "--suite-gate" ]; then
  MODE="suite-gate"; SEAL_ID="(suite)"; shift
  while [ $# -gt 0 ]; do
    case "$1" in
      --branch) BRANCH="$2"; shift 2 ;;
      --run)    SG_RUN="$2"; shift 2 ;;
      --repo)   REPO="$2";   shift 2 ;;
      *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
  done
  : "${BRANCH:?--suite-gate requires --branch}"
else
  SEAL_ID="${1:?usage: run_acceptance.sh <seal-id> <branch> <sha256> [--vault DIR] [--repo DIR]}"
  BRANCH="${2:?missing branch}"
  EXPECTED="${3:?missing expected sha256}"
  shift 3
  while [ $# -gt 0 ]; do
    case "$1" in
      --vault) VAULT="$2"; shift 2 ;;
      --repo)  REPO="$2";  shift 2 ;;
      *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
  done
fi
```

Then add the suite-gate execution block immediately **after** the `run_exam` function definition and **before** the `# ── Baseline mode …` block (so the `cleanup`/`EXAM_WT` trap, already defined above, covers it):

```bash
# ── Suite-gate mode (committed-suite gate for suite-disposition plans) ─────────
# Runs the repo's OWN committed suite (already on the branch) in a detached
# worktree. No held-out suite is mounted. pytest exit codes are the authority:
# 0 => pass; 5 => no tests collected (false-green guard); anything else => red.
if [ "$MODE" = "suite-gate" ]; then
  EXAM_WT="$(mktemp -d)/suite-gate"
  if ! git -C "$REPO" worktree add --detach "$EXAM_WT" "$BRANCH" >/dev/null 2>&1; then
    emit ERROR false 1 "could not create suite-gate worktree for branch $BRANCH in $REPO"
    exit 1
  fi
  OUT="$( (cd "$EXAM_WT" && eval "$SG_RUN") 2>&1 )"; CODE=$?
  if [ "$CODE" -eq 0 ]; then
    emit OK true 0 "$OUT"; exit 0
  elif [ "$CODE" -eq 5 ]; then
    emit ERROR false 5 "committed suite collected no tests — refusing to false-green:
$OUT"; exit 1
  else
    emit OK false "$CODE" "$OUT" assertion; exit 1
  fi
fi
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_run_acceptance.py -q`
Expected: PASS — the four new `suite_gate` tests pass AND every pre-existing sealed/baseline test still passes (the sealed path is untouched).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/run_acceptance.sh tests/test_run_acceptance.py
git commit -m "feat(acceptance): add --suite-gate mode (committed-suite gate on a branch)"
```

---

### Task 3: drain prose — dispatch the correctness gate on disposition

**Type:** implementation
**Depends-on:** 1, 2

**Files:**
- Modify: `skills/ultradocket/SKILL.md`
- Test: `tests/test_ultradocket_skill.py`

**Interfaces:**
- Consumes: the `run_acceptance.sh --suite-gate --branch <branch>` CLI signature (from Task 2); the seal-required-only-for-sealed behavior of `compile_docket` (from Task 1).
- Produces: drain step-3 prose covering all three dispositions; a prose-contract test guarding it.

**Parallelization rationale:** none — this is the one dependent tail (it documents the interfaces Tasks 1 and 2 land), so it cannot share their wave. The plan's parallelism is the Task 1 ∥ Task 2 wave; this task is honestly serial after it.

- [ ] **Step 1: Write the failing test**

Create `tests/test_ultradocket_skill.py`:

```python
"""Prose contract: the docket drain documents all three acceptance dispositions
and the committed-suite gate invocation, so the suite path cannot silently
regress out of the skill."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKILL = (ROOT / "skills/ultradocket/SKILL.md").read_text()


def test_drain_documents_suite_gate_invocation():
    assert "--suite-gate" in SKILL


def test_drain_dispatches_on_all_three_dispositions():
    low = SKILL.lower()
    assert "sealed" in low and "suite" in low and "waived" in low


def test_waived_is_parked_not_auto_merged():
    low = SKILL.lower()
    # waived work is never auto-merged unverified — it parks for the operator.
    assert "waived" in low and "park" in low
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/test_ultradocket_skill.py -q`
Expected: FAIL — `--suite-gate` and the `waived` disposition are not yet in `SKILL.md`.

- [ ] **Step 3: Edit the drain prose**

In `skills/ultradocket/SKILL.md`, in **Mode: run**, replace step 3 ("Administer the sealed exam …") with a disposition-dispatched gate. Replace the existing bullet:

> 3. **Administer the sealed exam** against the plan's branch with
>    `run_acceptance.sh <sealId> <branch> <sha256>` (exit-code authority; it makes
>    its own detached worktree, so it is agnostic to the current checkout).

with:

```markdown
3. **Administer the correctness gate** against the plan's branch, dispatched on
   the plan's disposition (its `**Acceptance:**` line, read as `acceptance.mode`
   from `compile_plan`). Each runner makes its own detached worktree (agnostic to
   the current checkout) and is exit-code authority:
   - `sealed` → `run_acceptance.sh <sealId> <branch> <sha256>` — the held-out exam.
   - `suite` → `run_acceptance.sh --suite-gate --branch <branch>` — the committed
     suite (`python3 -m pytest`) run on the branch; exit 0 ⇒ pass. This is the
     disposition for ultrapowers' own engine/skill/doc work, which authors no
     held-out exam.
   - `waived` → no gate exists; **park for the operator** at the end gate. Never
     auto-merge unverified work.
```

Then in step 4 ("Merge or park"), update the **Green exam** / **Red exam** bullets to read "gate" instead of "exam" so they cover both runners (the JSON contract is identical), and confirm the **Red exam or executor failure → park** bullet already covers a red suite gate.

In **Mode: plan** step 5 ("Write back"), replace the parenthetical so suite plans queue without a seal:

> 5. **Write back** in one atomic entry update — plan path, seal-id, and engine —
>    advancing the entry `accepted → planned → queued` ...

becomes:

```markdown
5. **Write back** in one atomic entry update — plan path, engine, and (for
   `sealed` plans only) the seal-id — advancing the entry
   `accepted → planned → queued` via `docket_lib.transition` (`planned` is the
   intermediate: approved, seal not yet issued for sealed plans; for `suite`/
   `waived` plans there is no seal and the entry advances straight to `queued`).
   Never hand-edit the docket prose.
```

And update the "If sealing fails" paragraph to scope it to sealed plans:

> **If sealing fails**, the entry stays `planned` (approved, unsealed) ...

becomes:

```markdown
**If sealing fails** (a `sealed`-disposition plan only — `suite` and `waived`
plans author no seal and are never "sealing failures"), the entry stays `planned`
(approved, unsealed) and the sweep continues; it surfaces for a retry on a later
sweep. It is never `queued`, so the drain never picks up an unsealed sealed plan.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 -m pytest tests/test_ultradocket_skill.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/ultradocket/SKILL.md tests/test_ultradocket_skill.py
git commit -m "docs(docket): drain gate dispatches on disposition (sealed/suite/waived)"
```

---

### Task 4: Full-suite gate

**Type:** gate

**Files:** none — verification only.

The committed suite is the acceptance for this `suite`-disposition plan. Run the
full gate and confirm green; this is the merge-time verification.

- [ ] **Step 1: Run the full suite**

Run: `python3 -m pytest`
Expected: PASS — all tests green, including the new `test_ultradocket_skill.py`, the new `suite_gate` tests, and the re-scoped `test_compile_docket.py`.

---

## Acceptance

**Acceptance:** suite — ultrapowers' own engine/skill change, verified by the committed pytest suite (with the new tests in Tasks 1–3) plus adversarial diff review; no held-out exam.

Bootstrap note: this plan **cannot be built by the docket drain** (the suite path it
adds does not exist yet), so it is built via the normal single-feature `/ultrapowers`
flow; once landed, `/ultradocket run` handles suite plans thereafter.
