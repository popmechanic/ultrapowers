# Suite-gate JS-behavioral sims Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a suite-disposition plan's branch changes harness JS, make `run_acceptance.sh --suite-gate` also run the harness `.mjs` sims so JS behavior is exit-code-gated like Python — closing the shallow-green hole in the docket drain's auto-merge keystone (issue #79).

**Architecture:** One surgical change to `run_acceptance.sh`: the `--suite-gate` mode gains an optional `--base <ref>`; after a green pytest run it diffs `base...HEAD`, and if `skills/ultrapowers/harnesses/*.js` was touched it auto-discovers the harness sims (the `tests/*.mjs` referencing `harnesses/`), runs each with `node`, and requires exit-0 **plus** a pass sentinel. Results fold into the same one-object JSON contract. Docs (`ultradocket/SKILL.md`, `CLAUDE.md`) record how the drain arms it. No `waves.js` edit → no re-bake.

**Tech Stack:** Bash (`run_acceptance.sh`), `git worktree`, `node` (harness sims), Python `pytest` (the suite that tests the gate).

**Acceptance:** suite — this is ultrapowers' own gate-script + skill/doc development; author and operator read every diff, and the committed pytest suite (plus the manually-run `.mjs` sims) is the verification. No held-out exam is authored.

## Global Constraints

- **Versioning stays `0.0.x`; this plan bumps NO version.** Do not touch `.claude-plugin/plugin.json` or `marketplace.json`.
- **No direct Anthropic API calls / no `anthropic` SDK / no `ANTHROPIC_API_KEY`** in any script.
- **Do not edit `skills/ultrapowers/harnesses/waves.js`** — it is baked from `references/*.md` and pinned by `tests/test_no_prompt_drift.py`. This plan does not touch it, so no re-bake is needed.
- **The JSON contract shape is fixed:** every emitted object is `{sealId, status, passed, exitCode, output, redKind?}`. `sealId` for the suite-gate stays the literal `(suite)`. New failure paths reuse existing fields only.
- **Backward compatibility:** a `--suite-gate` invocation that passes **no** `--base` must behave byte-for-byte as it does today (pytest-only). The three existing suite-gate tests pass no `--base` and must stay green untouched.
- **Sentinel convention:** a harness sim signals success by printing a line matching the extended regex `ALL (SCENARIOS|TESTS) PASSED` (both current sims already do).

---

## File structure

- `skills/ultrapowers/scripts/run_acceptance.sh` — **modify.** Add `SG_BASE` parsing to the `--suite-gate` arg loop; add a `run_js_sims` helper after `run_exam`; fold its result into the suite-gate green branch.
- `tests/test_run_acceptance.py` — **modify.** Extend the `suite_gate` helper with an optional `base=`; add a JS-sim repo fixture and five new cases.
- `skills/ultradocket/SKILL.md` — **modify.** Document `--base <integration-line-HEAD>` on the drain's step-3 `suite` gate line.
- `CLAUDE.md` — **modify.** One line: the suite-gate runs the harness sims when `harnesses/*.js` changes, and harness sims must print the pass sentinel.
- `tests/test_ultradocket_skill.py` — **modify.** Pin that the drain documents passing `--base` to the suite-gate.

Task 1 (the gate script + its tests) and Task 2 (docs + doc pin) touch disjoint files with no build-time data dependency, so they are independent. Task 3 is the verification gate over both.

---

### Task 1: `run_acceptance.sh` — run harness sims on a harness-JS diff

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/run_acceptance.sh`
- Test: `tests/test_run_acceptance.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: the CLI contract `run_acceptance.sh --suite-gate --branch <B> [--base <ref>] [--run <cmd>] [--repo <dir>]`. With `--base`: after a green pytest, if `git diff --name-only <base>...HEAD` lists a `skills/ultrapowers/harnesses/*.js` path, each `tests/*.mjs` referencing `harnesses/` is run with `node`; a sim passes iff exit 0 **and** stdout matches `ALL (SCENARIOS|TESTS) PASSED`. Emitted JSON stays `{sealId:"(suite)", status, passed, exitCode, output, redKind?}`: sim assertion red → `status OK, passed false, redKind "assertion"`; sim false-green / missing `node` / no harness sim exists → `status ERROR, passed false` (no `redKind`). Without `--base`, or with no harness diff, behavior is unchanged (pytest-only).

- [ ] **Step 1: Add the failing tests**

Append to `tests/test_run_acceptance.py`. First add these imports near the top of the file (after the existing `import sys`):

```python
import shutil

NODE = shutil.which("node")
needs_node = pytest.mark.skipif(NODE is None, reason="node not installed")
```

`pytest` is already importable in this suite (other tests use `tmp_path`); if `import pytest` is not already present at the top of the file, add it alongside the other imports.

Then extend the existing `suite_gate` helper to accept an optional base (replace the current definition):

```python
def suite_gate(repo, branch="main", run=None, base=None):
    cmd = ["bash", str(RUN), "--suite-gate", "--branch", branch, "--repo", str(repo)]
    if run:
        cmd += ["--run", run]
    if base:
        cmd += ["--base", base]
    r = sh(cmd, check=False)
    return r.returncode, json.loads(r.stdout)
```

Now add a fixture builder and the five cases at the end of the file:

```python
def make_js_suite_repo(tmp_path, *, sim_body=None, name="jsrepo"):
    """Repo with a committed pytest suite, a harness JS file, and (optionally) a
    harness sim under tests/. `sim_body=None` means no harness sim exists."""
    repo = tmp_path / name
    (repo / "tests").mkdir(parents=True)
    (repo / "skills" / "ultrapowers" / "harnesses").mkdir(parents=True)
    sh(["git", "init", "-q", "-b", "main"], cwd=repo)
    sh(["git", "config", "user.email", "t@t"], cwd=repo)
    sh(["git", "config", "user.name", "t"], cwd=repo)
    (repo / "tests" / "test_committed.py").write_text("def test_ok():\n    assert True\n")
    (repo / "skills/ultrapowers/harnesses" / "waves.js").write_text("// harness v1\n")
    (repo / "README.md").write_text("v1\n")
    if sim_body is not None:
        (repo / "tests" / "harness_sim.mjs").write_text(sim_body)
    sh(["git", "add", "."], cwd=repo)
    sh(["git", "commit", "-qm", "base"], cwd=repo)
    return repo


def _branch_editing(repo, path, text, branch="feat"):
    """Create `branch` off HEAD, change one file, commit, return to main."""
    sh(["git", "checkout", "-q", "-b", branch], cwd=repo)
    (repo / path).write_text(text)
    sh(["git", "commit", "-qam", "change"], cwd=repo)
    sh(["git", "checkout", "-q", "main"], cwd=repo)
    return branch


GREEN_SIM = "// exercises harnesses/waves.js\nconsole.log('checked harness');\nconsole.log('ALL SCENARIOS PASSED');\n"
RED_SIM = "// exercises harnesses/waves.js\nconsole.log('checking harness');\nprocess.exit(1);\n"
SILENT_SIM = "// exercises harnesses/waves.js\nconsole.log('did setup but asserted nothing');\n"


@needs_node
def test_suite_gate_runs_harness_sims_green(tmp_path):
    repo = make_js_suite_repo(tmp_path, sim_body=GREEN_SIM)
    br = _branch_editing(repo, "skills/ultrapowers/harnesses/waves.js", "// harness v2\n")
    code, out = suite_gate(repo, branch=br, base="main")
    assert code == 0 and out["status"] == "OK" and out["passed"] is True
    assert "ALL SCENARIOS PASSED" in out["output"]


@needs_node
def test_suite_gate_red_sim_parks(tmp_path):
    repo = make_js_suite_repo(tmp_path, sim_body=RED_SIM)
    br = _branch_editing(repo, "skills/ultrapowers/harnesses/waves.js", "// harness v2\n")
    code, out = suite_gate(repo, branch=br, base="main")
    assert code != 0 and out["passed"] is False and out["redKind"] == "assertion"


@needs_node
def test_suite_gate_sim_false_green_is_error(tmp_path):
    repo = make_js_suite_repo(tmp_path, sim_body=SILENT_SIM)
    br = _branch_editing(repo, "skills/ultrapowers/harnesses/waves.js", "// harness v2\n")
    code, out = suite_gate(repo, branch=br, base="main")
    assert code != 0 and out["passed"] is False and out["status"] == "ERROR"


@needs_node
def test_suite_gate_no_harness_diff_skips_sims(tmp_path):
    # A red sim exists, but the branch changes only a non-harness file, so the
    # sim must NOT run — proving detection gates on the diff (no regression).
    repo = make_js_suite_repo(tmp_path, sim_body=RED_SIM)
    br = _branch_editing(repo, "README.md", "v2\n")
    code, out = suite_gate(repo, branch=br, base="main")
    assert code == 0 and out["status"] == "OK" and out["passed"] is True


@needs_node
def test_suite_gate_harness_diff_no_sim_is_error(tmp_path):
    # Harness JS changed but no tests/*.mjs exercises harnesses/ -> refuse to
    # green unverified JS (empty run-set is a hard error).
    repo = make_js_suite_repo(tmp_path, sim_body=None)
    br = _branch_editing(repo, "skills/ultrapowers/harnesses/waves.js", "// harness v2\n")
    code, out = suite_gate(repo, branch=br, base="main")
    assert code != 0 and out["passed"] is False and out["status"] == "ERROR"
```

- [ ] **Step 2: Run the new tests — verify they fail**

Run: `python3 -m pytest tests/test_run_acceptance.py -k "harness or false_green or no_harness_diff" -v`
Expected: FAIL. Today `--suite-gate` ignores an unknown `--base` argument (the arg loop's `*)` case prints `unknown argument: --base` to stderr and `exit 2`), so `json.loads(r.stdout)` raises / the assertions fail. The three sim tests and the empty-run-set test do not yet pass.

- [ ] **Step 3: Parse `--base` in the suite-gate arg loop**

In `skills/ultrapowers/scripts/run_acceptance.sh`, add the `SG_BASE` default next to the existing `SG_RUN` default (near the top, the line `SG_RUN="python3 -m pytest"`):

```bash
SG_RUN="python3 -m pytest"
SG_BASE=""
```

Then, inside the `elif [ "${1:-}" = "--suite-gate" ]; then` block, add a `--base` case to the `while` loop (alongside `--branch`, `--run`, `--repo`):

```bash
    case "$1" in
      --branch) BRANCH="$2"; shift 2 ;;
      --run)    SG_RUN="$2"; shift 2 ;;
      --base)   SG_BASE="$2"; shift 2 ;;
      --repo)   REPO="$2";   shift 2 ;;
      *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
```

- [ ] **Step 4: Add the `run_js_sims` helper**

Insert this function **after** the `run_exam` function's closing `}` (the line before the `# ── Suite-gate mode …` comment block) and before that comment. It sets `J_*` globals and never emits or exits — the caller owns the contract. The `cleanup`/`EXAM_WT` trap defined earlier already covers the worktree.

```bash
# ── Harness JS-behavioral sims (issue #79) ────────────────────────────────────
# After a green pytest suite-gate, if the branch changed harness JS, run the
# harness .mjs sims so JS behavior is exit-code-gated too. Sets J_* globals;
# never emits or exits. node exits 0 for a no-op script, so a pass requires exit
# 0 AND a printed sentinel — exit code alone would re-open the false-green hole.
run_js_sims() { # $1=worktree $2=base_ref  → sets J_STATUS J_PASSED J_CODE J_OUTPUT J_REDKIND
  local WT="$1" BASE="$2"
  J_STATUS=OK; J_PASSED=true; J_CODE=0; J_OUTPUT=""; J_REDKIND=""
  # Detection: did this branch touch harness JS vs the base? Three-dot diffs
  # against the merge-base, correct even if the base line advanced.
  local CHANGED
  CHANGED="$(git -C "$WT" diff --name-only "$BASE"...HEAD 2>/dev/null \
              | grep -E '^skills/ultrapowers/harnesses/.*\.js$' || true)"
  if [ -z "$CHANGED" ]; then
    return 0   # harnesses untouched → nothing to run, gate stays green
  fi
  # node is required to exercise the JS. Missing node is an environment error,
  # never feature-absence — do not false-green by silently skipping.
  if ! command -v node >/dev/null 2>&1; then
    J_STATUS=ERROR; J_PASSED=false; J_CODE=1
    J_OUTPUT="harness JS changed but 'node' is not on PATH — cannot run harness sims:
$CHANGED"; return 0
  fi
  # Discover harness sims: the tests/*.mjs that exercise the harness (reference
  # harnesses/). Excludes the viewer specs (which reference viewer/).
  local SIMS="" f
  for f in "$WT"/tests/*.mjs; do
    [ -e "$f" ] || continue
    if grep -q 'harnesses/' "$f"; then SIMS="$SIMS $f"; fi
  done
  if [ -z "${SIMS// /}" ]; then
    # Harness JS changed but nothing exercises it → refuse to green unverified JS.
    J_STATUS=ERROR; J_PASSED=false; J_CODE=1
    J_OUTPUT="harness JS changed but no harness sim (tests/*.mjs referencing harnesses/) exists to exercise it — refusing to green unverified JS:
$CHANGED"; return 0
  fi
  local SENTINEL='ALL (SCENARIOS|TESTS) PASSED'
  local sim SOUT SCODE ACC=""
  for sim in $SIMS; do
    SOUT="$( (cd "$WT" && node "$sim") 2>&1 )"; SCODE=$?
    ACC="$ACC
--- sim $(basename "$sim") (exit $SCODE) ---
$SOUT"
    if [ "$SCODE" -ne 0 ]; then
      J_STATUS=OK; J_PASSED=false; J_CODE=$SCODE; J_REDKIND=assertion
      J_OUTPUT="harness sim $(basename "$sim") failed (exit $SCODE):$ACC"; return 0
    fi
    if ! printf '%s' "$SOUT" | grep -Eq "$SENTINEL"; then
      J_STATUS=ERROR; J_PASSED=false; J_CODE=1
      J_OUTPUT="harness sim $(basename "$sim") exited 0 but printed no pass sentinel (/$SENTINEL/) — refusing to false-green:$ACC"; return 0
    fi
  done
  J_STATUS=OK; J_PASSED=true; J_CODE=0; J_OUTPUT="harness sims passed:$ACC"
  return 0
}
```

- [ ] **Step 5: Fold the sims into the suite-gate green branch**

In the `if [ "$MODE" = "suite-gate" ]; then` block, replace the `if [ "$CODE" -eq 0 ]; then emit OK true 0 "$OUT"; exit 0` arm (the pytest-green arm only — leave the `elif [ "$CODE" -eq 5 ]` and `else` arms unchanged) with:

```bash
  if [ "$CODE" -eq 0 ]; then
    # pytest green. If a base was given AND this branch changed harness JS, also
    # run the harness .mjs sims so JS behavior is exit-code-gated (issue #79).
    if [ -n "$SG_BASE" ]; then
      run_js_sims "$EXAM_WT" "$SG_BASE"
      if [ "$J_STATUS" != OK ] || [ "$J_PASSED" != true ]; then
        emit "$J_STATUS" "$J_PASSED" "$J_CODE" "pytest passed; $J_OUTPUT" "$J_REDKIND"
        exit 1
      fi
      emit OK true 0 "$OUT
$J_OUTPUT"; exit 0
    fi
    emit OK true 0 "$OUT"; exit 0
```

Note: when `run_js_sims` returns with harnesses untouched, it leaves `J_STATUS=OK`/`J_PASSED=true`/`J_OUTPUT=""`, so the green `emit` fires with just the pytest output plus a trailing blank line — still a clean pass.

- [ ] **Step 6: Run the new tests — verify they pass**

Run: `python3 -m pytest tests/test_run_acceptance.py -k "harness or false_green or no_harness_diff" -v`
Expected: PASS (all five: green, red-sim, false-green, no-harness-diff-skips, harness-diff-no-sim-error).

- [ ] **Step 7: Run the full acceptance-script suite — verify no regression**

Run: `python3 -m pytest tests/test_run_acceptance.py -v`
Expected: PASS, including the untouched `test_suite_gate_green_passes`, `test_suite_gate_red_parks`, `test_suite_gate_no_tests_never_false_greens`, and `test_suite_gate_worktree_cleaned_up` (backward-compat proof — they pass no `--base`).

- [ ] **Step 8: Commit**

```bash
git add skills/ultrapowers/scripts/run_acceptance.sh tests/test_run_acceptance.py
git commit -m "feat(acceptance): suite-gate runs harness .mjs sims on a harness-JS diff (#79)"
```

---

### Task 2: Document how the drain arms the JS gate

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultradocket/SKILL.md`
- Modify: `CLAUDE.md`
- Test: `tests/test_ultradocket_skill.py`

**Interfaces:**
- Consumes: nothing at build time. It documents the `--base` argument that Task 1 implements, but shares no file and no code symbol with Task 1 — the two are independent diffs.
- Produces: prose only. The drain's step-3 `suite` line names `--base <integration-line-HEAD>`; `test_ultradocket_skill.py` pins that `--base` appears in `SKILL.md`.

- [ ] **Step 1: Add the failing pin**

Append to `tests/test_ultradocket_skill.py`:

```python
def test_drain_arms_js_gate_with_base():
    # The suite-gate only runs the harness .mjs sims when the drain passes the
    # integration-line base to diff against (issue #79). Pin that it is documented.
    assert "--base" in SKILL
```

- [ ] **Step 2: Run the pin — verify it fails**

Run: `python3 -m pytest tests/test_ultradocket_skill.py::test_drain_arms_js_gate_with_base -v`
Expected: FAIL — `--base` is not yet in `skills/ultradocket/SKILL.md`.

- [ ] **Step 3: Document `--base` on the drain's suite gate line**

In `skills/ultradocket/SKILL.md`, find the step-3 `suite` dispatch line (currently):

```
   - `suite` → `run_acceptance.sh --suite-gate --branch <branch>` — the committed
     suite (`python3 -m pytest`) run on the branch; exit 0 ⇒ pass. This is the
     disposition for ultrapowers' own engine/skill/doc work, which authors no
     held-out exam.
```

Replace it with (pass the integration-line HEAD as `--base` so the gate also runs the harness `.mjs` sims when the branch changed harness JS):

```
   - `suite` → `run_acceptance.sh --suite-gate --branch <branch> --base <docket-integration-line-HEAD>`
     — the committed suite (`python3 -m pytest`) run on the branch; exit 0 ⇒ pass.
     Passing `--base` (the ref the plan branched from) arms the JS-behavioral
     guard: when the branch changed `skills/ultrapowers/harnesses/*.js`, the gate
     also runs the harness `.mjs` sims (exit-code + pass-sentinel authority), so a
     `waves.js`-behavioral plan cannot ride a Python-only green (issue #79). This
     is the disposition for ultrapowers' own engine/skill/doc work, which authors
     no held-out exam.
```

- [ ] **Step 4: Add the `CLAUDE.md` note**

In `CLAUDE.md`, under the **Prompts are baked…** / conventions area, add a new bullet to the "Conventions & gotchas" list (place it after the "Prompts are baked" bullet):

```markdown
- **The suite-gate runs the `.mjs` harness sims when harness JS changes.** For a
  `suite`-disposition branch, `run_acceptance.sh --suite-gate --base <ref>` diffs
  `<ref>...HEAD`; if `skills/ultrapowers/harnesses/*.js` was touched it runs the
  `tests/*.mjs` that reference `harnesses/` via `node`, gated on exit code **and** a
  `ALL (SCENARIOS|TESTS) PASSED` sentinel. So a new harness sim MUST print that
  sentinel on success, and harness JS with no covering sim fails the gate (never a
  shallow green). The viewer specs (`swarm_*`, `audit_*`) reference `viewer/` and
  are not run by the gate.
```

- [ ] **Step 5: Run the pin and the skill-test file — verify they pass**

Run: `python3 -m pytest tests/test_ultradocket_skill.py -v`
Expected: PASS (the new `--base` pin plus the three existing disposition pins).

- [ ] **Step 6: Commit**

```bash
git add skills/ultradocket/SKILL.md CLAUDE.md tests/test_ultradocket_skill.py
git commit -m "docs(docket): drain arms the JS-behavioral suite-gate via --base (#79)"
```

---

### Task 3: Verification gate — full suite + manual sims

**Type:** gate
**Depends-on:** 1, 2

**Files:**
- None (verification only; writes nothing).

**Interfaces:**
- Consumes: the complete working tree from Tasks 1 and 2.
- Produces: nothing — pass/fail evidence only.

- [ ] **Step 1: Run the full pytest suite**

Run: `python3 -m pytest`
Expected: PASS — the entire committed suite green (`pytest.ini` scopes it to `tests/`), including the new `test_run_acceptance.py` cases and the `test_ultradocket_skill.py` pin, with the prior count unchanged except for the additions.

- [ ] **Step 2: Run the four skill validators (mirrors CI)**

Run:
```bash
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers && \
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan && \
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultralearn && \
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultradocket
```
Expected: each prints its OK/valid result and exits 0.

- [ ] **Step 3: Run every `.mjs` sim by hand (they are not in CI)**

Run:
```bash
for f in tests/*.mjs; do echo "=== $f ==="; node "$f" || echo "FAILED: $f"; done
```
Expected: every sim exits 0 — `sim_workflow.mjs` prints `ALL SCENARIOS PASSED`; the `swarm_*` / `audit_*` specs print `ALL TESTS PASSED`. No `FAILED:` line.

- [ ] **Step 4: Confirm no version bump and no `waves.js` edit**

Run: `git diff --name-only main...HEAD`
Expected: the changed files are exactly `skills/ultrapowers/scripts/run_acceptance.sh`, `tests/test_run_acceptance.py`, `skills/ultradocket/SKILL.md`, `CLAUDE.md`, `tests/test_ultradocket_skill.py`, and the plan/spec docs — **not** `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, or `skills/ultrapowers/harnesses/waves.js`.

---

## Self-review

**Spec coverage:**
- Detection via optional `--base` diff of `harnesses/*.js` → Task 1 Steps 3–5. ✓
- Auto-discover harness sims (reference `harnesses/`) → Task 1 Step 4 (`run_js_sims` discovery loop). ✓
- Pass-sentinel false-green guard → Task 1 Step 4 (`SENTINEL` check). ✓
- Missing-node → ERROR → Task 1 Step 4 (`command -v node`). ✓
- Empty run-set → hard ERROR → Task 1 Step 4 + test `test_suite_gate_harness_diff_no_sim_is_error`. ✓
- Same JSON contract; sealed/baseline paths untouched → Task 1 Steps 4–5 only alter the suite-gate green arm. ✓
- Backward compat (no `--base` = today) → Task 1 Step 5 fall-through + Step 7 regression run. ✓
- Drain arms `--base`; docs → Task 2. ✓
- Required tests (red sim → red, green → green, non-harness plan → skip) → Task 1 Step 1 cases 2, 1, 4. ✓
- Full pytest + manual `.mjs` verification → Task 3. ✓

**Placeholder scan:** none — every step shows exact code/commands.

**Type consistency:** the emitted JSON fields (`sealId`, `status`, `passed`, `exitCode`, `output`, `redKind`) and the `J_*` globals are used identically across the helper (Step 4) and the caller (Step 5); the `suite_gate(..., base=)` helper signature matches all five new call sites.

**ultraplan additions:**
- Decomposition shaping: the plan is intentionally narrow — the core is one cohesive single-file diff to `run_acceptance.sh`; Task 2 (docs) is split out only because a reviewer could reject doc wording while approving the shell change (real reviewer seam, disjoint files), not to manufacture width. No contract-first or file-split moves were introduced, so no `Parallelization rationale:` lines are warranted (escape valve: little latent parallelism).
- Every task carries an explicit `**Type:**`. ✓
- Cross-task ordering is `**Depends-on:**` (Task 3 → 1, 2), not prose. ✓
- No preamble holds load-bearing coordination; each task body is self-contained. ✓
- Task 3 is `gate` (empty Files, verification-only). ✓
- Backticked file mentions: Task 2 mentions `run_acceptance.sh` (which Task 1 *modifies*, not creates) — no prose-reference edge is created by referencing an existing file. ✓
- Acceptance line present: `suite`. ✓
