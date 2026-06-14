# Review Cycle 1 Fixes Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Acceptance:** suite — review-cycle fixes; verified by the committed test suite, not a held-out exam.

**Goal:** Close every fix-now finding from the iteration-1 three-agent review of ultrapowers 0.4.0: compiler correctness (degrade ordering, read edges, ambiguous-Files default, duplicate IDs, marker diagnostics), sweep containment, compat tripwires, baked-prompt hardening (required headSha, commit step), sim coverage gaps, and doc truth-ups across six documents.

**Architecture:** Each task is a self-contained file-cluster fix: one code/script file plus its test file, or one doc plus any test that pins it. BAKE-block edits always change both copies (reference doc + workflow.js) in the same task so `tests/test_no_prompt_drift.py` stays green. Doc tasks carry exact replacement text so no judgment is needed.

**Tech Stack:** Python 3 (pytest), Node 22 (sim), bash, markdown.

**House rules for every task:** run `python3 -m pytest tests/ -q` (full suite, must be green), `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers`, and `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan` (both must print `skill ok`) before committing. Commit on your assigned branch with a conventional message. Do not bump any version numbers.

---

### Task 1: Compiler correctness — degrade ordering, read edges, ambiguous Files, duplicate IDs, marker diagnostics

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `tests/test_compile_plan.py`

Five verified bugs in the deterministic compiler. Fix each test-first. The current file is ~236 lines; line references below are to the current version.

**Bug A — sequential degrade discards the DAG.** At the degrade branch (`if len(impl) <= 2 or fully_overlapping:`), `waves = [[t["id"]] for t in impl]` re-derives waves from document order, throwing away the Kahn layering already computed by `layer(impl, edges)` two lines above. A 2-task plan where Task 1 carries a `Depends-on` marker naming task 2 emits `waves: [["1"],["2"]]` — executing the dependent before its prerequisite. Fix: flatten the already-computed topological layering instead: `waves = [[tid] for wave in waves for tid in wave]`.

**Bug B — `Test:` paths are parsed then dropped.** `FILE_LINE` matches `Test:` but `parse_task` only handles `Create`/`Modify`. The documented contract (dependency-analysis.md "reads") says a task that `Test:`s a path another task writes must depend on the writer. Fix: collect `Test:` paths into a `reads` list (same `PATH_RE` extraction and `:line-range` stripping as writes); in `build_edges`, for every ordered pair (a, b), add edge `a → b` with `"why": "read-after-write"` when `set(a["writes"]) & set(b["reads"])` is non-empty (no document-order condition — same rationale as write-after-create: you cannot test a file that does not exist).

**Bug C — the ambiguous-Files conservative default is documented but unimplemented.** An `implementation` task whose Files block is missing, empty, or contains glob paths currently gets zero edges and runs in wave 0 in parallel with everything. Fix: in `parse_task`, set `files_ambiguous=True` when (no creates AND no modifies AND no reads were parsed) OR any parsed path contains a glob character (`*`, `?`, or `[`). In `build_edges`, for each implementation task T with `files_ambiguous`: add edge `U → T` with `"why": "ambiguous-files"` for every impl task U with `U["order"] < T["order"]`, and edge `T → U` for every U with `U["order"] > T["order"]` — this serializes T into its own wave at its document position. (Gates/release/manual tasks have already left the impl set before `build_edges`, so a `Files: none` gate is unaffected.)

**Bug D — duplicate task IDs produce a false "cycle detected" with an empty member list.** Two `### Task 1:` headings collapse in `layer()`'s indegree dict while `order` keeps both, tripping the cycle branch with no members. Fix: in `main()` immediately after `split_tasks`, detect duplicates and fail loudly:

```python
    ids = [t["id"] for t in tasks]
    dups = sorted({i for i in ids if ids.count(i) > 1})
    if dups:
        print("compile_plan: duplicate task id(s): " + ", ".join(dups) +
              " — task headings must be unique; refusing to compile.", file=sys.stderr)
        raise SystemExit(1)
```

**Bug E — explicit author intent silently vanishes.** Two cases:
1. An unparseable `**Type:**` line (`**Type:** Release`, `**Type:** implmentation`) silently falls to heuristics. Fix: in `parse_task`, when a stripped line starts with `**Type:**` but `MARKER_TYPE` does not match or its group is not in `TYPES`, record the raw remainder as `type_unparsed` (first occurrence, only when no valid `ttype` was found). In `main()`, prepend to `marker_conflicts` one entry per affected task:

```python
    type_conflicts = [
        {"task": t["id"], "edge": "",
         "note": "**Type:** " + repr(t["type_unparsed"]) + " is not a recognized type "
                 "(implementation/gate/release/manual) — marker ignored, heuristic applied"}
        for t in tasks if t.get("type_unparsed")]
```

   and emit `"marker_conflicts": type_conflicts + conflicts`.
2. A `Depends-on` entry naming a task outside the implementation set (unknown ID, or a gate/release/manual task) is silently dropped by `add()`'s membership check. Fix: in `build_edges`, in the marker-edge loop, when `d not in ids`, append a conflict instead of calling `add`:

```python
                conflicts.append({
                    "task": t["id"],
                    "edge": d + " -> " + t["id"] + " (marker)",
                    "note": "Depends-on: " + d + " names a task outside the implementation set "
                            "(unknown id or gate/release/manual) — edge dropped",
                })
```

**Also (coordinated wording):** change the existing `Depends-on: none` override note from `"Depends-on: none overridden by inferred edge (file edge wins)"` to `"Depends-on: none overridden by inferred edge (inferred edge wins)"` — the same note fires for text edges, so "file edge wins" is wrong. A sibling doc task updates plan-markers.md to the same "inferred edge wins" wording.

- [ ] **Step 1: Write the failing tests** — append to `tests/test_compile_plan.py` (existing helpers `compile_plan(path)` and `ROOT` are already there; reuse them; add a `compile_plan_raw` helper for error cases):

```python
def compile_plan_raw(path):
    return subprocess.run([sys.executable, str(COMPILER), str(path)],
                          capture_output=True, text=True)


def test_degrade_honors_marker_edges(tmp_path):
    plan = tmp_path / "dep.md"
    plan.write_text(
        "# Plan: Degrade order\n\n"
        "### Task 1: dependent\n\n**Type:** implementation\n**Depends-on:** 2\n\n"
        "**Files:**\n- Create: `one.txt`\n\n- [ ] **Step 1:** write one\n\n"
        "### Task 2: prerequisite\n\n**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Create: `two.txt`\n\n- [ ] **Step 1:** write two\n"
    )
    out = compile_plan(plan)
    assert out["mode"] == "sequential"
    assert {"from": "2", "to": "1", "why": "marker"} in out["dag_edges"]
    assert out["waves"] == [["2"], ["1"]]   # topological, not document, order


def test_test_paths_generate_read_after_write_edge(tmp_path):
    plan = tmp_path / "reads.md"
    plan.write_text(
        "# Plan: Reads\n\n"
        "### Task 1: writer\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `data.json`\n\n- [ ] **Step 1:** write data\n\n"
        "### Task 2: reader\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `reader.py`\n- Test: `data.json`\n\n- [ ] **Step 1:** consume data\n\n"
        "### Task 3: bystander\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `other.txt`\n\n- [ ] **Step 1:** write other\n"
    )
    out = compile_plan(plan)
    assert {"from": "1", "to": "2", "why": "read-after-write"} in out["dag_edges"]
    assert out["waves"] == [["1", "3"], ["2"]]


def test_missing_files_block_is_conservatively_serialized(tmp_path):
    plan = tmp_path / "ambig.md"
    plan.write_text(
        "# Plan: Ambiguous\n\n"
        "### Task 1: first\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `one.txt`\n\n- [ ] **Step 1:** write one\n\n"
        "### Task 2: mystery\n\n**Type:** implementation\n\n"
        "- [ ] **Step 1:** refactor something unspecified\n\n"
        "### Task 3: third\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `three.txt`\n\n- [ ] **Step 1:** write three\n"
    )
    out = compile_plan(plan)
    assert {"from": "1", "to": "2", "why": "ambiguous-files"} in out["dag_edges"]
    assert {"from": "2", "to": "3", "why": "ambiguous-files"} in out["dag_edges"]
    assert out["waves"] == [["1"], ["2"], ["3"]]


def test_glob_paths_are_ambiguous(tmp_path):
    plan = tmp_path / "glob.md"
    plan.write_text(
        "# Plan: Glob\n\n"
        "### Task 1: first\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `one.txt`\n\n- [ ] **Step 1:** write one\n\n"
        "### Task 2: globby\n\n**Type:** implementation\n\n"
        "**Files:**\n- Modify: `src/*.ts`\n\n- [ ] **Step 1:** sweep the sources\n"
    )
    out = compile_plan(plan)
    assert {"from": "1", "to": "2", "why": "ambiguous-files"} in out["dag_edges"]


def test_duplicate_task_ids_are_a_loud_error(tmp_path):
    plan = tmp_path / "dup.md"
    plan.write_text(
        "# Plan: Dup\n\n"
        "### Task 1: first\n\n**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n\n"
        "### Task 1: second\n\n**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    p = compile_plan_raw(plan)
    assert p.returncode == 1
    assert "duplicate task id" in p.stderr
    assert "cycle" not in p.stderr.lower()


def test_unparseable_type_marker_surfaces_conflict(tmp_path):
    plan = tmp_path / "typo.md"
    plan.write_text(
        "# Plan: Typo\n\n"
        "### Task 1: misspelled\n\n**Type:** implmentation\n\n"
        "**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n\n"
        "### Task 2: plain\n\n**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    by_id = {t["id"]: t for t in out["tasks"]}
    assert by_id["1"]["disposition"] == "implementation"
    assert by_id["1"]["heuristic"] is True
    assert any(c["task"] == "1" and "not a recognized type" in c["note"]
               for c in out["marker_conflicts"])


def test_depends_on_outside_impl_set_surfaces_conflict(tmp_path):
    plan = tmp_path / "ghost.md"
    plan.write_text(
        "# Plan: Ghost\n\n"
        "### Task 1: real\n\n**Type:** implementation\n**Depends-on:** 9\n\n"
        "**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n\n"
        "### Task 2: also real\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** b\n"
    )
    out = compile_plan(plan)
    assert not any(e["from"] == "9" for e in out["dag_edges"])
    assert any(c["task"] == "1" and "edge dropped" in c["note"] and "9" in c["note"]
               for c in out["marker_conflicts"])


def test_text_dependency_creates_edge(tmp_path):
    plan = tmp_path / "text.md"
    plan.write_text(
        "# Plan: Text\n\n"
        "### Task 1: base\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.txt`\n\n- [ ] **Step 1:** a\n\n"
        "### Task 2: follower\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.txt`\n\n- [ ] **Step 1:** Run after Task 1 lands.\n\n"
        "### Task 3: bystander\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `c.txt`\n\n- [ ] **Step 1:** c\n"
    )
    out = compile_plan(plan)
    assert {"from": "1", "to": "2", "why": "text"} in out["dag_edges"]
    assert out["waves"] == [["1", "3"], ["2"]]
```

- [ ] **Step 2: Run the new tests, confirm they fail** — `python3 -m pytest tests/test_compile_plan.py -q`. Expected: the eight new tests fail (wrong waves / missing edges / missing conflicts / wrong stderr); the four pre-existing tests still pass.
- [ ] **Step 3: Implement** all five fixes in `skills/ultrapowers/scripts/compile_plan.py` as specified above. Update the module docstring's parenthetical edge list to mention read and ambiguous-files edges.
- [ ] **Step 4: Run the full suite** — `python3 -m pytest tests/ -q`. Expected: all green (the existing marked/unmarked fixtures have no Test: lines, no text-dep phrases, and no Files-less implementation tasks, so their expected waves are unchanged).
- [ ] **Step 5: Run both validators** — `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` and `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan`. Expected: `skill ok` twice.
- [ ] **Step 6: Commit** — `git add skills/ultrapowers/scripts/compile_plan.py tests/test_compile_plan.py && git commit -m "fix: compiler honors DAG in degrade, Test: reads, ambiguous Files, dup IDs, marker diagnostics"`.

### Task 2: Sweep containment — never abort mid-sweep

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/sweep_worktrees.sh`
- Modify: `tests/test_sweep_worktrees.py`

The script runs under `set -euo pipefail`, so three verified failure modes abort it mid-sweep, leaving later worktrees unswept and the summary unprinted: (a) a stale directory under `.claude/worktrees/wf_*` that git no longer recognizes (`worktree remove` exits 128), (b) a locked worktree (needs `--force --force`), (c) under `--force`, a `worktree-wf_*` branch that is currently checked out (`branch -D` exits 1). Also: any unknown first argument is silently treated as non-force, and a merged-but-checked-out branch is misreported as "unmerged".

- [ ] **Step 1: Write the failing tests** — append to `tests/test_sweep_worktrees.py` (reuse the existing `git`, `make_repo`, `add_engine_worktree`, `branches` helpers):

```python
def test_sweep_survives_stale_dir_and_locked_worktree(tmp_path):
    repo = make_repo(tmp_path)
    # A stale plain directory git does not recognize, sorting BEFORE a real worktree.
    stale = repo / ".claude" / "worktrees" / "wf_aaa-stale"
    stale.mkdir(parents=True)
    (stale / "junk.txt").write_text("junk\n")
    wt_locked, _ = add_engine_worktree(repo, "mmm-locked", "l.txt", merge=True)
    git(repo, "worktree", "lock", str(wt_locked))
    wt_real, _ = add_engine_worktree(repo, "zzz-real", "z.txt", merge=True)

    p = subprocess.run(["bash", str(SWEEP)], cwd=repo, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert not stale.exists()
    assert not wt_locked.exists()
    assert not wt_real.exists()
    assert "swept:" in p.stdout          # the summary line printed — no mid-sweep abort


def test_sweep_force_keeps_checked_out_branch_and_finishes(tmp_path):
    repo = make_repo(tmp_path)
    add_engine_worktree(repo, "other", "o.txt", merge=False)
    # An unmerged worktree-wf_ branch checked out in the MAIN repo: -d and -D both fail.
    git(repo, "checkout", "-b", "worktree-wf_co")
    (repo / "co.txt").write_text("co\n")
    git(repo, "add", ".")
    git(repo, "commit", "-m", "co work")

    p = subprocess.run(["bash", str(SWEEP), "--force"], cwd=repo,
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert "kept (cannot delete" in p.stdout
    assert "swept:" in p.stdout                       # summary still printed
    assert branches(repo) == ["worktree-wf_co"]       # the other one was force-deleted


def test_sweep_reports_checked_out_merged_branch_distinctly(tmp_path):
    repo = make_repo(tmp_path)
    git(repo, "checkout", "-b", "worktree-wf_merged-co")   # zero commits: fully merged
    p = subprocess.run(["bash", str(SWEEP)], cwd=repo, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert "kept (merged but undeletable" in p.stdout
    assert "kept (unmerged" not in p.stdout


def test_sweep_rejects_unknown_argument(tmp_path):
    repo = make_repo(tmp_path)
    p = subprocess.run(["bash", str(SWEEP), "--froce"], cwd=repo,
                       capture_output=True, text=True)
    assert p.returncode == 2
    assert "usage" in p.stderr.lower()
```

- [ ] **Step 2: Run them, confirm they fail** — `python3 -m pytest tests/test_sweep_worktrees.py -q`. Expected: 4 new failures (non-zero rc / missing messages), 3 existing passes.
- [ ] **Step 3: Rewrite the script body** (keep the header comment block, add a usage note to it). Full new body below the header:

```bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
FORCE="${1:-}"
if [ -n "$FORCE" ] && [ "$FORCE" != "--force" ]; then
  echo "usage: sweep_worktrees.sh [--force]" >&2
  exit 2
fi

removed_worktrees=0
for wt in "$ROOT"/.claude/worktrees/wf_*; do
  [ -e "$wt" ] || continue
  # --force --force also removes locked worktrees; a stale directory git no
  # longer recognizes falls through to rm -rf. The sweep never aborts mid-loop.
  if ! git -C "$ROOT" worktree remove --force --force "$wt" 2>/dev/null; then
    rm -rf "$wt"
  fi
  removed_worktrees=$((removed_worktrees + 1))
done
git -C "$ROOT" worktree prune

deleted=0
kept=0
while IFS= read -r br; do
  [ -n "$br" ] || continue
  if git -C "$ROOT" branch -d "$br" >/dev/null 2>&1; then
    deleted=$((deleted + 1))
  elif [ "$FORCE" = "--force" ] && git -C "$ROOT" branch -D "$br" >/dev/null 2>&1; then
    deleted=$((deleted + 1))
  else
    kept=$((kept + 1))
    if [ "$FORCE" = "--force" ]; then
      echo "kept (cannot delete — likely checked out; resolve manually): $br"
    elif git -C "$ROOT" merge-base --is-ancestor "$br" HEAD 2>/dev/null; then
      echo "kept (merged but undeletable — likely checked out): $br"
    else
      echo "kept (unmerged — failed/blocked work; --force to delete): $br"
    fi
  fi
done < <(git -C "$ROOT" branch --list 'worktree-wf_*' --format='%(refname:short)')

echo "swept: $removed_worktrees worktree(s) removed, $deleted branch(es) deleted, $kept kept"
```

- [ ] **Step 4: Run the full suite** — `python3 -m pytest tests/ -q`. Expected: all green (the existing three sweep tests rely on messages this rewrite preserves: `kept (unmerged` and the `swept:` summary format).
- [ ] **Step 5: Run both validators** — `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` and `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan`. Expected: `skill ok` twice.
- [ ] **Step 6: Commit** — `git add skills/ultrapowers/scripts/sweep_worktrees.sh tests/test_sweep_worktrees.py && git commit -m "fix: sweep never aborts mid-sweep (stale dirs, locked worktrees, checked-out branches, bad args)"`.

### Task 3: Compat tripwires — numeric version sort, parser tokens, header line, prompt-file existence, continuous-execution pin

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `tests/test_superpowers_compat.py`

Five gaps in the upstream-drift tripwires. These tests skip when superpowers is not installed (existing `pytestmark` — keep it); on this machine superpowers 5.1.0 IS installed at `~/.claude/plugins/cache/claude-plugins-official/superpowers/5.1.0/`, so they all run.

- [ ] **Step 1: Make these five changes** to `tests/test_superpowers_compat.py`:

1. Replace the lexicographic sort in `installed()` (currently `key=lambda p: p.name` — `5.9.0` would sort after `5.10.0`) with a numeric version key:

```python
def _version_key(p):
    parts = p.name.split(".")
    if all(x.isdigit() for x in parts):
        return (1, tuple(int(x) for x in parts), p.name)
    return (0, (), p.name)


def installed():
    versions = sorted((p for p in CACHE.iterdir() if p.is_dir()), key=_version_key)
    assert versions, "superpowers cache exists but holds no version directory"
    return versions[-1]


def test_version_key_sorts_numerically():
    import types
    fake = lambda name: types.SimpleNamespace(name=name)
    names = ["5.9.0", "5.10.0", "5.1.0"]
    assert sorted(names, key=lambda n: _version_key(fake(n)))[-1] == "5.10.0"
```

2. Extend `HANDOFF_SKILLS` with the skills ultrapowers names at runtime handoffs and as re-bake sources: add `"using-git-worktrees"`, `"verification-before-completion"`, `"test-driven-development"`, `"requesting-code-review"`.
3. In `test_writing_plans_template_shape_unchanged`, extend the token tuple with the three Files sub-labels `compile_plan.py` parses: `"- Create:"`, `"- Modify:"`, `"- Test:"`.
4. Add a test pinning the exact header line ultraplan quotes and REPLACEs, and a test that the re-bake source prompt files still exist:

```python
def test_writing_plans_header_line_ultraplan_replaces():
    text = (installed() / "skills/writing-plans/SKILL.md").read_text()
    line = ("**For agentic workers:** REQUIRED SUB-SKILL: Use "
            "superpowers:subagent-driven-development (recommended) or "
            "superpowers:executing-plans to implement this plan task-by-task. "
            "Steps use checkbox (`- [ ]`) syntax for tracking.")
    assert line in text, (
        "writing-plans reworded the agentic-workers header — "
        "skills/ultraplan/SKILL.md quotes and REPLACEs this exact line; re-audit it")


def test_rebake_source_prompt_files_still_exist():
    for rel in ("skills/subagent-driven-development/implementer-prompt.md",
                "skills/subagent-driven-development/spec-reviewer-prompt.md",
                "skills/subagent-driven-development/code-quality-reviewer-prompt.md",
                "skills/requesting-code-review/code-reviewer.md"):
        assert (installed() / rel).exists(), (
            rel + " is gone — reviewer-prompts.md names it as a re-bake source; "
            "re-audit the re-bake procedure in workflow-template.md")
```

5. Add a test pinning subagent-driven-development's continuous-execution posture (plan-markers.md's Executor-variance section and ultrapowers SKILL.md Step 6 depend on it):

```python
def test_sdd_still_mandates_continuous_execution():
    text = (installed() / "skills/subagent-driven-development/SKILL.md").read_text()
    assert "Continuous execution" in text and "without stopping" in text, (
        "subagent-driven-development changed its continuous-execution posture — "
        "re-audit plan-markers.md Executor variance and ultrapowers SKILL.md Step 6")
```

- [ ] **Step 2: Run the compat file** — `python3 -m pytest tests/test_superpowers_compat.py -q`. Expected: all pass, none skipped (superpowers 5.1.0 is installed here).
- [ ] **Step 3: Run the full suite** — `python3 -m pytest tests/ -q`. Expected: all green.
- [ ] **Step 4: Run both validators** — `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` and `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan`. Expected: `skill ok` twice.
- [ ] **Step 5: Commit** — `git add tests/test_superpowers_compat.py && git commit -m "test: harden upstream tripwires — numeric version sort, parser tokens, header pin, prompt files, SDD posture"`.

### Task 4: Baked discipline — require headSha, add the commit step, true-up the divergence comment and fix-loop policy

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `skills/ultrapowers/workflow.js`
- Modify: `tests/test_canary.py`

CRITICAL CONSTRAINT: `tests/test_no_prompt_drift.py` asserts every `<!-- BAKE:NAME -->` block in reviewer-prompts.md appears (whitespace/formatting-normalized) inside workflow.js. Every BAKE-block edit below must therefore be made to BOTH copies with identical wording. Run that test after each edit pair.

Four fixes:

**Fix A — the implementer prompt never says to commit.** Upstream's implementer prompt has an explicit "Commit your work" step; ours relies on convention, and an implementer that leaves work uncommitted reports HEAD == BASE so the merge silently integrates nothing. In the `BAKE:IMPLEMENTER_PROMPT` block of reviewer-prompts.md, after workflow step 6 ("Run the full check suite one final time and confirm it is clean."), add:

> 7. Commit your work on your branch. The merge step integrates committed work only — `git rev-parse HEAD` must point at a commit that contains your final state; uncommitted or unstaged changes never reach the integration branch.

In workflow.js, add the matching array line after the step-6 string:

```js
  '7. Commit your work on your branch. The merge step integrates committed work only — git rev-parse HEAD must point at a commit that contains your final state; uncommitted or unstaged changes never reach the integration branch.',
```

**Fix B — `headSha` is optional in the implementer schema but the pipeline depends on it.** A missing value threads the literal string `HEAD: undefined` into the reviewer dispatch (the reviewer is told to `git checkout --detach <HEAD>`, and its GUARD then forces a BLOCKED state its schema cannot express). In BOTH copies of `IMPLEMENTER_SCHEMA` (the `BAKE:IMPLEMENTER_SCHEMA` block in reviewer-prompts.md and the constant in workflow.js), change:

```
required: ['status', 'summary', 'branch'],
```

to:

```
required: ['status', 'summary', 'branch', 'headSha'],
```

Below the schema block in reviewer-prompts.md (OUTSIDE the BAKE markers, after the existing status bullets), add: "`headSha` is required for every status, including `BLOCKED` / `NEEDS_CONTEXT` — the worktree always has a HEAD (at minimum the provided `BASE` sha), and downstream steps refuse to operate on a guessed sha."

**Fix C — stale comment attributes the merged review pass to "superpowers v5.0.6 direction".** v5.0.6 never changed subagent-driven-development's two-stage per-task review; the merged pass is a deliberate divergence from 5.1.0 (reviewer-prompts.md says so). In workflow.js, replace the comment above `REVIEWER_PROMPT`:

```js
// One independent pass merging spec-compliance + code-quality (superpowers v5.0.6
// direction: a single review loop instead of two). Always runs at most-capable.
```

with:

```js
// One independent pass merging spec-compliance + code-quality — a deliberate
// divergence from superpowers 5.1.0's two-ordered-pass mandate (see
// references/reviewer-prompts.md, "Deliberate divergence"). Always runs at most-capable.
```

**Fix D — the fix-loop policy promises an escalation round the code never had, and the cap is not logged.** In reviewer-prompts.md, "Fix-loop policy" item 4 currently reads "If the implementer returns `BLOCKED` after a fix-round re-dispatch, escalate once to the most-capable model tier. If still `BLOCKED`, mark the task `FAILED` — never silently drop a blocked task." Replace it (this section has no BAKE markers — doc-only) with:

> 4. The fix-round re-dispatch itself runs at the most-capable tier. If the implementer returns `BLOCKED` or `NEEDS_CONTEXT` after that re-dispatch, the task is marked `FAILED` (`reviewVerdict: 'blocked-after-fix'`) and surfaced at the pre-merge gate — never silently dropped.

In workflow.js, inside `runTaskInner`'s fix loop, the `if (iter === 2)` branch returns the `fix-loop-exhausted` failure without logging — wave-merge.md's "No Silent Caps" table promises a `log()`. Add as the first line inside that branch:

```js
      log('task ' + task.id + ' FAILED: fix-loop cap (2) reached with blocking issues remaining')
```

- [ ] **Step 1: Write the failing test** — add to `tests/test_canary.py`:

```python
def test_workflow_requires_headsha_and_commit_discipline():
    wf = WORKFLOW.read_text()
    assert "required: ['status', 'summary', 'branch', 'headSha']" in wf
    assert "Commit your work" in wf
    assert "fix-loop cap" in wf          # exhaustion is logged, not silent
    assert "v5.0.6 direction" not in wf  # stale upstream attribution removed
```

- [ ] **Step 2: Run it, confirm it fails** — `python3 -m pytest tests/test_canary.py -q`.
- [ ] **Step 3: Apply fixes A–D** to both files as specified.
- [ ] **Step 4: Run the drift guard and the sim** — `python3 -m pytest tests/test_no_prompt_drift.py tests/test_workflow_sim.py tests/test_canary.py -q`. Expected: all green (the sim's stub implementers already return `headSha`, so no sim change is needed here).
- [ ] **Step 5: Run the full suite** — `python3 -m pytest tests/ -q`. Expected: all green.
- [ ] **Step 6: Run both validators** — `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` and `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan`. Expected: `skill ok` twice.
- [ ] **Step 7: Commit** — `git add skills/ultrapowers/references/reviewer-prompts.md skills/ultrapowers/workflow.js tests/test_canary.py && git commit -m "fix: implementer must commit and report headSha; true-up divergence comment and fix-loop policy"`.

### Task 5: Budget early-return and sim hardening — chunk cap, transitive blocking, tautology guards

**Type:** implementation
**Depends-on:** 4

**Files:**
- Modify: `skills/ultrapowers/workflow.js`
- Modify: `tests/sim_workflow.mjs`

This task builds on the baked-discipline edits already merged into workflow.js by the prerequisite task — anchor to the integration branch state you are given (run `git rev-parse HEAD`, confirm it equals BASE) before editing.

**Fix A — a run launched with an exhausted budget still dispatches the setup agent and the opus integration reviewer.** `budgetExhausted()` is only consulted inside the wave loop. In workflow.js: move the `const budgetExhausted = () => {...}` declaration (currently just below the `CONCURRENCY` constant) UP so it sits immediately after the five report-array declarations (`taskResults` … `unfinished`), and insert directly after it, BEFORE `phase('Setup')`:

```js
// A run launched with an already-exhausted budget defers everything up front:
// dispatching setup (or the opus integration review) would spend agents on a
// run that cannot execute a single task.
if (budgetExhausted()) {
  WAVES.forEach((w) => w.forEach((t) => unfinished.push(t.id + ': deferred (budget exhausted before setup)')))
  log('budget exhausted before setup: deferring the entire run, no agents dispatched')
  return {
    integrationBranch,
    waves: WAVES.map((w) => w.map((t) => t.id)),
    dependencyEdges,
    tasks: [],
    tests: { command: undefined, passed: false, output: 'not run — budget exhausted before setup' },
    baseline: {},
    waveMerges: [],
    judgmentCalls: ['run deferred: budget exhausted before setup — no setup, task, or review agents dispatched'],
    unfinished,
    completenessFindings: [],
    blockedWaves: [],
  }
}
```

(`CONCURRENCY` stays where it is; only the `budgetExhausted` const moves.)

**Fix B — sim gaps.** Four changes to `tests/sim_workflow.mjs`:

1. **Allow a custom `parallel`:** change `runWorkflow({ agent, args, budget })` to `runWorkflow({ agent, args, budget, parallel: parallelOverride })` and use `const parallel = parallelOverride || ((thunks) => Promise.all(thunks.map((t) => t())))`.
2. **Tighten `scenarioBudgetExhausted`** (its banner says "runs nothing" but it only asserts no implementer ran — setup and integration currently DO run before Fix A): count every agent invocation and assert zero, and assert the deferral report shape:

```js
async function scenarioBudgetExhausted() {
  let agentCalls = 0
  const inner = makeAgent()
  const r = await runWorkflow({
    agent: async (prompt, opts) => { agentCalls += 1; return inner(prompt, opts) },
    args: baseArgs, budget: { total: 100, remaining: 0 },
  })
  assert(agentCalls === 0, 'budget: NO agents dispatched at all (setup and integration included)')
  eq(r.tasks, [], 'budget: no task results')
  eq(r.tests.passed, false, 'budget: tests reported not-passed (not run)')
  assert(['A', 'B', 'C'].every((id) => r.unfinished.some((u) => u.startsWith(id + ':') && /budget/.test(u))),
    'budget: every task surfaced as deferred, none silently dropped')
  assert(r.judgmentCalls.some((j) => /budget exhausted before setup/.test(j)),
    'budget: deferral recorded as a judgment call')
  console.log('scenario budget-exhausted: OK')
}
```

3. **New `scenarioChunkCap`** — a 17-task wave must be chunked so no `parallel()` batch exceeds 16, and all 17 tasks still complete:

```js
async function scenarioChunkCap() {
  const tasks = Array.from({ length: 17 }, (_, i) =>
    ({ id: 'T' + i, title: 't' + i, body: 'do ' + i, tier: 'cheap' }))
  const args = { waves: [tasks], integrationBranch: 'ultra/integration-sim', stamp: 'sim' }
  const batchSizes = []
  const parallel = (thunks) => { batchSizes.push(thunks.length); return Promise.all(thunks.map((t) => t())) }
  const r = await runWorkflow({ agent: makeAgent(), args, budget: undefined, parallel })
  assert(Math.max(...batchSizes) <= 16, 'chunkCap: no parallel batch exceeds the 16-agent engine cap')
  eq(batchSizes.reduce((a, b) => a + b, 0), 17, 'chunkCap: every task dispatched exactly once')
  eq(r.tasks.length, 17, 'chunkCap: 17 task results')
  assert(r.tasks.every((t) => t.status === 'done'), 'chunkCap: all 17 done')
  console.log('scenario chunk-cap: OK')
}
```

4. **New `scenarioTransitiveDepBlock`** — the dep-closure `grew` loop is the only fixed-point loop in workflow.js and no scenario exercises a chain. Waves `[[A, X], [B, C, Y]]`, edges `[['A','B'], ['B','C']]`; A fails via fix-loop exhaustion (its reviewer always returns a blocking issue), X and Y pass. B is blocked by the direct edge; C must be blocked TRANSITIVELY (B never ran — only the closure can block C):

```js
async function scenarioTransitiveDepBlock() {
  const implCalled = new Set()
  const waves = [
    [
      { id: 'A', title: 'task A', body: 'do A', tier: 'cheap' },
      { id: 'X', title: 'task X', body: 'do X', tier: 'cheap' },
    ],
    [
      { id: 'B', title: 'task B', body: 'do B', tier: 'cheap' },
      { id: 'C', title: 'task C', body: 'do C', tier: 'cheap' },
      { id: 'Y', title: 'task Y', body: 'do Y', tier: 'cheap' },
    ],
  ]
  const args = { waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim',
                 edges: [['A', 'B'], ['B', 'C']] }
  const r = await runWorkflow({
    agent: makeAgent((label) => {
      if (label.startsWith('impl:') || label.startsWith('fix:')) {
        implCalled.add(taskIdFromLabel(label))
        return undefined            // fall through to the default DONE stub
      }
      if (label.startsWith('review:') && taskIdFromLabel(label) === 'A') {
        return { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'always broken' }] }
      }
      return undefined
    }),
    args, budget: undefined,
  })
  assert(!implCalled.has('B'), 'transitive: direct dependent B never dispatched')
  assert(!implCalled.has('C'), 'transitive: TRANSITIVE dependent C never dispatched')
  assert(implCalled.has('Y'), 'transitive: unrelated sibling Y did dispatch')
  assert(r.unfinished.some((u) => /^B: blocked/.test(u)) && r.unfinished.some((u) => /^C: blocked/.test(u)),
    'transitive: B and C both surfaced in unfinished')
  const y = r.tasks.find((t) => t.task === 'Y')
  eq(y && y.status, 'done', 'transitive: Y completed')
  console.log('scenario transitive-dep-block: OK')
}
```

5. **Tautology guard in `scenarioMetaAbsentEngine`:** the meta-stripping regex `\{[^}]*\}` stops matching if `meta` ever gains a nested object, silently turning the scenario into a re-test of the meta-present path. Immediately after `const srcWithoutMeta = SRC.replace(...)`, add: `assert(srcWithoutMeta !== SRC, 'metaAbsent: the regex actually stripped the meta block — update it if meta gained nesting')`.

Register `scenarioChunkCap()` and `scenarioTransitiveDepBlock()` in the await-list at the bottom of the file.

- [ ] **Step 1: Make the sim changes first** (Fix B), then run `node tests/sim_workflow.mjs`. Expected: FAILS — `scenarioBudgetExhausted` reports agents dispatched (setup + integration ran), because Fix A is not yet applied.
- [ ] **Step 2: Apply Fix A** to workflow.js.
- [ ] **Step 3: Re-run the sim** — `node tests/sim_workflow.mjs`. Expected: `ALL SCENARIOS PASSED`.
- [ ] **Step 4: Run the full suite** — `python3 -m pytest tests/ -q`. Expected: all green (test_no_prompt_drift unaffected: no BAKE-block text changed in this task).
- [ ] **Step 5: Run both validators** — `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` and `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan`. Expected: `skill ok` twice.
- [ ] **Step 6: Commit** — `git add skills/ultrapowers/workflow.js tests/sim_workflow.mjs && git commit -m "fix: defer entire run when budget is exhausted at launch; sim covers chunk cap, transitive blocking, meta tautology"`.

### Task 6: dependency-analysis.md truth-up — degrade semantics, read edges, ambiguous-Files, text-dep scope, cycle output

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `skills/ultrapowers/references/dependency-analysis.md`

This doc must describe the compiler as it now behaves (the prerequisite task changed it; verify against `skills/ultrapowers/scripts/compile_plan.py` on your branch). Five surgical edits. Do NOT renumber or restructure sections — `tests/test_marker_compiler.py` pins section ordering ("## Classify" before "## Build the DAG") and the strings `plan-markers.md`, `**Depends-on:**`, `additive`, `marker_conflicts`, `post-merge runbook`, `preamble`, `fence-aware`, `dispositions`, `compile_plan.py`, `derived_knobs`, `"heuristic": true` — all must survive.

1. **Reads bullet (Input section).** Replace the line "**reads** = `Test:` paths are treated as reads only — they do not generate outbound edges unless another task also writes them." with: "**reads** = `Test:` paths. A reader generates no outbound edges, but when another task writes a path this task reads, the compiler adds an edge writer → reader (`why: \"read-after-write\"`) — you cannot test a file that does not exist yet."
2. **Build the DAG.** Add a rule 5 after rule 4: "5. **Read-after-write:** A's `writes` set shares a path with B's `reads` set → edge A → B. Like write-after-create, this applies regardless of document order." Then append to the closing paragraph of the section: "Edge `why` labels emitted by the compiler: `marker`, `write-after-create`, `write-after-write`, `read-after-write`, `text`, `ambiguous-files`."
3. **Rule 4 (text dependencies).** Replace the parenthetical "(case-insensitive, where A is the task number or title). A phase-level reference (`after phase C`) expands to an edge from every task in that phase." with: "(case-insensitive, where A is the task NUMBER exactly as written in the heading). Task titles and phase-level prose are NOT matched — convert them to `**Depends-on:**` markers on the downstream task (ultraplan authoring rule 2)."
4. **Conservative Defaults — ambiguous Files bullet.** Append to that bullet: "The compiler implements this mechanically: an `implementation` task with no parsed `Create:`/`Modify:`/`Test:` paths, or with glob characters in any path, gets `ambiguous-files` edges from every preceding implementation task AND into every following one — serializing it into its own wave at its document position."
5. **Cycle Detection.** Replace the example sentence '"Cycle detected: T3 → T5 → T3 via shared file `foo/bar.ts`."' with: 'The compiler reports the unplaceable tasks: `compile_plan: cycle detected among tasks A, B — revise the plan to break it; refusing to guess an ordering.` When hand-deriving, name the offending edges too.'
6. **Small-Plan Degrade — rewrite the whole closing paragraph.** Replace "…collapse to a single sequential wave `[[T1, T2, …, TN]]` in document order and skip worktree machinery entirely. Log the reason: `\"Sequential mode: N tasks, overlapping writes.\"` Run tasks one at a time in the main worktree." with: "…emit one single-task wave per task in topological (Kahn) order — `[[T1], [T2], …]` — so dependency edges are still honored. The run flows through the standard workflow machinery (worktrees, per-task review, per-wave merge); sequential mode simply means no two tasks ever execute concurrently. The compiler's `degrade_reason` reads `Sequential mode: N implementation tasks` (suffixed with `, fully overlapping writes` when that trigger fired)." Also change the trigger bullet "Total task count ≤ 2, **or**" to "Implementation task count ≤ 2 (counted after classification removes gates, release, and manual tasks), **or**".

- [ ] **Step 1: Apply the six edits** exactly as written.
- [ ] **Step 2: Sanity-check the claims against the code** — confirm each documented behavior exists in `skills/ultrapowers/scripts/compile_plan.py` on your branch (degrade flattening, `read-after-write`, `ambiguous-files`, the duplicate-ID error, the cycle message text). If the code differs, match the doc to the CODE and note the discrepancy in your report.
- [ ] **Step 3: Run the full suite** — `python3 -m pytest tests/ -q`. Expected: all green (test_marker_compiler.py's pinned strings all survive).
- [ ] **Step 4: Run both validators** — `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` and `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan`. Expected: `skill ok` twice.
- [ ] **Step 5: Commit** — `git add skills/ultrapowers/references/dependency-analysis.md && git commit -m "docs: dependency-analysis matches the executable compiler (degrade, reads, ambiguous Files, text deps, cycles)"`.

### Task 7: plan-markers.md truth-up — executor variance, heuristic subset note, inferred-edge wording, obligations subject

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/plan-markers.md`

CRITICAL CONSTRAINT: do NOT touch the two `<!-- BAKE:MARKER_SYNTAX -->` / `<!-- BAKE:TYPE_SEMANTICS -->` blocks — `tests/test_ultraplan_skill.py` pins them verbatim against the ultraplan skill. Also keep these pinned strings present somewhere in the file (`tests/test_marker_contract.py`): `**Type:**`, `**Depends-on:**`, all four type names, `worktree-pure`, `post-merge runbook`, `additive`, `fence-aware`, the `## Executor variance` heading, and the phrase `sequential executor` (lowercase ok).

Four edits:

1. **Executor variance — the false safety claim.** The installed subagent-driven-development 5.1.0 mandates: "**Continuous execution:** Do not pause to check in with your human partner between tasks. Execute all tasks from the plan without stopping." So the current claim that "the sequential executors keep a human in the loop at each task, so a `release` push or a `manual` owner step gets human eyes before it runs" is false — a sequential executor WILL run a release push inline without human eyes. Replace the passage "That is safe by construction, not by accident: the sequential executors keep a human in the loop at each task, so a `release` push or a `manual` owner step gets human eyes before it runs. The semantic difference to author for:" with:

   > Since superpowers 5.1.0, the sequential executors run **continuously** — subagent-driven-development explicitly instructs "Do not pause to check in with your human partner between tasks" — so a `release` push or a `manual` owner step in the plan **executes inline without fresh human eyes**. The safety comes from plan approval (the human approved exactly those steps when approving the plan) and from placement (put `release`/`manual` tasks LAST, so nothing irreversible runs before all implementation work has landed and been reviewed). When ultrapowers itself falls back to a sequential executor (SKILL.md Step 6), it withholds `release`/`manual` tasks from the handoff and carries them as the post-merge runbook instead. The semantic difference to author for:

   (A compat test pins SDD's continuous-execution line so this section gets re-audited if upstream changes posture; the ultrapowers SKILL.md Step-6 withholding rule is added by a sibling task — the sentence above is the contract both implement.)

2. **Classification heuristics — regex subset note.** After the numbered heuristic list (after the paragraph ending "applies only to tasks that classify as `implementation`."), add:

   > The executable compiler (`scripts/compile_plan.py`) implements these heuristics as a conservative regex subset: release evidence is the literal patterns `git push`, `git checkout main`, `git merge main|master`, `ssh`, `scp`, `systemctl`, and "after the branch merges" — it does not recognize provider CLIs or other deploy idioms by name. Heuristic classifications are flagged `"heuristic": true` in its output precisely so the orchestrating agent re-judges them against the full contract above.

3. **Inferred-edge wording.** In the paragraph after the marker-syntax example, replace "if inference still finds one, the file edge wins and the disagreement is surfaced in the transparency block under `marker_conflicts` — never silently dropped." with "if inference still finds one, the inferred edge wins (file or text — the compiler's conflict note names which) and the disagreement is surfaced in the transparency block under `marker_conflicts` — never silently dropped."
4. **Compile-time obligations subject.** Replace the lead-in "Whatever the classification source (marker or heuristic), the compiler MUST:" with "Whatever the classification source (marker or heuristic), the compiling agent MUST (the mechanical obligations — task splitting, fence-aware extraction, classification, edges, runbook collection — are implemented by `scripts/compile_plan.py`; preamble inlining and ordering-prose supersession remain the orchestrating agent's judgment, recorded in the transparency block):".

- [ ] **Step 1: Apply the four edits** exactly as written, leaving both BAKE blocks byte-identical.
- [ ] **Step 2: Run the full suite** — `python3 -m pytest tests/ -q`. Expected: all green (test_ultraplan_skill.py and test_marker_contract.py both pass).
- [ ] **Step 3: Run both validators** — `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` and `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan`. Expected: `skill ok` twice.
- [ ] **Step 4: Commit** — `git add skills/ultrapowers/references/plan-markers.md && git commit -m "docs: executor variance tells the truth about continuous execution; heuristic subset and edge-wording notes"`.

### Task 8: ultrapowers SKILL.md truth-up — degrade wording, Step-6 release/manual withholding, validator invocation

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`

CRITICAL CONSTRAINT: `tests/test_orchestrator_markers.py` pins many strings in this file — among them `Classify first`, `post-merge runbook`, `` `meta.name` ``, `not found`, `restore the session checkout`, `git checkout <baseBranch>`, `Tested with superpowers <semver>`, `scripts/compile_plan.py`, `ultrapowers-probe`, `tests.passed`, `git checkout <integrationBranch>`. All must survive; the edits below only touch other text.

Three edits:

1. **Step 2 degrade wording.** Replace "**Apply conservative defaults** and the **small-plan degrade** (≤2 tasks or fully overlapping writes → a single sequential wave)." with "**Apply conservative defaults** and the **small-plan degrade** (≤2 implementation tasks or fully overlapping writes → sequential mode: one single-task wave per task, in dependency order)."
2. **Step 6 — withhold release/manual tasks from the sequential fallback.** The installed subagent-driven-development 5.1.0 runs continuously ("Do not pause to check in with your human partner between tasks"), so handing it the full marked plan would execute `release` pushes and `manual` owner steps inline without fresh human eyes. In Step 6, after the paragraph ending "…we simply lose parallelism for that run. **Never improvise an ad-hoc workflow script** — that would reintroduce the runtime nondeterminism this skill exists to remove.", add a new paragraph:

   > If the plan carries `release` or `manual` tasks (marked, or classified by the heuristics), do **not** hand those to the sequential executor — subagent-driven-development executes every task continuously, without pausing for human eyes. Hand it the `implementation` and `gate` tasks only, and carry the `release`/`manual` tasks as the post-merge runbook, presented to the human when the sequential run completes — the same contract the parallel path honors.

3. **Resources — validator invocation.** Replace "`scripts/validate_skill.py` — run `python3 scripts/validate_skill.py skills/ultrapowers` to verify frontmatter and reference integrity; expected output: `skill ok`." with "`scripts/validate_skill.py` — run `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` from the repo root (CI also runs it for `skills/ultraplan`) to verify frontmatter and reference integrity; expected output: `skill ok`."

- [ ] **Step 1: Apply the three edits** exactly as written.
- [ ] **Step 2: Run the full suite** — `python3 -m pytest tests/ -q`. Expected: all green (test_orchestrator_markers.py passes).
- [ ] **Step 3: Run both validators** — `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` and `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan`. Expected: `skill ok` twice.
- [ ] **Step 4: Commit** — `git add skills/ultrapowers/SKILL.md && git commit -m "docs: SKILL.md degrade wording, Step-6 release/manual withholding, correct validator invocation"`.

### Task 9: wave-merge.md truth-up — critic sourcing and the No Silent Caps table

**Type:** implementation
**Depends-on:** 4

**Files:**
- Modify: `skills/ultrapowers/references/wave-merge.md`

CRITICAL CONSTRAINT: do NOT touch the five `<!-- BAKE:* -->` blocks (SETUP_PROMPT_CREATE, SETUP_PROMPT_RESUME, MERGE_PROMPT, RECONCILE_PROMPT, COMPLETENESS_PROMPT) — `tests/test_no_prompt_drift.py` pins them against workflow.js. Both edits below are outside those blocks. This task depends on the baked-discipline task because the table row below documents the `log()` call that task adds to workflow.js's fix-loop branch — verify the line `fix-loop cap (2) reached` exists in `skills/ultrapowers/workflow.js` on your branch before editing.

Two edits:

1. **Completeness-critic sourcing.** In the "Integration and Completeness Review" numbered list, replace "Dispatches a **completeness-critic agent** using `superpowers:verification-before-completion`." with "Dispatches a **completeness-critic agent** whose prompt is adapted from `superpowers:verification-before-completion`'s evidence-before-claims discipline — baked into `workflow.js` at build time, not loaded from Superpowers at runtime."
2. **No Silent Caps table.** Replace the two misrouted rows:
   - "| Downstream wave cascade-blocked | `log()` | `## Blocked Waves` |" becomes "| Downstream wave cascade-blocked | `log()` (one line per blocked wave) | `unfinished` (`cascade-blocked by wave N` entries) |"
   - "| Fix-loop cap reached | `log()` | `## Blocked Waves` |" becomes "| Fix-loop cap reached | `log()` | failed task in `tasks[]` (`reviewVerdict: 'fix-loop-exhausted'`) |"

- [ ] **Step 1: Apply both edits**, leaving all five BAKE blocks byte-identical.
- [ ] **Step 2: Run the full suite** — `python3 -m pytest tests/ -q`. Expected: all green.
- [ ] **Step 3: Run both validators** — `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` and `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan`. Expected: `skill ok` twice.
- [ ] **Step 4: Commit** — `git add skills/ultrapowers/references/wave-merge.md && git commit -m "docs: wave-merge critic sourcing and No Silent Caps routing match the code"`.

### Task 10: report-format.md truth-up plus a verdict-vocabulary tripwire

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/report-format.md`
- Modify: `tests/test_report_runbook.py`

report-format.md documents three things workflow.js never emits. KEEP these pinned strings (`tests/test_report_runbook.py`): `Post-merge runbook`, `Step-2`, `finishing-a-development-branch`, `blockedWaves`, `Blocked waves`, and the file must NOT contain `clean up worktrees`.

Three doc edits (field-reference table):

1. `tasks` row: replace "`status` is one of `done`, `failed`, `skipped`" with "`status` is `done` or `failed`; dependency-blocked and budget-deferred tasks are reported as strings in `unfinished`, not as `tasks[]` entries".
2. `tasks[].commit` row: replace "Merge commit SHA on the integration branch" with "The implementer's final commit on the task's worktree branch (self-reported); the integration merge SHA lives in `waveMerges[].headSha`".
3. `tasks[].reviewVerdict` row: replace 'Verdict from the code-review subagent, e.g. `"clean"`, `"fixed"`, `"warnings"`' with 'Review outcome. Merged tasks: `clean` (passed first review) or `fixed` (passed after the fix round). Failed tasks: `not-reviewed` (implementer BLOCKED/NEEDS_CONTEXT), `fix-loop-exhausted` (blocking issues after the capped fix round), `blocked-after-fix` (implementer blocked during the fix round), `agent-error` (the agent call itself failed)'.

Then add a tripwire so the vocabulary can never silently drift again — append to `tests/test_report_runbook.py` (add `import re` at the top):

```python
def test_report_format_documents_every_review_verdict():
    wf = (ROOT / "skills/ultrapowers/workflow.js").read_text()
    doc = REPORT.read_text()
    verdicts = set()
    for frag in re.findall(r"reviewVerdict:([^\n]+)", wf):
        verdicts.update(re.findall(r"'([a-z][a-z-]*)'", frag))
    assert verdicts, "no reviewVerdict literals found in workflow.js"
    for v in sorted(verdicts):
        assert "`" + v + "`" in doc, (
            "report-format.md does not document reviewVerdict '" + v + "' — "
            "workflow.js emits it; update the field-reference table")
```

- [ ] **Step 1: Add the tripwire test, run it, confirm it fails** — `python3 -m pytest tests/test_report_runbook.py -q`. Expected: fails on `fix-loop-exhausted` (and others) missing from the doc.
- [ ] **Step 2: Apply the three doc edits.** Every verdict string the test extracts (`clean`, `fixed`, `not-reviewed`, `fix-loop-exhausted`, `blocked-after-fix`, `agent-error`) must appear backtick-wrapped in the doc.
- [ ] **Step 3: Re-run** — `python3 -m pytest tests/test_report_runbook.py -q`. Expected: all pass.
- [ ] **Step 4: Run the full suite** — `python3 -m pytest tests/ -q`. Expected: all green.
- [ ] **Step 5: Run both validators** — `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` and `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan`. Expected: `skill ok` twice.
- [ ] **Step 6: Commit** — `git add skills/ultrapowers/references/report-format.md tests/test_report_runbook.py && git commit -m "docs: report-format matches emitted statuses and verdicts, with a vocabulary tripwire"`.

### Task 11: ultraplan header quote completion and README handoff truth-up

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultraplan/SKILL.md`
- Modify: `README.md`

Two truth-ups:

1. **ultraplan quotes a truncated upstream line.** The installed superpowers 5.1.0 writing-plans header line is one sentence longer than ultraplan's quote. In `skills/ultraplan/SKILL.md`, the "Replace the plan header" section currently quotes:

   > **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

   Replace that quoted line with the full upstream line (a literal-substring REPLACE of the truncated quote would leave the trailing sentence duplicated after the rewritten header):

   > **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

   The replacement header (the blockquote beginning "**For agentic workers:** Parallel execution:") already carries the trailing sentence — leave it unchanged. Keep the strings `REQUIRED SUB-SKILL`, `ultrapowers:ultrapowers`, and `Execution Handoff` intact (pinned by `tests/test_ultraplan_skill.py`).

2. **README claims review is "reused" from superpowers — it is baked, not reused.** Two spots in `README.md`:
   - In the intro blockquote paragraph, replace "Install it first — ultrapowers plugs into that workflow at the "execute the plan" step and reuses its skills rather than duplicating them." with "Install it first — ultrapowers plugs into that workflow at the "execute the plan" step: brainstorming, planning, and branch-finishing hand off to superpowers skills at runtime, while the execution-time review discipline is baked in from superpowers sources at build time (drift-tested, manually re-baked)."
   - In the install section, replace "Superpowers must be installed alongside it — ultrapowers reuses its brainstorming, planning, review, and branch-finishing skills." with "Superpowers must be installed alongside it — ultrapowers hands off to its brainstorming, planning, and branch-finishing skills; the review discipline is baked from its sources at build time and re-baked manually when upstream changes."

- [ ] **Step 1: Apply both edits** exactly as written.
- [ ] **Step 2: Run the full suite** — `python3 -m pytest tests/ -q`. Expected: all green (test_ultraplan_skill.py passes; the mirrored BAKE blocks were not touched).
- [ ] **Step 3: Run both validators** — `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` and `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan`. Expected: `skill ok` twice.
- [ ] **Step 4: Commit** — `git add skills/ultraplan/SKILL.md README.md && git commit -m "docs: complete the upstream header quote; README tells the truth about baked vs reused review"`.

### Task 12: Full-suite gate

**Type:** gate
**Depends-on:** none

**Files:** none (verification only)

- [ ] **Step 1:** Run: `python3 -m pytest tests/ -q` — expect every test green (≈70 tests after the additions), zero failures.
- [ ] **Step 2:** Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` — expect `skill ok`.
- [ ] **Step 3:** Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan` — expect `skill ok`.
- [ ] **Step 4:** Run: `node tests/sim_workflow.mjs` — expect `ALL SCENARIOS PASSED`.
