# Gate Residual Smalls (#124 items 1–3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan may also be executed by `/ultrapowers`.

**Acceptance:** suite — committed pytest is the verification; cosmetic/coverage smalls on shipped fixes (no harness JS touched), sealing not requested.

**Goal:** Close #124 items 1–3: (1) a test exercising `--baseline` mode under a
symlinked TMPDIR (both committed symlink pins cover only the suite-gate and
sealed-exam entry points; `--baseline` inherits the canonicalization
structurally via the shared `run_exam` but nothing pins it); (2) one comment
noting the symlink fixture's mechanism differs by platform (macOS `mktemp -d`
ignores TMPDIR — the differential rides the /var→/private/var symlink; Linux
honors TMPDIR); (3) one SKILL.md sentence noting an explicitly-passed
empty/whitespace `--test-cmd` knob fails the test-command stage loudly instead
of falling through to detection. Out of scope, staying in the issue by name:
item 4 (`ultra_gate.py` whitespace-testCmd from a hand-edited receipt —
frozen periphery).

**Tech Stack:** Python 3.11 + pytest, bash. Suite: `python3 -m pytest` from
the repo root. No harness JS is touched, so no `.mjs` sim obligations.

**Plan-defect note (authoring):** issue #124's item-2 wording and the
existing comment block at `tests/test_run_acceptance.py:769-778` overlap; the
task below reconciles them rather than adding a duplicate paragraph.

---

### Task 1: `--baseline` symlinked-TMPDIR pin + dual-mechanism comment

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `tests/test_run_acceptance.py`

**Interfaces:**
- Consumes: `_symlinked_tmpdir_env(tmp_path, name)` (existing fixture helper,
  tests/test_run_acceptance.py:801) and the existing baseline-mode invocation
  pattern of `run_acceptance.sh --baseline --suite DIR --branch BASE`.

- [ ] **Step 1:** Add `test_baseline_survives_symlinked_tmpdir` alongside the
  two existing symlink pins (`test_suite_gate_survives_symlinked_tmpdir`,
  `test_sealed_exam_survives_symlinked_tmpdir`, lines ~810–830): invoke
  `run_acceptance.sh --baseline` through `_symlinked_tmpdir_env` against the
  same minimal fixture repo those tests use, asserting exit 0 and the
  baseline verdict JSON parses — pinning that `--baseline` inherits the
  path-canonicalization through the shared `run_exam` core. Confirm the test
  fails when run against a shadow copy of `run_acceptance.sh` with the
  canonicalization line removed (mutation check, same discipline as the
  sibling pins — do not commit the shadow).
- [ ] **Step 2:** Extend the `_symlinked_tmpdir_env` docstring (or the block
  comment at lines ~769–778 if that is the better home — pick one, do not
  duplicate) with the platform note: macOS `mktemp -d` ignores TMPDIR
  entirely (the differential rides the /var→/private/var symlink); Linux
  honors TMPDIR (the fixture's explicit symlink carries the differential).
  One comment, both mechanisms named.
- [ ] **Step 3:** `python3 -m pytest tests/test_run_acceptance.py -q` → PASS;
  full suite → PASS.
- [ ] **Step 4:** Commit: `test(gate): pin --baseline under symlinked TMPDIR + dual-mechanism comment (#124)`

---

### Task 2: SKILL.md `--test-cmd` loud-failure note

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`

- [ ] **Step 1:** In the `testCmd` bullet (SKILL.md:76 region), add one
  sentence: an explicitly-passed empty or whitespace-only `--test-cmd` fails
  the test-command stage loudly rather than falling through to detection —
  pass the knob only with a real command.
- [ ] **Step 2:** `python3 -m pytest -q` → PASS (word-budget/ratchet tests, if
  any cover SKILL.md, stay green).
- [ ] **Step 3:** Commit: `docs(skill): note --test-cmd empty/whitespace fails loudly (#124)`
