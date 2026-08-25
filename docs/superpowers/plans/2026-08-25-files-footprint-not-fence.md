# FILES Is a Footprint, Not a Fence Implementation Plan (#223)

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the engine amplifying an incomplete `FILES` list into fix-loop exhaustion and burned critic rounds: out-of-`FILES` *modifications* become disclosed advisories (deletions outside `FILES` stay blocking verbatim), and a redirect's `files` is derived as a union — task FILES ∪ paths the instruction names ∪ the finding's files — never hand-narrowed.

**Architecture:** Two independent surfaces. (T1) The baked discipline: one sentence each in the IMPLEMENTER and REVIEWER blocks of `references/reviewer-prompts.md`, re-baked into `harnesses/waves.js` per `references/workflow-template.md` with `tests/test_no_prompt_drift.py` as the pin; the SIBLING FILES rule and the deletion rule are untouched. (T2) The redirect composer: `redirect_args.py`'s amend loop derives `files` from three sources with a deterministic path-token extractor (`compile_plan._is_pathlike`, the compiler's own rule) and can only grow the set; SKILL.md's "narrow `files` to the fix" clause goes. No canary (the reviewer's fence on deletions is untouched — agreed at distill); #233 (watch — plan-time FILES blast-radius) is the authoring-side complement and is cited, not bundled.

**Tech Stack:** Markdown prompt sources, JavaScript string constants in `waves.js` (no logic change), Python 3 stdlib, pytest, Node for the `.mjs` sims the suite-gate runs when `waves.js` changes.

**Spec:** GitHub issue #223 plus its docket entry `docs/superpowers/docket.md` (`### #223`). Sequenced after #222 (which refactored `redirect_args.py` into `load_context`/`emit_relaunch`; T2 edits the amend loop in `main()`, which #222 left byte-identical).

**Acceptance:** suite — prompt-source edit + re-bake pinned by the drift test, composer change pinned by its unit tests; the committed suite plus the harness `.mjs` sims (run by the suite-gate because `waves.js` changes) are the verification, no held-out exam.

## Global Constraints

- The verification periphery is FROZEN: never touch `gate_check.py`, `ultra_gate.py`, `run_lock.sh`, `run_acceptance.sh`, `collect_seal.py`, `seal_hash.py`.
- Prompts are baked; edit the source, not the copy: every wording change lands in `skills/ultrapowers/references/reviewer-prompts.md` FIRST and is then copied into the matching `const` in `skills/ultrapowers/harnesses/waves.js`; `python3 -m pytest tests/test_no_prompt_drift.py` must be green at every commit.
- `waves.js` changes here are string-constant edits only — no control-flow change; the four harness sims (`node tests/sim_workflow.mjs`, `node tests/sim_derived_heads.mjs`, `node tests/frontier_merge.mjs`, `node tests/wave_ancestry_sim.mjs`) must still print their `ALL SCENARIOS PASSED` / `ALL TESTS PASSED` sentinel.
- The SIBLING FILES rule (implementer input list + reviewer "missing dependency edge" paragraph) and the "NEVER delete a file outside FILES" / "deletion … is automatically a blocking issue" rules keep their current words.
- No Anthropic API calls or SDK anywhere; no new dependencies.
- Tests must be concurrency-safe: derive every path from pytest's `tmp_path`, no shared on-disk fixtures, no ports.
- The full gate is `python3 -m pytest`; every task leaves it green.

---

### Task 1: reviewer-prompts.md — out-of-FILES modifications are advisory; re-bake waves.js

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Test: `tests/test_no_prompt_drift.py`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: nothing code-level. The two rewritten sentences below are the contract; T2's SKILL.md wording refers to them only by concept.

- [ ] **Step 1: Confirm the drift pin is green before editing**

Run: `python3 -m pytest tests/test_no_prompt_drift.py -q`
Expected: PASS (baseline).

- [ ] **Step 2: Edit the IMPLEMENTER_PROMPT source sentence**

In `skills/ultrapowers/references/reviewer-prompts.md`, inside `<!-- BAKE:IMPLEMENTER_PROMPT -->`, the self-verify bullet currently reads:

```
- Read the packet's `## Files changed` section (the `git diff --stat` of your `BASE..HEAD`): verify no unrelated files are modified. If `FILES` is present, confirm every changed path is named there or is plainly required by the task text. NEVER delete a file outside `FILES` — if the task seems to demand it, STOP and report `BLOCKED` explaining why.
```

Replace it with exactly:

```
- Read the packet's `## Files changed` section (the `git diff --stat` of your `BASE..HEAD`): verify no unrelated files are modified. If `FILES` is present, treat it as the task's expected footprint, not a fence: a modified path outside it is allowed when the task requires it — a plan-mandated gate command or check is forcing context, not a scope violation — but disclose every such path as a `concerns` entry prefixed `out-of-FILES:` naming the path and why, and report `DONE_WITH_CONCERNS`. NEVER delete a file outside `FILES` — if the task seems to demand it, STOP and report `BLOCKED` explaining why.
```

- [ ] **Step 3: Edit the REVIEWER_PROMPT source sentence**

Inside `<!-- BAKE:REVIEWER_PROMPT -->`, the line after spec-compliance item 3 currently reads:

```
When `FILES` (the task's declared file scope) is provided: a deletion of any file that exists at `BASE` but is not named in `FILES` is automatically a blocking issue; modifications outside `FILES` are blocking unless the task text plainly requires them.
```

Replace it with exactly:

```
When `FILES` (the task's declared file scope) is provided, it is the task's expected footprint, not a fence: a deletion of any file that exists at `BASE` but is not named in `FILES` is automatically a blocking issue; a modification outside `FILES` is advisory — report it as a `minor` issue naming the path, and judge whether the change itself is required by the task under item 3 (a plan-mandated gate command or check the task must satisfy is forcing context, never a scope violation). An undisclosed out-of-`FILES` modification — one the implementer did not surface as an `out-of-FILES:` concern — is itself a `minor` issue, not a blocking one.
```

- [ ] **Step 4: Re-bake both sentences into `waves.js`**

In `skills/ultrapowers/harnesses/waves.js`, replace the two string-array elements holding the old sentences — the IMPLEMENTER_PROMPT element beginning `'- Read the packet\'s ## Files changed section` and the REVIEWER_PROMPT element beginning `'When FILES (the task\'s declared file scope) is provided:` — with the new wording, formatted the way the surrounding elements are (markdown/backticks stripped, single-quoted JS string with `\'` for apostrophes). The drift test normalizes formatting/punctuation but the **words must match** the source.

- [ ] **Step 5: Run the drift pin and the harness sims**

Run: `python3 -m pytest tests/test_no_prompt_drift.py tests/test_canary.py -q`
Expected: PASS.
Run: `node tests/sim_workflow.mjs && node tests/sim_derived_heads.mjs && node tests/frontier_merge.mjs && node tests/wave_ancestry_sim.mjs`
Expected: each exits 0 and prints its `ALL SCENARIOS PASSED` / `ALL TESTS PASSED` sentinel (none of them asserts the two sentences; this confirms the string edit broke no JS).

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/references/reviewer-prompts.md skills/ultrapowers/harnesses/waves.js
git commit -m "feat(engine): FILES is a footprint, not a fence — out-of-FILES modifications advisory, deletions still block; re-bake (#223)"
```

---

### Task 2: redirect_args.py — derive `files` as a union, never narrow; strike the SKILL.md clause

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/redirect_args.py`
- Modify: `skills/ultrapowers/SKILL.md`
- Test: `tests/test_redirect_args.py`

**Interfaces:**
- Consumes: `compile_plan._is_pathlike(tok: str) -> bool` (existing, same scripts directory; importable because a script's own directory is `sys.path[0]`).
- Produces: `redirect_args.instruction_paths(instruction: str) -> list[str]` (path-like tokens in first-appearance order, deduped) and `redirect_args.derive_files(task_files: list, instruction: str, finding_files: list) -> list[str]` (ordered union: task FILES, then instruction paths, then finding files; deduped, first occurrence wins).

The amend loop's `files` handling changes from "replace when the finding gives `files`" to "always derive the union". A finding with no `files` and an instruction naming no paths leaves `files` equal to the task's FILES (identity, still written back so the launch copy and the wave entry agree). The derived list lands on BOTH the launch task (`tasks[tid]["files"]`) and the wave entry (`entries[tid]["files"]`), as today.

Token rule for `instruction_paths`: split the instruction on whitespace; strip surrounding backticks, quotes, parentheses and trailing `,;:.` from each token; drop a trailing `::<name>` pytest node selector; keep the token iff `compile_plan._is_pathlike(token)` — the compiler's own rule (paths with `/`, dotfiles, real extensions; never `Foo.Bar` attribute references or bare words).

- [ ] **Step 1: Rewrite the narrowing pin and add the derivation tests**

In `tests/test_redirect_args.py`, replace `test_amend_appends_redirect_narrows_files_sets_tier_keeps_siblings` with:

```python
def test_amend_appends_redirect_unions_files_sets_tier_keeps_siblings(tmp_path):
    # #223: `files` is DERIVED — task FILES ∪ instruction paths ∪ finding
    # files — and never narrows; a finding naming only c.py still keeps a.py.
    run = make_run(tmp_path)
    r = run_helper(run, [{"task": "1", "instruction": "fix the guard",
                          "files": ["c.py"], "tier": "standard"}])
    assert r.returncode == 0, r.stderr
    out_args = json.loads(Path(r.stdout.strip()).read_text())
    assert out_args["resume"] is True
    assert out_args["integrationBranch"] == "ultra/int-1"      # from gate-receipt.json
    assert out_args["pluginRoot"] == "/pr" and out_args["runDir"]  # receipt spread carried
    new_launch = json.loads(Path(out_args["wavesPath"]).read_text())
    assert "REDIRECT: fix the guard" in new_launch["tasks"]["1"]["body"]
    assert new_launch["tasks"]["1"]["files"] == ["a.py", "c.py"]
    assert new_launch["tasks"]["2"] == json.loads((run / "launch.json").read_text())["tasks"]["2"]
    entry1 = out_args["waves"][0][0]
    assert entry1["tier"] == "standard" and entry1["files"] == ["a.py", "c.py"]
    # originals untouched
    assert "REDIRECT" not in (run / "launch.json").read_text()
    assert "resume" not in json.loads((run / "args.json").read_text())
```

and append:

```python
def test_files_derived_from_instruction_paths(tmp_path):
    run = make_run(tmp_path)
    r = run_helper(run, [{"task": "1", "instruction":
                          "add the guard in `src/guard.py`, cover it in tests/test_guard.py::test_x, "
                          "and leave Foo.Bar alone (see README)."}])
    assert r.returncode == 0, r.stderr
    out_args = json.loads(Path(r.stdout.strip()).read_text())
    new_launch = json.loads(Path(out_args["wavesPath"]).read_text())
    assert new_launch["tasks"]["1"]["files"] == ["a.py", "src/guard.py", "tests/test_guard.py", "README"]
    assert out_args["waves"][0][0]["files"] == ["a.py", "src/guard.py", "tests/test_guard.py", "README"]


def test_files_never_narrow_below_task_files(tmp_path):
    # a hand-narrowed finding cannot exclude the task's own FILES
    run = make_run(tmp_path)
    r = run_helper(run, [{"task": "1", "instruction": "trim it", "files": ["z.py"]}])
    assert r.returncode == 0, r.stderr
    out_args = json.loads(Path(r.stdout.strip()).read_text())
    assert out_args["waves"][0][0]["files"] == ["a.py", "z.py"]


def test_files_unchanged_when_nothing_names_a_path(tmp_path):
    run = make_run(tmp_path)
    r = run_helper(run, [{"task": "1", "instruction": "rename the helper and rerun"}])
    assert r.returncode == 0, r.stderr
    out_args = json.loads(Path(r.stdout.strip()).read_text())
    new_launch = json.loads(Path(out_args["wavesPath"]).read_text())
    assert new_launch["tasks"]["1"]["files"] == ["a.py"]
    assert out_args["waves"][0][0]["files"] == ["a.py"]


def test_instruction_paths_and_derive_files_units():
    sys.path.insert(0, str(SCRIPT.parent))
    import redirect_args as ra
    assert ra.instruction_paths("edit `a/b.py`, (c.md) and d.py; then tests/t.py::test_k.") == \
        ["a/b.py", "c.md", "d.py", "tests/t.py"]
    assert ra.instruction_paths("no paths here, just Foo.Bar and v1.2") == ["v1.2"]
    assert ra.derive_files(["a.py"], "touch b.py and a.py", ["c.py", "b.py"]) == ["a.py", "b.py", "c.py"]
    assert ra.derive_files(["a.py"], "", []) == ["a.py"]
```

(`v1.2` is path-like under the compiler's rule — a real extension — and that is the accepted cost: a false path costs nothing at redirect time since `files` is advisory scope, while a dropped path was the failure this issue fixes.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_redirect_args.py -v`
Expected: the five new/rewritten tests FAIL (`files` still replaced wholesale; `instruction_paths` undefined); every other test PASSES.

- [ ] **Step 3: Implement the derivation in `redirect_args.py`**

Add after the imports:

```python
import compile_plan  # same scripts dir: the compiler's own path-token rule

_STRIP = "`'\"()[]{}<>"


def instruction_paths(instruction):
    """Path-like tokens in a redirect instruction, first-appearance order,
    deduped: the compiler's _is_pathlike rule applied to whitespace tokens
    stripped of quoting/bracket characters, trailing ,;:. punctuation and a
    trailing ::node pytest selector."""
    out = []
    for raw in (instruction or "").split():
        tok = raw.strip(_STRIP).rstrip(",;:.").strip(_STRIP)
        tok = tok.split("::", 1)[0]
        if tok and compile_plan._is_pathlike(tok) and tok not in out:
            out.append(tok)
    return out


def derive_files(task_files, instruction, finding_files):
    """#223: files is a footprint — task FILES ∪ instruction paths ∪ the
    finding's files, ordered, deduped. It can only grow; never narrows."""
    out = []
    for p in list(task_files or []) + instruction_paths(instruction) + list(finding_files or []):
        if p and p not in out:
            out.append(p)
    return out
```

In `main()`'s amend loop replace

```python
        if f.get("files"):
            tasks[tid]["files"] = list(f["files"])
            entries[tid]["files"] = list(f["files"])
```

with

```python
        derived = derive_files(tasks[tid].get("files") or entries[tid].get("files"),
                               instruction, f.get("files"))
        tasks[tid]["files"] = list(derived)
        entries[tid]["files"] = list(derived)
```

(`instruction` is the stripped instruction already bound two lines above.) Update the module docstring's "file-scope narrow" phrase to "file-scope union (#223)".

- [ ] **Step 4: Strike the SKILL.md clause**

In `skills/ultrapowers/SKILL.md` Step 5, the Redirect bullet's parenthetical currently reads `— narrow `files` to the fix, right-size `tier` down when the fix is mechanical)`. Change it to `— `files` is derived as the task's FILES ∪ paths the instruction names ∪ the finding's `files`, never narrowed; right-size `tier` down when the fix is mechanical)`. The tier clause keeps its words (#230 watch owns it).

- [ ] **Step 5: Run the tests and confirm green**

Run: `python3 -m pytest tests/test_redirect_args.py tests/test_salvage_args.py -v`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/scripts/redirect_args.py tests/test_redirect_args.py skills/ultrapowers/SKILL.md
git commit -m "feat(engine): redirect files derived as task FILES ∪ instruction paths ∪ finding files, never narrowed (#223)"
```

---

### Task 3: Suite gate

**Type:** gate
**Depends-on:** 1, 2

**Files:**
- Test: `tests/`

- [ ] **Step 1: Run the full suite and the harness sims**

Run: `python3 -m pytest`
Expected: all green.
Run: `node tests/sim_workflow.mjs && node tests/sim_derived_heads.mjs && node tests/frontier_merge.mjs && node tests/wave_ancestry_sim.mjs`
Expected: each prints its pass sentinel.

---

## Operator smoke

- do: `grep -c "footprint, not a fence" skills/ultrapowers/references/reviewer-prompts.md skills/ultrapowers/harnesses/waves.js`
  see: `2` for each file (implementer + reviewer sentences, source and baked copy).
- do: `grep -n "narrow \`files\`" skills/ultrapowers/SKILL.md; echo exit=$?`
  see: no match, `exit=1`.
- do: `python3 -c "import sys; sys.path.insert(0,'skills/ultrapowers/scripts'); import redirect_args as r; print(r.instruction_paths('fix \`src/x.py\` and tests/test_x.py::test_a'))"`
  see: `['src/x.py', 'tests/test_x.py']`.
