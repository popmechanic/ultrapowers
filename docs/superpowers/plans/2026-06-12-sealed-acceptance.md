# Sealed Acceptance Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the eval's held-out acceptance mechanism to an engine contract: every marked plan carries a sealed exam (authored from the spec alone, stored outside the repo, hash-pinned, red-at-baseline) that the engine administers deterministically at the pre-merge gate, where it hard-gates Approve alongside `tests.passed`.

**Architecture:** Four seams: (1) two small scripts — a canonical suite hasher and a deterministic exam runner emitting JSON receipts; (2) `compile_plan.py` parses/enforces a plan-level `**Acceptance:**` marker; (3) `workflow.js` administers the exam in its final phase and adds an `acceptance` block to the structured report (re-bake discipline: prompt pinned in `reviewer-prompts.md`, contract docs updated); (4) the skills — ultraplan gains the sealing step + author-agent prompt, ultrapowers' SKILL.md carries acceptance through Steps 2–5. The eval fixtures get sealed so the contract is exercised by future eval runs.

**Tech Stack:** bash + python3 scripts, pytest (mirroring `tests/test_viewer.py` / `tests/test_compile_plan.py` conventions), the existing anti-drift pinning in `tests/test_no_prompt_drift.py`.

**Spec:** `docs/superpowers/specs/2026-06-12-sealed-acceptance-design.md`

**Shared contract (referenced by several tasks; each task body restates what it needs):**
- Vault: `~/.ultrapowers/acceptance/<seal-id>/{suite/, manifest.json}`; seal-id = first 12 hex of the suite hash.
- Suite hash: sha256 over sorted `(relative-path, file-bytes)` pairs — `seal_hash.py` is the only implementation; everyone else calls it.
- Plan marker (plan-level, outside any task): `**Acceptance:** sealed <seal-id> (sha256:<64-hex>)` or `**Acceptance:** waived — <reason>`.
- Runner JSON: `{ sealId, status: OK|SEAL_MISSING|SEAL_BROKEN|ERROR, passed: bool, exitCode: int, output: str }`.

---

### Task 1: Seal hasher + deterministic exam runner

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `skills/ultrapowers/scripts/seal_hash.py`
- Create: `skills/ultrapowers/scripts/run_acceptance.sh`
- Test: `tests/test_run_acceptance.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_run_acceptance.py`:

```python
"""Sealed acceptance: canonical hashing + deterministic exam runner, e2e
against a throwaway git repo and a tmp vault (no real ~/.ultrapowers use)."""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills/ultrapowers/scripts"
RUN = SCRIPTS / "run_acceptance.sh"
HASH = SCRIPTS / "seal_hash.py"


def sh(cmd, cwd=None, check=True):
    return subprocess.run(cmd, cwd=cwd, check=check, capture_output=True, text=True)


def make_repo(tmp_path, feature_built):
    repo = tmp_path / "repo"
    repo.mkdir()
    sh(["git", "init", "-q", "-b", "main"], cwd=repo)
    sh(["git", "config", "user.email", "t@t"], cwd=repo)
    sh(["git", "config", "user.name", "t"], cwd=repo)
    body = "def add(a, b):\n    return a + b\n" if feature_built \
        else "def add(a, b):\n    raise NotImplementedError\n"
    (repo / "mod.py").write_text(body)
    sh(["git", "add", "."], cwd=repo)
    sh(["git", "commit", "-qm", "base"], cwd=repo)
    return repo


def make_vault(tmp_path):
    suite = tmp_path / "vault" / "pending" / "suite"
    suite.mkdir(parents=True)
    (suite / "test_exam.py").write_text(
        "from mod import add\n\n\ndef test_add():\n    assert add(2, 3) == 5\n")
    digest = sh([sys.executable, str(HASH), str(suite)]).stdout.strip()
    seal_id = digest[:12]
    entry = tmp_path / "vault" / seal_id
    (tmp_path / "vault" / "pending").rename(entry)
    (entry / "manifest.json").write_text(json.dumps({
        "sealId": seal_id, "suiteSha256": digest,
        "runCmd": "python3 -m pytest .ultra-acceptance -q"}))
    return tmp_path / "vault", seal_id, digest


def administer(vault, seal_id, digest, repo):
    r = sh(["bash", str(RUN), seal_id, "main", digest,
            "--vault", str(vault), "--repo", str(repo)], check=False)
    return r.returncode, json.loads(r.stdout)


def test_hash_is_stable_and_content_sensitive(tmp_path):
    vault, seal_id, digest = make_vault(tmp_path)
    again = sh([sys.executable, str(HASH), str(vault / seal_id / "suite")]).stdout.strip()
    assert again == digest and len(digest) == 64
    (vault / seal_id / "suite" / "test_exam.py").write_text("# tampered\n")
    assert sh([sys.executable, str(HASH), str(vault / seal_id / "suite")]).stdout.strip() != digest


def test_green_exam_passes(tmp_path):
    vault, seal_id, digest = make_vault(tmp_path)
    repo = make_repo(tmp_path, feature_built=True)
    code, out = administer(vault, seal_id, digest, repo)
    assert code == 0 and out["status"] == "OK" and out["passed"] is True
    assert out["sealId"] == seal_id


def test_red_exam_fails_honestly(tmp_path):
    vault, seal_id, digest = make_vault(tmp_path)
    repo = make_repo(tmp_path, feature_built=False)
    code, out = administer(vault, seal_id, digest, repo)
    assert code != 0 and out["status"] == "OK" and out["passed"] is False
    assert out["exitCode"] != 0


def test_broken_seal_refuses_to_run(tmp_path):
    vault, seal_id, digest = make_vault(tmp_path)
    (vault / seal_id / "suite" / "test_exam.py").write_text("assert True\n")
    repo = make_repo(tmp_path, feature_built=True)
    code, out = administer(vault, seal_id, digest, repo)
    assert code != 0 and out["status"] == "SEAL_BROKEN" and out["passed"] is False


def test_missing_seal_reports_missing(tmp_path):
    repo = make_repo(tmp_path, feature_built=True)
    code, out = administer(tmp_path / "vault", "000000000000", "0" * 64, repo)
    assert code != 0 and out["status"] == "SEAL_MISSING"


def test_worktree_cleaned_up(tmp_path):
    vault, seal_id, digest = make_vault(tmp_path)
    repo = make_repo(tmp_path, feature_built=True)
    administer(vault, seal_id, digest, repo)
    listed = sh(["git", "worktree", "list"], cwd=repo).stdout.strip().splitlines()
    assert len(listed) == 1, "exam worktree leaked"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_run_acceptance.py -q`
Expected: FAIL/ERROR — `seal_hash.py` and `run_acceptance.sh` do not exist.

- [ ] **Step 3: Write `seal_hash.py`**

Create `skills/ultrapowers/scripts/seal_hash.py`:

```python
#!/usr/bin/env python3
"""Canonical content hash of a sealed acceptance suite directory.

sha256 over (relative-path, file-bytes) pairs in sorted order: the same suite
hashes identically regardless of machine, vault location, or copy. This file
is the ONLY hash implementation — the sealing author and run_acceptance.sh
both call it (spec: docs/superpowers/specs/2026-06-12-sealed-acceptance-design.md).
"""
import hashlib
import pathlib
import sys


def suite_hash(directory):
    root = pathlib.Path(directory)
    h = hashlib.sha256()
    for f in sorted(p for p in root.rglob("*") if p.is_file()):
        rel = f.relative_to(root).as_posix()
        h.update(rel.encode() + b"\0" + f.read_bytes() + b"\0")
    return h.hexdigest()


if __name__ == "__main__":
    print(suite_hash(sys.argv[1]))
```

- [ ] **Step 4: Write `run_acceptance.sh`**

Create `skills/ultrapowers/scripts/run_acceptance.sh` (and `chmod +x` it):

```bash
#!/usr/bin/env bash
# Administer a sealed acceptance exam against a branch. Deterministic: no
# agents, no interpretation. Emits exactly one JSON object on stdout.
# Exit 0 iff the seal verified AND the exam passed.
#
# Usage: run_acceptance.sh <seal-id> <branch> <expected-sha256>
#                          [--vault DIR] [--repo DIR]
# Spec: docs/superpowers/specs/2026-06-12-sealed-acceptance-design.md
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

emit() { # status passed exit_code output  → prints JSON, never fails
  STATUS="$1" PASSED="$2" CODE="$3" OUTPUT="$4" SEAL="$SEAL_ID" python3 - <<'EOF'
import json, os
print(json.dumps({
    "sealId": os.environ["SEAL"],
    "status": os.environ["STATUS"],
    "passed": os.environ["PASSED"] == "true",
    "exitCode": int(os.environ["CODE"]),
    "output": os.environ["OUTPUT"][-8000:],
}))
EOF
}

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

RUN_CMD="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["runCmd"])' "$MANIFEST")"
WT="$(mktemp -d)/exam"
cleanup() { git -C "$REPO" worktree remove --force "$WT" >/dev/null 2>&1 || true; }
trap cleanup EXIT

if ! git -C "$REPO" worktree add --detach "$WT" "$BRANCH" >/dev/null 2>&1; then
  emit ERROR false 1 "could not create exam worktree for branch $BRANCH in $REPO"
  exit 1
fi
mkdir -p "$WT/.ultra-acceptance"
cp -R "$SUITE/." "$WT/.ultra-acceptance/"

OUT="$( (cd "$WT" && eval "$RUN_CMD") 2>&1 )"
CODE=$?
if [ "$CODE" -eq 0 ]; then
  emit OK true 0 "$OUT"
  exit 0
fi
emit OK false "$CODE" "$OUT"
exit 1
```

Convention baked into manifests: `runCmd` runs from the worktree root and
references the suite at `.ultra-acceptance` (e.g.
`python3 -m pytest .ultra-acceptance -q`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_run_acceptance.py -q`
Expected: all 6 PASS.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/scripts/seal_hash.py skills/ultrapowers/scripts/run_acceptance.sh tests/test_run_acceptance.py
git commit -m "feat: sealed-acceptance hasher and deterministic exam runner"
```

---

### Task 2: Compiler — parse and enforce the Acceptance marker

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `tests/test_compile_plan.py`
- Modify: `tests/fixtures/marked-plan.md` (and any other marked plan fixture under `tests/fixtures/` — find them with `grep -rl "Depends-on" tests/fixtures/`)

Contract (restated): the plan-level marker is `**Acceptance:** sealed <seal-id> (sha256:<64-hex>)` or `**Acceptance:** waived — <reason>`, on its own line outside any task body and outside code fences. A **marked** plan (any task carrying explicit markers, i.e. any task with `heuristic: false`) with neither form fails compilation. Unmarked plans get a disposition warning instead.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_compile_plan.py` (follow the file's existing helper conventions for invoking the compiler — reuse its existing `run`/fixture helpers rather than redefining them; the snippets below assume a helper `compile_text(plan_markdown)` that writes a tmp plan and returns `(returncode, parsed_json_or_None, stderr)` — add it if absent):

```python
SEAL_LINE = "**Acceptance:** sealed a1b2c3d4e5f6 (sha256:" + "ab" * 32 + ")"
WAIVE_LINE = "**Acceptance:** waived — fixture plan, exam not applicable"


def _minimal_marked_plan(acceptance_line=None):
    head = ["# Tiny Implementation Plan", ""]
    if acceptance_line:
        head += [acceptance_line, ""]
    return "\n".join(head + [
        "### Task 1: Thing",
        "**Type:** implementation",
        "**Depends-on:** none",
        "**Files:**",
        "- Create: `a.py`",
        "- [ ] **Step 1: do it**",
    ]) + "\n"


def test_acceptance_sealed_parsed():
    code, out, _ = compile_text(_minimal_marked_plan(SEAL_LINE))
    assert code == 0
    assert out["acceptance"] == {"mode": "sealed", "sealId": "a1b2c3d4e5f6",
                                 "sha256": "ab" * 32}


def test_acceptance_waived_parsed():
    code, out, _ = compile_text(_minimal_marked_plan(WAIVE_LINE))
    assert code == 0
    assert out["acceptance"]["mode"] == "waived"
    assert "not applicable" in out["acceptance"]["reason"]


def test_marked_plan_without_acceptance_fails():
    code, _, err = compile_text(_minimal_marked_plan())
    assert code != 0
    assert "Acceptance" in err and "sealed-acceptance" in err


def test_fenced_acceptance_line_is_ignored():
    plan = _minimal_marked_plan("```\n" + SEAL_LINE + "\n```")
    code, _, err = compile_text(plan)
    assert code != 0, "a fenced example must not count as the plan's seal"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_compile_plan.py -q`
Expected: the four new tests FAIL (`acceptance` key absent / no enforcement).

- [ ] **Step 3: Implement parsing + enforcement**

In `skills/ultrapowers/scripts/compile_plan.py`, add near the other regex/parse helpers (after `def classify(t):` is a reasonable anchor):

```python
ACCEPT_SEALED = re.compile(
    r"^\*\*Acceptance:\*\*\s*sealed\s+([0-9a-f]{8,40})\s*\(sha256:([0-9a-f]{64})\)\s*$",
    re.I)
ACCEPT_WAIVED = re.compile(r"^\*\*Acceptance:\*\*\s*waived\s*[—–-]\s*(.+?)\s*$", re.I)


def parse_acceptance(text):
    """Plan-level sealed-acceptance marker.

    Fence-aware scan of the whole document (the line conventionally sits in
    the plan header, but position is not load-bearing). Returns
    {"mode": "sealed", "sealId", "sha256"} | {"mode": "waived", "reason"}
    | {"mode": "missing"}.
    Spec: docs/superpowers/specs/2026-06-12-sealed-acceptance-design.md
    """
    for line in _fence_aware_lines(text):
        s = line.strip()
        m = ACCEPT_SEALED.match(s)
        if m:
            return {"mode": "sealed", "sealId": m.group(1), "sha256": m.group(2)}
        m = ACCEPT_WAIVED.match(s)
        if m:
            return {"mode": "waived", "reason": m.group(1)}
    return {"mode": "missing"}
```

(`_fence_aware_lines` already exists — if its return shape includes fence
state rather than plain filtered lines, adapt the loop to skip in-fence lines
accordingly; the test in Step 1 pins the behavior.)

In `main()`: after tasks are parsed/classified and before the output dict is
built, compute:

```python
    acceptance = parse_acceptance(text)
    marked = any(not t.get("heuristic") for t in tasks_out)
    if acceptance["mode"] == "missing" and marked:
        sys.exit("error: marked plan has no **Acceptance:** line (sealed or waived). "
                 "Seal the exam (ultraplan sealing step) or record an explicit waiver. "
                 "See docs/superpowers/specs/2026-06-12-sealed-acceptance-design.md")
```

(`tasks_out` = whatever local holds the per-task dicts with their `heuristic`
flags — match the existing variable name.) For an unmarked plan with
`mode == "missing"`, append a warning string to the existing
`marker_conflicts` list: `"acceptance: missing (unmarked plan — warning only)"`.
Add `"acceptance": acceptance` to the output dict alongside
`"marker_conflicts"`.

- [ ] **Step 4: Update fixtures**

Add to every **marked** plan fixture under `tests/fixtures/` (locate with
`grep -rl "Depends-on" tests/fixtures/`), immediately after the plan's header
block: `**Acceptance:** waived — compiler test fixture`. Do NOT touch
`evals/fixtures/` (Task 5 seals those properly).

- [ ] **Step 5: Run the full test suite**

Run: `python3 -m pytest tests/ -q`
Expected: all PASS — including every pre-existing compiler/viewer/marker test
that compiles the fixtures (they now carry waivers).

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/scripts/compile_plan.py tests/test_compile_plan.py tests/fixtures/
git commit -m "feat: compiler parses and enforces the plan-level Acceptance marker"
```

---

### Task 3: Engine — administer the exam, report receipts

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `skills/ultrapowers/workflow.js`
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `skills/ultrapowers/references/report-format.md`
- Modify: `skills/ultrapowers/references/workflow-template.md`
- Modify: `tests/test_no_prompt_drift.py` (only if its expected-blocks list is explicit)

Contract (restated): the runner is `run_acceptance.sh <seal-id> <branch> <sha256>`; it prints one JSON object `{ sealId, status: OK|SEAL_MISSING|SEAL_BROKEN|ERROR, passed, exitCode, output }` and exits 0 iff verified-and-passed. The engine must treat the script as the authority — the agent only relays output. This task follows the **re-bake discipline**: the new prompt text lands in `reviewer-prompts.md` inside a `<!-- BAKE:... -->` block first, then verbatim in `workflow.js`.

- [ ] **Step 1: Write the failing drift expectation**

In `skills/ultrapowers/references/reviewer-prompts.md`, add a new baked block
(mirror the formatting of the existing `BAKE:` blocks exactly):

```markdown
<!-- BAKE:ACCEPTANCE-EXAM -->
Run EXACTLY this command from the repository root and return its complete stdout verbatim in the "raw" field. Do not interpret the result, do not fix anything, do not retry, and do not run any other command. If the command cannot be executed, put the reason in "raw".
<!-- /BAKE:ACCEPTANCE-EXAM -->
```

If `tests/test_no_prompt_drift.py` enumerates expected block names explicitly
(check `test_expected_blocks_present`), add `ACCEPTANCE-EXAM` to that list.

Run: `python3 -m pytest tests/test_no_prompt_drift.py -q`
Expected: FAIL — the block is not yet baked into `workflow.js`.

- [ ] **Step 2: Add the args contract and administration to `workflow.js`**

Immediately after the `const testCmd = ...` line, add:

```js
// acceptance: sealed-exam administration (spec 2026-06-12-sealed-acceptance).
//   { mode: 'sealed', sealId, sha256, scriptPath }  — scriptPath is the
//   absolute path to run_acceptance.sh, resolved by the orchestrator from the
//   plugin root at launch (the workflow has no filesystem introspection), or
//   { mode: 'waived', reason }. Absent → report.acceptance = null.
const ACCEPTANCE = (ARGS && ARGS.acceptance && typeof ARGS.acceptance === 'object')
  ? ARGS.acceptance : null
```

In the integration/completeness section — after `review` is computed and
before the `// ── Structured return value` comment — add:

```js
// ── Sealed acceptance exam: deterministic script is the authority; the agent
// only relays its stdout (BAKE:ACCEPTANCE-EXAM). ──────────────────────────────
let acceptance = null
if (ACCEPTANCE && ACCEPTANCE.mode === 'waived') {
  acceptance = { mode: 'waived', reason: String(ACCEPTANCE.reason || ''), passed: null }
} else if (ACCEPTANCE && ACCEPTANCE.mode === 'sealed') {
  phase('Acceptance')
  const cmd = 'bash ' + ACCEPTANCE.scriptPath + ' ' + ACCEPTANCE.sealId + ' ' +
    integrationBranch + ' ' + ACCEPTANCE.sha256
  try {
    const exam = await agent(
      'Run EXACTLY this command from the repository root and return its complete ' +
      'stdout verbatim in the "raw" field. Do not interpret the result, do not fix ' +
      'anything, do not retry, and do not run any other command. If the command ' +
      'cannot be executed, put the reason in "raw".\n\nCOMMAND: ' + cmd,
      { label: 'acceptance-exam', model: CHEAP_MODEL,
        schema: { type: 'object', required: ['raw'],
                  properties: { raw: { type: 'string' } } } }
    )
    let parsed = null
    try { parsed = JSON.parse(((exam && exam.raw || '').match(/\{[\s\S]*\}/) || ['null'])[0]) } catch (e) { parsed = null }
    acceptance = (parsed && typeof parsed.passed === 'boolean')
      ? { mode: 'sealed', sealId: ACCEPTANCE.sealId, status: parsed.status,
          passed: parsed.passed, exitCode: parsed.exitCode, output: parsed.output }
      : { mode: 'sealed', sealId: ACCEPTANCE.sealId, status: 'ERROR', passed: false,
          output: 'unparseable exam output: ' + String(exam && exam.raw).slice(0, 2000) }
  } catch (e) {
    acceptance = { mode: 'sealed', sealId: ACCEPTANCE.sealId, status: 'ERROR',
                   passed: false, output: 'exam agent error: ' + String((e && e.message) || e) }
  }
  if (!acceptance.passed) judgmentCalls.push(
    'sealed acceptance did not pass (' + acceptance.status + ') — gate must not Approve')
}
```

`CHEAP_MODEL` here means: use the same model constant the setup/merge agents
use (find it where merge agents are dispatched; do not invent a new constant).
Add `acceptance,` to the structured `return { ... }` block, after `tests:`.
Add `{ title: 'Acceptance' }` to the `meta.phases` literal (pure literal —
no computed values).

- [ ] **Step 3: Update the contract docs**

- `references/report-format.md`: document the `acceptance` block —
  `null | { mode: 'waived', reason, passed: null } | { mode: 'sealed', sealId, status, passed, exitCode, output }` —
  and that presentation order places it directly after the test result.
- `references/workflow-template.md`: add `acceptance?` to the documented args
  contract with the shape above and the note that the orchestrator resolves
  `scriptPath` from the plugin root.

- [ ] **Step 4: Run the suite**

Run: `python3 -m pytest tests/ -q`
Expected: all PASS — drift test now finds `ACCEPTANCE-EXAM` baked; workflow
syntax remains valid (the sim test `tests/test_workflow_sim.py` still
executes; if it asserts the exact report key set, add `acceptance` there).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/workflow.js skills/ultrapowers/references/ tests/test_no_prompt_drift.py tests/test_workflow_sim.py
git commit -m "feat: engine administers sealed acceptance exam, reports receipts"
```

---

### Task 4: Skills — sealing step, gate enforcement, args plumbing

**Type:** implementation
**Depends-on:** 1, 2, 3

**Files:**
- Modify: `skills/ultraplan/SKILL.md`
- Create: `skills/ultraplan/references/seal-author-prompt.md`
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `tests/test_ultraplan_skill.py`, `tests/test_orchestrator_markers.py` (only where they pin section lists/content — run them and update pins, never weaken assertions)

- [ ] **Step 1: Add the sealing step to ultraplan**

In `skills/ultraplan/SKILL.md`, after the "Authoring rules (the worktree-pure
contract)" section, add:

```markdown
## Seal the exam (after plan approval)

A marked plan is not execution-ready until it carries an `**Acceptance:**`
line (the compiler refuses it otherwise). After the human approves the plan:

1. Dispatch a fresh-context author subagent per
   `references/seal-author-prompt.md`. Its inputs are ONLY: the spec text,
   the repo's test conventions (framework, run command, naming), the base
   branch name, and the vault path `~/.ultrapowers/acceptance/`. Never the
   plan, never the task list, never this conversation's history.
2. The author writes the suite into the vault, proves it RED against a
   pristine baseline worktree (a suite that passes before the work exists
   tests nothing — collection errors from missing modules count as red; the
   suite's own syntax errors do not), writes `manifest.json`, and returns
   ONLY: seal-id, sha256, red-run evidence, and a coverage summary mapping
   spec criteria to test names.
3. Append to the plan, after the header block:
   `**Acceptance:** sealed <seal-id> (sha256:<hash>)` plus the coverage
   summary as a short appendix (spec-derived, safe to show).
4. Two consecutive green-at-baseline attempts → stop and tell the human: the
   spec may describe behavior that already exists.

The operator may instead record `**Acceptance:** waived — <reason>`; waivers
surface verbatim at the wave-plan gate, in the report, and at the pre-merge
gate. Never waive silently on the operator's behalf.
```

Add to the self-review additions list: `- The plan carries an
**Acceptance:** line — sealed (preferred) or an explicit operator waiver.`

- [ ] **Step 2: Write the author prompt reference**

Create `skills/ultraplan/references/seal-author-prompt.md`:

```markdown
# Seal author prompt (sealed acceptance)

Dispatch a fresh subagent (most-capable tier) with exactly this brief plus
the four inputs — spec text, test conventions, base branch, vault path.

---

You are the independent acceptance author. You have the feature SPEC only.
You must never ask for, read, or be told the implementation plan.

1. Derive acceptance criteria from the spec — observable behavior only.
2. Write a test suite encoding those criteria, in the repo's test framework,
   into `<vault>/pending/suite/`. Tests must run from a repo checkout root
   with the suite mounted at `.ultra-acceptance/` (e.g. run command
   `python3 -m pytest .ultra-acceptance -q`).
3. Prove RED: create a throwaway worktree of the base branch, copy the suite
   to `.ultra-acceptance/`, run it. It must FAIL because the feature is
   absent. If it fails due to your own syntax/import bugs, fix and rerun. If
   it PASSES, report GREEN_AT_BASELINE with the output — do not weaken tests
   to force red.
4. Compute the hash: `python3 <plugin>/skills/ultrapowers/scripts/seal_hash.py <vault>/pending/suite`.
   Rename `<vault>/pending` to `<vault>/<first-12-hex-of-hash>`. Write
   `manifest.json`: { sealId, planPath: null, specPath, suiteSha256, runCmd,
   createdAt, baselineSha, redEvidence (≤2000 chars), coverage:
   [{criterion, tests[]}] }.
5. Remove the worktree. Return ONLY: sealId, suiteSha256, redEvidence,
   coverage summary. Never return suite contents.
```

- [ ] **Step 3: Plumb acceptance through the ultrapowers SKILL**

In `skills/ultrapowers/SKILL.md`:

- **Step 2 (derived knobs):** add a bullet — the compiler output's
  `acceptance` field rides into the launch args; for `sealed` mode the
  orchestrator resolves `scriptPath` to
  `<plugin-root>/skills/ultrapowers/scripts/run_acceptance.sh`. A compile
  failure for a missing Acceptance line is surfaced to the human with the
  ultraplan sealing step named as the remedy.
- **Step 3 (transparency block):** add item — render the acceptance
  disposition: `sealed <seal-id>` or the verbatim waiver reason. The human
  approves it with the rest of the interpretation.
- **Step 4b (args):** extend the documented args object with
  `acceptance?: { mode: 'sealed', sealId, sha256, scriptPath } | { mode: 'waived', reason }`.
- **Step 5 (gate):** amend the Approve bullet: gate on
  `tests.passed && (acceptance is null || acceptance.passed || acceptance.mode === 'waived')`.
  On a red exam offer Redirect/Salvage; an operator override is recorded as a
  waiver-with-reason in the runbook and the final report. `SEAL_MISSING` /
  `SEAL_BROKEN` remedies: re-seal via the ultraplan sealing step (the spec
  still exists) or waive explicitly. Render the `acceptance` block's raw
  output with the report — receipts, not narrative.

- [ ] **Step 4: Run the suite and the skill validator**

Run: `python3 -m pytest tests/ -q && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan`
Expected: all PASS, both validators print `skill ok`. Update any pinned
section lists in `tests/test_ultraplan_skill.py` / `tests/test_orchestrator_markers.py`
that the new sections legitimately extend — never delete an existing
assertion to make this pass.

- [ ] **Step 5: Commit**

```bash
git add skills/ultraplan/ skills/ultrapowers/SKILL.md tests/test_ultraplan_skill.py tests/test_orchestrator_markers.py
git commit -m "feat: sealing step in ultraplan; acceptance hard gate in ultrapowers skill"
```

---

### Task 5: Seal the eval fixtures

**Type:** implementation
**Depends-on:** 2

**Files:**
- Create: `evals/scripts/seal_fixture.py`
- Modify: `evals/fixtures/wide/plan.md`, `evals/fixtures/chained/plan.md`, `evals/fixtures/mixed/plan.md`, `evals/fixtures/degrade/plan.md`
- Test: `tests/test_fixture_seals.py`

The eval fixtures already have held-out suites (`evals/fixtures/<f>/acceptance/`).
This task gives each fixture plan a real `**Acceptance:**` line whose hash is
recomputable from the repo (the vault copy is a convenience; the repo
acceptance dir is the source of truth for the hash), so compiled fixture
plans satisfy Task 2's enforcement and future eval runs exercise the gate.

- [ ] **Step 1: Write the failing test**

Create `tests/test_fixture_seals.py`:

```python
"""Every eval fixture plan carries a sealed Acceptance line whose hash matches
the fixture's acceptance suite as committed in the repo."""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
HASH = ROOT / "skills/ultrapowers/scripts/seal_hash.py"
FIXTURES = ["wide", "chained", "mixed", "degrade"]
LINE = re.compile(r"\*\*Acceptance:\*\* sealed ([0-9a-f]{12}) \(sha256:([0-9a-f]{64})\)")


def test_fixture_plans_carry_matching_seals():
    for name in FIXTURES:
        plan = (ROOT / "evals/fixtures" / name / "plan.md").read_text()
        m = LINE.search(plan)
        assert m, f"{name}/plan.md has no sealed Acceptance line"
        suite = ROOT / "evals/fixtures" / name / "acceptance"
        digest = subprocess.run([sys.executable, str(HASH), str(suite)],
                                capture_output=True, text=True, check=True).stdout.strip()
        assert m.group(2) == digest, f"{name}: recorded hash != recomputed suite hash"
        assert m.group(1) == digest[:12]
```

Run: `python3 -m pytest tests/test_fixture_seals.py -q` — expected: FAIL (no lines yet).

- [ ] **Step 2: Write `seal_fixture.py`**

Create `evals/scripts/seal_fixture.py`:

```python
#!/usr/bin/env python3
"""Vault an eval fixture's acceptance suite and print its Acceptance line.

Usage: seal_fixture.py <fixture-name> [--vault DIR]
Copies evals/fixtures/<name>/acceptance/ into the vault under its seal-id,
writes manifest.json, and prints the exact line to add to the fixture plan.
Idempotent: re-running overwrites the same vault entry (hash-addressed).
"""
import argparse
import datetime
import json
import pathlib
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
from seal_hash import suite_hash  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("fixture")
    ap.add_argument("--vault", default=str(pathlib.Path.home() / ".ultrapowers/acceptance"))
    args = ap.parse_args()
    suite = ROOT / "evals/fixtures" / args.fixture / "acceptance"
    if not suite.is_dir():
        sys.exit(f"no acceptance suite at {suite}")
    digest = suite_hash(suite)
    seal_id = digest[:12]
    entry = pathlib.Path(args.vault) / seal_id
    if entry.exists():
        shutil.rmtree(entry)
    (entry / "suite").parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(suite, entry / "suite")
    (entry / "manifest.json").write_text(json.dumps({
        "sealId": seal_id, "planPath": f"evals/fixtures/{args.fixture}/plan.md",
        "specPath": None, "suiteSha256": digest,
        "runCmd": "python3 -m pytest .ultra-acceptance -q",
        "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "baselineSha": None, "redEvidence": "pre-existing eval suite, sealed retroactively",
        "coverage": []}, indent=2))
    print(f"**Acceptance:** sealed {seal_id} (sha256:{digest})")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Seal all four fixtures**

For each of `wide`, `chained`, `mixed`, `degrade`:

```bash
python3 evals/scripts/seal_fixture.py <name>
```

Take each printed line and insert it into `evals/fixtures/<name>/plan.md`
immediately after the top-level `# ...` heading (or after the
`> **For agentic workers:**` blockquote if the plan has one), separated by
blank lines. (The vault write is a local
side effect; the committed artifact is the plan line, whose hash any machine
can recompute from the repo suite — that is what the test pins.)

- [ ] **Step 4: Run the suite**

Run: `python3 -m pytest tests/test_fixture_seals.py tests/test_compile_plan.py -q && python3 -m pytest tests/ -q`
Expected: all PASS (fixture plans now compile under Task 2's enforcement).

- [ ] **Step 5: Commit**

```bash
git add evals/scripts/seal_fixture.py evals/fixtures/*/plan.md tests/test_fixture_seals.py
git commit -m "feat: seal eval fixture plans; add seal_fixture tool"
```

---

### Task 6: Full-suite verification

**Type:** gate
**Depends-on:** 1, 2, 3, 4, 5

Run: `python3 -m pytest tests/ -q`
Expected: every test passes — pre-existing suite plus `test_run_acceptance.py`
(6 tests), the new compiler tests, the drift block, and `test_fixture_seals.py`.
Also: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers`
and `... skills/ultraplan` both print `skill ok`.

---

### Task 7: Live shakedown of the sealing flow

**Type:** manual
**Depends-on:** 6

Owner steps (needs an interactive session; exercises the agentic paths no
pytest can):

1. Pick a toy spec (a one-paragraph feature against any scratch repo).
   Run the ultraplan flow end to end: plan → approve → **sealing step** — and
   confirm the author agent writes the vault entry, proves red, and the plan
   gains a valid `**Acceptance:**` line whose hash matches
   `seal_hash.py` on the vault suite.
2. Run `/ultrapowers` on that plan; at the pre-merge gate confirm the report
   shows the `acceptance` block with raw runner output, green.
3. Tamper test: edit one byte of the vaulted suite, re-run
   `run_acceptance.sh` manually — confirm `SEAL_BROKEN` and that the gate
   path would refuse Approve.
4. Waiver test: compile a marked plan with `**Acceptance:** waived — testing
   the waiver path` and confirm the waiver renders at the wave-plan gate and
   in the report.
5. File issues for anything rough; the docket (part 3) will inherit this
   contract as-is.

---

## Self-review notes

- Spec coverage: vault + hashing + runner (Task 1), marker parse/enforcement
  incl. fence-awareness and unmarked-plan warning (Task 2), engine
  administration + receipts + re-bake discipline (Task 3), sealing step +
  author prompt + hard gate + waiver flow + SEAL_MISSING remedies (Task 4),
  eval fixtures sealed (Task 5), agentic paths shaken down (Task 7). The
  threat-model and non-goals sections of the spec require no code.
- Type consistency: runner JSON shape defined in Task 1 is restated and
  consumed verbatim in Tasks 3–4; the marker grammar defined in Task 2 is
  the one Task 4's skill text and Task 5's test regex use; `seal_hash.py` is
  the single hash implementation (Tasks 1, 5 import/invoke it).
- Same-file collisions: none across tasks (Task 2 owns `tests/fixtures/`,
  Task 5 owns `evals/fixtures/`); waves can run [1,2] → [3,5] → [4].
- Known judgment points left to implementers, deliberately: exact local
  variable names at the two `compile_plan.py` integration points and the
  cheap-model constant name in `workflow.js` — both anchored with greppable
  context and pinned by tests.
