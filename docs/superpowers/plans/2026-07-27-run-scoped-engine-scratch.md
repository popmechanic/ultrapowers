# Run-Scoped Engine Scratch Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** All engine-generated scratch (review packets, fallback diffs) lands under the per-run directory, structurally invisible to git, with the review-package script resolved via the plugin root and a bounded run-dir lifecycle (issue #90).

**Architecture:** The driver emits two new top-level launch-args keys (`pluginRoot`, `runDir`) that the harness substitutes into its baked prompts, deleting the script-absent fallback; `review-package`'s default output moves under a self-ignoring `.claude/ultrapowers/`; the driver prunes old run dirs (keep 10) and SKILL.md's gate step deletes the run's review exhaust. Spec: `docs/superpowers/specs/2026-07-27-run-scoped-engine-scratch.md`.

**Tech Stack:** Python 3 (driver/compiler + pytest), Bash (review-package), JavaScript (waves.js harness + node sims).

**Acceptance:** suite — the committed pytest suite plus the harness sims are the verification; no seal requested (spec disposition).

## Global Constraints

- No `anthropic` SDK, no `ANTHROPIC_API_KEY`, no direct Anthropic API calls in any shipped or dev script.
- The frozen verification periphery is untouched: `gate_check.py`, `ultra_gate.py`, `run_lock.sh`, `run_acceptance.sh`, `collect_seal.py`, `seal_hash.py`, and the compiler's diagnostic vocabulary.
- Prompts are baked: edit `skills/ultrapowers/references/reviewer-prompts.md`, then re-bake the changed lines into `skills/ultrapowers/harnesses/waves.js` per `skills/ultrapowers/references/workflow-template.md`; `tests/test_no_prompt_drift.py` must stay green.
- **Fixed cross-task contract (verbatim, all sides):** the launch-args skeleton (`args.json`) carries top-level keys `"pluginRoot"` and `"runDir"`, both absolute-path strings. The prompt sources use the literal placeholder tokens `<pluginRoot>` and `<runDir>`, substituted by the harness at dispatch time. Engine exhaust lives in `<runDir>/review/`. `review-package` treats an OUTFILE argument ending in `/` as a target directory and derives its default filename inside it. The parent ignore file is `.claude/ultrapowers/.gitignore` with content exactly `*` plus newline. The driver prune keeps the newest **10** directories matching `^run-\d{8}-\d{6}$` and touches nothing else.
- `tests/sim_workflow.mjs` must keep printing `ALL SCENARIOS PASSED` on success (the suite-gate sentinel).

---

### Task 1: review-package — relocate default scratch, self-ignoring parent, directory OUTFILE

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/review-package`
- Test: `tests/test_review_package.py`

**Interfaces:**
- Consumes: nothing from other tasks (the OUTFILE-directory semantics it implements are fixed verbatim in Global Constraints).
- Produces: `review-package BASE HEAD [OUTFILE]` — unchanged signature; NEW: an OUTFILE ending in `/` is a target directory (created if absent) receiving the default-named packet `review-<base7>..<head7>.diff`; NEW: the bare-CLI default directory is `<main-repo-root>/.claude/ultrapowers/scratch/` and the script maintains `<main-repo-root>/.claude/ultrapowers/.gitignore` (content `*` + newline) whenever it resolves a default location. `.superpowers/ultra` is retired.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_review_package.py` (its `make_repo`/`run_script` helpers already exist in the file):

```python
def test_default_lands_in_claude_ultrapowers_scratch(tmp_path):
    repo, base, head = make_repo(tmp_path)
    p = run_script(repo, base, head)
    assert p.returncode == 0, p.stderr
    out_path = pathlib.Path(p.stdout.strip().splitlines()[-1])
    assert out_path.exists()
    expected_dir = (repo / ".claude" / "ultrapowers" / "scratch").resolve()
    assert out_path.resolve().parent == expected_dir
    # The parent self-ignore makes the scratch invisible to git in ANY repo.
    ignore = repo / ".claude" / "ultrapowers" / ".gitignore"
    assert ignore.read_text() == "*\n"
    status = git(repo, "status", "--porcelain").stdout
    assert status == "", f"engine scratch visible to git: {status}"
    # The old location is never created.
    assert not (repo / ".superpowers").exists()


def test_outfile_trailing_slash_is_a_target_directory(tmp_path):
    repo, base, head = make_repo(tmp_path)
    dest = tmp_path / "exhaust" / "review"
    p = run_script(repo, base, head, str(dest) + "/")
    assert p.returncode == 0, p.stderr
    out_path = pathlib.Path(p.stdout.strip().splitlines()[-1])
    assert out_path.exists()
    assert out_path.resolve().parent == dest.resolve()
    assert out_path.name.startswith("review-") and out_path.name.endswith(".diff")
    body = out_path.read_text()
    assert "# Review package:" in body and "## Commits" in body
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `python3 -m pytest tests/test_review_package.py -v -k "claude_ultrapowers or trailing_slash"`
Expected: FAIL — the default path assertion fails (script still writes `.superpowers/ultra`) and the trailing-slash case writes a file literally named with the trailing slash or errors.

- [ ] **Step 3: Implement**

In `skills/ultrapowers/scripts/review-package`, replace the OUTFILE-resolution block (the `if [ $# -eq 3 ] … fi` that currently derives `.superpowers/ultra`) with:

```bash
default_dir() {
  # Default scratch: <main-repo-root>/.claude/ultrapowers/scratch — derived from
  # the RESOLVED PARENT of --git-common-dir (identical for every linked
  # worktree, so implementer and reviewer worktrees see one shared path). The
  # parent .gitignore self-ignores (content `*`), so engine scratch is
  # structurally invisible to git status/add in ANY repo — the property the
  # old .superpowers/ location only had when superpowers' own scripts had run.
  common=$(git rev-parse --git-common-dir)
  common=$(cd "$common" && pwd)          # absolutize (handles the bare ".git" case)
  local root parent
  root="$(dirname "$common")"
  parent="$root/.claude/ultrapowers"
  mkdir -p "$parent/scratch"
  printf '*\n' > "$parent/.gitignore"
  ( cd "$parent/scratch" && pwd )
}

default_name() {
  echo "review-$(git rev-parse --short "$base")..$(git rev-parse --short "$head").diff"
}

if [ $# -eq 3 ]; then
  case $3 in
    */)
      mkdir -p "$3"
      out="$(cd "$3" && pwd)/$(default_name)"
      ;;
    *)
      out=$3
      ;;
  esac
else
  out="$(default_dir)/$(default_name)"
fi
```

Also rewrite the script's header comment: the `.superpowers/ultra` rationale paragraph is obsolete — state the new default (`<main-repo-root>/.claude/ultrapowers/scratch/`, parent self-ignored), the trailing-slash directory form, and keep the warning against a worktree-relative CWD-derived path (the shared-across-worktrees property still holds and still matters).

- [ ] **Step 4: Update the pre-existing test to the new default**

In `tests/test_review_package.py`, the existing `test_review_package_writes_to_shared_superpowers_dir_and_echoes_path` pins the old location. Rename it to `test_review_package_writes_to_shared_scratch_dir_and_echoes_path` and change its expectation:

```python
    expected_dir = (common.resolve().parent / ".claude" / "ultrapowers" / "scratch")
    assert out_path.resolve().parent == expected_dir.resolve()
```

Update the module docstring's `.superpowers/ultra` mention to `.claude/ultrapowers/scratch`, and update any other assertion in this file that references `.superpowers` (grep the file) to the new path. Do not weaken the linked-worktree sharing assertions — they must pass against the new location.

- [ ] **Step 5: Run the whole file, verify green**

Run: `python3 -m pytest tests/test_review_package.py -v`
Expected: PASS, all tests.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/scripts/review-package tests/test_review_package.py
git commit -m "feat(scratch): review-package defaults under self-ignored .claude/ultrapowers; directory OUTFILE"
```

---

### Task 2: Driver + compiler — launch-args path keys, parent self-ignore, keep-10 prune, gate-step exhaust deletion

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/ultra_run.py`
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `skills/ultrapowers/SKILL.md`
- Test: `tests/test_ultra_run.py`

**Interfaces:**
- Consumes: nothing from other tasks (the args-key names it emits are fixed verbatim in Global Constraints).
- Produces: `args.json` top-level keys `"pluginRoot": str` and `"runDir": str` (absolute paths), emitted by `compile_plan.py --run-dir <dir>` (new flag, requires `--emit-args`, pluginRoot self-derived); `prune_run_dirs(state_dir: Path, keep: int = 10) -> list[str]` in `ultra_run.py`.

**Parallelization rationale:** contract-first — the args-key names and formats are fixed in Global Constraints, so the harness-side consumer (a sibling task) builds against the contract in parallel rather than waiting on this producer.

This task carries the plan's only deletion code. The prune must be provably incapable of touching anything but engine-created run directories — that is why its name filter is a strict regex, not a prefix match, and why the test seeds decoy entries.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_ultra_run.py` (its `make_repo`/`run_driver` helpers already exist; `ROOT` is the plugin repo root):

```python
def test_args_skeleton_carries_plugin_root_and_run_dir(tmp_path):
    repo = make_repo(tmp_path)
    r = run_driver(repo)
    assert r.returncode == 0, r.stdout + r.stderr
    skel = json.loads((repo / ".claude/ultrapowers/run-t1/args.json").read_text())
    assert skel["pluginRoot"] == str(ROOT)
    assert skel["runDir"] == str((repo / ".claude/ultrapowers/run-t1").resolve())


def test_run_dir_requires_emit_args(tmp_path):
    repo = make_repo(tmp_path)
    r = sh([sys.executable, str(SCRIPTS / "compile_plan.py"), "plan.md",
            "--run-dir", str(tmp_path / "rd")], cwd=repo, check=False)
    assert r.returncode != 0
    assert "--run-dir requires --emit-args" in (r.stdout + r.stderr)


def test_state_dir_self_ignores_and_prunes_old_runs(tmp_path):
    repo = make_repo(tmp_path)
    state = repo / ".claude/ultrapowers"
    state.mkdir(parents=True)
    # 12 stale stamp-format run dirs; the 2 oldest must be pruned (keep 10).
    for day in range(10, 22):
        (state / f"run-202601{day:02d}-000000").mkdir()
    # Decoys that the prune must NEVER touch: non-matching names.
    (state / "scratch").mkdir()
    (state / "pending-abc123def456").mkdir()
    (state / "run-keepme").mkdir()          # prefix collides, format does not
    r = run_driver(repo)
    assert r.returncode == 0, r.stdout + r.stderr
    survivors = sorted(d.name for d in state.iterdir()
                       if d.name.startswith("run-2026"))
    assert len(survivors) == 10
    assert survivors[0] == "run-20260112-000000"   # the 2 oldest are gone
    assert (state / "scratch").is_dir()
    assert (state / "pending-abc123def456").is_dir()
    assert (state / "run-keepme").is_dir()
    assert (state / "run-t1").is_dir()             # the current run, untouched
    assert (state / ".gitignore").read_text() == "*\n"
    receipt = json.loads(r.stdout)
    assert any(s["stage"] == "scratch-hygiene" and s["ok"]
               for s in receipt["stages"])
```

- [ ] **Step 2: Run them to verify they fail**

Run: `python3 -m pytest tests/test_ultra_run.py -v -k "plugin_root or run_dir_requires or prunes_old"`
Expected: FAIL — `KeyError: 'pluginRoot'`, the flag-validation message missing, and 12 survivors with no `.gitignore`.

- [ ] **Step 3: Implement the compiler flag**

In `skills/ultrapowers/scripts/compile_plan.py`:

1. Add near the existing emit flags (`--emit-launch` / `--emit-args` argparse block):

```python
    ap.add_argument("--run-dir", type=Path, default=None, dest="run_dir",
                    help="absolute per-run directory; stamped into the args "
                         "skeleton as runDir (with pluginRoot) so the engine "
                         "routes all scratch there")
```

2. After the existing `--emit-args requires --emit-launch` validation, add:

```python
    if args.run_dir is not None and emit_args is None:
        sys.exit("error: --run-dir requires --emit-args (the keys ride the "
                 "launch-args skeleton)")
```

3. Where the args skeleton dict is built (the object written to the `--emit-args` path), add — with `PLUGIN_ROOT = Path(__file__).resolve().parents[3]` as a module constant if the file does not already define one (`scripts` → `ultrapowers` → `skills` → plugin root; verify against `ultra_run.py`'s `PLUGIN_ROOT = HERE.parents[2]`, which resolves to the same directory, and assert equality by eye before committing):

```python
    if args.run_dir is not None:
        skeleton["pluginRoot"] = str(PLUGIN_ROOT)
        skeleton["runDir"] = str(args.run_dir.resolve())
```

(`skeleton` here names whatever variable the file already uses for the emitted args object — match the existing name.)

- [ ] **Step 4: Implement the driver side**

In `skills/ultrapowers/scripts/ultra_run.py`:

1. Module-level, next to the existing constants:

```python
import re

RUN_DIR_RE = re.compile(r"^run-\d{8}-\d{6}$")
KEEP_RUNS = 10


def prune_run_dirs(state_dir, keep=KEEP_RUNS):
    """Keep the newest `keep` run dirs; delete older ones. Matches ONLY
    strict run-<stamp> names — everything else under the state dir
    (scratch/, pending seal dirs, operator files) is not ours to touch.
    Stamp format sorts lexicographically = chronologically."""
    if not state_dir.is_dir():
        return []
    runs = sorted(d for d in state_dir.iterdir()
                  if d.is_dir() and RUN_DIR_RE.match(d.name))
    doomed = runs[:-keep] if keep else runs
    for d in doomed:
        shutil.rmtree(d, ignore_errors=True)
    return [d.name for d in doomed]
```

2. In `main()`, immediately before `run_dir.mkdir(parents=True, exist_ok=True)`, insert:

```python
    # Scratch hygiene: the state dir self-ignores (content `*`) so every run
    # dir is structurally invisible to git in any repo, and old run records
    # are pruned keep-newest-10 (runs serialize on RUN_LOCK, so no dir here
    # is live). Exhaust (<runDir>/review) is deleted earlier, at the SKILL.md
    # gate step; this prune is the crash backstop that gives cleanup a
    # trigger even when a run died before its gate.
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / ".gitignore").write_text("*\n")
    pruned = prune_run_dirs(state_dir)
    stage("scratch-hygiene", True,
          "pruned %d old run dir(s)" % len(pruned) if pruned else "nothing to prune")
```

3. Change the `compile_plan.py` invocation to pass the run dir:

```python
    r = sh([sys.executable, str(HERE / "compile_plan.py"), str(a.plan),
            "--emit-launch", str(launch), "--emit-args", str(args_file),
            "--run-dir", str(run_dir.resolve())],
           cwd=root)
```

- [ ] **Step 5: Run the new tests, verify green; then the full driver + compiler files**

Run: `python3 -m pytest tests/test_ultra_run.py tests/test_compile_plan.py tests/test_all_plans_compile.py -v`
Expected: PASS — including every pre-existing test (the new flag is optional, so bare compiles are unaffected).

- [ ] **Step 6: Add the gate-step exhaust deletion line to SKILL.md**

In `skills/ultrapowers/SKILL.md`, Step 5 (`## Step 5 — Pre-merge gate (human gate)`), insert a new paragraph directly after the three exit-code bullets (`0 (PASS)` / `2 (NEEDS_ACK)` / `1 (BLOCKED)`) and before the "Render the report…" paragraph:

```markdown
Whatever the verdict, delete the run's review exhaust now —
`rm -rf .claude/ultrapowers/run-<stamp>/review` — the packets are regenerable
from the BASE/HEAD shas recorded in the report; the run's records
(transcripts, receipts, launch/args) stay for the viewer and later harvests.
```

- [ ] **Step 7: Full-suite sanity and commit**

Run: `python3 -m pytest -q`
Expected: PASS (no pin on the SKILL.md Step-5 wording exists; if any test fails on the new paragraph, read the failure — do not delete the paragraph without understanding the pin).

```bash
git add skills/ultrapowers/scripts/ultra_run.py skills/ultrapowers/scripts/compile_plan.py skills/ultrapowers/SKILL.md tests/test_ultra_run.py
git commit -m "feat(scratch): args carry pluginRoot/runDir; state dir self-ignores; keep-10 run prune; gate-step exhaust deletion"
```

---

### Task 3: Prompt source + harness — absolute packet path, fallback deletion, fail-loud path args

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Test: `tests/sim_workflow.mjs`

**Interfaces:**
- Consumes: nothing from other tasks at build time — the placeholder tokens, args-key names, and trailing-slash OUTFILE semantics this task writes into prompts are fixed verbatim in Global Constraints; the sim stubs `args` directly.
- Produces: the harness refuses to launch unless `args.pluginRoot` and `args.runDir` are absolute-path strings; every dispatched prompt has `<pluginRoot>`/`<runDir>` substituted with those values.

**Parallelization rationale:** contract-first — building against the Global-Constraints args contract (not a sibling's merged code) is what lets prompts/harness, driver, and script land as one three-wide wave.

- [ ] **Step 1: Write the failing sim assertions**

In `tests/sim_workflow.mjs`:

1. Extend `baseArgs` with the two new keys:

```js
const baseArgs = { waves: WAVES, integrationBranch: 'ultra/integration-sim', stamp: 'sim',
  dependencyEdges: ['A -> C'],
  pluginRoot: '/opt/plug', runDir: '/repo/.claude/ultrapowers/run-sim' }
```

2. In the existing prompt-capture scenario (the one that records `prompts['impl:A']` and asserts `WORKTREE SETUP` / `TEST COMMAND`), add:

```js
  assert(prompts['impl:A'].includes('bash /opt/plug/skills/ultrapowers/scripts/review-package'),
    'packet script is resolved via pluginRoot, not repo-relative')
  assert(prompts['impl:A'].includes('/repo/.claude/ultrapowers/run-sim/review/'),
    'packet OUTFILE directory rides under runDir')
  assert(!prompts['impl:A'].includes('If the script is absent'),
    'script-absent fallback branch is deleted')
  assert(!prompts['impl:A'].includes('<pluginRoot>') && !prompts['impl:A'].includes('<runDir>'),
    'placeholders are substituted in dispatched prompts')
  assert(prompts['review:A:1'].includes('/repo/.claude/ultrapowers/run-sim/review/'),
    'reviewer prompt names the run scratch dir')
  assert(!prompts['review:A:1'].includes('.superpowers'),
    'old scratch location gone from reviewer prompt')
```

3. Add a new fail-loud scenario immediately after the existing fail-loud args scenarios, following their local style:

```js
// ── missing path args fail loud ──────────────────────────────────────────────
for (const missing of ['pluginRoot', 'runDir']) {
  const args = { ...baseArgs }
  delete args[missing]
  let threw = null
  try {
    await runWorkflow({ agent: makeAgent(), args, budget: { total: null, spent: () => 0, remaining: () => Infinity } })
  } catch (e) { threw = e }
  assert(threw && threw.message.includes(missing),
    'missing args.' + missing + ' must refuse to launch, naming the key')
}
```

(Match the surrounding scenarios' `budget` idiom — reuse whatever stub the neighboring scenarios pass.)

- [ ] **Step 2: Run the sim to verify it fails**

Run: `node tests/sim_workflow.mjs`
Expected: exit 1 with `SIM ASSERT FAILED: packet script is resolved via pluginRoot…` (the first new assertion).

- [ ] **Step 3: Edit the prompt source**

In `skills/ultrapowers/references/reviewer-prompts.md`:

1. Replace the implementer packet bullet (the line beginning `- Generate the review packet for your BASE..HEAD first:` — it currently names the repo-relative script path and ends `…the reviewer recovers the diff from those.`) with:

```
- Generate the review packet for your BASE..HEAD first: run bash <pluginRoot>/skills/ultrapowers/scripts/review-package <BASE> <HEAD> <runDir>/review/ (your committed HEAD; the trailing slash makes the last argument a target directory receiving the default-named packet). It writes the commits and the git diff -U10 under the run scratch dir — outside anything git tracks — and echoes the packet path as its last stdout line. Report that echoed path so the reviewer reads the exact diff you produced.
```

The old bullet's script-absent fallback sentence ("If the script is absent … the reviewer recovers the diff from those.") is deleted, not moved — the script always exists at `<pluginRoot>`.

2. In the reviewer prompt's step 1 (the line beginning `1. Read the pre-baked review packet at the path the implementer reported`), replace the parenthetical `(the commits and git diff BASE...HEAD for this task, written to the shared scratch dir under .superpowers/, outside .git/)` with `(the commits and git diff BASE...HEAD for this task, written under the run scratch dir <runDir>/review/)`. Keep the rest of the step — including the guarded read-only fallback (`git diff <BASE> <HEAD>` from the shas) — verbatim: it writes nothing and stays as engine-bypass safety.

- [ ] **Step 4: Re-bake into the harness and add validation + substitution**

In `skills/ultrapowers/harnesses/waves.js`:

1. Re-bake per `skills/ultrapowers/references/workflow-template.md`: the two lines edited in Step 3 replace their counterparts in the baked `IMPLEMENTER_PROMPT` / `REVIEWER_PROMPT` strings (currently near lines 272 and 295), byte-identical to the source so `tests/test_no_prompt_drift.py` stays green.

2. Next to the existing launch validations (the tier check that throws `…is not a tier … Refusing to launch.`), add:

```js
for (const k of ['pluginRoot', 'runDir']) {
  if (typeof ARGS[k] !== 'string' || !ARGS[k].startsWith('/')) {
    throw new Error('ultrapowers: args.' + k + ' missing or not an absolute path. ' +
      'ultra_run.py emits both keys via compile_plan.py --run-dir; a hand-authored ' +
      'salvage/redirect launch must carry them too. Refusing to launch.')
  }
}
```

3. After the baked prompt constants, define the substitution helper and apply it at every `agent(...)` dispatch whose prompt embeds the baked prompts (implementer initial dispatch, fix-round dispatch, reviewer dispatches — grep for `IMPLEMENTER_PROMPT` and `REVIEWER_PROMPT` uses):

```js
// Path placeholders are baked as literal <pluginRoot>/<runDir> tokens (so the
// prompt-drift pin sees source-identical text) and filled at dispatch time.
const fillPaths = (s) =>
  s.split('<pluginRoot>').join(ARGS.pluginRoot).split('<runDir>').join(ARGS.runDir)
```

wrapping each composed prompt string: `agent(fillPaths(<existing prompt expression>), opts)`. Do not substitute inside the schema constants — only dispatched prompt strings.

- [ ] **Step 5: Run the sim and the affected pytest pins, verify green**

Run: `node tests/sim_workflow.mjs`
Expected: `ALL SCENARIOS PASSED`, exit 0.

Run: `python3 -m pytest tests/test_no_prompt_drift.py tests/test_workflow_sim.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/references/reviewer-prompts.md skills/ultrapowers/harnesses/waves.js tests/sim_workflow.mjs
git commit -m "feat(scratch): prompts resolve review-package via pluginRoot, packets under runDir/review; fail-loud path args"
```

---

### Task 4: Suite gate

**Type:** gate
**Depends-on:** 1, 2, 3

Verification only — writes nothing.

- [ ] **Step 1: Full pytest suite**

Run: `python3 -m pytest -q`
Expected: PASS, 0 failures (548 pre-plan tests plus this plan's additions).

- [ ] **Step 2: Harness sims (the suite-gate runs these when `harnesses/*.js` changed)**

Run: `node tests/sim_workflow.mjs && node tests/wave_ancestry_sim.mjs`
Expected: both exit 0; `sim_workflow.mjs` prints `ALL SCENARIOS PASSED`.

- [ ] **Step 3: Compile self-check on this plan's own repo state**

Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers`
Expected: exit 0.
