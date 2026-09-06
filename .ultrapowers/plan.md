# The patch capture drops untracked binaries outside a task's Files

**Grammar:** claims-v1

**Claim:** After this run, a fleet run on a Python target with no .gitignore folds its tasks
clean: the bytecode the workers' test runs leave behind never reaches a patch, and I see the
four-task run-7 shape merge instead of parking. (elicited)

**Goal:** #714. On the #694 2×2 control (target `popmechanic/ab`, run-7, fold arm) all four wave-1
implementers finished clean and the fold parked 20 conflicts, every one a `__pycache__/*.pyc`: the
target had no `.gitignore`, each implementer's pytest left bytecode in its clone,
`withPatchCapture` took the whole tree (`git add -A` + `git diff --cached --binary`), and four
patches carried the same binary paths, which the kernel cannot fold. 0/5 merged, gate BLOCKED,
fourteen minutes and twelve workers spent. The driver's capture is the one place that knows both
the task's Files and the tree; it drops what no task named and git cannot merge. The kernel is
untouched (decision of 2026-09-06: capture-side, binary by git's own detection, no artifact list).
**Closes:** #714

**Tech Stack:** Node 22 ESM (`fleet/*.mjs`), real git in the sims; the suite is
`python3 -m pytest` from the repo root, which bridges every `fleet/tests/test_*.mjs`.

**Exam command:** node {paths}

**Parallelization rationale:** one task, width 1 — the capture is one function with one exam
file; there is no second contract to split off.

## Global Constraints

- Check: `git diff --quiet $ULTRA_BASE -- skills/ultrapowers/kernel/`
- The fold kernel is not the fix: no change under `skills/ultrapowers/kernel/` (the Check above).
- A text path outside a task's Files is still captured exactly as before — the reviewers' scope
  rule is the only thing that judges it; the driver drops binaries and nothing else.
- Every existing assertion in `fleet/tests/test_run_waves.mjs` still holds; the new legs sit under
  a comment naming this task.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The capture drops untracked binaries no task named

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-waves.mjs`
- Modify: `fleet/run-main.mjs`
- Modify: `fleet/run-engine.mjs`
- Test: `fleet/tests/test_run_waves.mjs`

**Claim:** The patch the driver captures for a task carries no path outside the task's Files
block that is untracked at BASE and matches a build-artifact shape (`__pycache__/`, `*.pyc`,
`.pytest_cache/`, `node_modules/`, `dist/` — or simply: any untracked binary outside Files).
(quoted from #714)
Machine: M1. For a `worktree`-isolated reply (`impl:`, `exam:`, `fix:` labels alike), a path that
is untracked at the task's base sha, binary as `git diff --numstat` reports it (`-` for both
counts), and absent from the task's FILES list is not present in the `.patch` file the capture
writes.
M2. A binary path the task's FILES list names, and every text path whether or not FILES names
it, is present in the `.patch` file with the same content it had in the clone.
M3. When at least one path is dropped, one event `{ kind: 'capture:dropped', label, paths }` is
emitted through `onEvent`, `paths` listing every dropped path; when nothing is dropped, no such
event is emitted.
M4. Four clones cut at one base, each carrying its own text edit to one shared file plus the same
untracked `__pycache__/*.pyc` not in any FILES list, yield four patches no two of which name a
binary path in common.

**Authorized-by:** #714 (bug, fleet); the 2026-09-06 decision recorded on this plan (capture-side,
binary by git's detection, kernel untouched); the run-7 record on `popmechanic/ab`
(`refs/tags/ultra/evidence/run-7`).

**Interfaces:**
- Consumes: `patchAgainstBase({ cwd, base, out, git })`
- Consumes: `withPatchCapture({ agent, clonesDir, base, patchesDir, git, taskIdOf, cloneNameOf, onEvent })`
- Produces: nothing a sibling consumes (the `capture:dropped` event is read by the event log)

**Context:** The task's Files are already the driver's fact: the engine hands each implementer a
`FILES:` line built from the compiled task's `files` array (`filesLine` in `run-engine.mjs`), and
the same array is what the patch capture must consult — the capture wrapper is built once in
`run-main.mjs` before the engine runs, so the per-task list has to reach it by label (a lookup
the engine or `run-main` supplies), not by a second parse of the plan. "Untracked at base" is
`git ls-tree` at the task's base sha (a function of `opts` for later waves, exactly as `base`
already is), never the clone's index, because the capture stages the whole tree with `git add -A`
first. The run-7 shape this makes inexpressible: four implementers, each `python3 -m pytest` in
its clone, `app/__pycache__/registry.cpython-312.pyc` and eighteen siblings untracked at BASE,
named by no task; the legacy engine on the same fixture never met it because its workers committed
named files. A `.gitignore` on the target is the operator's workaround, not the fix — the exam's
fixture has none. Also standing: the `capture:error` event stays as it is; the new event is its
sibling in the event log, and the janitor and census read the log by `kind`, so the literal is
`capture:dropped` exactly.

**Proof:**
- Test: `fleet/tests/test_run_waves.mjs`
- Legs: (a) a clone at BASE gains a text edit to a FILES path, an untracked `__pycache__/x.pyc`
  (bytes with a NUL) outside FILES, and an untracked text file outside FILES; the captured patch
  names the text edit and the stray text file and does not name the `.pyc` — and the same tree
  captured with the pre-task whole-tree capture (the existing §4 leg) does name it, which is the
  difference the task makes — and the same clone captured again under the labels `exam:T1` and
  `fix:T1:0` yields patches that likewise do not name the `.pyc` [M1]; (b) a clone whose FILES list names `assets/logo.png` writes that
  binary plus an unnamed `build/blob.bin`: the patch carries exactly `assets/logo.png` and the text edits,
  byte-for-byte, and `build/blob.bin` is absent from it [M2]; (c) a clone that drops two unnamed binaries,
  `build/blob.bin` and `out/two.bin`, in one capture: the wrapped agent's `onEvent` receives exactly
  one `capture:dropped` event, with `label` `impl:T1` and `paths` equal to both of them, so a
  per-path event or a one-path list fails the count or the equality; and the wrapped agent receives
  no `capture:dropped` at all when the clone holds only FILES paths and text [M3]; (d) four
  clones at one BASE each edit `app/registry.py` and each hold the same untracked
  `app/__pycache__/registry.cpython-312.pyc`; the four patches, read with `git apply --numstat`,
  name no `.pyc`, and each names `app/registry.py` [M4].

**Stale-if:**
- path-absent: `fleet/run-waves.mjs`
- path-absent: `fleet/tests/test_run_waves.mjs`
- issue-closed: #714
