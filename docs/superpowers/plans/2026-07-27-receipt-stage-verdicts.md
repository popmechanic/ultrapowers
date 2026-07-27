# Receipt Stage Verdicts (#97) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every receipt stage detail states the stage's own conclusion — a green stage can never carry a failure sentence, and probe stdout/stderr attaches only on failure.

**Architecture:** One emission-point change in `ultra_run.py`: `stage(name, ok, detail)` becomes `stage(name, ok, success="", failure="")` so the emitter picks the detail by the verdict — the defect class (failure text leaking into a green stage) becomes inexpressible. Each of the 12 call sites passes its conclusion as `success` and its probe evidence as `failure`. A generic pin test asserts no `ok: true` stage ever carries a known failure phrasing.

**Tech Stack:** Python 3, pytest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-27-receipt-stage-verdicts.md`

**Acceptance:** suite — the committed pytest suite is the verification; deterministic driver code, not the frozen verification periphery. No seal requested.

## Global Constraints

- **No receipt schema change:** stage entries keep exactly the keys `stage`, `ok`, `detail`; the 2000-char detail cap and `bail()` semantics are unchanged.
- **Failure details keep full probe evidence** — raw stdout/stderr belongs on the failure path; only success details become conclusions.
- **The pin is generic:** the no-failure-phrasing assertion iterates ALL of `receipt["stages"]`, never an enumerated stage list, so stages added by later plans are covered automatically.
- **No changes outside** `skills/ultrapowers/scripts/ultra_run.py` and `tests/test_ultra_run.py`.
- **No Anthropic SDK / `ANTHROPIC_API_KEY`** in any shipped or dev script (CLAUDE.md).
- Suite gate: `python3 -m pytest` green from the repo root.

---

### Task 1: Dual-detail stage emission + per-site conclusions

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/ultra_run.py`
- Test: `tests/test_ultra_run.py`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: `stage(name, ok, success="", failure="")` inner helper (emits `detail = success if ok else failure`); success-detail contract per stage: `git-repo` → repo root path, `worktree-probe` → `"worktree capability verified (probe cut and removed)"`, `superpowers-compat` → `"contract verified against the enabled superpowers"`, `compile` → `"<N> task(s) in <M> wave(s); acceptance: <mode>"`, `lock` → `"lock acquired: <stamp>"`, `snapshot` → `"checkout snapshot recorded"`.

This plan is intentionally narrow: one file, one emission change — no latent parallelism.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_ultra_run.py`, reusing its existing helpers (`make_repo`, `run_driver`):

```python
# --- #97: stage details state the stage's own verdict ---

FAILURE_PHRASINGS = ("not inside a git repository", "Preparing worktree",
                     "no branch resolvable")


def test_green_stages_never_carry_failure_phrasings(tmp_path):
    # Generic over ALL stages, so stages added by later plans are covered too.
    repo = make_repo(tmp_path)
    r = run_driver(repo)
    assert r.returncode == 0, r.stdout + r.stderr
    receipt = json.loads(r.stdout)
    for s in receipt["stages"]:
        if s["ok"]:
            for phrase in FAILURE_PHRASINGS:
                assert phrase not in s["detail"], (s["stage"], s["detail"])


def test_git_repo_success_detail_is_repo_root(tmp_path):
    repo = make_repo(tmp_path)
    r = run_driver(repo)
    receipt = json.loads(r.stdout)
    s = next(x for x in receipt["stages"] if x["stage"] == "git-repo")
    assert s["detail"] == str(repo.resolve())


def test_worktree_probe_success_detail_is_conclusion(tmp_path):
    repo = make_repo(tmp_path)
    r = run_driver(repo)
    receipt = json.loads(r.stdout)
    s = next(x for x in receipt["stages"] if x["stage"] == "worktree-probe")
    assert s["detail"] == "worktree capability verified (probe cut and removed)"


def test_compile_success_detail_is_summary_not_json(tmp_path):
    repo = make_repo(tmp_path)
    r = run_driver(repo)
    receipt = json.loads(r.stdout)
    s = next(x for x in receipt["stages"] if x["stage"] == "compile")
    assert not s["detail"].startswith("{")
    assert "task(s)" in s["detail"] and "wave(s)" in s["detail"]
    assert (receipt["compile"]["acceptance"] or {}).get("mode", "unmarked") in s["detail"]


def test_failure_details_survive_not_a_repo(tmp_path):
    # The failure path keeps its message — run the driver OUTSIDE any git repo.
    plain = tmp_path / "plain"
    plain.mkdir()
    (plain / "plan.md").write_text("# nothing")
    r = sh([sys.executable, str(RUN), "plan.md", "--stamp", "t9"],
           cwd=plain, check=False)
    assert r.returncode != 0
    receipt = json.loads(r.stdout)
    s = next(x for x in receipt["stages"] if x["stage"] == "git-repo")
    assert s["ok"] is False
    assert ("not inside a git repository" in s["detail"]) or ("fatal" in s["detail"])
```

Note on `test_git_repo_success_detail_is_repo_root`: `git rev-parse --show-toplevel` returns the symlink-resolved path, which `repo.resolve()` matches on macOS temp dirs. If a pre-existing helper repo lands elsewhere, compare against `Path(r_stdout_root)` semantics — the contract is "the resolved repo root path", not any particular formatting.

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_ultra_run.py -q`
Expected: FAIL — `test_green_stages_never_carry_failure_phrasings` (git-repo green detail IS "not inside a git repository" today), `test_git_repo_success_detail_is_repo_root`, `test_worktree_probe_success_detail_is_conclusion`, `test_compile_success_detail_is_summary_not_json`. The failure-path test may already pass.

- [ ] **Step 3: Implement in `ultra_run.py`**

1. Replace the inner `stage` helper:

```python
    def stage(name, ok, success="", failure=""):
        stages.append({"stage": name, "ok": bool(ok),
                       "detail": str(success if ok else failure).strip()[-2000:]})
        return bool(ok)
```

2. Update every call site (all keyword-form for clarity):

```python
    r = sh(["git", "rev-parse", "--show-toplevel"], cwd=a.repo)
    if not stage("git-repo", r.returncode == 0,
                 success=r.stdout.strip(),
                 failure=r.stderr or "not inside a git repository"):
        return bail()
```

```python
    if not stage("worktree-probe", wt_ok,
                 success="worktree capability verified (probe cut and removed)",
                 failure=r.stderr):
        return bail()
```

Engine-skew (three sites, conclusions unchanged in content):

```python
            stage("engine-skew", True,
                  success="SKEW — repo waves.js copied into .claude/workflows")
        elif not stage("engine-skew", r.returncode == 0,
                       success=out or "IN_SYNC",
                       failure=out or "skew check failed"):
            return bail()
    else:
        stage("engine-skew", True, success="skipped — not self-hosting")
```

```python
    if not stage("superpowers-compat", r.returncode == 0,
                 success="contract verified against the enabled superpowers",
                 failure=r.stdout + r.stderr):
        return bail()
```

```python
    stage("scratch-hygiene", True, success=detail)
```

Compile — parse the JSON BEFORE the stage call (it already lands in the receipt) and summarize:

```python
    r = sh([sys.executable, str(HERE / "compile_plan.py"), str(a.plan),
            "--emit-launch", str(launch), "--emit-args", str(args_file),
            "--run-dir", str(run_dir.resolve())],
           cwd=root)
    compile_obj, summary = None, ""
    if r.returncode == 0:
        compile_obj = json.loads(r.stdout)
        waves = compile_obj.get("waves") or []
        mode = (compile_obj.get("acceptance") or {}).get("mode") or "unmarked"
        summary = "%d task(s) in %d wave(s); acceptance: %s" % (
            sum(len(w) for w in waves), len(waves), mode)
    if not stage("compile", r.returncode == 0,
                 success=summary, failure=r.stderr or r.stdout):
        return bail()
    receipt["compile"] = compile_obj
```

(The old `receipt["compile"] = json.loads(r.stdout)` line after the stage call is replaced by the assignment above.)

```python
    if not stage("install", bool(installed),
                 success="installed: " + ", ".join(installed),
                 failure="no harness manifests found under " + str(HARNESSES)):
        return bail()
```

```python
    r = sh(["bash", str(HERE / "run_lock.sh"), "acquire", stamp], cwd=root)
    if not stage("lock", r.returncode == 0,
                 success="lock acquired: " + stamp,
                 failure=r.stderr or r.stdout):
        return bail()
    r = sh(["bash", str(HERE / "run_lock.sh"), "snapshot"], cwd=root)
    if not stage("snapshot", r.returncode == 0,
                 success="checkout snapshot recorded",
                 failure=r.stderr):
        return bail()
```

```python
    stage("base-branch", bool(base),
          success=base, failure="no branch resolvable")
    if not base:
        return bail()
```

If the tree already contains a `test-command` stage (added by the gate-derives-inputs work), convert its call to the same keyword form: `success` = the resolved command + source, `failure` = the no-detection message naming `--test-cmd`.

- [ ] **Step 4: Run the tests**

Run: `python3 -m pytest tests/test_ultra_run.py -q`
Expected: PASS — all new tests plus every pre-existing driver test. If a pre-existing test pinned an old success detail (e.g. worktree porcelain), update that assertion to the new conclusion string, preserving the test's intent — the new strings are the contract, per the Interfaces block.

Then: `python3 -m pytest -q` — full suite green.

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/ultra_run.py tests/test_ultra_run.py
git commit -m "fix(driver): stage details state the stage's own verdict — dual success/failure emission (#97)"
```

---

### Task 2: Suite gate

**Type:** gate
**Depends-on:** 1

Run from the repo root on the integrated tree:

- `python3 -m pytest` — the whole committed suite green (no harness JS changes in this plan, so no `.mjs` sims are triggered).
