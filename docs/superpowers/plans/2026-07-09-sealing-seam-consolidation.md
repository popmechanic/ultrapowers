# Sealing Seam Consolidation Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Acceptance:** suite — ultrapowers' own script/skill/prompt development; the committed suite, the drift pins, and adversarial review are the verification.

**Goal:** Make the sealing seam's two observed transcription defects inexpressible: the collect step derives the plan's Acceptance line from the manifest instead of hand-copying a hash, and the seal author's RED proof reads the same manifest fields the gate will later consume.

**Architecture:** One new small script (`collect_seal.py`) reports the collect case and prints the exact Acceptance line from `manifest.suiteSha256`. `run_acceptance.sh --baseline` gains a `--manifest` input that reads `runCmd`/`bootstrapCmd`/`framework`/`ranPattern` from the manifest draft and fails closed (`MANIFEST_INCOHERENT`) on drafts the gate would misread. The seal-author brief reorders to manifest-draft-first and gains a behavior-not-layout rider; the ultraplan SKILL collect step becomes one script invocation.

**Tech Stack:** Python 3 (stdlib only), bash, pytest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-09-sealing-seam-consolidation-design.md`

## Global Constraints

- **Gate authority unchanged:** the sealed gate path still compares the suite hash against the plan-recorded value passed as `<expected-sha256>`; never derive the gate's expectation from the manifest.
- **Legacy seals stay valid:** no new required manifest field; `tests/test_fixture_seals.py` and all existing `tests/test_run_acceptance.py` tests must pass unmodified; the `--baseline --run/--bootstrap` flags keep working.
- **Rejected machinery — do not add:** no `redProof` stamping, no collect-time suite-hash re-verification, no `ranPattern`-vs-baseline advisory warning. The spec rejects these as unearned; adding one is a plan violation.
- **Preserve pinned tokens:** `tests/test_async_sealing.py` and `tests/test_seal_author_agent.py` pin tokens in the brief and the ultraplan SKILL (`<pendingDir>`, `specSha256`, `outcome.json`, `durable failure record`, `ultrapowers:seal-author`, `### Collect at plan approval`, `shasum -a 256`, `dispatch synchronously`, `at plan approval, never silently after`). Edits must keep every pin green.
- **No direct Anthropic API calls or SDK** anywhere (repo rule: the plugin must need no API key).
- The full gate is `python3 -m pytest` from the repo root, green.

---

### Task 1: `collect_seal.py` — deterministic collect-case detection

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Create: `skills/ultrapowers/scripts/collect_seal.py`
- Test: `tests/test_collect_seal.py`

**Interfaces:**
- Consumes: nothing from sibling tasks (reads the vault layout that already exists: `<vault>/<sealId>/manifest.json`, `<vault>/pending-<12hex>/{dispatch,outcome}.json`).
- Produces: CLI `collect_seal.py <spec-file> [--vault DIR]` printing one JSON object to stdout, exit 0. Shapes: `{"case": "sealed", "specSha256", "sealId", "suiteSha256", "acceptanceLine", "coverage"}` · `{"case": "failure", "specSha256", "outcome"|"error", ...}` · `{"case": "pending", "specSha256", "dispatch", "pendingDir"}` · `{"case": "none", "specSha256"}`. `acceptanceLine` is exactly `**Acceptance:** sealed <sealId> (sha256:<suiteSha256>)`.

Why adversarial review: this script emits the Acceptance line the gate will later trust; a bug here re-creates the exact spec-vs-suite mis-stamp class this plan exists to kill.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_collect_seal.py`:

```python
"""collect_seal.py: deterministic collect-case detection. The sealed case's
Acceptance line is derived from manifest.suiteSha256 — never specSha256
(hand-copying between the manifest's two hashes was a live 0.0.35 defect:
SEAL_BROKEN false-blocks in 2 of 10 field runs)."""
import hashlib
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
COLLECT = ROOT / "skills/ultrapowers/scripts/collect_seal.py"

SUITE_SHA = "ab" * 32          # a fake but well-formed sha256
SEAL_ID = SUITE_SHA[:12]


def run_collect(spec, vault):
    r = subprocess.run(
        [sys.executable, str(COLLECT), str(spec), "--vault", str(vault)],
        capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def write_spec(tmp_path, text="# spec\nthe feature behaves like X\n"):
    spec = tmp_path / "spec.md"
    spec.write_text(text)
    return spec, hashlib.sha256(spec.read_bytes()).hexdigest()


def make_sealed(vault, spec_sha, *, suite_sha=SUITE_SHA, extra=None):
    entry = vault / suite_sha[:12]
    (entry / "suite").mkdir(parents=True)
    manifest = {"sealId": suite_sha[:12], "specSha256": spec_sha,
                "suiteSha256": suite_sha,
                "runCmd": "python3 -m pytest .ultra-acceptance -q"}
    manifest.update(extra or {})
    (entry / "manifest.json").write_text(json.dumps(manifest))
    return entry


def test_sealed_case_line_is_verbatim_and_uses_suite_hash(tmp_path):
    spec, sha = write_spec(tmp_path)
    vault = tmp_path / "vault"
    make_sealed(vault, sha)
    out = run_collect(spec, vault)
    assert out["case"] == "sealed"
    assert out["sealId"] == SEAL_ID
    assert out["suiteSha256"] == SUITE_SHA
    assert out["acceptanceLine"] == (
        f"**Acceptance:** sealed {SEAL_ID} (sha256:{SUITE_SHA})")


def test_sealed_line_never_carries_the_spec_hash(tmp_path):
    spec, sha = write_spec(tmp_path)
    vault = tmp_path / "vault"
    make_sealed(vault, sha)
    out = run_collect(spec, vault)
    assert sha not in out["acceptanceLine"], (
        "the Acceptance line must carry suiteSha256; stamping specSha256 "
        "is the SEAL_BROKEN false-block defect")


def test_coverage_is_passed_through(tmp_path):
    spec, sha = write_spec(tmp_path)
    vault = tmp_path / "vault"
    cov = [{"criterion": "X happens", "tests": ["test_x"]}]
    make_sealed(vault, sha, extra={"coverage": cov})
    assert run_collect(spec, vault)["coverage"] == cov


def test_seal_for_a_different_spec_is_not_a_match(tmp_path):
    spec, _sha = write_spec(tmp_path)
    vault = tmp_path / "vault"
    make_sealed(vault, "0" * 64)          # someone else's seal
    assert run_collect(spec, vault)["case"] == "none"


def test_edited_spec_matches_nothing(tmp_path):
    spec, sha = write_spec(tmp_path)
    vault = tmp_path / "vault"
    make_sealed(vault, sha)
    spec.write_text("# spec\nedited after dispatch\n")
    assert run_collect(spec, vault)["case"] == "none"


def test_pending_draft_manifest_is_not_a_sealed_match(tmp_path):
    # Manifest-first authoring means pending dirs now hold manifest.json
    # DRAFTS (no suiteSha256). A draft must never satisfy the sealed case.
    spec, sha = write_spec(tmp_path)
    vault = tmp_path / "vault"
    pending = vault / f"pending-{sha[:12]}"
    pending.mkdir(parents=True)
    (pending / "manifest.json").write_text(json.dumps(
        {"specSha256": sha, "runCmd": "python3 -m pytest .ultra-acceptance -q"}))
    (pending / "dispatch.json").write_text(json.dumps(
        {"specPath": str(spec), "specSha256": sha, "dispatchedAt": "t"}))
    out = run_collect(spec, vault)
    assert out["case"] == "pending"
    assert out["dispatch"]["specSha256"] == sha


def test_outcome_record_reports_failure_case(tmp_path):
    spec, sha = write_spec(tmp_path)
    vault = tmp_path / "vault"
    pending = vault / f"pending-{sha[:12]}"
    pending.mkdir(parents=True)
    record = {"status": "GREEN_AT_BASELINE", "specSha256": sha,
              "evidence": "all green at base", "createdAt": "t"}
    (pending / "outcome.json").write_text(json.dumps(record))
    out = run_collect(spec, vault)
    assert out["case"] == "failure"
    assert out["outcome"] == record


def test_empty_or_missing_vault_is_none(tmp_path):
    spec, sha = write_spec(tmp_path)
    out = run_collect(spec, tmp_path / "no-such-vault")
    assert out == {"case": "none", "specSha256": sha}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_collect_seal.py -q`
Expected: errors/failures for every test (the script does not exist yet).

- [ ] **Step 3: Implement the script**

Create `skills/ultrapowers/scripts/collect_seal.py`:

```python
#!/usr/bin/env python3
"""Deterministic collect step for sealed acceptance.

Hashes a spec file, scans the vault, and reports which collect case holds —
sealed / failure / pending / none — as one JSON object on stdout. For the
sealed case it prints the exact Acceptance line the plan must carry, derived
from manifest.suiteSha256, so the orchestrator appends it verbatim and never
chooses between the manifest's two hashes (stamping specSha256 was a live
false-block defect). Detection only: the responses to each case stay in the
ultraplan SKILL's collect step.
Spec: docs/superpowers/specs/2026-07-09-sealing-seam-consolidation-design.md
"""
import argparse
import hashlib
import json
import pathlib
import sys


def spec_sha256(spec_path):
    return hashlib.sha256(pathlib.Path(spec_path).read_bytes()).hexdigest()


def _read_json(path):
    try:
        return json.loads(pathlib.Path(path).read_text())
    except (OSError, json.JSONDecodeError, ValueError):
        return None


def collect(spec_path, vault):
    vault = pathlib.Path(vault).expanduser()
    sha = spec_sha256(spec_path)

    # Case: sealed — a non-pending vault entry's manifest records this spec
    # hash. pending-* dirs are skipped: manifest-first authoring leaves a
    # DRAFT manifest (no suiteSha256) in the pending dir, which must never
    # satisfy the sealed case.
    if vault.is_dir():
        for mpath in sorted(vault.glob("*/manifest.json")):
            if mpath.parent.name.startswith("pending-"):
                continue
            m = _read_json(mpath)
            if not m or m.get("specSha256") != sha:
                continue
            seal_id = m.get("sealId") or mpath.parent.name
            suite_sha = m.get("suiteSha256")
            if not suite_sha:
                return {"case": "failure", "specSha256": sha,
                        "error": f"manifest for seal {seal_id} lacks suiteSha256",
                        "manifestPath": str(mpath)}
            return {
                "case": "sealed",
                "specSha256": sha,
                "sealId": seal_id,
                "suiteSha256": suite_sha,
                "acceptanceLine":
                    f"**Acceptance:** sealed {seal_id} (sha256:{suite_sha})",
                "coverage": m.get("coverage"),
            }

    # Cases: failure / pending — the per-dispatch pending dir.
    pending = vault / f"pending-{sha[:12]}"
    outcome = _read_json(pending / "outcome.json")
    if outcome is not None:
        return {"case": "failure", "specSha256": sha,
                "outcome": outcome, "pendingDir": str(pending)}
    dispatch = _read_json(pending / "dispatch.json")
    if dispatch is not None:
        return {"case": "pending", "specSha256": sha,
                "dispatch": dispatch, "pendingDir": str(pending)}

    return {"case": "none", "specSha256": sha}


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Report the sealed-acceptance collect case for a spec file.")
    parser.add_argument("spec", help="path to the approved spec file")
    parser.add_argument(
        "--vault",
        default=str(pathlib.Path.home() / ".ultrapowers" / "acceptance"),
        help="acceptance vault dir (default: ~/.ultrapowers/acceptance)")
    args = parser.parse_args(argv)
    print(json.dumps(collect(args.spec, args.vault), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_collect_seal.py -q`
Expected: all 8 PASS.

- [ ] **Step 5: Run the full suite and commit**

Run: `python3 -m pytest -q` — expected green.

```bash
git add skills/ultrapowers/scripts/collect_seal.py tests/test_collect_seal.py
git commit -m "feat(sealing): collect_seal.py — deterministic collect case + verbatim Acceptance line from suiteSha256"
```

---

### Task 2: `run_acceptance.sh` — manifest-proven baseline + legacy diagnosis

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/run_acceptance.sh`
- Test: `tests/test_run_acceptance.py`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: `--baseline --manifest <draft.json>` mode (reads `runCmd`, `bootstrapCmd`, `framework`, `ranPattern` from the draft; mutually exclusive with `--run`/`--bootstrap`, usage-error exit 2 when combined); new emitted status `MANIFEST_INCOHERENT` (JSON `status` field, exit 1) for drafts the gate would misread; augmented no-tests-ran diagnosis on the sealed gate path naming `framework/ranPattern` when a legacy manifest defaults to pytest with a non-pytest `runCmd`.

Why adversarial review: this file is the verification authority for every sealed gate; a regression here false-greens or false-reds every future run. All existing tests in `tests/test_run_acceptance.py` must pass **unmodified** — they pin the flags path and gate semantics.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_run_acceptance.py` (reuse the file's existing helpers `sh`, `make_repo`, `make_vault`, `administer`, `RUN`, `HASH`):

```python
# --- baseline --manifest: the RED proof reads the fields the gate reads ---

def write_draft(tmp_path, **fields):
    draft = tmp_path / "draft-manifest.json"
    draft.write_text(json.dumps(fields))
    return draft


def make_pytest_suite(tmp_path):
    suite = tmp_path / "suite"
    suite.mkdir()
    (suite / "test_exam.py").write_text(
        "from mod import add\n\n\ndef test_add():\n    assert add(2, 3) == 5\n")
    return suite


# A framework-free fake runner: prints a summary line on both outcomes, so
# ranPattern can detect "tests ran" red or green. Runs from the worktree root.
SH_RUNNER = (
    "if grep -q 'return a + b' mod.py; "
    "then echo 'TESTS RAN: 1 passed'; exit 0; "
    "else echo 'TESTS RAN: 1 failed'; exit 1; fi\n")


def make_sh_suite(tmp_path):
    suite = tmp_path / "suite"
    suite.mkdir()
    (suite / "run.sh").write_text(SH_RUNNER)
    return suite


def baseline_manifest(repo, suite, draft):
    r = sh(["bash", str(RUN), "--baseline", "--suite", str(suite),
            "--branch", "main", "--manifest", str(draft),
            "--repo", str(repo)], check=False)
    return r.returncode, json.loads(r.stdout)


def test_manifest_baseline_proves_red_reading_draft_fields(tmp_path):
    repo = make_repo(tmp_path, feature_built=False)
    suite = make_pytest_suite(tmp_path)
    draft = write_draft(tmp_path, runCmd="python3 -m pytest .ultra-acceptance -q")
    code, out = baseline_manifest(repo, suite, draft)
    assert code == 0
    assert out["status"] == "PROVEN_RED"


def test_incoherent_nonpytest_runcmd_without_framework(tmp_path):
    repo = make_repo(tmp_path, feature_built=False)
    suite = make_sh_suite(tmp_path)
    draft = write_draft(tmp_path, runCmd="sh .ultra-acceptance/run.sh")
    code, out = baseline_manifest(repo, suite, draft)
    assert code == 1
    assert out["status"] == "MANIFEST_INCOHERENT"
    assert "framework" in out["output"]


def test_incoherent_nonpytest_framework_without_ranpattern(tmp_path):
    repo = make_repo(tmp_path, feature_built=False)
    suite = make_sh_suite(tmp_path)
    draft = write_draft(tmp_path, runCmd="sh .ultra-acceptance/run.sh",
                        framework="sh")
    code, out = baseline_manifest(repo, suite, draft)
    assert code == 1
    assert out["status"] == "MANIFEST_INCOHERENT"
    assert "ranPattern" in out["output"]


def test_incoherent_draft_missing_runcmd(tmp_path):
    repo = make_repo(tmp_path, feature_built=False)
    suite = make_pytest_suite(tmp_path)
    draft = write_draft(tmp_path, framework="pytest")
    code, out = baseline_manifest(repo, suite, draft)
    assert code == 1
    assert out["status"] == "MANIFEST_INCOHERENT"
    assert "runCmd" in out["output"]


def test_coherent_nonpytest_manifest_proves_red(tmp_path):
    repo = make_repo(tmp_path, feature_built=False)
    suite = make_sh_suite(tmp_path)
    draft = write_draft(tmp_path, runCmd="sh .ultra-acceptance/run.sh",
                        framework="sh", ranPattern="TESTS RAN")
    code, out = baseline_manifest(repo, suite, draft)
    assert code == 0
    assert out["status"] == "PROVEN_RED"
    assert out["redKind"] == "assertion"     # the pattern saw the tests run


def test_manifest_flag_mutually_exclusive_with_run_flags(tmp_path):
    repo = make_repo(tmp_path, feature_built=False)
    suite = make_pytest_suite(tmp_path)
    draft = write_draft(tmp_path, runCmd="python3 -m pytest .ultra-acceptance -q")
    r = sh(["bash", str(RUN), "--baseline", "--suite", str(suite),
            "--branch", "main", "--manifest", str(draft),
            "--run", "python3 -m pytest .ultra-acceptance -q",
            "--repo", str(repo)], check=False)
    assert r.returncode == 2
    assert "mutually exclusive" in r.stderr


def test_manifest_first_nonpytest_seal_certifies_at_gate(tmp_path):
    # The end-to-end the field runs needed: author manifest-first, prove RED,
    # finalize, build the feature, administer at the gate — green, no false-red.
    repo = make_repo(tmp_path, feature_built=False)
    suite = tmp_path / "vault" / "pending-x" / "suite"
    suite.mkdir(parents=True)
    (suite / "run.sh").write_text(SH_RUNNER)
    draft = tmp_path / "vault" / "pending-x" / "manifest.json"
    draft.write_text(json.dumps({
        "runCmd": "sh .ultra-acceptance/run.sh",
        "framework": "sh", "ranPattern": "TESTS RAN"}))
    code, out = baseline_manifest(repo, suite, draft)
    assert (code, out["status"]) == (0, "PROVEN_RED")
    # finalize: hash, rename into the vault, complete the manifest
    digest = sh([sys.executable, str(HASH), str(suite)]).stdout.strip()
    entry = tmp_path / "vault" / digest[:12]
    (tmp_path / "vault" / "pending-x").rename(entry)
    manifest = json.loads((entry / "manifest.json").read_text())
    manifest.update({"sealId": digest[:12], "suiteSha256": digest})
    (entry / "manifest.json").write_text(json.dumps(manifest))
    # build the feature and administer
    (repo / "mod.py").write_text("def add(a, b):\n    return a + b\n")
    sh(["git", "add", "."], cwd=repo)
    sh(["git", "commit", "-qm", "feature"], cwd=repo)
    code, out = administer(tmp_path / "vault", digest[:12], digest, repo)
    assert code == 0
    assert out["passed"] is True


# --- legacy-seal gate diagnosis ---

def test_legacy_nonpytest_manifest_refusal_names_the_cause(tmp_path):
    # A pre-consolidation seal: green non-pytest suite, manifest lacking
    # framework/ranPattern. Still refuses (unchanged), but the message now
    # names the real cause instead of the generic no-tests-ran text.
    repo = make_repo(tmp_path, feature_built=True)
    vault, seal_id, digest = make_vault(
        tmp_path, run_cmd="sh .ultra-acceptance/run.sh",
        suite_files={"run.sh": "echo 'TESTS RAN: 1 passed'\nexit 0\n"})
    code, out = administer(vault, seal_id, digest, repo)
    assert code == 1
    assert out["passed"] is False
    assert "framework/ranPattern" in out["output"]
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `python3 -m pytest tests/test_run_acceptance.py -q -k "manifest or legacy"`
Expected: every new test FAILS — `--manifest` is an unknown argument today (empty stdout breaks the JSON parse; the mutual-exclusion test fails on its stderr assert, since today's message is "unknown argument"), and the legacy refusal message lacks the new text. Existing tests still pass: `python3 -m pytest tests/test_run_acceptance.py -q` shows only the new tests failing.

- [ ] **Step 3: Implement the script changes**

Four edits to `skills/ultrapowers/scripts/run_acceptance.sh`:

**(a)** Extend the header comment's usage block and initialize the new variable. The init line

```bash
B_SUITE=""; B_RUN=""; B_BOOT=""
```

becomes

```bash
B_SUITE=""; B_RUN=""; B_BOOT=""; B_MANIFEST=""
```

and the usage comment's baseline line becomes:

```bash
#    or: run_acceptance.sh --baseline --suite DIR --branch BASE
#                          (--manifest FILE | --run CMD [--bootstrap CMD])
#                          [--repo DIR]   (seal-time RED proof)
```

**(b)** In the `--baseline` argument loop, add a case alongside `--bootstrap`:

```bash
      --manifest)  B_MANIFEST="$2"; shift 2 ;;
```

and replace the three requirement lines after the loop:

```bash
  : "${B_SUITE:?--baseline requires --suite}"
  : "${BRANCH:?--baseline requires --branch}"
  : "${B_RUN:?--baseline requires --run}"
```

with:

```bash
  : "${B_SUITE:?--baseline requires --suite}"
  : "${BRANCH:?--baseline requires --branch}"
  if [ -n "$B_MANIFEST" ]; then
    if [ -n "$B_RUN" ] || [ -n "$B_BOOT" ]; then
      echo "--manifest is mutually exclusive with --run/--bootstrap" >&2
      exit 2
    fi
  else
    : "${B_RUN:?--baseline requires --run (or --manifest)}"
  fi
```

**(c)** Move the `read_manifest()` function definition (currently just above the sealed gate path, after the comment `# Read all four manifest fields in ONE python3 pass …`) up to sit immediately after the `run_exam()` function definition, so baseline mode can call it. The function body is unchanged — move, don't edit.

**(d)** Replace the head of the baseline execution block:

```bash
if [ "$MODE" = baseline ]; then
  FRAMEWORK="${FRAMEWORK:-pytest}"; RAN_PATTERN="${RAN_PATTERN:-}"
```

with:

```bash
if [ "$MODE" = baseline ]; then
  if [ -n "$B_MANIFEST" ]; then
    # Manifest-proven sealing: the RED proof reads the exact fields the gate
    # will read, and refuses a draft the gate would misread — framework
    # defaults to pytest at the gate, so a non-pytest runCmd without an
    # explicit framework/ranPattern false-reds every green exam.
    if [ ! -f "$B_MANIFEST" ]; then
      emit MANIFEST_INCOHERENT false 2 "manifest draft not found: $B_MANIFEST"
      exit 1
    fi
    { IFS= read -r B_RUN
      IFS= read -r B_BOOT
      IFS= read -r FRAMEWORK
      IFS= read -r RAN_PATTERN
    } < <(read_manifest "$B_MANIFEST")
    if [ -z "$B_RUN" ]; then
      emit MANIFEST_INCOHERENT false 2 "manifest draft missing runCmd: $B_MANIFEST"
      exit 1
    fi
    if [ "$FRAMEWORK" = "pytest" ]; then
      if ! printf '%s' "$B_RUN" | grep -q "pytest"; then
        emit MANIFEST_INCOHERENT false 2 "framework is 'pytest' (or absent) but runCmd does not invoke pytest — a non-pytest suite must declare framework and ranPattern in the manifest: $B_RUN"
        exit 1
      fi
    elif [ -z "$RAN_PATTERN" ]; then
      emit MANIFEST_INCOHERENT false 2 "framework '$FRAMEWORK' requires a ranPattern (the no-tests-ran defense has no marker outside pytest)"
      exit 1
    fi
  else
    FRAMEWORK="${FRAMEWORK:-pytest}"; RAN_PATTERN="${RAN_PATTERN:-}"
  fi
```

The rest of the baseline block (the `run_exam` call and the three `emit` branches) is unchanged.

**(e)** In the sealed gate path, between the final `run_exam "$SUITE" "$BRANCH" "$RUN_CMD" "$BOOTSTRAP_CMD"` and its `emit`, insert the legacy diagnosis:

```bash
# Legacy-seal diagnosis: a pre-consolidation manifest that omits framework/
# ranPattern for a non-pytest runCmd hits the no-tests-ran refusal with a
# generic message; name the real cause. Behavior unchanged — still refuses.
case "$R_OUTPUT" in
  *"ran no sealed tests"*)
    if [ "$FRAMEWORK" = "pytest" ] && ! printf '%s' "$RUN_CMD" | grep -q "pytest"; then
      R_OUTPUT="manifest omits framework/ranPattern for a non-pytest runCmd — re-seal or add the fields (the pytest ran-marker cannot see this runner). $R_OUTPUT"
    fi ;;
esac
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_run_acceptance.py -q`
Expected: all tests PASS — the new ones and every pre-existing one, unmodified.

- [ ] **Step 5: Run the full suite and commit**

Run: `python3 -m pytest -q` — expected green (`tests/test_fixture_seals.py` in particular must stay green: legacy pytest seals are untouched).

```bash
git add skills/ultrapowers/scripts/run_acceptance.sh tests/test_run_acceptance.py
git commit -m "feat(sealing): --baseline --manifest proves the fields the gate reads; MANIFEST_INCOHERENT fails closed; legacy non-pytest refusal names the cause"
```

---

### Task 3: Seal-author brief — manifest-draft-first + behavior-not-layout rider

**Type:** implementation
**Depends-on:** none
**Review:** lean

**Files:**
- Modify: `skills/ultraplan/references/seal-author-prompt.md`
- Test: `tests/test_seal_brief_manifest_first.py`

**Interfaces:**
- Consumes: nothing from sibling tasks — the brief text is authored against the spec's fixed CLI contract (the manifest-reading baseline mode and its incoherence status are implemented by a sibling task; the two land together in this plan's integrated tree).
- Produces: the rewritten brief (prose only; no code symbols).

Hard constraints for this task:
- Preserve these pinned tokens verbatim somewhere in the brief (sibling-owned test files assert them and this task must leave those files untouched): `<pendingDir>`, `specSha256`, `outcome.json`, `durable failure record`, `ultrapowers:seal-author`.
- Edit only the two files this task declares. The async-sealing pin file, the seal-author-agent pin file, and the agent definition belong to sibling tasks or stay untouched — Step 4 runs them by path to prove the rewrite keeps their pins green.

- [ ] **Step 1: Write the failing pin tests**

Create `tests/test_seal_brief_manifest_first.py`:

```python
"""Manifest-first sealing brief (seam consolidation): the manifest draft is
written before the RED proof and proven via --manifest, so the gate only
ever consumes fields the proof exercised; and exams pin behavior, never
implementation layout (spec-time seals guessed module surfaces in 2 field
runs and forced rework of correct code)."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROMPT = (ROOT / "skills/ultraplan/references/seal-author-prompt.md").read_text()


def test_brief_writes_the_manifest_draft_before_the_red_proof():
    assert "Write the manifest draft" in PROMPT
    assert "--manifest" in PROMPT


def test_brief_retires_the_flags_invocation():
    assert '--run "<runCmd>"' not in PROMPT, (
        "the flags invocation is the second channel — proving via flags and "
        "writing the manifest separately is how unproven fields reached the gate"
    )


def test_brief_names_framework_and_ranpattern():
    assert "framework" in PROMPT
    assert "ranPattern" in PROMPT
    assert "MANIFEST_INCOHERENT" in PROMPT


def test_brief_pins_behavior_not_layout():
    assert "never module layout" in PROMPT


def test_brief_prefers_value_pinning_over_symbol_pinning():
    assert "golden values" in PROMPT
```

- [ ] **Step 2: Run the pin tests to verify they fail**

Run: `python3 -m pytest tests/test_seal_brief_manifest_first.py -q`
Expected: all 5 FAIL (each test has at least one assert the current brief cannot satisfy — no `--manifest`, the old flags invocation still present, no `ranPattern`/`MANIFEST_INCOHERENT`, no rider).

- [ ] **Step 3: Rewrite the brief**

Replace the **entire contents** of `skills/ultraplan/references/seal-author-prompt.md` with:

~~~markdown
# Seal author prompt (sealed acceptance)

Dispatch a fresh subagent of agent type `ultrapowers:seal-author`
(most-capable tier at dispatch; the reasoning-effort knob is pinned in the
plugin's `agents/seal-author.md` definition, never inherited from the
session) with exactly this brief plus the six inputs — spec text, test
conventions, base branch, vault path, spec hash (`specSha256`, computed by
the dispatcher over the approved spec file), and the per-dispatch pending
dir `<pendingDir>` (`<vault>/pending-<first-12-hex-of-specSha256>/`,
created by the dispatcher, which writes its `dispatch.json` receipt there
before dispatching).

---

You are the independent acceptance author. You have the feature SPEC only.
You must never ask for, read, or be told the implementation plan (when you
are dispatched at spec approval, it does not exist yet).

1. Derive acceptance criteria from the spec — observable behavior only.
   Pin observable behavior and values — never module layout, export names,
   file locations, or textual source structure — unless the spec itself
   fixes them. Prefer hand-computed golden values over the spec's internal
   symbol names: value-pinning survives spec typos and implementation
   freedom, while symbol-pinning turns the exam into a hidden interface
   contract the plan author cannot see.
2. Write a test suite encoding those criteria, in the repo's test framework,
   into `<pendingDir>/suite/`. Tests must run from a repo checkout root
   with the suite mounted at `.ultra-acceptance/` (e.g. run command
   `python3 -m pytest .ultra-acceptance -q`). If the repo's own libraries need
   an editable install or other setup to import (a `kb_lib`-style package, a
   polyglot monorepo), author a one-line `bootstrapCmd` that prepares the
   worktree (e.g. `python3 -m venv .venv && .venv/bin/pip install -e .[dev]`,
   with `runCmd` then invoking `.venv/bin/python -m pytest …`). Leave
   `bootstrapCmd` empty when the bare checkout already imports.
3. Write the manifest draft `<pendingDir>/manifest.json` BEFORE proving
   RED — the proof runner reads it, so the fields the gate will consume are
   exactly the fields you prove:
   { planPath: null, specPath, specSha256, runCmd, bootstrapCmd, createdAt,
   baselineSha, framework, ranPattern }.
   `framework` and `ranPattern` are REQUIRED whenever the suite is not
   pytest — `ranPattern` is an extended regex matching the runner's own
   output whenever tests actually executed (a summary line that prints on
   red and green runs alike). Omit both only for a pytest suite.
4. Prove RED through the EXACT gate runner — never an ad-hoc test call:
   `bash <plugin>/skills/ultrapowers/scripts/run_acceptance.sh --baseline \
     --suite <pendingDir>/suite --branch <base> \
     --manifest <pendingDir>/manifest.json`.
   It must report `PROVEN_RED` (exit 0) because the feature is absent.
   `MANIFEST_INCOHERENT` means the draft itself would misread at the gate —
   fix the named field and rerun. If it reports `GREEN_AT_BASELINE`, the
   spec may already be satisfied — do not weaken tests to force red. If it
   reports `EXAM_BOOTSTRAP_ERROR`, fix `bootstrapCmd` in the draft until the
   env prepares. Read the output: a `redKind:"collection"` red must fail on
   the FEATURE's own import/symbol — if it fails importing a repo library
   instead, your `bootstrapCmd` is incomplete; fix it and rerun until the
   only failure is the feature.
   On a terminal failure — GREEN_AT_BASELINE, or an EXAM_BOOTSTRAP_ERROR you
   cannot fix — write `<pendingDir>/outcome.json`:
   { status: "GREEN_AT_BASELINE" | "EXAM_BOOTSTRAP_ERROR", specSha256,
   evidence (≤2000 chars), createdAt }, leave `<pendingDir>` in place as the
   durable failure record (the collect step reads it at plan approval; a
   failure must never exist only in your returned message), remove the
   worktree, and return the failure report with the runner output.
5. Compute the hash: `python3 <plugin>/skills/ultrapowers/scripts/seal_hash.py <pendingDir>/suite`.
   Rename `<pendingDir>` to `<vault>/<first-12-hex-of-hash>`. Finalize the
   manifest by ADDING to the draft: { sealId, suiteSha256, redEvidence
   (≤2000 chars), coverage: [{criterion, tests[]}] }.
   The coverage summary MUST also list every spec section the suite deliberately
   does not cover (browser-only, target-runtime-only, environment it cannot
   execute) with a one-line reason each — exclusions are vouched by the operator
   and flow into the gate's `deferredVerification` checklist.
6. Remove the worktree. Return ONLY: sealId, suiteSha256, redEvidence,
   coverage summary. Never return suite contents.
~~~

- [ ] **Step 4: Run the pin tests and the neighboring pins to verify they pass**

Run: `python3 -m pytest tests/test_seal_brief_manifest_first.py tests/test_async_sealing.py tests/test_seal_author_agent.py -q`
Expected: all PASS — the new pins, and every pre-existing brief/SKILL/agent pin untouched by this rewrite.

- [ ] **Step 5: Run the full suite and commit**

Run: `python3 -m pytest -q` — expected green.

```bash
git add skills/ultraplan/references/seal-author-prompt.md tests/test_seal_brief_manifest_first.py
git commit -m "feat(sealing): seal-author brief goes manifest-draft-first; behavior-not-layout authoring rider"
```

---

### Task 4: ultraplan SKILL collect step — one script invocation

**Type:** implementation
**Depends-on:** none
**Review:** lean

**Files:**
- Modify: `skills/ultraplan/SKILL.md`
- Test: `tests/test_async_sealing.py`

**Interfaces:**
- Consumes: nothing from sibling tasks — the collect step's prose names the deterministic collector by its role and path per the spec's fixed contract (the script itself is created by a sibling task; the two land together in this plan's integrated tree).
- Produces: the rewritten "Collect at plan approval" section (prose only).

Hard constraints for this task:
- Edit only the `### Collect at plan approval` section of `skills/ultraplan/SKILL.md` (between that heading and the paragraph beginning "Two consecutive green-at-baseline attempts", exclusive). The dispatch section, disposition section, and the rest of the SKILL are untouched.
- Keep every existing pinned token green: `### Collect at plan approval`, `specSha256`, `shasum -a 256` (it remains in the dispatch section), `outcome.json`, `at plan approval, never silently after`, `dispatch synchronously`.
- Edit only the two files this task declares — the seal-author brief belongs to a sibling task; touch no other test file.

- [ ] **Step 1: Extend the pin test (failing first)**

In `tests/test_async_sealing.py`, replace:

```python
def test_skill_collects_content_addressed_at_plan_approval():
    assert "### Collect at plan approval" in SKILL
    assert "specSha256" in SKILL
    assert "shasum -a 256" in SKILL
```

with:

```python
def test_skill_collects_content_addressed_at_plan_approval():
    assert "### Collect at plan approval" in SKILL
    assert "specSha256" in SKILL
    assert "shasum -a 256" in SKILL


def test_skill_collect_is_mechanical_not_transcribed():
    assert "collect_seal.py" in SKILL, (
        "the collect step must derive the Acceptance line via the "
        "deterministic collector — hand-copying a hash between the "
        "manifest's two sha256 values was a live SEAL_BROKEN false-block"
    )
    assert "verbatim" in SKILL, (
        "the orchestrator appends the reported acceptanceLine verbatim; "
        "re-typing it reopens the transcription channel"
    )
```

- [ ] **Step 2: Run the pin test to verify it fails**

Run: `python3 -m pytest tests/test_async_sealing.py -q`
Expected: `test_skill_collect_is_mechanical_not_transcribed` FAILS; every other test passes.

- [ ] **Step 3: Rewrite the collect section**

In `skills/ultraplan/SKILL.md`, replace the body of `### Collect at plan approval` — everything from the line after the heading down to (but not including) the paragraph starting `Two consecutive green-at-baseline attempts` — with:

~~~markdown
After the human approves the plan, run the deterministic collector against
the spec file as approved:

    python3 skills/ultrapowers/scripts/collect_seal.py <spec-file>

It hashes the spec (`specSha256`), scans the vault, and reports exactly one
case as JSON. Act on the case it names:

1. **`sealed`** → append the reported `acceptanceLine` to the plan
   **verbatim**, after the header block, plus the coverage summary as a
   short appendix (spec-derived, safe to show). Zero wait, zero
   transcription — the line already carries the suite hash; hand-copying
   between the manifest's two hashes was a live false-block defect.
2. **`failure`** — an `outcome.json` failure record matches → surface it
   at plan approval, never silently after: GREEN_AT_BASELINE counts as attempt #1
   toward the two-attempt stop rule below; EXAM_BOOTSTRAP_ERROR surfaces
   with its evidence before any re-dispatch.
3. **`pending`** — a dispatch receipt exists with no outcome → the
   background author is still running; say so and wait for it — the
   residual wait is bounded by today's synchronous cost minus the time
   already elapsed. If no background author is actually alive for it, the
   dispatch crashed: treat as `none`.
4. **`none`** — the spec was edited after dispatch (a stale hash can never
   match), the dispatch crashed, or nothing was dispatched → remove
   superseded `pending-*` dirs whose `dispatch.json` names this spec path,
   then dispatch synchronously with the same brief and inputs and wait.
   Never worse than the status quo.
~~~

- [ ] **Step 4: Run the pins to verify they pass**

Run: `python3 -m pytest tests/test_async_sealing.py -q`
Expected: all PASS.

- [ ] **Step 5: Validate the skill, run the full suite, and commit**

Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan` — expected exit 0.
Run: `python3 -m pytest -q` — expected green.

```bash
git add skills/ultraplan/SKILL.md tests/test_async_sealing.py
git commit -m "feat(sealing): ultraplan collect step runs the deterministic collector; acceptance line appended verbatim"
```

---

### Task 5: Gate — full suite green

**Type:** gate
**Depends-on:** 1, 2, 3, 4

Run from the integrated tree:

- [ ] `python3 -m pytest` — the whole suite green (588 baseline + this plan's additions), including unmodified `tests/test_fixture_seals.py` and the pre-existing `tests/test_run_acceptance.py` tests (legacy-seal compatibility).
- [ ] `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` — exit 0.
- [ ] `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan` — exit 0.
