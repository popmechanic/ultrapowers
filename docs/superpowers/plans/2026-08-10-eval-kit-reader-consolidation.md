# Eval-Kit Reader Consolidation (#139 + #140) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One shared `*.harness.json` reader (hook + eval kit) and one shared A/B cell-setup function, per spec `docs/superpowers/specs/2026-08-10-eval-kit-reader-consolidation-design.md`.

**Architecture:** A new ~25-line module `harness_manifest.py` exposes `scan(harness_dir) -> (files, problems)` and a CLI shim; the session hook and `ab_runner.seed_workflows` become its two consumers (the hook lax, the kit fail-closed). Separately, `prepare_cell(plan, root)` absorbs the five-call cell setup both A/B entry points currently duplicate.

**Tech Stack:** Python 3 stdlib only, bash (the hook), pytest.

**Acceptance:** suite — dev tooling across evals + the session hook; the committed suite plus existing hook behavior tests are the verification (spec §Acceptance).

## Global Constraints

- `skills/ultrapowers/scripts/ultra_run.py` is **NOT touched** — its inline manifest reader stays, deliberately (spec §2, round-3 trim, operator-ratified).
- Frozen periphery untouched: no edits to `collect_seal.py`, `seal_hash.py`, `run_acceptance.sh`, `gate_check.py`, `ultra_gate.py`, `run_lock.sh`, or compiler diagnostic vocabulary.
- The hook's routing-rule heredoc (`<ultrapowers-routing>` block) stays **byte-identical** — `tests/test_recommendation_rubric.py` and the routing pins in `tests/test_session_hook.py` must stay green.
- CLI invariant: `problems` **never reach stdout** — stdout is filenames only; problems go to stderr (the hook word-splits stdout into filenames).
- `scan`'s docstring MUST carry the backward-tolerance rule verbatim-in-substance: schema migrations extend the accepted forms, never replace them; only a manifest unreadable under any known form is a problem (the eval kit reads pinned older-engine worktrees with the checkout's `scan`).
- The kit's `harness_manifest` import is a **hard import** at module top (no `try/except → None` fallback).
- `seed_workflows` fails on problems **before copying anything**.
- Scrub window: in both A/B mains the `try/finally scrub_credentials` begins immediately after `prepare_cell` returns; dirt-seeding and `pre = rev(workdir)` live inside the `try`.
- Suite gate: `python3 -m pytest` green from the repo root.

---

### Task 1: Shared manifest reader `harness_manifest.py` + unit tests

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `skills/ultrapowers/scripts/harness_manifest.py`
- Test: `tests/test_harness_manifest.py`

**Interfaces:**
- Consumes: nothing (stdlib only).
- Produces: `scan(harness_dir: str | Path) -> tuple[list[str], list[str]]` — `(files, problems)`; and the CLI contract `python3 harness_manifest.py <dir>` → stdout one filename per line, problems on stderr, exit 0.

**Parallelization rationale:** contract-first — the reader's signature and CLI shape are fixed here so both consumer tasks (hook, kit) build against it independently in the next wave.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_harness_manifest.py`:

```python
"""Unit tests for the shared *.harness.json runtime reader (spec
2026-08-10-eval-kit-reader-consolidation). scan() is the single runtime
manifest contract for the session hook and the eval kit."""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills/ultrapowers/scripts/harness_manifest.py"
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
from harness_manifest import scan


def _manifest(d, name, fname=None, raw=None, backing=True):
    (d / name).write_text(raw if raw is not None else json.dumps({"file": fname}))
    if fname and backing:
        (d / fname).write_text("// harness\n")


def test_scan_orders_by_manifest_filename_not_file_value(tmp_path):
    _manifest(tmp_path, "a.harness.json", "z.js")
    _manifest(tmp_path, "z.harness.json", "a.js")
    files, problems = scan(tmp_path)
    assert files == ["z.js", "a.js"]  # a.harness.json sorts first
    assert problems == []


def test_scan_reports_unparseable_json_as_problem(tmp_path):
    _manifest(tmp_path, "good.harness.json", "good.js")
    _manifest(tmp_path, "bad.harness.json", raw="{not json")
    files, problems = scan(tmp_path)
    assert files == ["good.js"]
    assert problems == ["bad.harness.json: unparseable JSON"]


def test_scan_reports_missing_file_key_as_problem(tmp_path):
    _manifest(tmp_path, "nokey.harness.json", raw=json.dumps({"name": "x"}))
    files, problems = scan(tmp_path)
    assert files == []
    assert problems == ["nokey.harness.json: missing `file` key"]


def test_scan_reports_absent_backing_file_as_problem(tmp_path):
    _manifest(tmp_path, "ghost.harness.json", "ghost.js", backing=False)
    files, problems = scan(tmp_path)
    assert files == []
    assert problems == ["ghost.harness.json: backing file ghost.js absent"]


def test_scan_of_missing_dir_is_empty_not_an_error(tmp_path):
    assert scan(tmp_path / "nowhere") == ([], [])


def test_cli_stdout_carries_only_filenames(tmp_path):
    _manifest(tmp_path, "good.harness.json", "good.js")
    _manifest(tmp_path, "bad.harness.json", raw="{not json")
    p = subprocess.run([sys.executable, str(SCRIPT), str(tmp_path)],
                       capture_output=True, text=True)
    assert p.returncode == 0
    assert p.stdout.splitlines() == ["good.js"]   # problems never on stdout
    assert "bad.harness.json" in p.stderr


def test_scan_docstring_carries_the_backward_tolerance_rule():
    import harness_manifest
    doc = harness_manifest.scan.__doc__ or ""
    assert "extend" in doc.lower() and "never replace" in doc.lower()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_harness_manifest.py -v`
Expected: FAIL/ERROR with `ModuleNotFoundError: No module named 'harness_manifest'`

- [ ] **Step 3: Write the module**

Create `skills/ultrapowers/scripts/harness_manifest.py`:

```python
#!/usr/bin/env python3
"""The single runtime reader of the *.harness.json manifest schema.

Consumers: hooks/session_start.sh (via the CLI, lax) and the eval kit's
seed_workflows (via scan(), fail-closed). A schema change edits scan() here
plus the test-side pin in tests/test_harness_registry.py.
Spec: docs/superpowers/specs/2026-08-10-eval-kit-reader-consolidation-design.md
"""
import json
import sys
from pathlib import Path


def scan(harness_dir):
    """Return (files, problems) for the *.harness.json manifests under
    harness_dir, in manifest-filename order.

    files: each manifest's `file` value, for manifests that parse, carry a
    `file` key, and whose backing file exists beside them. problems: one
    line per manifest failing any of those checks. Never raises.

    Backward tolerance is part of this contract: the eval kit reads
    manifests inside PINNED older-engine worktrees with the checkout's
    scan(), so a schema migration must EXTEND the accepted forms, never
    replace them — only a manifest unreadable under ANY known form is a
    problem. Otherwise the first schema change makes every pre-change
    engine ref hard-fail in the kit.
    """
    harness_dir = Path(harness_dir)
    files, problems = [], []
    for manifest in sorted(harness_dir.glob("*.harness.json")):
        try:
            fname = json.loads(manifest.read_text()).get("file")
        except Exception:
            problems.append("%s: unparseable JSON" % manifest.name)
            continue
        if not fname:
            problems.append("%s: missing `file` key" % manifest.name)
            continue
        if not (harness_dir / fname).is_file():
            problems.append("%s: backing file %s absent" % (manifest.name, fname))
            continue
        files.append(fname)
    return files, problems


if __name__ == "__main__":
    files, problems = scan(sys.argv[1])
    for line in problems:
        print(line, file=sys.stderr)   # never stdout: the hook word-splits stdout
    for line in files:
        print(line)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_harness_manifest.py -v`
Expected: 7 PASS

- [ ] **Step 5: Run the full suite**

Run: `python3 -m pytest`
Expected: green (no existing test knows this module yet)

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/scripts/harness_manifest.py tests/test_harness_manifest.py
git commit -m "feat(#140): harness_manifest.scan — the single runtime *.harness.json reader"
```

---

### Task 2: Hook consumes the shared reader; GC no-ops on reader failure

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `hooks/session_start.sh:26-51`
- Test: `tests/test_session_hook.py`

**Interfaces:**
- Consumes: the shared-reader CLI (from Task 1): `python3 <scripts-dir>/harness_manifest.py <dir>` — stdout one filename per line, problems on stderr, exit 0.
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_session_hook.py` (reuse the file's existing `ROOT` constant and env style — see `test_session_start_gcs_stale_workflow`):

```python
def test_session_start_gc_noops_on_reader_failure(tmp_path):
    # A failing python3 SHIM on an otherwise-FULL PATH — not PATH=/bin, which
    # also loses basename and makes this test pass vacuously (empty base
    # matches the empty installed_set pattern, so rm is unreachable even
    # with the guard deleted). This test must fail when the guard is removed.
    import os
    shim = tmp_path / "shim"
    shim.mkdir()
    (shim / "python3").write_text("#!/bin/sh\nexit 1\n")
    (shim / "python3").chmod(0o755)
    wf = tmp_path / "proj" / ".claude" / "workflows"
    wf.mkdir(parents=True)
    (wf / "waves.js").write_text("// installed harness\n")
    env = dict(os.environ,
               PATH="%s:%s" % (shim, os.environ["PATH"]),
               CLAUDE_PROJECT_DIR=str(tmp_path / "proj"))
    p = subprocess.run(["bash", str(ROOT / "hooks/session_start.sh")],
                       capture_output=True, text=True, env=env)
    assert p.returncode == 0, p.stderr
    assert "<ultrapowers-routing>" in p.stdout      # hook contract intact
    assert (wf / "waves.js").exists()  # reader failure must NOT uninstall
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_session_hook.py::test_session_start_gc_noops_on_reader_failure -v`
Expected: FAIL — the current GC deletes `waves.js` when the reader yields nothing (`installed_set` empty ⇒ every `.js` is an "orphan").

- [ ] **Step 3: Convert the hook**

In `hooks/session_start.sh`, replace the embedded reader (the `# One python3 pass…` comment through the closing `" "$harnesses")"` line, currently lines 26–36) with:

```bash
  # The shared reader (harness_manifest.py) lists every manifest's `file` —
  # the same scan() the eval kit uses, so the manifest schema has one
  # runtime reader. Problems go to its stderr (swallowed here); stdout is
  # filenames only.
  files="$(python3 "$plugin_root/skills/ultrapowers/scripts/harness_manifest.py" "$harnesses")"
```

Keep the copy loop **unchanged** (including the `[ -e "$harnesses/$f" ]` belt). Then wrap the GC loop (the `# GC: remove any .js files…` comment and its `for existing…done` block) in a non-empty guard:

```bash
  # GC only when the reader produced an install set: on reader failure
  # (python3 or the reader script missing) an empty set must be a no-op,
  # not a mass uninstall of every installed harness.
  if [ -n "$installed_set" ]; then
    for existing in "$dest"/*.js; do
      [ -e "$existing" ] || continue
      base="$(basename "$existing")"
      case " $installed_set " in *" $base "*) : ;; *) rm -f "$existing" ;; esac
    done
  fi
```

Do not touch anything from `cat <<'EOF'` down — the routing heredoc stays byte-identical.

- [ ] **Step 4: Run the new test to verify it passes**

Run: `python3 -m pytest tests/test_session_hook.py::test_session_start_gc_noops_on_reader_failure -v`
Expected: PASS

- [ ] **Step 5: Run the hook's full test file, then the suite**

Run: `python3 -m pytest tests/test_session_hook.py -v && python3 -m pytest`
Expected: all PASS — install, idempotence, stale-orphan GC, routing-context purity, and the recommendation-rubric pins all still green.

- [ ] **Step 6: Commit**

```bash
git add hooks/session_start.sh tests/test_session_hook.py
git commit -m "feat(#140): hook consumes harness_manifest CLI; GC no-ops on reader failure"
```

---

### Task 3: `seed_workflows` goes fail-closed through `scan`

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `evals/ab_runner.py:40-46,348-373`
- Test: `tests/test_ab_runner.py`

**Interfaces:**
- Consumes: `scan(harness_dir) -> (files, problems)` (from Task 1).
- Produces: `seed_workflows(engine_wt, workdir)` — signature unchanged; now `sys.exit`s on manifest problems before copying anything.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_ab_runner.py`:

```python
def test_seed_workflows_refuses_problem_manifests_before_copying(tmp_path):
    # Fail-closed (spec 2026-08-10): today a bad manifest is silently
    # skipped and the cell proceeds on a partial seed — after this change
    # one bad manifest refuses the whole cell, and nothing is copied.
    engine = tmp_path / "engine"
    h = engine / "skills/ultrapowers/harnesses"
    h.mkdir(parents=True)
    (h / "good.harness.json").write_text(json.dumps({"file": "good.js"}))
    (h / "good.js").write_text("// harness\n")
    (h / "bad.harness.json").write_text("{not json")
    workdir = tmp_path / "run"
    workdir.mkdir()
    try:
        ab_runner.seed_workflows(engine, workdir)
        assert False, "should refuse a problems-bearing manifest set"
    except SystemExit as e:
        assert "bad.harness.json" in str(e)
    assert not (workdir / ".claude/workflows/good.js").exists()  # fail BEFORE copy
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_ab_runner.py::test_seed_workflows_refuses_problem_manifests_before_copying -v`
Expected: FAIL — today the unparseable manifest raises `json.JSONDecodeError` (not `SystemExit`) out of `seed_workflows`.

- [ ] **Step 3: Convert `seed_workflows`**

In `evals/ab_runner.py`, directly under the existing `_SCRIPTS` sys.path block (after the `seal_hash` import, ~line 46), add the **hard** import — deliberately NOT inside a `try/except`; it sits at module top, so a missing module breaks even `--dry-run`, loudly, which is the point:

```python
from harness_manifest import scan as scan_harness_manifests  # noqa: E402
```

Replace the body of `seed_workflows` (keep the function's docstring, appending one sentence: `One bad manifest refuses the cell before anything is copied (fail-closed, spec 2026-08-10).`):

```python
    wf = Path(workdir) / ".claude/workflows"
    wf.mkdir(parents=True, exist_ok=True)
    harnesses = Path(engine_wt) / "skills/ultrapowers/harnesses"
    seeded, problems = scan_harness_manifests(harnesses)
    if problems:
        sys.exit("seed_workflows: manifest problems under %s — refusing the "
                 "cell before seeding anything: %s"
                 % (harnesses, "; ".join(problems)))
    if not seeded:
        # A silent zero-seed cascades into probe_workflow failing and the cell
        # rerunning interactively — the A/B would then compare execution modes,
        # not engines. Same guard as ultra_run.py's install stage.
        sys.exit("seed_workflows: no harness manifests found under %s "
                 "— refusing an unprobeable cell" % harnesses)
    for fname in seeded:
        shutil.copy2(harnesses / fname, wf / fname)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_ab_runner.py::test_seed_workflows_refuses_problem_manifests_before_copying -v`
Expected: PASS

- [ ] **Step 5: Run the suite**

Run: `python3 -m pytest`
Expected: green

- [ ] **Step 6: Commit**

```bash
git add evals/ab_runner.py tests/test_ab_runner.py
git commit -m "feat(#140): seed_workflows fail-closed via shared scan — no partial seeds"
```

---

### Task 4: Extract `prepare_cell`; both A/B mains call it

**Type:** implementation
**Depends-on:** 3

**Files:**
- Modify: `evals/ab_runner.py:597-655`
- Modify: `evals/run_ab_cell.py:33-58`
- Test: `tests/test_ab_runner.py`

**Interfaces:**
- Consumes: `seed_workflows(engine_wt, workdir)` (from Task 3, called inside the extraction); `build_run_plan`, `prepare_engine`, `install_seals`, `clone_project`, `prepare_session_config` (pre-existing kit functions).
- Produces: `prepare_cell(plan: dict, root: Path) -> tuple[Path, str, dict]` — `(workdir, baseline, env)`.

**Parallelization rationale:** none claimed — this task shares `evals/ab_runner.py` and its test file with the fail-closed conversion, so it is sequenced behind it by construction; no architectural move was made to force width.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_ab_runner.py` (function-level recorder stubs — the same monkeypatch style as `test_bootstrap_cell_green_engine_counts_zero`; NOT subprocess stubs, under which the seeding step would `sys.exit` before the chain completes):

```python
def test_prepare_cell_runs_the_five_calls_in_order(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(ab_runner, "prepare_engine",
                        lambda ref, root: calls.append(("prepare_engine", ref)) or "ENGINE_WT")
    monkeypatch.setattr(ab_runner, "install_seals",
                        lambda plan, root: calls.append(("install_seals",)))
    monkeypatch.setattr(ab_runner, "clone_project",
                        lambda plan: calls.append(("clone_project",)) or (tmp_path / "wd", "BASE"))
    monkeypatch.setattr(ab_runner, "seed_workflows",
                        lambda engine, wd: calls.append(("seed_workflows", engine)))
    monkeypatch.setattr(ab_runner, "prepare_session_config",
                        lambda engine, parent: calls.append(("prepare_session_config", parent)) or {"E": "1"})
    workdir, baseline, env = ab_runner.prepare_cell({"engineRef": "abc123"}, tmp_path)
    assert [c[0] for c in calls] == ["prepare_engine", "install_seals",
                                    "clone_project", "seed_workflows",
                                    "prepare_session_config"]
    assert calls[0][1] == "abc123"          # engineRef derived from the plan
    assert calls[3][1] == "ENGINE_WT"       # engine threads from prepare_engine
    assert calls[4][1] == (tmp_path / "wd").parent   # config keyed to workdir parent
    assert (workdir, baseline, env) == (tmp_path / "wd", "BASE", {"E": "1"})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_ab_runner.py::test_prepare_cell_runs_the_five_calls_in_order -v`
Expected: FAIL with `AttributeError: … no attribute 'prepare_cell'`

- [ ] **Step 3: Add `prepare_cell` to `evals/ab_runner.py`**

Immediately above `def main():`:

```python
def prepare_cell(plan, root):
    """The shared cell setup for BOTH A/B entry points (#139): engine
    worktree, seal installs, project clone, workflow seeding, session
    config. Pre-#138 the two entry points ran drifting copies of this
    sequence. Seeds a live credential — the caller's try/finally
    scrub_credentials must begin immediately after this returns."""
    engine = prepare_engine(plan["engineRef"], root)
    install_seals(plan, root)
    workdir, baseline = clone_project(plan)
    seed_workflows(engine, workdir)
    env = prepare_session_config(engine, workdir.parent)
    return workdir, baseline, env
```

- [ ] **Step 4: Rewire `ab_runner.main`**

Replace the five setup lines in `main()` (currently `engine = prepare_engine(...)` through `env = prepare_session_config(...)`, ~lines 631–635) with:

```python
    workdir, _baseline, env = prepare_cell(plan, root)
```

The `try:` that follows stays immediately after this line (scrub-window pin).

- [ ] **Step 5: Rewire `run_ab_cell.main`**

In `evals/run_ab_cell.py`, replace the setup block (from `engine = ab.prepare_engine(...)` through `env = ab.prepare_session_config(...)`, currently lines 36–53) so dirt-seeding and `pre` move INSIDE the `try` — both shell out and can raise, and the token is live once `prepare_cell` returns:

```python
    workdir, baseline, env = ab.prepare_cell(plan, ROOT)
    try:
        # Spec §The eval gate: seed pre-existing operator dirt BEFORE launch.
        # Inside the try — the token is already live (kit scrub-window contract).
        (workdir / "OPERATOR-WIP.txt").write_text("uncommitted operator scratch\n")
        tracked = sh(["git", "ls-files"], workdir).stdout.splitlines()[0]
        with open(workdir / tracked, "a") as f:
            f.write("\n# operator uncommitted edit (eval dirt seed)\n")
        dirt_before = sh(["git", "status", "--porcelain"], workdir).stdout
        pre = rev(workdir)
        transcript, gate_report, mode = ab.drive_run(workdir, plan, env)
    finally:  # the seeded token never outlives the drive (kit contract)
        ab.scrub_credentials(env)
```

(The dirt writes never commit, so `pre` is the same commit as before the reorder — spec §3. The comments about the registry-race fix and Keychain seeding now live with `prepare_cell`/the kit; delete the two stale comment lines that referenced them here.)

- [ ] **Step 6: Run the new test, then the suite**

Run: `python3 -m pytest tests/test_ab_runner.py::test_prepare_cell_runs_the_five_calls_in_order -v && python3 -m pytest`
Expected: PASS, suite green

- [ ] **Step 7: Sanity-run the dry path end-to-end**

Run: `python3 evals/ab_runner.py --engine-ref main --engine-label A --fixture wide --dry-run`
Expected: run-plan JSON printed, exit 0 (proves module-top import + `main` rewiring parse and run without touching claude).

- [ ] **Step 8: Commit**

```bash
git add evals/ab_runner.py evals/run_ab_cell.py tests/test_ab_runner.py
git commit -m "feat(#139): extract prepare_cell — one cell setup for both A/B entry points"
```
