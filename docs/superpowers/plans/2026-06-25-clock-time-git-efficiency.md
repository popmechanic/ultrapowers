# Clock-Time & Git Efficiency Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Acceptance:** suite — this is ultrapowers' own engine/script development; the author and operator read every diff, and the committed pytest suite + the `test_no_prompt_drift.py` re-bake pin are the verification. No held-out exam.

**Goal:** Cut the redundant git and dependency work that drags ultrapowers' wall-clock — chiefly the read-only reviewer paying for a worktree checkout and a dependency install it never uses — without touching the load-bearing TDD / independent-review / fix-loop / suite paradigm.

**Architecture:** Six independent fixes, each confined to one file, derived from a clock-time audit (2026-06-25). The headline fix removes the reviewer's `isolation:'worktree'` + dependency-bootstrap (the one cost that scales with repo size) and reroutes its rare fallback to a checkout-free `git diff`. The other five are localized script refactors (O(N²) sweep → single pass, per-poll git memoization, one-python3 hook install, single manifest read, hardlink try-then-fallback that also fixes a cross-device abort bug).

**Tech Stack:** Node ESM workflow (`waves.js`, baked prompts), bash scripts (POSIX / bash 3.2-compatible), Python 3 test suite (pytest).

## Global Constraints

- **Versioning stays `0.0.x`.** A release bumps **both** `.claude-plugin/plugin.json` **and** `.claude-plugin/marketplace.json` to the **same** value.
- **Prompts are baked.** Edit the SOURCE in `skills/ultrapowers/references/reviewer-prompts.md` (inside the `<!-- BAKE:NAME -->` markers), copy the changed WORDS into the matching `const` in `skills/ultrapowers/harnesses/waves.js`, and keep `tests/test_no_prompt_drift.py` green. NEVER edit only the baked copy. After any change to `waves.js`, bump `version` in `skills/ultrapowers/harnesses/waves.harness.json`.
- **No Anthropic API / SDK / `ANTHROPIC_API_KEY`** in any shipped or dev script.
- **Shell scripts must run under bash 3.2** (the macOS default): no associative arrays (`declare -A`), no bash-4-only features.
- **Do not weaken the quality paradigm.** Per-task independent review, the bounded fix-loop, TDD, the per-wave + integration suite runs, and `isolation:'worktree'` for the WRITING roles (implementer, fix) all stay. Only the READ-ONLY reviewer's worktree is removed.
- **The test gate is `python3 -m pytest`** (`pytest.ini` scopes it to `tests/`). The 5 `tests/*.mjs` viewer specs are not in CI and are unaffected by this work.

## Decomposition note

The six implementation tasks were shaped by **file seam** (ultraplan move #3): each touches a disjoint file, so all six run in one parallel wave with no contention and no `Depends-on` edges among them. No contract-first split or file split was needed — the independence is pre-existing, not manufactured, so no `**Parallelization rationale:**` lines are required. Tasks 7–9 (`gate` / `manual` / `release`) do not run in waves.

---

### Task 1: Trim redundant git + dependency work from the review path (A1 + A2 + B)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/harnesses/waves.js`, `GUARD`
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`, `GUARD`
- Modify: `skills/ultrapowers/harnesses/waves.harness.json`
- Test: `tests/test_review_dispatch_lean.py`, `tests/test_no_prompt_drift.py`

Files-note — `skills/ultrapowers/harnesses/waves.js` (reviewer dispatch `reviewOpts` + `reviewPrompt` assembly; baked `GUARD`, `REVIEWER_PROMPT`, `IMPLEMENTER_PROMPT` consts)
Files-note — `skills/ultrapowers/references/reviewer-prompts.md` (the `GUARD`, `REVIEWER_PROMPT`, `IMPLEMENTER_PROMPT` BAKE blocks — the SOURCE of truth)
Files-note — `skills/ultrapowers/harnesses/waves.harness.json` (bump `version`)
Files-note — `tests/test_review_dispatch_lean.py` (new), `tests/test_no_prompt_drift.py` (existing pin)

**Interfaces:**
- Consumes: none
- Produces: a reviewer dispatch with no `isolation:'worktree'` and no dependency/test-command lines; baked prompts whose words match their source blocks.

This task bundles three audit findings that all collide on `waves.js` + `reviewer-prompts.md`, so they share one atomic re-bake:
- **A1** — the reviewer is handed `bootstrapLine` + `testCmdLine` though it never builds or tests (a cache-miss makes it run a full `pip/bun install` just to read one diff file).
- **A2** — the reviewer is dispatched `isolation:'worktree'` (a full `git worktree add` per review pass) though its happy path only reads the pre-baked packet from the shared common git dir; its rare fallback can be a checkout-free `git diff`.
- **B** — the implementer derives its own changed-file diff up to 3× (a three-dot self-verify diff + the packet's two-dot stat); collapse the self-verify into the packet it already generates, fixing the two-dot/three-dot mismatch.

A2 is the higher-risk part (it makes reviewers non-isolated on the shared main checkout); its runtime behavior is validated by the post-merge shakedown in Task 8. The reviewer reviews the byte-identical diff either way — review is unweakened.

- [ ] **Step 1: Write the failing structural test**

Create `tests/test_review_dispatch_lean.py`:

```python
import pathlib

WAVES = pathlib.Path(__file__).resolve().parents[1] / "skills/ultrapowers/harnesses/waves.js"


def test_only_writing_roles_get_a_worktree():
    src = WAVES.read_text()
    # The implementer and the fix re-dispatch are writing roles that commit on
    # their own branch and need isolation; the read-only reviewer does NOT — it
    # reads the pre-baked packet from the shared common git dir (A2). So exactly
    # two isolation:'worktree' dispatches remain.
    assert src.count("isolation: 'worktree'") == 2


def test_reviewer_prompt_has_no_bootstrap_or_testcmd():
    src = WAVES.read_text()
    start = src.index("const reviewPrompt =")
    end = src.index("const reviewOpts", start)
    review_assembly = src[start:end]
    # The reviewer never builds or tests, so it must not be handed the dependency
    # bootstrap line or a test command (A1).
    assert "bootstrapLine" not in review_assembly
    assert "testCmdLine" not in review_assembly
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `python3 -m pytest tests/test_review_dispatch_lean.py -v`
Expected: FAIL — current `waves.js` has three `isolation: 'worktree'` dispatches and the reviewer assembly contains `bootstrapLine`/`testCmdLine`.

- [ ] **Step 3: Edit the reviewer dispatch in `waves.js` (A1 + A2, JS side)**

In the `reviewPrompt` assembly (around line 666-669), remove `testCmdLine(task) + bootstrapLine + ` so the line reads:

```js
    const reviewPrompt =
      GUARD + '\n\n' + REVIEWER_PROMPT +
      taskBodyBlock(task) + '\nBRANCH: ' + impl.branch + '\nHEAD: ' + impl.headSha +
      '\nBASE: ' + baseSha + filesLine(task) + siblingsStr + globalConstraintsBlock + interfacesLine(task)
```

In `reviewOpts` (around line 670-673), drop `isolation: 'worktree', `:

```js
    const reviewOpts = (pass) => ({
      label: 'review:' + task.id + ':' + iter + (pass ? ':' + pass : ''),
      model: REVIEWER_MODEL, schema: REVIEWER_SCHEMA,
    })
```

Leave `bootstrapLine` and `testCmdLine(task)` in the implementer dispatch (~line 637) and the fix dispatch (~line 744) — those roles build and test.

- [ ] **Step 4: Run the structural test to confirm it passes**

Run: `python3 -m pytest tests/test_review_dispatch_lean.py -v`
Expected: PASS.

- [ ] **Step 5: Edit the SOURCE prompts in `references/reviewer-prompts.md`**

**(A2) GUARD block** — replace the words:

> are READ-ONLY: they operate on a detached checkout and never write files, create commits, stage changes, or otherwise mutate any tree

with:

> are READ-ONLY: they read the diff or a detached inspection checkout and never write files, create commits, stage changes, check out or switch a branch, or otherwise mutate a working tree

(The completeness critic still detaches HEAD to inspect — "a detached inspection checkout" keeps that permitted; "check out or switch a branch" forbids the branch-switch that would corrupt concurrent reviewers sharing the main checkout.)

**(A2) REVIEWER_PROMPT block, step 1** — replace the second sentence:

> Guarded fallback: if no packet path was reported, the file is missing, or its recorded HEAD does not match the implementer HEAD, recover the diff from live git on a DETACHED checkout of the implementer HEAD (`git checkout --detach <HEAD>` — the implementer branch is locked by its worktree, so do not check the branch out) and run `git diff BASE...HEAD` yourself.

with:

> Guarded fallback: if no packet path was reported, the file is missing, or its recorded HEAD does not match the implementer HEAD, recover the diff read-only with `git diff <BASE> <HEAD>` using the BASE and HEAD shas in your inputs — both commits live in the shared object store, so this needs no checkout. You run non-isolated on the shared main checkout alongside concurrent reviewers; never check out a branch or detach any tree.

**(B) IMPLEMENTER_PROMPT block, "Self-verify before reporting"** — replace these four bullets:

> - Re-read the task. Confirm every stated requirement is addressed.
> - Run `git diff BASE...HEAD` (`BASE` is provided in your inputs) and verify no unrelated files are modified.
> - Confirm no secrets, no commented-out debug code, no TODOs introduced.
> - If `FILES` is present: confirm every file you created, modified, or deleted is named there or is plainly required by the task text. NEVER delete a file outside `FILES` — if the task seems to demand it, STOP and report `BLOCKED` explaining why.
> - As your final step, generate the review packet for your `BASE...HEAD`: run `bash skills/ultrapowers/scripts/review-package <BASE> <HEAD>` (your committed HEAD). It writes the commits and the `git diff -U10` to the shared common git dir and echoes the packet path as its last stdout line. Report that echoed path so the reviewer reads the exact diff you produced.

with:

> - Re-read the task. Confirm every stated requirement is addressed.
> - Generate the review packet for your `BASE..HEAD` first: run `bash skills/ultrapowers/scripts/review-package <BASE> <HEAD>` (your committed HEAD). It writes the commits and the `git diff -U10` to the shared common git dir and echoes the packet path as its last stdout line. Report that echoed path so the reviewer reads the exact diff you produced.
> - Read the packet's `## Files changed` section (the `git diff --stat` of your `BASE..HEAD`): verify no unrelated files are modified. If `FILES` is present, confirm every changed path is named there or is plainly required by the task text. NEVER delete a file outside `FILES` — if the task seems to demand it, STOP and report `BLOCKED` explaining why.
> - Confirm no secrets, no commented-out debug code, no TODOs introduced.

This removes the separate three-dot `git diff BASE...HEAD` and folds both the unrelated-files and FILES-scope checks into the packet's two-dot stat — one diff computation, consistent two-dot semantics.

- [ ] **Step 6: Run the drift test to confirm it now fails (source ahead of bake)**

Run: `python3 -m pytest "tests/test_no_prompt_drift.py::test_block_is_baked_into_workflow[GUARD]" "tests/test_no_prompt_drift.py::test_block_is_baked_into_workflow[REVIEWER_PROMPT]" "tests/test_no_prompt_drift.py::test_block_is_baked_into_workflow[IMPLEMENTER_PROMPT]" -v`
Expected: FAIL — the baked `waves.js` consts still carry the old words.

- [ ] **Step 7: Re-bake — copy the new words into the `waves.js` consts**

In `waves.js`, edit the `GUARD` string constant, the `REVIEWER_PROMPT` array element for step 1, and the `IMPLEMENTER_PROMPT` "Self-verify before reporting" array elements so their WORDS match the source edits from Step 5. Formatting/punctuation need not match (the drift test normalizes it away); the words must. The `GUARD` is a `+`-concatenated string (~lines 211-225); `REVIEWER_PROMPT` (~268-298) and `IMPLEMENTER_PROMPT` (~229-262) are arrays of strings joined by `'\n'` — edit the corresponding elements.

- [ ] **Step 8: Run the drift + syntax tests to confirm green**

Run: `python3 -m pytest tests/test_no_prompt_drift.py tests/test_canary.py -v`
Expected: PASS — all BAKE blocks match and `test_workflow_parses_as_js` confirms `waves.js` still parses.

- [ ] **Step 9: Bump the harness version**

In `skills/ultrapowers/harnesses/waves.harness.json`, increment the `version` field (the harness changed).

- [ ] **Step 10: Run the full suite and commit**

Run: `python3 -m pytest`
Expected: PASS (all tests).

```bash
git add skills/ultrapowers/harnesses/waves.js skills/ultrapowers/references/reviewer-prompts.md skills/ultrapowers/harnesses/waves.harness.json tests/test_review_dispatch_lean.py
git commit -m "perf(review): drop reviewer worktree+bootstrap, dedupe implementer diff"
```

---

### Task 2: Compute the worktree lock-set once in `sweep_worktrees.sh` (C)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/sweep_worktrees.sh`
- Test: `tests/test_sweep_worktrees.py`

Files-note — `skills/ultrapowers/scripts/sweep_worktrees.sh` (`is_locked` + its call site)
Files-note — `tests/test_sweep_worktrees.py` (existing characterization pin)

**Interfaces:**
- Consumes: none
- Produces: identical sweep behavior (locked worktrees kept, unlocked removed) with one `git worktree list` call instead of one per worktree.

`is_locked()` re-runs `git worktree list --porcelain` for every worktree (O(N²) git invocations, worst when a wide run leaves the most worktrees). Precompute the locked-path set once. This is a behavior-preserving refactor; the existing multi-worktree locked/unlocked test is the regression guard.

- [ ] **Step 1: Confirm the existing pin is green before refactor**

Run: `python3 -m pytest tests/test_sweep_worktrees.py -v`
Expected: PASS (baseline — establishes the behavior to preserve).

- [ ] **Step 2: Replace `is_locked` with a precomputed set**

Replace the `is_locked()` definition (around lines 66-71):

```bash
is_locked() {
  git -C "$ROOT" worktree list --porcelain | awk -v wt="$1" '
    $1 == "worktree" { cur = substr($0, 10) }
    $1 == "locked" && cur == wt { found = 1 }
    END { exit !found }'
}
```

with a one-pass precomputation plus an O(1)-ish membership test (no git per call; bash-3.2 safe — no associative arrays):

```bash
# Compute the set of locked worktree paths ONCE (a single porcelain pass) instead
# of re-running `git worktree list` for every worktree — the old per-worktree call
# was O(N^2) in worktree count, worst exactly when a wide run left the most.
LOCKED_PATHS="$(git -C "$ROOT" worktree list --porcelain | awk '
  $1 == "worktree" { cur = substr($0, 10) }
  $1 == "locked"   { print cur }')"
is_locked() {
  # Membership test against the precomputed newline-delimited set — no git call.
  printf '%s\n' "$LOCKED_PATHS" | grep -Fxq -- "$1"
}
```

The call site (`if [ "$FORCE" != "--force" ] && is_locked "$wt"; then`, ~line 88) is unchanged.

- [ ] **Step 3: Confirm behavior preserved**

Run: `python3 -m pytest tests/test_sweep_worktrees.py::test_sweep_survives_stale_dir_and_locked_worktree tests/test_sweep_worktrees.py::test_sweep_force_removes_locked_worktree -v`
Expected: PASS — locked worktree kept by default, unlocked removed, `--force` still removes locked.

- [ ] **Step 4: Run the full suite and commit**

Run: `python3 -m pytest`
Expected: PASS.

```bash
git add skills/ultrapowers/scripts/sweep_worktrees.sh
git commit -m "perf(sweep): compute worktree lock-set in one pass (was O(N^2))"
```

---

### Task 3: Memoize per-branch git in `swarm_watch.py` across polls (D)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/swarm_watch.py`
- Test: `tests/test_swarm_agents.py`

Files-note — `skills/ultrapowers/scripts/swarm_watch.py` (`snapshot`)
Files-note — `tests/test_swarm_agents.py` (add a memoization spy test)

**Interfaces:**
- Consumes: none
- Produces: `snapshot()` returns identical branch data while skipping `rev-list` / `merge-base` / `git log --numstat` for any branch whose sha and the integration sha are unchanged since the last poll.

Every poll (default 2s) recomputes `rev-list --count`, `merge-base --is-ancestor`, and a full `git log --numstat` for every branch, even unchanged ones. Off the critical path (background telemetry) but wasteful. Memoize by `(branch sha, integration sha)`.

- [ ] **Step 1: Write the failing spy test**

Add to `tests/test_swarm_agents.py` (mirrors `test_status_carries_branch_commits`'s repo setup; resets the module cache; counts the per-branch git calls across two identical polls):

```python
def test_snapshot_memoizes_per_branch_git_across_polls(tmp_path, monkeypatch):
    repo = tmp_path / "repo"
    repo.mkdir()

    def g(*a):
        return _run(["git", "-C", str(repo), *a])

    g("init", "-q"); g("config", "commit.gpgsign", "false")
    g("config", "user.name", "t"); g("config", "user.email", "t@t")
    (repo / "f.txt").write_text("base\n"); g("add", "-A"); g("commit", "-qm", "baseline")
    g("checkout", "-qb", "ultra/integration-test")
    g("worktree", "add", "-q", "-b", "worktree-wf_impl-t4",
      str(repo / ".claude/worktrees/wf_impl-t4"))
    wt = repo / ".claude/worktrees/wf_impl-t4"
    _run(["git", "config", "commit.gpgsign", "false"], cwd=wt)
    (wt / "t4.txt").write_text("one\ntwo\n")
    _run(["git", "add", "-A"], cwd=wt); _run(["git", "commit", "-qm", "feat: t4"], cwd=wt)

    swarm_watch._BRANCH_CACHE.clear()

    calls = {"per_branch": 0}
    real_git = swarm_watch.git

    def counting_git(r, *a):
        if a[:2] == ("rev-list", "--count") or a[0] == "log":
            calls["per_branch"] += 1
        return real_git(r, *a)

    real_run = swarm_watch.subprocess.run

    def counting_run(cmd, *a, **k):
        if isinstance(cmd, list) and "merge-base" in cmd:
            calls["per_branch"] += 1
        return real_run(cmd, *a, **k)

    monkeypatch.setattr(swarm_watch, "git", counting_git)
    monkeypatch.setattr(swarm_watch.subprocess, "run", counting_run)

    snap1 = swarm_watch.snapshot(repo, "ultra/integration-test")
    first = calls["per_branch"]
    assert first >= 1, "first poll should run per-branch git"

    calls["per_branch"] = 0
    snap2 = swarm_watch.snapshot(repo, "ultra/integration-test")
    assert calls["per_branch"] == 0, "unchanged branch must be served from cache"
    assert snap1["branches"] == snap2["branches"], "memoized output must match a fresh poll"
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `python3 -m pytest tests/test_swarm_agents.py::test_snapshot_memoizes_per_branch_git_across_polls -v`
Expected: FAIL — `swarm_watch._BRANCH_CACHE` does not exist, and the second poll re-runs per-branch git.

- [ ] **Step 3: Add the cache and memoize `snapshot`**

Add a module-level cache near the top of `swarm_watch.py` (with the other module constants, e.g. above `def snapshot`):

```python
# Memoize per-branch git results across polls, keyed by (branch sha, integration
# sha). A branch whose sha hasn't moved (and whose integration base hasn't moved)
# has identical ahead/merged/commits — recomputing rev-list/merge-base/log every
# 2s poll is pure waste. Unbounded by design: bounded in practice by distinct shas.
_BRANCH_CACHE = {}
```

Rewrite the branch loop in `snapshot()` (lines ~61-79) to compute the integration sha once and consult the cache:

```python
def snapshot(repo, integration):
    wts = worktrees(repo)
    wt_by_branch = {w.get("branch"): w for w in wts if w.get("branch")}

    integ_sha = git(repo, "rev-parse", integration) if integration else ""

    branches = []
    out = git(repo, "for-each-ref", "--format=%(refname:short) %(objectname)",
              "refs/heads/worktree-wf_*")
    for line in out.splitlines():
        name, sha = line.split()
        wt_path = (wt_by_branch.get(name) or {}).get("path", "")
        if integration:
            key = (name, sha, integ_sha)
            cached = _BRANCH_CACHE.get(key)
            if cached is None:
                ahead_s = git(repo, "rev-list", "--count", f"{integration}..{name}")
                ahead = int(ahead_s) if ahead_s.isdigit() else 0
                merged = subprocess.run(
                    ["git", "-C", str(repo), "merge-base", "--is-ancestor",
                     name, integration], capture_output=True).returncode == 0
                commits = branch_commits(repo, integration, name)
                cached = (ahead, merged, commits)
                _BRANCH_CACHE[key] = cached
            ahead, merged, commits = cached
            entry = {"name": name, "sha": sha, "ahead": ahead, "merged": merged,
                     "worktree": wt_path, "commits": commits}
        else:
            entry = {"name": name, "sha": sha, "ahead": 0, "merged": False,
                     "worktree": wt_path, "commits": branch_commits(repo, integration, name)}
        branches.append(entry)
```

(The rest of `snapshot()` — the `integ` block and the return value — is unchanged.)

- [ ] **Step 4: Run the spy + output-equivalence tests**

Run: `python3 -m pytest tests/test_swarm_agents.py::test_snapshot_memoizes_per_branch_git_across_polls tests/test_swarm_agents.py::test_status_carries_branch_commits -v`
Expected: PASS — second poll runs zero per-branch git calls and returns identical branch data.

- [ ] **Step 5: Run the full suite and commit**

Run: `python3 -m pytest`
Expected: PASS.

```bash
git add skills/ultrapowers/scripts/swarm_watch.py tests/test_swarm_agents.py
git commit -m "perf(swarm_watch): memoize per-branch git by (branch sha, integration sha)"
```

---

### Task 4: One python3 + cmp-guarded copy in `session_start.sh` (E)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `hooks/session_start.sh`
- Test: `tests/test_session_hook.py`

Files-note — `hooks/session_start.sh` (the harness-install loop)
Files-note — `tests/test_session_hook.py` (existing install/emit/GC pins + an idempotency test)

**Interfaces:**
- Consumes: none
- Produces: identical harness install + orphan GC + routing emit, using one python3 invocation for all manifests and skipping the copy when the installed file is byte-identical.

The hook runs on **every** interactive session start and spawns one `python3 -c` per manifest plus an unconditional 74KB `cp` of `waves.js`. Collapse to a single python3 and a `cmp`-guarded copy.

- [ ] **Step 1: Add an idempotency test (and confirm existing pins green)**

Add to `tests/test_session_hook.py` (mirrors the existing install test; runs the hook twice to exercise the cmp-skip path):

```python
def test_session_start_install_is_idempotent():
    with tempfile.TemporaryDirectory() as proj:
        for _ in range(2):
            p = subprocess.run(["bash", str(ROOT / "hooks/session_start.sh")],
                               capture_output=True, text=True,
                               env={"CLAUDE_PROJECT_DIR": proj, "PATH": _path()})
            assert p.returncode == 0, p.stderr
        wf = pathlib.Path(proj) / ".claude" / "workflows"
        for m in sorted((ROOT / "skills/ultrapowers/harnesses").glob("*.harness.json")):
            spec = json.loads(m.read_text())
            installed = wf / spec["file"]
            assert installed.exists(), f"hook did not install {spec['file']}"
            assert installed.read_text() == (ROOT / "skills/ultrapowers/harnesses" / spec["file"]).read_text()
```

Run: `python3 -m pytest tests/test_session_hook.py -v`
Expected: the new test FAILS only if the change is already half-applied; existing install/emit/GC/purity tests PASS. (Run it now to record the baseline; it should pass against current code too, since the current loop is also idempotent — it becomes the guard for the refactor.)

- [ ] **Step 2: Replace the per-manifest python3 loop with one python3 + cmp guard**

Replace the install loop (around lines 25-31):

```bash
  installed_set=""
  for m in "$harnesses"/*.harness.json; do
    [ -e "$m" ] || continue
    f="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['file'])" "$m")"
    [ -n "$f" ] && [ -e "$harnesses/$f" ] && cp "$harnesses/$f" "$dest/$f"
    [ -n "$f" ] && installed_set="$installed_set $f"
  done
```

with:

```bash
  installed_set=""
  # One python3 pass lists every manifest's `file` (was one spawn per manifest).
  files="$(python3 -c "
import glob, json, os, sys
for m in sorted(glob.glob(os.path.join(sys.argv[1], '*.harness.json'))):
    try:
        f = json.load(open(m)).get('file')
    except Exception:
        continue
    if f:
        print(f)
" "$harnesses")"
  for f in $files; do
    [ -e "$harnesses/$f" ] || continue
    # Skip the copy when the installed copy is byte-identical (the common no-change
    # session) — avoids an unconditional 74KB write of waves.js every session start.
    cmp -s "$harnesses/$f" "$dest/$f" 2>/dev/null || cp "$harnesses/$f" "$dest/$f"
    installed_set="$installed_set $f"
  done
```

The orphan-GC loop (lines ~32-39) and the `cat <<'EOF'` routing block are unchanged. (All install output already lives inside the `( ... ) >/dev/null 2>&1` subshell, so the routing-context purity pin stays green.)

- [ ] **Step 3: Confirm install, GC, purity, and idempotency**

Run: `python3 -m pytest tests/test_session_hook.py -v`
Expected: PASS — `test_session_start_installs_saved_workflows_before_registry_snapshot`, `test_session_start_gcs_stale_workflow`, `test_session_start_install_does_not_pollute_routing_context`, and the new `test_session_start_install_is_idempotent` all green.

- [ ] **Step 4: Run the full suite and commit**

Run: `python3 -m pytest`
Expected: PASS.

```bash
git add hooks/session_start.sh tests/test_session_hook.py
git commit -m "perf(session-hook): one python3 for manifests + cmp-guarded harness copy"
```

---

### Task 5: Single manifest read in `run_acceptance.sh` (F)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/run_acceptance.sh`
- Test: `tests/test_run_acceptance.py`

Files-note — `skills/ultrapowers/scripts/run_acceptance.sh` (manifest field extraction)
Files-note — `tests/test_run_acceptance.py` (existing field-parse + malformed-manifest pins)

**Interfaces:**
- Consumes: none
- Produces: the same four manifest fields (`runCmd`, `bootstrapCmd`, `framework`, `ranPattern`) parsed in one python3 pass; a missing/invalid `runCmd` still yields a clean `ERROR` (never a crash, never a false-green).

The sealed-gate path spawns four separate `python3 -c json.load(...)` processes to read four fields from one manifest. Collapse to one read while preserving the malformed-manifest guard.

- [ ] **Step 1: Confirm the existing pins are green before refactor**

Run: `python3 -m pytest tests/test_run_acceptance.py::test_non_pytest_green_suite_certifies tests/test_run_acceptance.py::test_malformed_manifest_never_false_greens -v`
Expected: PASS (baseline behavior to preserve — all four fields parsed; missing `runCmd` → `ERROR`).

- [ ] **Step 2: Replace the four python3 reads with one**

Replace lines ~164-171:

```bash
if ! RUN_CMD="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["runCmd"])' "$MANIFEST" 2>/dev/null)" \
   || [ -z "$RUN_CMD" ]; then
  emit ERROR false 1 "manifest missing or invalid runCmd: $MANIFEST"
  exit 1
fi
BOOTSTRAP_CMD="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("bootstrapCmd") or "")' "$MANIFEST" 2>/dev/null || true)"
FRAMEWORK="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("framework") or "pytest")' "$MANIFEST" 2>/dev/null || echo "pytest")"
RAN_PATTERN="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("ranPattern") or "")' "$MANIFEST" 2>/dev/null || true)"
```

with a single read into four variables (a malformed/missing manifest yields an empty `runCmd`, which the guard converts to `ERROR`):

```bash
# Read all four manifest fields in ONE python3 pass (was four json.load spawns).
# A missing/unreadable manifest or empty runCmd yields an empty first line, which
# the runCmd guard below converts to a clean ERROR — never a crash, never a false-green.
read_manifest() {
  python3 -c '
import json, sys
try:
    m = json.load(open(sys.argv[1]))
except Exception:
    m = {}
print(m.get("runCmd") or "")
print(m.get("bootstrapCmd") or "")
print(m.get("framework") or "pytest")
print(m.get("ranPattern") or "")
' "$1"
}
{ IFS= read -r RUN_CMD
  IFS= read -r BOOTSTRAP_CMD
  IFS= read -r FRAMEWORK
  IFS= read -r RAN_PATTERN
} < <(read_manifest "$MANIFEST")

if [ -z "$RUN_CMD" ]; then
  emit ERROR false 1 "manifest missing or invalid runCmd: $MANIFEST"
  exit 1
fi
```

(Each `print` emits a newline-terminated line, so all four `read`s succeed under `set -euo pipefail`.)

- [ ] **Step 3: Confirm fields parse and the malformed guard holds**

Run: `python3 -m pytest tests/test_run_acceptance.py::test_non_pytest_green_suite_certifies tests/test_run_acceptance.py::test_malformed_manifest_never_false_greens tests/test_run_acceptance.py::test_bootstrap_runs_before_suite -v`
Expected: PASS — `framework`+`ranPattern` certify a non-pytest green suite, `bootstrapCmd` still runs before the suite, and a missing-field manifest still ERRORs.

- [ ] **Step 4: Run the full suite and commit**

Run: `python3 -m pytest`
Expected: PASS.

```bash
git add skills/ultrapowers/scripts/run_acceptance.sh
git commit -m "perf(run_acceptance): read manifest fields in one python3 pass"
```

---

### Task 6: Hardlink try-then-fallback in `warm_cache.sh` (G)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/warm_cache.sh`
- Test: `tests/test_warm_cache.py`

Files-note — `skills/ultrapowers/scripts/warm_cache.sh` (`clone_tree`; delete `cp_al_supported` + `_CP_AL`)
Files-note — `tests/test_warm_cache.py` (add a cross-device-fallback test)

**Interfaces:**
- Consumes: none
- Produces: `clone_tree` attempts a hardlink-clone and falls back to a deep copy on failure, so a cache directory on a different filesystem than the worktree restores successfully (exit 0) instead of aborting.

The current `clone_tree` probes `cp -al` in `$TMPDIR` (possibly a different filesystem than the real cache→worktree clone) and, because the real `cp -al` is unguarded under `set -euo pipefail`, a genuine cross-device clone **aborts the whole restore** instead of falling back. Replace the probe with try-then-fallback — fixing both the per-call probe overhead and the abort bug.

- [ ] **Step 1: Write the failing cross-device-fallback test**

Add to `tests/test_warm_cache.py` (uses the existing `run`/`make_lockfile`/`make_deps_dir` helpers; a PATH-shimmed `cp` makes the hardlink fail **only** for the worktree target — reproducing the probe-says-yes-but-real-clone-is-cross-device case):

```python
def test_restore_falls_back_when_hardlink_fails_cross_device(tmp_path):
    lock = make_lockfile(tmp_path, "bun.lock", "dep-a@1.0.0\n")
    src = make_deps_dir(tmp_path, "node_modules", {"dep-a/index.js": "A\n"})
    p = run(tmp_path, "populate", str(lock), str(src))
    assert p.returncode == 0, p.stderr

    # Shim `cp` so a hardlink-clone (`cp -al`) FAILS only when the destination is
    # the worktree target — letting any probe in a temp dir succeed. This is the
    # cross-device case: the probe's filesystem supports hardlinks but the real
    # cache->worktree clone does not.
    shim = tmp_path / "shim"
    shim.mkdir()
    (shim / "cp").write_text(
        '#!/usr/bin/env bash\n'
        'dst="${@: -1}"\n'
        'for a in "$@"; do\n'
        '  if [ "$a" = "-al" ]; then\n'
        '    case "$dst" in *fresh_worktree*) exit 1 ;; *) exec /bin/cp "$@" ;; esac\n'
        '  fi\n'
        'done\n'
        'exec /bin/cp "$@"\n')
    (shim / "cp").chmod(0o755)

    target = tmp_path / "fresh_worktree" / "node_modules"
    target.parent.mkdir(parents=True)
    p = run(tmp_path, "restore", str(lock), str(target),
            env_extra={"PATH": f"{shim}:{os.environ['PATH']}"})
    assert p.returncode == 0, p.stderr
    assert (target / "dep-a/index.js").read_text() == "A\n"
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `python3 -m pytest tests/test_warm_cache.py::test_restore_falls_back_when_hardlink_fails_cross_device -v`
Expected: FAIL — current code's probe says "yes" (succeeds in the temp dir), then the unguarded `cp -al` into the worktree fails and aborts the restore (non-zero exit).

- [ ] **Step 3: Replace the probe with try-then-fallback**

Replace `clone_tree` (lines ~39-47):

```bash
clone_tree() {
  local src="$1" dst="$2"
  mkdir -p "$dst"
  if cp_al_supported; then
    cp -al "$src/." "$dst/"
  else
    cp -aR "$src/." "$dst/"
  fi
}
```

with:

```bash
clone_tree() {
  local src="$1" dst="$2"
  mkdir -p "$dst"
  # Try a hardlink-clone (near-instant); fall back to a deep copy when hardlinks
  # are unsupported or cross-device (cache dir on a different filesystem than the
  # worktree). Try-then-fallback instead of a probe: the old probe ran in $TMPDIR
  # — possibly a different fs than the real cache->worktree clone — and, unguarded
  # under `set -e`, a genuine cross-device `cp -al` ABORTED the whole restore. This
  # attempts the real clone and recovers.
  cp -al "$src/." "$dst/" 2>/dev/null || cp -aR "$src/." "$dst/"
}
```

Then DELETE the now-unused `_CP_AL` variable and `cp_al_supported()` function (lines ~49-64).

- [ ] **Step 4: Confirm fallback works and the HIT path still restores**

Run: `python3 -m pytest tests/test_warm_cache.py::test_restore_falls_back_when_hardlink_fails_cross_device tests/test_warm_cache.py::test_populate_then_restore_hits_and_clones_files -v`
Expected: PASS — cross-device restore now falls back to a copy (exit 0, files present), and the normal hardlink HIT path still restores correct contents.

- [ ] **Step 5: Run the full suite and commit**

Run: `python3 -m pytest`
Expected: PASS.

```bash
git add skills/ultrapowers/scripts/warm_cache.sh tests/test_warm_cache.py
git commit -m "fix(warm_cache): hardlink try-then-fallback (fixes cross-device restore abort)"
```

---

### Task 7: Full suite gate

**Type:** gate

**Files:**
- Test: `tests/`

Files-note — `tests/` (the whole suite)

Verification only — writes nothing. The committed pytest suite is the acceptance authority for this `suite`-disposition plan.

- [ ] **Step 1: Run the full gate**

Run: `python3 -m pytest`
Expected: PASS — every test green, including the three new tests (`test_review_dispatch_lean.py`, the swarm memo spy, the warm_cache fallback) and all existing pins.

Note: the 5 `tests/*.mjs` viewer/sim specs are not in pytest/CI; they are unaffected by this work and need not be run.

---

### Task 8: Post-merge shakedown of the non-isolated reviewer (A2 runtime validation)

**Type:** manual

The non-isolated reviewer (Task 1, A2) changes runtime behavior that unit tests cannot exercise: whether a reviewer running on the shared main checkout correctly finds the pre-baked packet and returns verdicts, and whether concurrent reviewers leave the main checkout clean. Validate it on a real run after the plugin re-resolves.

- [ ] **Step 1:** After merge, let `/plugin` re-resolve the new version and start a **new** session (the installed plugin lags the repo until then).
- [ ] **Step 2:** Run `/ultrapowers` on a small multi-task sample plan (e.g. an `evals/fixtures/wide` plan or any 2–3-task plan with a parallel wave).
- [ ] **Step 3:** Confirm at the pre-merge gate: every task's reviewer produced a verdict (no review-stage agent errors), `git status --porcelain` on the session checkout is **empty** (no reviewer wrote to the shared tree), and `gitVerified` is true.
- [ ] **Step 4:** If any reviewer failed to read its packet or the checkout is dirty, revert the A2 portion of Task 1 (restore `isolation:'worktree'` on `reviewOpts` and the detached-checkout fallback wording) and re-bake; keep A1 (bootstrap/testCmd deletion) and B (implementer dedup), which carry no runtime risk.

---

### Task 9: Release 0.0.24

**Type:** release

Operator-gated publish ritual; carried into the post-merge runbook, not run as a wave task.

- [ ] **Step 1:** Bump `version` to `0.0.24` in **both** `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (same value).
- [ ] **Step 2:** Commit on `main`: `chore(release): 0.0.24 — review-path git/clock-time efficiency`.
- [ ] **Step 3:** Push.

---

## Self-Review

**Spec coverage:** A1 (reviewer bootstrap/testCmd) → Task 1 Steps 3,7. A2 (reviewer worktree + fallback + GUARD) → Task 1 Steps 3,5,7. B (implementer diff dedup + two-dot) → Task 1 Steps 5,7. C (sweep O(N²)) → Task 2. D (swarm_watch memo) → Task 3. E (session hook) → Task 4. F (run_acceptance) → Task 5. G (warm_cache) → Task 6. Suite gate → Task 7. A2 runtime validation → Task 8. Release → Task 9. All audit-bundle items covered.

**Placeholder scan:** none — every code step shows the exact before/after; every test step gives the exact `pytest` command and expected result.

**Type consistency:** the tasks share no code symbols (each edits a disjoint file), so there are no cross-task signatures to reconcile; `Consumes`/`Produces` are all "none"/behavioral, so the compiler will find no undeclared dependencies.

**Marker check:** every implementation task carries `**Type:** implementation` + `**Depends-on:** none`; the gate/manual/release tasks are explicitly typed; the plan carries `**Acceptance:** suite`; no preamble holds load-bearing coordination (each task body is self-contained).
