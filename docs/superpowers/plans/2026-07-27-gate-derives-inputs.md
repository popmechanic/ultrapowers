# Gate Derives Its Inputs From the Receipt (#96) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No agent ever authors or edits a pre-merge gate input: the driver derives `testCmd`/`bootstrapCmd` at preflight and stamps them into the receipt; the harness stamps `report.tests.command` mechanically; the frozen gate half reads only the receipt and provisions its suite-gate worktree from the validated bootstrap.

**Architecture:** One derivation chain. `ultra_run.py` (unfrozen) resolves the effective test command (operator knob or a deterministic file-presence ladder, fail-closed on miss) and stamps `receipt.testCmd`/`receipt.testCmdSource`/`receipt.bootstrapCmd`, injecting `testCmd` into the emitted args file. `waves.js` (unfrozen) makes `args.testCmd` mandatory and stamps `report.tests.command` from it; the completeness critic loses its `command` field. `ultra_gate.py` + `run_acceptance.sh` (FROZEN — this plan's eval cell is the unfreeze evidence) read `receipt.testCmd`, pass `--bootstrap receipt.bootstrapCmd`, and share the sealed path's bootstrap provisioning. A deterministic no-LLM eval cell proves `false_block` 1→0.

**Tech Stack:** Python 3 (pytest), bash, Node ≥18 (`node --test`, npm), the committed Dynamic Workflow harness (`waves.js`) + its `.mjs` sim.

**Spec:** `docs/superpowers/specs/2026-07-27-gate-derives-inputs.md`

**Acceptance:** suite — the committed pytest suite + the harness `.mjs` sims are the verification; the frozen-periphery half is additionally hard-gated by the Task 6 eval counter (`false_block` 1→0), per subtraction-eval doctrine. No seal requested.

## Global Constraints

- **Frozen-periphery discipline:** among the frozen files, ONLY `skills/ultrapowers/scripts/run_acceptance.sh` (Task 4) and `skills/ultrapowers/scripts/ultra_gate.py` (Task 5) change, exactly as those tasks prescribe; the change is justified by the eval route (Task 6: `false_block` 1→0). `gate_check.py`, `run_lock.sh`, `collect_seal.py`, `seal_hash.py`, and `skills/ultraplan/references/seal-author-prompt.md` stay byte-identical.
- **No BAKE-block changes:** every prompt-affecting edit in this plan is engine-side interpolation code, not baked prose. `tests/test_no_prompt_drift.py` must pass UNCHANGED — if it goes red, the edit touched a baked block and is wrong.
- **Receipt/args contract (verbatim keys):** `receipt.testCmd` (non-empty string, always present on a green preflight), `receipt.testCmdSource` (`"knob"` or `"detected:<rule>"`), `receipt.bootstrapCmd` (key absent when no bootstrap was supplied); args-file top-level `testCmd` always present, `bootstrapCmd` only when supplied.
- **No new redKind vocabulary:** a failed suite-gate bootstrap emits status `EXAM_BOOTSTRAP_ERROR` with NO `redKind` key, mirroring the sealed path exactly.
- **Empty commands are refused loudly** on both sides of the frozen boundary: the driver never stamps an empty `testCmd`; `--suite-gate` rejects an empty `--run` (an empty command `eval`s to exit 0 — a false green).
- **No Anthropic SDK / `ANTHROPIC_API_KEY`** in any shipped or dev script (CLAUDE.md).
- **Harness JS is sim-gated:** `waves.js` changes require `node tests/sim_workflow.mjs` to exit 0 AND print `ALL SCENARIOS PASSED`.
- Suite gate: `python3 -m pytest` green from the repo root.

---

### Task 1: Driver derives and stamps the gate inputs

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/ultra_run.py`
- Modify: `skills/ultrapowers/SKILL.md`
- Test: `tests/test_ultra_run.py`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: `detect_test_cmd(root: Path) -> tuple[str|None, str|None]` (command, rule); CLI flags `--test-cmd CMD` / `--bootstrap-cmd CMD` on the `ultra_run.py` preflight; receipt keys `testCmd` (str), `testCmdSource` (`"knob"` | `"detected:<rule>"`), `bootstrapCmd` (absent when unsupplied); args-file top-level `testCmd` (always) and `bootstrapCmd` (when supplied).

**Parallelization rationale:** the driver, harness, gate shell, and eval kit meet only at data contracts (receipt keys, CLI flags) fixed by the spec — a good engineer would draw these module boundaries with or without parallelism.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_ultra_run.py`, following its existing style (`RUN` subprocess helper, `tmp_path` git repos — see `test_happy_path_receipt` for the harness):

```python
from ultra_run import detect_test_cmd  # noqa: E402  (top of file, next to prune_run_dirs import)


def test_detect_test_cmd_ladder(tmp_path):
    # Miss: empty repo detects nothing.
    assert detect_test_cmd(tmp_path) == (None, None)
    # Each rule, lowest precedence first, then assert higher rules win.
    (tmp_path / "Cargo.toml").write_text("[package]\n")
    assert detect_test_cmd(tmp_path) == ("cargo test", "cargo-toml")
    (tmp_path / "go.mod").write_text("module x\n")
    assert detect_test_cmd(tmp_path) == ("go test ./...", "go-mod")
    (tmp_path / "Makefile").write_text("test:\n\ttrue\n")
    assert detect_test_cmd(tmp_path) == ("make test", "makefile-test")
    (tmp_path / "package.json").write_text('{"scripts": {"test": "node --test"}}')
    assert detect_test_cmd(tmp_path) == ("npm test", "package-json-npm")
    (tmp_path / "pnpm-lock.yaml").write_text("")
    assert detect_test_cmd(tmp_path) == ("pnpm test", "package-json-pnpm")
    (tmp_path / "pyproject.toml").write_text("[tool.pytest.ini_options]\n")
    assert detect_test_cmd(tmp_path) == ("python3 -m pytest", "pyproject-pytest")
    (tmp_path / "pytest.ini").write_text("[pytest]\n")
    assert detect_test_cmd(tmp_path) == ("python3 -m pytest", "pytest-ini")


def test_detect_ignores_package_json_without_test_script(tmp_path):
    (tmp_path / "package.json").write_text('{"scripts": {"build": "x"}}')
    assert detect_test_cmd(tmp_path) == (None, None)
    (tmp_path / "package.json").write_text("not json {")
    assert detect_test_cmd(tmp_path) == (None, None)


def test_preflight_stamps_detected_test_cmd(tmp_path):
    repo = make_repo(tmp_path)  # make_repo now writes pytest.ini — see the note below
    r = run_driver(repo)
    assert r.returncode == 0, r.stdout + r.stderr
    receipt = json.loads(r.stdout)
    assert receipt["testCmd"] == "python3 -m pytest"
    assert receipt["testCmdSource"] == "detected:pytest-ini"
    assert "bootstrapCmd" not in receipt
    args = json.loads((repo / ".claude/ultrapowers/run-t1/args.json").read_text())
    assert args["testCmd"] == "python3 -m pytest"
    assert "bootstrapCmd" not in args


def test_preflight_knob_wins_and_bootstrap_stamped(tmp_path):
    repo = make_repo(tmp_path)
    r = run_driver(repo, "--test-cmd", "make check", "--bootstrap-cmd", "true")
    assert r.returncode == 0, r.stdout + r.stderr
    receipt = json.loads(r.stdout)
    assert receipt["testCmd"] == "make check"
    assert receipt["testCmdSource"] == "knob"
    assert receipt["bootstrapCmd"] == "true"
    args = json.loads((repo / ".claude/ultrapowers/run-t1/args.json").read_text())
    assert args["testCmd"] == "make check"
    assert args["bootstrapCmd"] == "true"


def test_preflight_fails_closed_when_nothing_detected(tmp_path):
    repo = make_repo(tmp_path)
    (repo / "pytest.ini").unlink()
    sh(["git", "add", "-A"], cwd=repo)
    sh(["git", "commit", "-qm", "drop pytest.ini"], cwd=repo)
    r = run_driver(repo)
    assert r.returncode != 0
    receipt = json.loads(r.stdout)
    assert receipt["ok"] is False
    failing = [s for s in receipt["stages"] if not s["ok"]]
    assert failing and failing[-1]["stage"] == "test-command"
    assert "--test-cmd" in failing[-1]["detail"]
```

Two required edits to the EXISTING test helpers in the same file, so every current driver test keeps a detectable command:

1. In `make_repo`, next to the `plan.md` write, add: `(repo / "pytest.ini").write_text("[pytest]\n")` (it lands in the base commit via the existing `git add .`).
2. In `test_happy_path_receipt`, add `"test-command"` to the `for expected in (...)` stage-name tuple, and add `assert receipt["testCmd"] == "python3 -m pytest"` after the existing receipt assertions.

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_ultra_run.py -q`
Expected: FAIL — `ImportError: cannot import name 'detect_test_cmd'`.

- [ ] **Step 3: Implement `detect_test_cmd` + the `test-command` stage**

In `skills/ultrapowers/scripts/ultra_run.py`:

Add near the other helpers (module level, above `main`):

```python
def detect_test_cmd(root):
    """Deterministic test-command detection ladder (#96). File presence only,
    no LLM, no execution. Returns (command, rule) or (None, None)."""
    root = Path(root)
    if (root / "pytest.ini").is_file():
        return "python3 -m pytest", "pytest-ini"
    pyproject = root / "pyproject.toml"
    if pyproject.is_file() and "[tool.pytest" in pyproject.read_text(errors="ignore"):
        return "python3 -m pytest", "pyproject-pytest"
    pkg = root / "package.json"
    if pkg.is_file():
        try:
            scripts = json.loads(pkg.read_text()).get("scripts") or {}
        except (json.JSONDecodeError, AttributeError):
            scripts = {}
        if "test" in scripts:
            if (root / "pnpm-lock.yaml").is_file():
                return "pnpm test", "package-json-pnpm"
            if (root / "bun.lock").is_file() or (root / "bun.lockb").is_file():
                return "bun test", "package-json-bun"
            return "npm test", "package-json-npm"
    mk = root / "Makefile"
    if mk.is_file() and re.search(r"^test\s*:", mk.read_text(errors="ignore"), re.M):
        return "make test", "makefile-test"
    if (root / "go.mod").is_file():
        return "go test ./...", "go-mod"
    if (root / "Cargo.toml").is_file():
        return "cargo test", "cargo-toml"
    return None, None
```

(`import re` if not already imported.)

Add the CLI flags to the main argparse, next to the existing arguments:

```python
    ap.add_argument("--test-cmd", default=None,
                    help="run-wide suite command; wins over detection")
    ap.add_argument("--bootstrap-cmd", default=None,
                    help="per-worktree dependency install; stamped into the "
                         "receipt so the gate provisions its acceptance worktree")
```

Immediately AFTER the `compile` stage succeeds (the args file now exists) and before the `install` stage, add the `test-command` stage:

```python
    if a.test_cmd:
        test_cmd, test_src = a.test_cmd, "knob"
    else:
        test_cmd, rule = detect_test_cmd(root)
        test_src = ("detected:" + rule) if test_cmd else None
    if not stage("test-command", bool(test_cmd),
                 ("%s (%s)" % (test_cmd, test_src)) if test_cmd else
                 "no test command detected — pass --test-cmd <run-wide suite "
                 "command>; the gate refuses to run without one"):
        return bail()
    args_obj = json.loads(args_file.read_text())
    args_obj["testCmd"] = test_cmd
    if a.bootstrap_cmd:
        args_obj["bootstrapCmd"] = a.bootstrap_cmd
    args_file.write_text(json.dumps(args_obj, indent=2))
```

Extend the final `receipt.update({...})` call with:

```python
                    "testCmd": test_cmd, "testCmdSource": test_src,
```

and, only when `a.bootstrap_cmd` is set, `"bootstrapCmd": a.bootstrap_cmd` (the key must be ABSENT otherwise — use a conditional `receipt["bootstrapCmd"] = a.bootstrap_cmd` after the update call, guarded by `if a.bootstrap_cmd:`, before the receipt file is written).

- [ ] **Step 4: Update `LLM_DERIVES` in the same file**

Replace the two `testCmd`/`bootstrapCmd` entries of `LLM_DERIVES` with:

```python
    "waves[][].testCmd per task, only for polyglot plans where one task's stack "
    "differs from the run-wide command (run-wide testCmd is driver-derived — "
    "knob or detection — and already stamped in the args file and receipt)",
    "nothing for bootstrapCmd — pass --bootstrap-cmd to the preflight driver "
    "instead, so the receipt and the gate share the validated value",
```

(The `tier` entry and the review-depth entry stay verbatim.)

- [ ] **Step 5: Mirror the flow change in `skills/ultrapowers/SKILL.md`**

Two edits, matching what the driver now does:

1. In Step 2's knob checklist, replace the `**testCmd**` and `**bootstrapCmd**` bullets with:

```markdown
- **`testCmd`** — run-wide resolution moved into the driver (pass `--test-cmd`
  to `ultra_run.py`, else its deterministic detection ladder stamps it;
  `receipt.testCmd`/`receipt.testCmdSource` record the outcome). Derive only
  **per-task** `testCmd` on wave entries, for polyglot plans.
- **`bootstrapCmd`** — pass `--bootstrap-cmd` to `ultra_run.py` (per-worktree
  install for fresh worktrees); it is validated, stamped into the receipt, and
  the pre-merge gate provisions its acceptance worktree from it.
```

2. In the Step 4c args example, delete `testCmd?, bootstrapCmd?` from the merge line (both already ride the argsFile skeleton):

```
args = { ...argsFile, integrationBranch: 'ultra/integration-<stamp>', stamp,
         baseBranch, reviewProfile?, tierOverrides? }
```

- [ ] **Step 6: Run the tests**

Run: `python3 -m pytest tests/test_ultra_run.py -q`
Expected: PASS. Then `python3 -m pytest -q` — the full suite must stay green. The `make_repo` pytest.ini edit from Step 1 is what keeps the pre-existing driver tests green; if a driver test elsewhere builds its own repo without `make_repo` and now fails at the `test-command` stage, give that repo a `pytest.ini` the same way (preserving the test's original intent).

- [ ] **Step 7: Commit**

```bash
git add skills/ultrapowers/scripts/ultra_run.py skills/ultrapowers/SKILL.md tests/test_ultra_run.py
git commit -m "feat(driver): derive testCmd at preflight (knob or detection ladder), stamp receipt gate inputs (#96)"
```

---

### Task 2: Harness stamps tests.command mechanically; the critic loses authorship

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Modify: `skills/ultrapowers/references/wave-merge.md`
- Test: `tests/sim_workflow.mjs`

**Interfaces:**
- Consumes: nothing from sibling tasks (the guarantee that launches supply `testCmd` is this plan's contract, enforced here by validation).
- Produces: launch contract `args.testCmd` (mandatory, non-empty string); `report.tests.command` always equals the effective run-wide `testCmd`; completeness-critic schema without a `command` property.

**Parallelization rationale:** harness stamping is pure engine logic against the args contract; it needs no driver code, only the agreed key names.

- [ ] **Step 1: Extend the sim with two failing scenarios**

In `tests/sim_workflow.mjs`:

1. Add `testCmd: 'pnpm check'` to `baseArgs` (next to `stamp`).
2. Add two scenarios, following the existing scenario function pattern (e.g. `scenarioArgsThrow` for the throw shape, `scenarioHappy` for a full run), and register them wherever the file runs its scenario list:

```js
// #96: launching without args.testCmd must throw naming the key — the gate
// derives tests.command from the receipt, so the harness copy must exist.
async function scenarioTestCmdMissing() {
  const { testCmd, ...rest } = baseArgs
  let threw = false
  try {
    await runWorkflow({ agent: makeAgent(), args: rest, budget: bigBudget() })
  } catch (e) {
    threw = /testCmd/.test(String((e && e.message) || e))
  }
  assert(threw, 'launch without args.testCmd must throw an error naming testCmd')
  console.log('scenario testcmd-missing: OK')
}

// #96: report.tests.command is stamped mechanically from args.testCmd even when
// the completeness critic returns prose and no command field at all.
async function scenarioMechanicalTestsCommand() {
  const agent = makeAgent((label) => {
    if (label === 'integration') {
      return { testsPassed: true, onIntegrationHead: true,
               output: 'python3 -m pytest -q (553 passed) ; node tests/sim.mjs (ALL PASSED)',
               findings: [] }
    }
    return undefined
  })
  const report = await runWorkflow({ agent, args: baseArgs, budget: bigBudget() })
  eq(report.tests.command, 'pnpm check',
     'tests.command must equal args.testCmd, never critic output')
  console.log('scenario mechanical-tests-command: OK')
}
```

Adapt helper names (`bigBudget`, scenario registration) to the file's actual conventions — the assertions above are the required behavior. Update any existing scenario assertion that expects `report.tests.command` to come from the critic.

- [ ] **Step 2: Run the sim to verify the new scenarios fail**

Run: `node tests/sim_workflow.mjs`
Expected: exit 1 — `scenarioTestCmdMissing` fails (no validation exists yet).

- [ ] **Step 3: Implement the waves.js changes**

Five edits:

1. Next to the existing mandatory-args loop (`for (const k of ['pluginRoot', 'runDir'])`), add:

```js
// #96: the gate derives tests.command from the receipt; the harness copy in
// args must therefore always exist — the driver stamps it (knob or detection).
if (typeof ARGS.testCmd !== 'string' || !ARGS.testCmd.trim()) {
  throw new Error('ultrapowers: args.testCmd missing or empty. The ultra_run.py ' +
    'preflight stamps it into the argsFile — launch by spreading the receipt argsFile.')
}
```

2. Replace the `testInstruction` fallback pair (the `testCmd ? ... : ('detect and run ...')` conditional) with the single branch:

```js
// testInstruction: args.testCmd is mandatory (driver-stamped: knob or detection).
const testInstruction = 'run the project test command `' + testCmd + '`'
```

3. In `REVIEW_SCHEMA`, delete the `command: { type: 'string' },` property line (the critic no longer authors a command).

4. In the final report assembly, change the tests line to:

```js
  tests: { command: testCmd, passed: review.testsPassed, output: review.output },
```

5. In the three fallback `review`/`tests` objects (budget-exhausted early report, integration-review-error fallback, null-review guard), remove `command: undefined,` from the review fallbacks and stamp `command: testCmd` in the early-exhaust `tests:` object.

Then verify no consumer of the deleted field remains: `grep -n "review\.command" skills/ultrapowers/harnesses/waves.js` must return nothing.

- [ ] **Step 4: Update the `testInstruction` documentation prose in `wave-merge.md`**

This is surrounding prose, NOT a BAKE block. Replace the item that reads "After all merges succeed: when no `testCmd` is provided, the merge agent detects and runs the project test command (pnpm check, npm test, pytest, cargo test, or go test ./...). **When `args.testCmd` is supplied, that exact command is used instead** (set it for monorepos or custom runners; baked into `MERGE_PROMPT` / `COMPLETENESS_PROMPT` via `testInstruction`)." with:

```markdown
3. After all merges succeed the merge agent runs the project test command —
   `args.testCmd`, which the pre-launch driver always supplies (operator
   `--test-cmd` or its deterministic detection ladder; interpolated into
   `MERGE_PROMPT` / `COMPLETENESS_PROMPT` via `testInstruction`).
```

- [ ] **Step 5: Run the sim and the drift pin**

Run: `node tests/sim_workflow.mjs`
Expected: exit 0, prints `ALL SCENARIOS PASSED` (all scenarios, including the two new ones).

Run: `python3 -m pytest tests/test_no_prompt_drift.py -q`
Expected: PASS with NO changes to that test file — if it fails, a BAKE block was touched; revert and re-scope the edit to engine code.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/harnesses/waves.js skills/ultrapowers/references/wave-merge.md tests/sim_workflow.mjs
git commit -m "feat(harness): mandatory args.testCmd, mechanical report.tests.command; critic schema drops command (#96)"
```

---

### Task 3: Eval kit — jsdeps fixture + deterministic suite-bootstrap cell

**Type:** implementation
**Depends-on:** none
**Review:** lean

**Files:**
- Create: `evals/fixtures/jsdeps/project/package.json`
- Create: `evals/fixtures/jsdeps/project/.gitignore`
- Create: `evals/fixtures/jsdeps/project/deps/fixture-dep/package.json`
- Create: `evals/fixtures/jsdeps/project/deps/fixture-dep/index.js`
- Create: `evals/fixtures/jsdeps/project/test/dep.test.js`
- Modify: `evals/ab_runner.py`
- Test: `tests/test_ab_runner.py`

**Interfaces:**
- Consumes: `prepare_engine(engine_ref, root)` and `_append_row`-style row writing (both already in `evals/ab_runner.py`).
- Produces: CLI `python3 evals/ab_runner.py --cell suite-bootstrap --engine-ref <ref>`; `run_bootstrap_cell(engine_ref, root) -> dict` returning (and appending to `evals/results/runs.jsonl`) a row `{"cell": "suite-bootstrap", "engineRef": <ref>, "falseBlock": 0|1, "status": <gate status>, "at": <iso8601>}`.

**Parallelization rationale:** the cell measures engine copies pinned from git refs — it never imports this branch's other changes, so it builds against the fixture alone.

- [ ] **Step 1: Author the fixture**

`evals/fixtures/jsdeps/project/package.json`:

```json
{
  "name": "jsdeps-fixture",
  "private": true,
  "version": "1.0.0",
  "scripts": { "test": "node --test" },
  "dependencies": { "fixture-dep": "file:./deps/fixture-dep" }
}
```

`evals/fixtures/jsdeps/project/.gitignore`:

```
node_modules/
package-lock.json
```

`evals/fixtures/jsdeps/project/deps/fixture-dep/package.json`:

```json
{ "name": "fixture-dep", "version": "1.0.0", "main": "index.js" }
```

`evals/fixtures/jsdeps/project/deps/fixture-dep/index.js`:

```js
module.exports.leftpad = (s, n) => String(s).padStart(n, ' ')
```

`evals/fixtures/jsdeps/project/test/dep.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert')
const { leftpad } = require('fixture-dep')

test('dependency imports and works', () => {
  assert.strictEqual(leftpad('7', 3), '  7')
})
```

The `file:` dependency makes `npm install` fully offline and deterministic; without install, `require('fixture-dep')` fails and `npm test` is red — the exact false-BLOCKED shape.

- [ ] **Step 2: Write the failing tests for the cell**

Append to `tests/test_ab_runner.py`, following its existing import/monkeypatch style:

```python
def _stub_engine(tmp_path, script_body):
    """A fake pinned-engine dir whose run_acceptance.sh is `script_body`."""
    eng = tmp_path / "engine"
    scripts = eng / "skills/ultrapowers/scripts"
    scripts.mkdir(parents=True)
    ra = scripts / "run_acceptance.sh"
    ra.write_text(script_body)
    ra.chmod(0o755)
    return eng


GREEN_JSON = ('#!/bin/bash\n'
              'echo \'{"sealId": "(suite)", "status": "OK", "passed": true, '
              '"exitCode": 0, "output": "ok"}\'\n')
REJECT_BOOTSTRAP = ('#!/bin/bash\n'
                    'for a in "$@"; do if [ "$a" = "--bootstrap" ]; then '
                    'echo "unknown argument: --bootstrap" >&2; exit 2; fi; done\n'
                    'echo \'{"sealId": "(suite)", "status": "OK", "passed": false, '
                    '"exitCode": 1, "output": "module not found", "redKind": "assertion"}\'\n')


def _cell_root(tmp_path):
    """A miniature repo root: just enough fixture + results tree for the cell."""
    root = tmp_path / "root"
    proj = root / "evals/fixtures/jsdeps/project"
    proj.mkdir(parents=True)
    (proj / "package.json").write_text('{"name": "x", "scripts": {"test": "node --test"}}')
    (root / "evals/results").mkdir(parents=True)
    return root


def test_bootstrap_cell_green_engine_counts_zero(tmp_path, monkeypatch):
    root = _cell_root(tmp_path)
    eng = _stub_engine(tmp_path, GREEN_JSON)
    monkeypatch.setattr(ab_runner, "prepare_engine", lambda ref, r: eng)
    row = ab_runner.run_bootstrap_cell("stub-ref", root)
    assert row["cell"] == "suite-bootstrap"
    assert row["falseBlock"] == 0
    rows = [json.loads(line) for line in
            (root / "evals/results/runs.jsonl").read_text().splitlines()]
    assert rows[-1]["engineRef"] == "stub-ref"


def test_bootstrap_cell_probes_then_falls_back_without_bootstrap(tmp_path, monkeypatch):
    # REJECT_BOOTSTRAP: the first invocation exits 2 with "unknown argument:
    # --bootstrap" on stderr; the cell must retry WITHOUT the flag (that is how
    # the baseline engine's own gate would run), parse the red JSON, and count
    # the block.
    root = _cell_root(tmp_path)
    eng = _stub_engine(tmp_path, REJECT_BOOTSTRAP)
    monkeypatch.setattr(ab_runner, "prepare_engine", lambda ref, r: eng)
    row = ab_runner.run_bootstrap_cell("old-ref", root)
    assert row["falseBlock"] == 1
    assert row["status"] == "OK"
```

Import `ab_runner` at the top of the test file the same way its existing tests do (the file already imports the module). No test touches the real `evals/results/`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_ab_runner.py -q`
Expected: FAIL — `run_bootstrap_cell` does not exist.

- [ ] **Step 4: Implement the cell in `evals/ab_runner.py`**

```python
def run_bootstrap_cell(engine_ref, root):
    """Deterministic suite-gate bootstrap cell (#96) — no claude, no LLM.

    Reproduces the false-BLOCKED shape: a green JS branch whose deps need
    `npm install` in the gate's fresh detached worktree. falseBlock=1 when the
    engine's suite gate reds a genuinely green branch; 0 when it passes.
    """
    root = Path(root)
    engine = prepare_engine(engine_ref, root)
    ra = Path(engine) / "skills/ultrapowers/scripts/run_acceptance.sh"

    # Materialize the fixture as a self-contained repo with a green `work` branch.
    workdir = Path(tempfile.mkdtemp(prefix="jsdeps-cell-")) / "repo"
    shutil.copytree(root / "evals/fixtures/jsdeps/project", workdir)
    env = _git_env()
    for cmd in (["git", "init", "-b", "main"], ["git", "add", "-A"],
                ["git", "commit", "-m", "fixture"], ["git", "branch", "work"]):
        subprocess.run(cmd, cwd=workdir, env=env, check=True, capture_output=True)

    cmd = ["bash", str(ra), "--suite-gate", "--branch", "work",
           "--run", "npm test", "--base", "main", "--repo", str(workdir),
           "--bootstrap", "npm install"]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if "unknown argument: --bootstrap" in (r.stderr or ""):
        # Engine predates the flag (the baseline arm): invoke as ITS gate would.
        r = subprocess.run(cmd[:-2], capture_output=True, text=True)
    payload = json.loads(r.stdout.strip().splitlines()[-1])
    row = {"cell": "suite-bootstrap", "engineRef": engine_ref,
           "falseBlock": 0 if payload.get("passed") is True else 1,
           "status": payload.get("status"),
           "at": datetime.now(timezone.utc).isoformat()}
    _append_row({"rowsPath": str(root / RESULTS / "runs.jsonl")}, row)
    return row
```

Wire the CLI: in `main()`, add `--cell` (choices `["suite-bootstrap"]`) and make `--engine-label`/`--fixture` optional when `--cell` is given; the `--cell` path calls `run_bootstrap_cell(a.engine_ref, repo_root)` , prints the row as JSON, and exits 0. Adjust the two functions' exact plumbing (repo-root resolution, `prepare_engine` return type) to the file's existing conventions.

- [ ] **Step 5: Run the tests**

Run: `python3 -m pytest tests/test_ab_runner.py -q`
Expected: PASS. Then `python3 -m pytest -q` green.

- [ ] **Step 6: Commit**

```bash
git add evals/fixtures/jsdeps evals/ab_runner.py tests/test_ab_runner.py
git commit -m "feat(evals): jsdeps fixture + deterministic suite-bootstrap cell with falseBlock counter (#96)"
```

---

### Task 4: Suite gate consumes the bootstrap (frozen shell, eval-gated)

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/run_acceptance.sh`
- Test: `tests/test_run_acceptance.py`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: `--bootstrap CMD` in `--suite-gate` mode; a failed bootstrap emits status `EXAM_BOOTSTRAP_ERROR` (no `redKind` key); empty `--run` emits status `ERROR` and exits 1; shared `provision_worktree()` used by both the sealed exam core and the suite gate.

**Parallelization rationale:** the shell script's contract is its CLI; it changes independently of the Python gate driver that will call it.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_run_acceptance.py`, following its existing green/red exam test style (tmp git repos, invoking the script, parsing the JSON line):

```python
def _bootstrap_repo(tmp_path):
    """A repo whose suite is green ONLY after a bootstrap ran in the worktree:
    the run command asserts a file the bootstrap creates."""
    repo = tmp_path / "brepo"
    repo.mkdir()
    for cmd in (["git", "init", "-q", "-b", "main"],
                ["git", "config", "user.email", "t@t"],
                ["git", "config", "user.name", "t"]):
        subprocess.run(cmd, cwd=repo, check=True, capture_output=True)
    (repo / "README").write_text("fixture\n")
    subprocess.run(["git", "add", "."], cwd=repo, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-qm", "base"], cwd=repo, check=True, capture_output=True)
    subprocess.run(["git", "branch", "work"], cwd=repo, check=True, capture_output=True)
    return repo


def _suite_gate(repo, *extra):
    r = subprocess.run(["bash", str(SCRIPT), "--suite-gate", "--branch", "work",
                        "--repo", str(repo), *extra],
                       capture_output=True, text=True)
    return r, json.loads(r.stdout.strip().splitlines()[-1])


def test_suite_gate_bootstrap_provisions_worktree(tmp_path):
    repo = _bootstrap_repo(tmp_path)
    r, payload = _suite_gate(repo, "--run", "test -f .deps-installed",
                             "--bootstrap", "echo ok > .deps-installed")
    assert payload["passed"] is True and payload["status"] == "OK", payload
    assert r.returncode == 0


def test_suite_gate_without_bootstrap_still_reds_honestly(tmp_path):
    # The pre-#96 false-BLOCKED shape — the flag is what fixes it.
    repo = _bootstrap_repo(tmp_path)
    r, payload = _suite_gate(repo, "--run", "test -f .deps-installed")
    assert payload["passed"] is False
    assert payload["redKind"] == "assertion"
    assert r.returncode != 0


def test_suite_gate_failed_bootstrap_is_env_not_assertion(tmp_path):
    repo = _bootstrap_repo(tmp_path)
    r, payload = _suite_gate(repo, "--run", "true", "--bootstrap", "exit 7")
    assert payload["status"] == "EXAM_BOOTSTRAP_ERROR"
    assert payload["passed"] is False
    assert "redKind" not in payload
    assert r.returncode != 0


def test_suite_gate_rejects_empty_run(tmp_path):
    repo = _bootstrap_repo(tmp_path)
    r, payload = _suite_gate(repo, "--run", "")
    assert payload["status"] == "ERROR"
    assert r.returncode == 1
```

`SCRIPT` here is the module-level path to `run_acceptance.sh` — reuse the existing constant if `tests/test_run_acceptance.py` already defines one (it invokes the script today; match its name), and reuse its repo-building helper instead of `_bootstrap_repo` if an equivalent exists. The assertions are the contract.

Note on `test_suite_gate_without_bootstrap_still_reds_honestly`: `test -f` exits 1 and the suite-gate red path classifies non-zero/non-5 exits as `redKind: "assertion"` — this pins that an ABSENT bootstrap still reds exactly as today (no behavior change without the flag).

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_run_acceptance.py -q`
Expected: the four new tests FAIL (`unknown argument: --bootstrap`, and empty `--run` currently exits 0 green).

- [ ] **Step 3: Implement in `run_acceptance.sh`**

Four edits:

1. In the `--suite-gate` argument loop, add a case:

```bash
      --bootstrap) SG_BOOT="$2"; shift 2 ;;
```

2. Factor the bootstrap stanza out of `run_exam()` into a shared function defined above it, and call it from `run_exam` in place of the inline block:

```bash
provision_worktree() { # $1=worktree $2=bootstrap_cmd → P_OK/P_CODE/P_OUTPUT
  P_OK=true; P_CODE=0; P_OUTPUT=""
  [ -z "$2" ] && return 0
  P_OUTPUT="$( (cd "$1" && eval "$2") 2>&1 )"; P_CODE=$?
  [ "$P_CODE" -ne 0 ] && P_OK=false
  return 0
}
```

`run_exam`'s bootstrap branch becomes:

```bash
  provision_worktree "$EXAM_WT" "$BOOT"
  if [ "$P_OK" != true ]; then
    R_STATUS=EXAM_BOOTSTRAP_ERROR; R_PASSED=false; R_CODE=$P_CODE
    R_OUTPUT="bootstrap failed (exit $P_CODE): $BOOT
$P_OUTPUT"; return 0
  fi
```

3. In the `--suite-gate` execution block, immediately after the block opens (before the worktree is created), reject an empty run command:

```bash
  if [ -z "${SG_RUN:-}" ]; then
    emit ERROR false 2 "--suite-gate requires a non-empty --run command (an empty command evals to exit 0 — refusing a false green)"
    exit 1
  fi
```

4. In the same block, after the worktree is created and before `eval "$SG_RUN"`, provision it:

```bash
  provision_worktree "$EXAM_WT" "${SG_BOOT:-}"
  if [ "$P_OK" != true ]; then
    emit EXAM_BOOTSTRAP_ERROR false "$P_CODE" "bootstrap failed (exit $P_CODE): ${SG_BOOT}
$P_OUTPUT"
    exit 1
  fi
```

No `redKind` argument on that `emit` — the status IS the environment classification, mirroring the sealed path.

- [ ] **Step 4: Run the tests**

Run: `python3 -m pytest tests/test_run_acceptance.py -q`
Expected: PASS, including every pre-existing sealed/baseline/suite-gate test (the `run_exam` refactor must be behavior-identical). Then `python3 -m pytest -q` green.

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/run_acceptance.sh tests/test_run_acceptance.py
git commit -m "feat(gate): suite-gate consumes --bootstrap via shared provision_worktree; reject empty --run (#96, eval-gated)"
```

---

### Task 5: The gate reads the receipt, not the report

**Type:** implementation
**Depends-on:** 1, 4
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/ultra_gate.py`
- Test: `tests/test_ultra_gate.py`

**Interfaces:**
- Consumes: receipt keys `testCmd`/`bootstrapCmd` (Task 1); `--bootstrap` flag in `--suite-gate` mode (Task 4).
- Produces: suite-disposition acceptance whose command and bootstrap come exclusively from `receipt.json`; a BLOCKED verdict with a "receipt lacks testCmd" detail when the receipt predates the driver change.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_ultra_gate.py`. Import the module the way `tests/test_ultra_run.py` imports `ultra_run` (path-insert `skills/ultrapowers/scripts`), and monkeypatch `ultra_gate.sh` to capture argv without running anything:

```python
"""ultra_gate.py suite-disposition acceptance derives from the receipt (#96)."""
import json
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "skills/ultrapowers/scripts"
sys.path.insert(0, str(SCRIPTS))
import ultra_gate  # noqa: E402


class FakeProc:
    def __init__(self, code=0, out="", err=""):
        self.returncode, self.stdout, self.stderr = code, out, err


def _run_gate(root, monkeypatch, receipt_extra):
    """Drive ultra_gate.main in gate mode against a synthesized run_dir whose
    receipt carries acceptance.mode 'suite' plus receipt_extra. Stubs at the
    ultra_gate.sh boundary ONLY (git rev-parse, run_lock restore, gate_check,
    run_acceptance are all subprocesses through sh()). Returns
    (exit_code, gate_receipt_dict_or_None, run_acceptance_argv_or_None)."""
    root.mkdir(parents=True, exist_ok=True)
    run_dir = root / ".claude/ultrapowers/run-t1"
    run_dir.mkdir(parents=True)
    rcpt = {"compile": {"acceptance": {"mode": "suite"}}, "baseBranch": "main"}
    rcpt.update(receipt_extra)
    (run_dir / "receipt.json").write_text(json.dumps(rcpt))
    result = root / "result.json"
    result.write_text(json.dumps({"result": {
        "integrationBranch": "ultra/x",
        "tests": {"command": "IGNORED PROSE (553 passed)", "passed": True,
                  "output": "ok"}}}))
    calls = []

    def fake_sh(cmd, cwd=None):
        calls.append([str(c) for c in cmd])
        joined = " ".join(str(c) for c in cmd)
        if "rev-parse" in joined:
            return FakeProc(0, str(root) + "\n")
        if "run_lock.sh" in joined:
            return FakeProc(0, "")
        if "gate_check.py" in joined:
            return FakeProc(0, json.dumps({"verdict": "PASS", "checks": [], "acks": []}))
        if "run_acceptance.sh" in joined:
            return FakeProc(0, json.dumps({"sealId": "(suite)", "status": "OK",
                                           "passed": True, "exitCode": 0,
                                           "output": "ok"}))
        return FakeProc(0, "")

    monkeypatch.setattr(ultra_gate, "sh", fake_sh)
    code = ultra_gate.main(["--stamp", "t1", "--result", str(result),
                            "--repo", str(root)])
    gate_receipt_path = run_dir / "gate-receipt.json"
    gate_receipt = (json.loads(gate_receipt_path.read_text())
                    if gate_receipt_path.is_file() else None)
    ra = [c for c in calls if any("run_acceptance.sh" in x for x in c)]
    return code, gate_receipt, (ra[0] if ra else None)


def test_suite_acceptance_command_comes_from_receipt(tmp_path, monkeypatch):
    code, receipt, ra = _run_gate(tmp_path / "a", monkeypatch,
                                  {"testCmd": "make check"})
    assert ra is not None
    assert ra[ra.index("--run") + 1] == "make check"
    assert all("IGNORED PROSE" not in x for x in ra)
    assert code == 0 and receipt["verdict"] == "PASS"


def test_bootstrap_passed_through_when_receipt_has_it(tmp_path, monkeypatch):
    _, _, ra = _run_gate(tmp_path / "a", monkeypatch,
                         {"testCmd": "npm test", "bootstrapCmd": "npm install"})
    assert ra[ra.index("--bootstrap") + 1] == "npm install"
    _, _, ra2 = _run_gate(tmp_path / "b", monkeypatch, {"testCmd": "npm test"})
    assert "--bootstrap" not in ra2


def test_missing_receipt_testcmd_blocks_loudly(tmp_path, monkeypatch, capsys):
    code, _, ra = _run_gate(tmp_path / "a", monkeypatch, {})
    assert code == 1
    assert ra is None, "run_acceptance must never be invoked without a receipt testCmd"
    printed = json.loads(capsys.readouterr().out)
    assert printed["verdict"] == "BLOCKED"
    assert "receipt lacks testCmd" in printed["detail"]
```

If `ultra_gate.main`'s gate mode reads anything else from the run_dir or envelope that this synthesis omits (read the flow before writing), extend the synthesis to satisfy it — the stubbing boundary stays `ultra_gate.sh`, and the assertions above are the contract. Note the missing-testCmd path exits through `blocked()` (prints the receipt, writes no `gate-receipt.json`) — that is why the third test parses stdout.

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_ultra_gate.py -q`
Expected: FAIL — the command still comes from `report.tests.command` and no `--bootstrap` is passed.

- [ ] **Step 3: Implement in `ultra_gate.py`**

Replace the suite branch of the acceptance dispatch:

```python
    else:  # 'suite' and unmarked both bind acceptance to the committed suite
        test_cmd = run_receipt.get("testCmd") or ""
        if not test_cmd:
            return blocked(receipt, "receipt lacks testCmd — the gate derives its "
                           "inputs from the receipt (#96); re-run the ultra_run.py "
                           "preflight so testCmd is stamped before gating")
        cmd = ["bash", str(HERE / "run_acceptance.sh"), "--suite-gate",
               "--branch", str(branch), "--run", test_cmd,
               "--base", run_receipt.get("baseBranch", "main")]
        if run_receipt.get("bootstrapCmd"):
            cmd += ["--bootstrap", run_receipt["bootstrapCmd"]]
        r = sh(cmd, cwd=root)
        acceptance = {"disposition": "suite", "exit": r.returncode,
                      "output": (r.stdout + r.stderr)[-4000:]}
        acc_pass = r.returncode == 0
```

`report.tests.command` is no longer read anywhere in the file — verify: `grep -n 'tests' skills/ultrapowers/scripts/ultra_gate.py` shows no `report...tests...command` read. (If `blocked()` cannot be `return`ed from that position in `main`, mirror how the surrounding code exits with a BLOCKED receipt — the verdict, exit code 1, and detail text are the contract.)

- [ ] **Step 4: Run the tests**

Run: `python3 -m pytest tests/test_ultra_gate.py -q` then `python3 -m pytest -q`
Expected: PASS; full suite green (`test_harvest_runs.py` pins the gate-receipt SHAPE, which is unchanged).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/ultra_gate.py tests/test_ultra_gate.py
git commit -m "feat(gate): suite acceptance derives command+bootstrap from the receipt; report.tests.command no longer trusted (#96, eval-gated)"
```

---

### Task 6: Eval evidence — the false-block counter goes 1→0

**Type:** implementation
**Depends-on:** 3, 4, 5
**Review:** lean

**Files:**
- Modify: `evals/results/runs.jsonl`
- Create: `evals/results/2026-07-27-96-suite-bootstrap.md`

The runs.jsonl modification is two appended rows (one per arm), nothing else.

**Interfaces:**
- Consumes: `--cell suite-bootstrap --engine-ref <ref>` CLI (Task 3); the fixed `run_acceptance.sh`/`ultra_gate.py` on this branch (Tasks 4, 5).
- Produces: the committed eval evidence that unfreezes the periphery change (subtraction-eval doctrine: mechanical counter, hard gate).

Requires `node` ≥18 and `npm` on PATH — if either is missing, FAIL this task honestly (report it); never fake a row.

- [ ] **Step 1: Run the baseline arm (engine 0.1.12, pre-fix)**

Run: `python3 evals/ab_runner.py --cell suite-bootstrap --engine-ref f2efcd3`
Expected: printed row has `"falseBlock": 1` — the 0.1.12 gate reds the genuinely green jsdeps branch (module not found, no bootstrap consumed).

If it prints `"falseBlock": 0`, STOP: the defect did not reproduce; do not proceed to Step 2 — report the row and the raw gate JSON as the task result for the pre-merge gate to adjudicate.

- [ ] **Step 2: Run the fixed arm (this branch)**

Run: `python3 evals/ab_runner.py --cell suite-bootstrap --engine-ref HEAD`
Expected: printed row has `"falseBlock": 0` — the fixed gate provisions the worktree from `--bootstrap` and passes.

- [ ] **Step 3: Record the evidence**

Create `evals/results/2026-07-27-96-suite-bootstrap.md`:

```markdown
# #96 suite-bootstrap cell — false_block 1→0

Deterministic (no-LLM) cell per docs/superpowers/specs/2026-07-27-gate-derives-inputs.md.

| arm | engine-ref | falseBlock | status |
|-----|-----------|------------|--------|
| baseline (0.1.12) | f2efcd3 | 1 | <status from row> |
| fixed (this branch) | HEAD | 0 | OK |

Counter contract met: the cell's false-block counter went 1→0; no other cell's
counters regress (no other cells were re-run — the deterministic cell shares no
state with the A/B protocol rows); pytest suite and harness sims green on this
branch (see the plan's gate task).
```

Fill `<status from row>` with the actual recorded status.

- [ ] **Step 4: Commit**

```bash
git add evals/results/runs.jsonl evals/results/2026-07-27-96-suite-bootstrap.md
git commit -m "evals: #96 suite-bootstrap cell evidence — false_block 1→0 (baseline f2efcd3 vs fixed)"
```

---

### Task 7: Suite gate

**Type:** gate
**Depends-on:** 1, 2, 3, 4, 5, 6

Run from the repo root on the integrated tree:

- `python3 -m pytest` — the whole committed suite green.
- `node tests/sim_workflow.mjs` — exit 0 AND prints `ALL SCENARIOS PASSED` (harness JS changed in Task 2, so the suite-gate JS guard runs it regardless; this is the same bar).
- `python3 skills/ultrapowers/scripts/compile_plan.py --check docs/superpowers/plans/2026-07-27-gate-derives-inputs.md` — the plan itself stays grammar-clean.
