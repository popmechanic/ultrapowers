# Sealed Acceptance — Exam-Worktree Env Bootstrap Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Acceptance:** suite — ultrapowers' own verification machinery (the acceptance runner, the seal-author prompt, and the operator-facing SKILL docs). The author and operator both read the diffs; the committed `tests/test_run_acceptance.py` e2e suite plus adversarial review are the verification. No held-out exam is authored — sealing a change to the sealing machinery would be circular.

**Goal:** Make the sealed acceptance gate run path-dependent suites by bootstrapping the exam worktree's environment, and stop reporting environment failures as feature reds.

**Architecture:** The seal records its own `bootstrapCmd` in `manifest.json`. `run_acceptance.sh` is refactored so a single shared core (worktree → bootstrap → run → classify) serves both the sealed gate path and a new `--baseline` seal-time RED-proof mode. The core runs the bootstrap before the suite and classifies failures into three buckets — `EXAM_BOOTSTRAP_ERROR` (env could not be prepared) versus a red labeled `redKind:"assertion"` (a test executed and failed) versus `redKind:"collection"` (nothing executed). Docs (seal-author prompt, ultraplan SKILL, ultrapowers SKILL Step 5) move in lockstep.

**Tech Stack:** Bash (`run_acceptance.sh`), Python pytest e2e tests that shell out against throwaway git repos, Markdown skill docs. No change to `harnesses/waves.js` — the frozen, drift-pinned harness is untouched, so there is **no re-bake and no canary re-pin** (`test_canary.py` pins only `waves.js`).

**Spec:** `docs/superpowers/specs/2026-06-15-sealed-acceptance-env-bootstrap-design.md`

**Run configuration (for the executor / orchestrator):**
- `bootstrapCmd` (fresh worktrees have no deps): `python3 -m pip install --quiet pytest`
- `testCmd` (run-wide): `python3 -m pytest tests/ -q`

---

## File structure

| File | Responsibility | Touched by |
|------|----------------|-----------|
| `skills/ultrapowers/scripts/run_acceptance.sh` | The deterministic exam runner: shared core, bootstrap, three-bucket classification, `--baseline` mode | Task 1, Task 2 |
| `tests/test_run_acceptance.py` | e2e tests of the runner against throwaway repos + tmp vault | Task 1, Task 2 |
| `skills/ultraplan/references/seal-author-prompt.md` | The independent seal-author's brief | Task 3 |
| `skills/ultraplan/SKILL.md` | Seal-the-exam step description | Task 3 |
| `skills/ultrapowers/SKILL.md` | Step 5 operator handling of the new statuses | Task 4 |

Task 1 and Task 2 both edit the runner + its test file, so Task 2 **Depends-on** Task 1 (no two tasks ever edit the same file concurrently). Tasks 3 and 4 edit disjoint doc files and run in parallel once their referenced behavior exists.

---

### Task 1: Runner core — bootstrap + three-bucket classification

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/run_acceptance.sh`
- Test: `tests/test_run_acceptance.py`

This task rewrites the runner body below the arg parse into a reusable `run_exam` core and adds the bootstrap step, `redKind`, and the `EXAM_BOOTSTRAP_ERROR` status. It delivers the **sealed gate path** only. The `--baseline` mode is Task 2, which builds on the `run_exam` function this task introduces.

- [ ] **Step 1: Add a manifest-writing helper and the new failing tests**

Add this helper near the existing `_set_run_cmd` helper in `tests/test_run_acceptance.py`:

```python
def _write_manifest(vault, seal_id, digest, run_cmd, bootstrap_cmd=None):
    """Write a manifest preserving the recorded hash; optionally a bootstrapCmd."""
    m = {"sealId": seal_id, "suiteSha256": digest, "runCmd": run_cmd}
    if bootstrap_cmd is not None:
        m["bootstrapCmd"] = bootstrap_cmd
    (vault / seal_id / "manifest.json").write_text(json.dumps(m))
```

Then append these tests:

```python
def test_assertion_red_is_labeled(tmp_path):
    """Feature built but wrong: a test executes and fails -> redKind 'assertion'."""
    vault, seal_id, digest = make_vault(tmp_path)
    repo = make_repo(tmp_path, feature_built=True)
    # break the feature so the executed test asserts false
    (repo / "mod.py").write_text("def add(a, b):\n    return a - b\n")
    sh(["git", "commit", "-aqm", "wrong"], cwd=repo)
    code, out = administer(vault, seal_id, digest, repo)
    assert code != 0 and out["status"] == "OK" and out["passed"] is False
    assert out["redKind"] == "assertion"


def test_collection_red_is_labeled(tmp_path):
    """Feature module absent: import fails at collection, no test runs -> 'collection'."""
    vault, seal_id, digest = make_vault(tmp_path)
    repo = make_repo(tmp_path, feature_built=False)
    code, out = administer(vault, seal_id, digest, repo)
    assert code != 0 and out["status"] == "OK" and out["passed"] is False
    assert out["redKind"] == "collection"


def test_bootstrap_runs_before_suite(tmp_path):
    """A bootstrapCmd that provisions a needed file lets the suite reach its
    assertion and pass — proving bootstrap runs in the worktree before runCmd."""
    vault = tmp_path / "vault"
    suite = vault / "pending" / "suite"
    suite.mkdir(parents=True)
    (suite / "test_exam.py").write_text(
        "from repolib import val\n\n\ndef test_val():\n    assert val() == 7\n")
    digest = sh([sys.executable, str(HASH), str(suite)]).stdout.strip()
    seal_id = digest[:12]
    (vault / "pending").rename(vault / seal_id)
    _write_manifest(vault, seal_id, digest, "python3 -m pytest .ultra-acceptance -q",
                    bootstrap_cmd="printf 'def val():\\n    return 7\\n' > repolib.py")
    repo = make_repo(tmp_path, feature_built=True)  # repolib NOT committed at base
    code, out = administer(vault, seal_id, digest, repo)
    assert code == 0 and out["status"] == "OK" and out["passed"] is True


def test_env_caused_collection_red_is_fixed_by_bootstrap(tmp_path):
    """The finding scenario: a suite importing a repo library absent in a bare
    worktree is a false red WITHOUT a bootstrap, and a true result WITH one."""
    vault = tmp_path / "vault"
    suite = vault / "pending" / "suite"
    suite.mkdir(parents=True)
    (suite / "test_exam.py").write_text(
        "from repolib import val\n\n\ndef test_val():\n    assert val() == 7\n")
    digest = sh([sys.executable, str(HASH), str(suite)]).stdout.strip()
    seal_id = digest[:12]
    (vault / "pending").rename(vault / seal_id)
    repo = make_repo(tmp_path, feature_built=True)
    # No bootstrap: repolib is unimportable -> false red labeled 'collection'.
    _write_manifest(vault, seal_id, digest, "python3 -m pytest .ultra-acceptance -q")
    code, out = administer(vault, seal_id, digest, repo)
    assert out["passed"] is False and out["redKind"] == "collection"
    # With a bootstrap that provisions repolib -> honest green.
    _write_manifest(vault, seal_id, digest, "python3 -m pytest .ultra-acceptance -q",
                    bootstrap_cmd="printf 'def val():\\n    return 7\\n' > repolib.py")
    code, out = administer(vault, seal_id, digest, repo)
    assert code == 0 and out["passed"] is True


def test_bootstrap_failure_is_env_error_not_red(tmp_path):
    """A bootstrapCmd that fails is EXAM_BOOTSTRAP_ERROR — never a feature red."""
    vault, seal_id, digest = make_vault(tmp_path)
    _write_manifest(vault, seal_id, digest, "python3 -m pytest .ultra-acceptance -q",
                    bootstrap_cmd="exit 3")
    repo = make_repo(tmp_path, feature_built=True)
    code, out = administer(vault, seal_id, digest, repo)
    assert code != 0
    assert out["status"] == "EXAM_BOOTSTRAP_ERROR" and out["passed"] is False
    assert "redKind" not in out


def test_missing_module_collection_red_keeps_status_ok(tmp_path):
    """Regression on the prior contract: a feature-absent collection error is
    still status OK / passed False (now additionally labeled 'collection')."""
    vault, seal_id, digest = make_vault(tmp_path)
    repo = make_repo(tmp_path, feature_built=False)
    code, out = administer(vault, seal_id, digest, repo)
    assert out["status"] == "OK" and out["passed"] is False
```

- [ ] **Step 2: Run the new tests and confirm they fail**

Run: `python3 -m pytest tests/test_run_acceptance.py -q -k "assertion_red or collection_red or bootstrap or env_caused or missing_module_collection"`
Expected: FAIL — current runner emits no `redKind` (KeyError on `out["redKind"]`) and never runs a bootstrap (`EXAM_BOOTSTRAP_ERROR` never appears; the `exit 3` bootstrap is ignored).

- [ ] **Step 3: Rewrite `run_acceptance.sh` with the shared core, bootstrap, and labeling**

Replace the entire file `skills/ultrapowers/scripts/run_acceptance.sh` with:

```bash
#!/usr/bin/env bash
# Administer a sealed acceptance exam against a branch. Deterministic: no
# agents, no interpretation. Emits exactly one JSON object on stdout.
# Exit 0 iff the seal verified AND the exam passed.
#
# Usage: run_acceptance.sh <seal-id> <branch> <expected-sha256>
#                          [--vault DIR] [--repo DIR]
# Spec: docs/superpowers/specs/2026-06-15-sealed-acceptance-env-bootstrap-design.md
set -uo pipefail

SEAL_ID="${1:?usage: run_acceptance.sh <seal-id> <branch> <sha256> [--vault DIR] [--repo DIR]}"
BRANCH="${2:?missing branch}"
EXPECTED="${3:?missing expected sha256}"
shift 3
VAULT="${HOME}/.ultrapowers/acceptance"
REPO="$(pwd)"
while [ $# -gt 0 ]; do
  case "$1" in
    --vault) VAULT="$2"; shift 2 ;;
    --repo)  REPO="$2";  shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
HERE="$(cd "$(dirname "$0")" && pwd)"

emit() { # status passed exit_code output [redKind] → prints JSON, never fails
  STATUS="$1" PASSED="$2" CODE="$3" OUTPUT="$4" REDKIND="${5:-}" SEAL="$SEAL_ID" python3 - <<'EOF'
import json, os
obj = {
    "sealId": os.environ["SEAL"],
    "status": os.environ["STATUS"],
    "passed": os.environ["PASSED"] == "true",
    "exitCode": int(os.environ["CODE"]),
    "output": os.environ["OUTPUT"][-8000:],
}
rk = os.environ.get("REDKIND", "")
if rk:
    obj["redKind"] = rk
print(json.dumps(obj))
EOF
}

# Shared exam core, used by the sealed gate path (and, in Task 2, --baseline).
# Creates a detached worktree of $2, mounts the suite at .ultra-acceptance/,
# runs the optional bootstrap, then the run command, and classifies into R_*
# globals WITHOUT emitting or exiting — each caller owns its own exit contract.
EXAM_WT=""
cleanup() { [ -n "$EXAM_WT" ] && git -C "$REPO" worktree remove --force "$EXAM_WT" >/dev/null 2>&1 || true; }
trap cleanup EXIT

run_exam() { # $1=suite_dir $2=branch $3=run_cmd $4=bootstrap_cmd
  local SUITE_DIR="$1" BR="$2" RUN_CMD="$3" BOOT="$4"
  R_REDKIND=""
  EXAM_WT="$(mktemp -d)/exam"
  if ! git -C "$REPO" worktree add --detach "$EXAM_WT" "$BR" >/dev/null 2>&1; then
    R_STATUS=ERROR; R_PASSED=false; R_CODE=1
    R_OUTPUT="could not create exam worktree for branch $BR in $REPO"; return 0
  fi
  mkdir -p "$EXAM_WT/.ultra-acceptance"
  cp -R "$SUITE_DIR/." "$EXAM_WT/.ultra-acceptance/"
  local RAN_MARKER="$EXAM_WT/.ultra-acceptance/.__ran__"
  cat > "$EXAM_WT/.ultra-acceptance/conftest.py" <<'CONF'
import pathlib
def pytest_runtest_call(item):
    pathlib.Path(__file__).with_name(".__ran__").write_text("1")
CONF
  # Bootstrap the worktree's environment (editable install / dep setup) before
  # the suite so the repo's own libraries import. A failed bootstrap is an ENV
  # error, never a red: the environment could not be prepared.
  if [ -n "$BOOT" ]; then
    local BOUT BCODE
    BOUT="$( (cd "$EXAM_WT" && eval "$BOOT") 2>&1 )"; BCODE=$?
    if [ "$BCODE" -ne 0 ]; then
      R_STATUS=EXAM_BOOTSTRAP_ERROR; R_PASSED=false; R_CODE=$BCODE
      R_OUTPUT="bootstrap failed (exit $BCODE): $BOOT
$BOUT"; return 0
    fi
  fi
  local OUT CODE
  OUT="$( (cd "$EXAM_WT" && eval "$RUN_CMD") 2>&1 )"; CODE=$?
  if [ "$CODE" -eq 0 ]; then
    # No-tests-ran defense (false-green guard): a green exit earns a pass only
    # if the sealed suite actually executed a test.
    if [ ! -f "$RAN_MARKER" ]; then
      R_STATUS=ERROR; R_PASSED=false; R_CODE=1
      R_OUTPUT="exam exited 0 but ran no sealed tests (zero tests collected or runCmd never executed the suite) — refusing to false-green:
$OUT"
    else
      R_STATUS=OK; R_PASSED=true; R_CODE=0; R_OUTPUT="$OUT"
    fi
  else
    # Non-zero WITH a tests-ran marker => a test executed and failed (assertion
    # red). WITHOUT it => nothing executed (collection/import red). The bootstrap
    # above means an env-caused collection error can no longer reach here, so a
    # surviving collection red is genuine feature-absence.
    R_STATUS=OK; R_PASSED=false; R_CODE=$CODE; R_OUTPUT="$OUT"
    if [ -f "$RAN_MARKER" ]; then R_REDKIND=assertion; else R_REDKIND=collection; fi
  fi
  return 0
}

# ── Sealed gate path ─────────────────────────────────────────────────────────
SUITE="$VAULT/$SEAL_ID/suite"
MANIFEST="$VAULT/$SEAL_ID/manifest.json"
if [ ! -d "$SUITE" ] || [ ! -f "$MANIFEST" ]; then
  emit SEAL_MISSING false 1 "vault entry not found: $VAULT/$SEAL_ID"
  exit 1
fi

ACTUAL="$(python3 "$HERE/seal_hash.py" "$SUITE")"
if [ "$ACTUAL" != "$EXPECTED" ]; then
  emit SEAL_BROKEN false 1 "suite hash $ACTUAL does not match recorded $EXPECTED"
  exit 1
fi

if ! RUN_CMD="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["runCmd"])' "$MANIFEST" 2>/dev/null)" \
   || [ -z "$RUN_CMD" ]; then
  emit ERROR false 1 "manifest missing or invalid runCmd: $MANIFEST"
  exit 1
fi
BOOTSTRAP_CMD="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("bootstrapCmd") or "")' "$MANIFEST" 2>/dev/null || true)"

run_exam "$SUITE" "$BRANCH" "$RUN_CMD" "$BOOTSTRAP_CMD"
emit "$R_STATUS" "$R_PASSED" "$R_CODE" "$R_OUTPUT" "$R_REDKIND"
if [ "$R_STATUS" = OK ] && [ "$R_PASSED" = true ]; then exit 0; fi
exit 1
```

- [ ] **Step 4: Run the full runner suite and confirm green**

Run: `python3 -m pytest tests/test_run_acceptance.py -q`
Expected: PASS — the new tests pass and all pre-existing tests (`test_green_exam_passes`, `test_red_exam_fails_honestly`, `test_collection_error_from_missing_module_is_honest_red`, the false-green guards, `test_worktree_cleaned_up`, …) stay green. The honest-red tests still see `status: OK`, now additionally carrying `redKind: "collection"`.

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/run_acceptance.sh tests/test_run_acceptance.py
git commit -m "ultrapowers: bootstrap the acceptance exam worktree + label env-vs-red

run_acceptance.sh refactors into a shared run_exam core that runs the
manifest's optional bootstrapCmd before the suite and classifies failures
into EXAM_BOOTSTRAP_ERROR (env could not be prepared) vs redKind
assertion/collection. Closes the false-red that neutralized the gate on
path-dependent suites."
```

---

### Task 2: Runner `--baseline` mode (seal-time RED proof through the exact path)

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `skills/ultrapowers/scripts/run_acceptance.sh`
- Test: `tests/test_run_acceptance.py`

This task adds `--baseline` arg handling and a baseline entry that reuses the `run_exam` core Task 1 introduced. The runner already defines `run_exam` and the sealed gate path (Task 1, merged into this task's base). This task adds a second entry mode so the seal-author proves RED against byte-identical logic.

- [ ] **Step 1: Write the failing baseline tests**

Append to `tests/test_run_acceptance.py`:

```python
def baseline(suite, branch, repo, run_cmd, bootstrap=None):
    cmd = ["bash", str(RUN), "--baseline", "--suite", str(suite),
           "--branch", branch, "--run", run_cmd, "--repo", str(repo)]
    if bootstrap is not None:
        cmd += ["--bootstrap", bootstrap]
    r = sh(cmd, check=False)
    return r.returncode, json.loads(r.stdout)


def _bare_suite(tmp_path):
    suite = tmp_path / "suite"
    suite.mkdir()
    (suite / "test_exam.py").write_text(
        "from mod import add\n\n\ndef test_add():\n    assert add(2, 3) == 5\n")
    return suite


def test_baseline_mode_proves_red(tmp_path):
    """Feature absent at baseline -> PROVEN_RED, exit 0 (the proof holds)."""
    suite = _bare_suite(tmp_path)
    repo = make_repo(tmp_path, feature_built=False)
    code, out = baseline(suite, "main", repo, "python3 -m pytest .ultra-acceptance -q")
    assert code == 0 and out["status"] == "PROVEN_RED" and out["passed"] is False


def test_baseline_mode_rejects_green(tmp_path):
    """Feature already present at baseline -> GREEN_AT_BASELINE, non-zero exit."""
    suite = _bare_suite(tmp_path)
    repo = make_repo(tmp_path, feature_built=True)
    code, out = baseline(suite, "main", repo, "python3 -m pytest .ultra-acceptance -q")
    assert code != 0 and out["status"] == "GREEN_AT_BASELINE" and out["passed"] is True


def test_baseline_mode_surfaces_bootstrap_error(tmp_path):
    """A failing bootstrap at baseline is an env error, not a proven red."""
    suite = _bare_suite(tmp_path)
    repo = make_repo(tmp_path, feature_built=False)
    code, out = baseline(suite, "main", repo,
                         "python3 -m pytest .ultra-acceptance -q", bootstrap="exit 4")
    assert code != 0 and out["status"] == "EXAM_BOOTSTRAP_ERROR" and out["passed"] is False
```

- [ ] **Step 2: Run the baseline tests and confirm they fail**

Run: `python3 -m pytest tests/test_run_acceptance.py -q -k baseline_mode`
Expected: FAIL — `--baseline` is an unknown argument today (the runner exits 2 with "unknown argument: --baseline" and no JSON, so `json.loads` raises).

- [ ] **Step 3: Add mode detection to the arg parse**

In `skills/ultrapowers/scripts/run_acceptance.sh`, replace the positional arg block (the lines from `SEAL_ID="${1:?usage...}"` through the closing `done` of the `--vault/--repo` loop, immediately above `HERE="$(cd ...)"`) with:

```bash
SEAL_ID="(baseline)"; BRANCH=""; EXPECTED=""
VAULT="${HOME}/.ultrapowers/acceptance"
REPO="$(pwd)"
B_SUITE=""; B_RUN=""; B_BOOT=""
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

- [ ] **Step 4: Add the baseline entry that reuses `run_exam`**

In the same file, immediately after the `run_exam() { … }` function definition (its closing `}`), and **before** the `# ── Sealed gate path ──` comment, insert:

```bash
# ── Baseline mode (seal-time RED proof through the exact gate execution core) ──
if [ "$MODE" = baseline ]; then
  run_exam "$B_SUITE" "$BRANCH" "$B_RUN" "$B_BOOT"
  if [ "$R_STATUS" = OK ] && [ "$R_PASSED" = false ]; then
    emit PROVEN_RED false "$R_CODE" "$R_OUTPUT" "$R_REDKIND"; exit 0
  fi
  if [ "$R_STATUS" = OK ] && [ "$R_PASSED" = true ]; then
    emit GREEN_AT_BASELINE true "$R_CODE" "$R_OUTPUT" "$R_REDKIND"; exit 1
  fi
  emit "$R_STATUS" "$R_PASSED" "$R_CODE" "$R_OUTPUT" "$R_REDKIND"; exit 1
fi
```

Also update the usage comment at the top of the file to document the second form:

```bash
# Usage: run_acceptance.sh <seal-id> <branch> <expected-sha256>
#                          [--vault DIR] [--repo DIR]
#    or: run_acceptance.sh --baseline --suite DIR --branch BASE --run CMD
#                          [--bootstrap CMD] [--repo DIR]   (seal-time RED proof)
```

- [ ] **Step 5: Run the full runner suite and confirm green**

Run: `python3 -m pytest tests/test_run_acceptance.py -q`
Expected: PASS — the three baseline tests pass and every Task 1 + pre-existing test stays green (sealed mode is unchanged: `MODE` defaults to `sealed` and the positional path is byte-equivalent to before).

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/scripts/run_acceptance.sh tests/test_run_acceptance.py
git commit -m "ultrapowers: add run_acceptance.sh --baseline RED-proof mode

The seal-author now proves RED through the same run_exam core the gate
uses (worktree + bootstrap + run + classify), so a suite that cannot
import under the runner is caught at seal time. PROVEN_RED exits 0;
GREEN_AT_BASELINE and EXAM_BOOTSTRAP_ERROR exit non-zero."
```

---

### Task 3: Seal-author authors `bootstrapCmd` and proves RED via `--baseline`

**Type:** implementation
**Depends-on:** 2

**Files:**
- Modify: `skills/ultraplan/references/seal-author-prompt.md`
- Modify: `skills/ultraplan/SKILL.md`

The seal-author must now author the exam's run context (`runCmd` + optional `bootstrapCmd`), prove RED through `run_acceptance.sh --baseline` (the mode Task 2 added), and record `bootstrapCmd` in the manifest. These are doc-only edits.

- [ ] **Step 1: Update the seal-author brief**

In `skills/ultraplan/references/seal-author-prompt.md`, replace numbered items 2–4 (the block from `2. Write a test suite …` through `… coverage: [{criterion, tests[]}] }.`) with:

```markdown
2. Write a test suite encoding those criteria, in the repo's test framework,
   into `<vault>/pending/suite/`. Tests must run from a repo checkout root
   with the suite mounted at `.ultra-acceptance/` (e.g. run command
   `python3 -m pytest .ultra-acceptance -q`). If the repo's own libraries need
   an editable install or other setup to import (a `kb_lib`-style package, a
   polyglot monorepo), author a one-line `bootstrapCmd` that prepares the
   worktree (e.g. `python3 -m venv .venv && .venv/bin/pip install -e .[dev]`,
   with `runCmd` then invoking `.venv/bin/python -m pytest …`). Leave
   `bootstrapCmd` empty when the bare checkout already imports.
3. Prove RED through the EXACT gate runner — never an ad-hoc pytest call:
   `python3 <plugin>/skills/ultrapowers/scripts/run_acceptance.sh --baseline \
     --suite <vault>/pending/suite --branch <base> --run "<runCmd>" \
     [--bootstrap "<bootstrapCmd>"]`.
   It must report `PROVEN_RED` (exit 0) because the feature is absent. If it
   reports `GREEN_AT_BASELINE`, the spec may already be satisfied — report
   GREEN_AT_BASELINE with the output; do not weaken tests to force red. If it
   reports `EXAM_BOOTSTRAP_ERROR`, fix `bootstrapCmd` until the env prepares.
   Read the output: a `redKind:"collection"` red must fail on the FEATURE's
   own import/symbol — if it fails importing a repo library instead, your
   `bootstrapCmd` is incomplete; fix it and rerun until the only failure is
   the feature.
4. Compute the hash: `python3 <plugin>/skills/ultrapowers/scripts/seal_hash.py <vault>/pending/suite`.
   Rename `<vault>/pending` to `<vault>/<first-12-hex-of-hash>`. Write
   `manifest.json`: { sealId, planPath: null, specPath, suiteSha256, runCmd,
   bootstrapCmd, createdAt, baselineSha, redEvidence (≤2000 chars), coverage:
   [{criterion, tests[]}] }.
```

- [ ] **Step 2: Update the ultraplan seal-the-exam step**

In `skills/ultraplan/SKILL.md`, replace numbered item 2 of the "Seal the exam (after plan approval)" section (the sentence beginning `2. The author writes the suite into the vault, proves it RED …` through `… spec criteria to test names.`) with:

```markdown
2. The author writes the suite into the vault, authoring an optional
   `bootstrapCmd` when the repo's own libraries need an editable install /
   setup to import, and proves it RED through the exact gate runner
   (`run_acceptance.sh --baseline …`, which creates the worktree, runs the
   bootstrap, then the suite, exactly as the pre-merge gate will) — a suite
   that passes before the work exists tests nothing; a `redKind:"collection"`
   red must fail on the feature's own import, not a still-unbootstrapped repo
   library. The author writes `manifest.json` (recording `bootstrapCmd` so
   seal-time and gate-time share one run context) and returns ONLY: seal-id,
   sha256, red-run evidence, and a coverage summary mapping spec criteria to
   test names.
```

- [ ] **Step 3: Verify the skill still validates**

Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan`
Expected: each prints `skill ok` (doc edits keep both skills structurally valid).

- [ ] **Step 4: Commit**

```bash
git add skills/ultraplan/references/seal-author-prompt.md skills/ultraplan/SKILL.md
git commit -m "ultraplan: seal-author authors bootstrapCmd, proves RED via --baseline

The independent author now authors the exam's run context and proves RED
through run_acceptance.sh --baseline — the same worktree+bootstrap+run core
the gate uses — and records bootstrapCmd in the manifest so seal-time and
gate-time match."
```

---

### Task 4: Step 5 operator handling of `EXAM_BOOTSTRAP_ERROR` and `redKind`

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`

Files-note — `skills/ultrapowers/SKILL.md` (the Step 5 sealed-gate paragraph)

A doc-only edit teaching the operator to read the runner's new statuses. It depends only on the runner statuses Task 1 introduced, and edits a file no other task touches — so it runs in parallel with Tasks 2/3.

- [ ] **Step 1: Extend the Step 5 status-handling sentence**

In `skills/ultrapowers/SKILL.md`, find the Step 5 sentence that begins `A non-zero exit carries a descriptive `status`: a red exam (`status: OK, passed: false`) offers Redirect/Salvage;`. Replace its first clause — `a red exam (`status: OK, passed: false`) offers Redirect/Salvage;` — with:

```markdown
a red exam (`status: OK, passed: false`) offers Redirect/Salvage — its `redKind` says which kind of red: `assertion` (a sealed test executed and failed — the feature is built but wrong) or `collection` (no test executed — an import/collection failure, i.e. the feature or a module it needs is absent); `EXAM_BOOTSTRAP_ERROR` (the seal's `bootstrapCmd` failed on this branch, so the exam environment could not be prepared) is **not** a feature red — do NOT Approve and do NOT record it as a waiver-of-red: fix the environment or re-seal with a corrected `bootstrapCmd`, then re-administer;
```

(The remainder of the sentence — `` `SEAL_BROKEN` (vault tampered) or `SEAL_MISSING` … `` — stays unchanged.)

- [ ] **Step 2: Verify the skill still validates**

Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers`
Expected: prints `skill ok`.

- [ ] **Step 3: Commit**

```bash
git add skills/ultrapowers/SKILL.md
git commit -m "ultrapowers: Step 5 reads redKind + handles EXAM_BOOTSTRAP_ERROR

The operator now distinguishes an assertion red from a collection red and
treats an exam-env-prep failure as a do-not-Approve env error, never a
feature red to waive."
```

---

### Task 5: Full-suite verification gate

**Type:** gate
**Depends-on:** 2, 3, 4

**Verification (writes nothing; informs `testCmd`):**
- `python3 -m pytest tests/ -q` — the entire repo suite is green (per the spec: "the full pytest suite runs before finishing"). Expected: all pass, with the same pre-existing skips/env notes the repo already carries.
- `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` — prints `skill ok`.
- `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan` — prints `skill ok`.
- `python3 -m pytest tests/test_canary.py -q` — the `waves.js` drift/canary pins are still green, confirming the frozen harness was untouched (no re-bake).

This is a `gate` task: ultrapowers never executes it as a worktree task — it is the run's verification expectation, surfaced in the wave-plan render and enforced at the Step 5 pre-merge gate.

---

## Coverage check (spec → task)

- Spec part 1 (manifest records `bootstrapCmd`): Task 1 (runner reads it) + Task 3 (author writes it).
- Spec part 2 (bootstrap before suite; three-bucket classification — `EXAM_BOOTSTRAP_ERROR`, `redKind` assertion/collection): Task 1.
- Spec part 3 (seal-author proves RED through the exact runner path; `--baseline` shared core): Task 2 (mode) + Task 3 (author uses it).
- Spec part 4 (docs in lockstep): Task 3 (seal-author + ultraplan) + Task 4 (ultrapowers Step 5).
- Spec testing section: Tasks 1 & 2 tests; Task 5 full-suite + validate + canary gate.
- Spec non-goals (no `waves.js` change, no auto-detect, no new gate CLI args): honored — only the runner, its tests, and docs change; `--baseline` is a seal-time tool, the gate signature is unchanged.
