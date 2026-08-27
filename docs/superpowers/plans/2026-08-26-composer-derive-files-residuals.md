# Composer Hardening Implementation Plan (#261 + #244)

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Acceptance:** suite — pure-Python composer scripts, every change pinned by pytest.

**Goal:** derive_files validates instruction-derived path candidates (exists-on-tree OR declared-FILES) with a visible drop report, plus the #244 residual batch (chain-file fallback, PROG pin, findings_naming tightening, snapshot dedup, numbering-hole pin, dead guard, drain/prose fixes).

**Architecture:** All behavior changes live in `redirect_args.py` / `salvage_args.py` / `residual_manifest.py`; prose fixes ride the composer task. No engine (waves.js) contact.

**Tech Stack:** Python 3 + pytest.

**Spec:** docs/superpowers/specs/2026-08-26-composer-derive-files-residuals.md

## Global Constraints

- FROZEN periphery untouched: `gate_check.py`, `ultra_gate.py`, `run_lock.sh`, sealing scripts, compiler diagnostic vocabulary — zero diff.
- `skills/ultrapowers/harnesses/*.js` untouched (no sim obligations).
- `python3 -m pytest` green (baseline ≥1169; this plan adds tests).

---

### Task 1: Composer scripts — guard + residuals 1, 2, 3, 4, 7, 8, 9

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/redirect_args.py`
- Modify: `skills/ultrapowers/scripts/salvage_args.py`
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultradocket/SKILL.md`
- Test: `tests/test_redirect_args.py`
- Test: `tests/test_salvage_args.py`

**Interfaces:**
- Produces: `derive_files(task_files, instruction, finding_files, declared=None) -> list[str]` (4th param: the launch's declared-FILES set; `None` = guard off for direct/legacy callers)

- [ ] **Step 1: Failing tests — derive_files guard (#261).** In `tests/test_redirect_args.py` add:

```python
def test_derive_files_guard_drops_fake_paths(capsys):
    # tokens that leak today: quoted ext list, glob mask, code fragment
    out = ra.derive_files(["a.py"], 'set the mask to "src/**/*.py" and rename foo(bar).py; exts ".py, .js"',
                          [], declared={"a.py"})
    assert out == ["a.py"]
    err = capsys.readouterr().err
    assert "dropped" in err and "src/**/*.py" in err


def test_derive_files_guard_keeps_real_and_declared(capsys):
    # exists-on-tree leg (pytest.ini at repo root) + declared-FILES leg
    out = ra.derive_files(["a.py"], "edit pytest.ini then wire lib/util.py",
                          [], declared={"a.py", "lib/util.py"})
    assert out == ["a.py", "pytest.ini", "lib/util.py"]
    assert capsys.readouterr().err == ""


def test_derive_files_finding_files_bypass_guard():
    # orchestrator-authored files are trusted even when absent everywhere
    out = ra.derive_files(["a.py"], "", ["brand/new.py"], declared={"a.py"})
    assert out == ["a.py", "brand/new.py"]


def test_derive_files_declared_none_bypasses_guard():
    # legacy/direct callers without a launch keep #223 behavior
    assert ra.derive_files(["a.py"], "touch b.py and a.py", ["c.py", "b.py"]) == ["a.py", "b.py", "c.py"]
```

Update `test_files_derived_from_instruction_paths` (CLI path): the instruction's `src/guard.py` / `tests/test_guard.py` / `README` exist nowhere and are undeclared → expect files `["a.py"]` unchanged and the drop report on stderr naming all three (this is now the guard's end-to-end negative pin).

- [ ] **Step 2: Implement the guard.** In `redirect_args.py`, `derive_files` gains `declared=None`; instruction-derived candidates pass iff `os.path.exists(p) or (declared is not None and p in declared)`; dropped tokens print one stderr line `"%s: dropped %d instruction token(s) not on tree or in declared FILES: %s"`. In `main()`, before the findings loop compute `declared = {p for t in tasks.values() for p in (t.get("files") or [])} | {p for e in entries.values() for p in (e.get("files") or [])}` and pass it. Docstring notes the chained-launch trust nuance (pre-guard leaked tokens self-legitimize; harmless forward).

- [ ] **Step 3: Failing tests — chain-file fallback (residuals 1+7).** In `tests/test_redirect_args.py`: (a) a run dir holding only `redirect-launch.json` (legacy name, amended bodies) chains from it and warns on stderr; (b) with `--out-dir` pointing at a fresh dir while `relaunch-launch.json` sits beside the receipt, bodies chain from the receipt-side file (no pristine re-derive).

- [ ] **Step 4: Implement fallback.** In `load_context`: probe, in order, `relaunch-launch.json` then legacy `redirect-launch.json`, each in `run_dir` then `receipt_dir`; first hit wins; stderr warning when the legacy name is used; fall through to `args.get("wavesPath")`. Add `LEGACY_CHAIN_LAUNCH = "redirect-launch.json"` beside `CHAIN_LAUNCH`.

- [ ] **Step 5: Failing tests — snapshot dedup (residual 4) + PROG pin (residual 2) + findings_naming (residual 3).**

test_redirect_args.py:

```python
def test_rotation_skips_byte_identical_snapshot(tmp_path):
    run = tmp_path
    (run / "report.json").write_text('{"r": 1}')
    first = ra.rotate_round_artifacts(str(run))
    assert first["report"] and (run / "report-1.json").is_file()
    second = ra.rotate_round_artifacts(str(run))          # unchanged live report
    assert second["report"] is None
    assert sorted(p.name for p in run.glob("report-*.json")) == ["report-1.json"]
    (run / "report.json").write_text('{"r": 2}')
    third = ra.rotate_round_artifacts(str(run))           # changed → snapshots again
    assert third["report"] and (run / "report-2.json").is_file()
```

test_salvage_args.py:

```python
def test_import_leaves_redirect_prog():
    import redirect_args as ra_mod
    import salvage_args  # noqa: F401  (import must not rebind the sibling's PROG)
    assert ra_mod.PROG == "redirect_args"


def test_findings_naming_tightened():
    rep = {"completenessFindings": [
        "Task 1 deleted 3 tests",              # incidental number — names only 1
        "tasks 2 and 3 left the guard untested",
        "tasks #2 and #3 still apply",
        "task 22 is unrelated",
    ]}
    assert sa.findings_naming(rep, "3") == ["tasks 2 and 3 left the guard untested",
                                            "tasks #2 and #3 still apply"]
    assert sa.findings_naming(rep, "1") == ["Task 1 deleted 3 tests"]
    assert sa.findings_naming(rep, "2") == ["tasks 2 and 3 left the guard untested",
                                            "tasks #2 and #3 still apply"]
    assert sa.findings_naming(rep, "22") == ["task 22 is unrelated"]
```

- [ ] **Step 6: Implement.** `rotate_round_artifacts`: before copying, find the highest existing `report-<k>.json`; skip the copy (leaving `out["report"] = None`) when `filecmp.cmp(report, highest, shallow=False)` — `import filecmp`; heads handling unchanged. `findings_naming` regex becomes `re.compile(r"\btasks?\b[\s,&#]*(?:(?:and|or|\d+)[\s,&#]*)*?\b" + re.escape(tid) + r"\b", re.IGNORECASE)` with the comment updated (connector class: ids, commas, whitespace, `#`, and/or/&).

- [ ] **Step 7: Prose (residuals 8+9).** `salvage_args.py` docstring line "Budget-deferred unfinished entries are listed on stderr, not salvaged." → "Other unfinished entries are listed on stderr, not salvaged." `skills/ultrapowers/SKILL.md` Salvage bullet "(budget-deferred entries are listed on stderr, not salvaged)" → "(other unfinished entries are listed on stderr, not salvaged)". `skills/ultradocket/SKILL.md`, sentence "Parked branches are presented for the operator to Salvage/Redirect with full context." gains: " (a drain run's args carry no `integrationBranch` and the drain writes no `gate-receipt.json` — pass `--integration-branch <docket-integration-branch>` to the composer)".

- [ ] **Step 8: Run** `python3 -m pytest tests/test_redirect_args.py tests/test_salvage_args.py -q` → green. **Commit:**

```bash
git add skills/ultrapowers/scripts/redirect_args.py skills/ultrapowers/scripts/salvage_args.py skills/ultrapowers/SKILL.md skills/ultradocket/SKILL.md tests/test_redirect_args.py tests/test_salvage_args.py
git commit -m "feat(composers): derive_files path guard + chain-file fallback, findings_naming tightening, snapshot dedup, PROG pin, drain/prose fixes (#261, #244)"
```

### Task 2: residual_manifest — dead guard + numbering-hole pin (residuals 5, 6)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/residual_manifest.py`
- Test: `tests/test_residual_manifest.py`

**Interfaces:**
- Consumes: nothing from Task 1 (disjoint files).

- [ ] **Step 1: Failing test — numbering hole.** In `tests/test_residual_manifest.py` add a `--run-dir` case with `report-3.json` present, `report-1.json` absent, and a live `report.json`: derive succeeds and orders rounds correctly (the hole is tolerated; verified-empirical behavior now pinned).

- [ ] **Step 2: Dead guard.** In `main()`, the `--run-dir` exclusivity guard `if a.reports or a.check:` → `if a.reports:` with message trimmed to `"--run-dir takes no positional reports"` (the `a.check` half is unreachable — the `if a.check:` block above returns/dies first). The die-string reflow noted in #244 item 6 is cosmetic and NOT touched.

- [ ] **Step 3: Run** `python3 -m pytest tests/test_residual_manifest.py -q` → green. **Commit:**

```bash
git add skills/ultrapowers/scripts/residual_manifest.py tests/test_residual_manifest.py
git commit -m "fix(residual-manifest): drop dead --check guard half; pin round-numbering-hole derive (#244)"
```

### Task 3: Suite gate

**Type:** gate
**Depends-on:** 1, 2

`python3 -m pytest` green; no harness JS touched so no sim obligation.

## Operator smoke

- do: `python3 skills/ultrapowers/scripts/redirect_args.py --receipt <any old runDir>/receipt.json --findings <findings naming a code fragment like foo(bar).py>` (or read the new tests' captured stderr)
- see: `redirect_args: dropped 1 instruction token(s) not on tree or in declared FILES: foo(bar).py` — fake paths no longer enter task scopes silently.
- do: `grep -n "budget-deferred" skills/ultrapowers/SKILL.md skills/ultrapowers/scripts/salvage_args.py`
- see: no hits — both prose copies now say "other unfinished entries".
- do: `grep -A1 "Salvage/Redirect with full context" skills/ultradocket/SKILL.md`
- see: the drain composer sentence naming `--integration-branch <docket-integration-branch>`.
