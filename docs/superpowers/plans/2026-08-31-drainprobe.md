# Drainprobe Report Flags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan may also be executed by `/ultrapowers`.

**Acceptance:** suite — the committed suite is the verification.

**Goal:** Add three independent flags to the drainprobe `report` CLI — `--verbose`, `--format`, `--limit` — plus a standalone text-padding helper. This is the measurement payload for the #454 concurrent-drain arms (map #360, sitting 2): the same plan is driven by every drain, so cross-run same-file traffic is manufactured by construction. The three flag tasks are functionally independent (each owns its parser line, its helper function, and its line in `main`) but all three genuinely edit `evals/drainprobe/probecli/cli.py`. That same-file contention is deliberate and left unserialized: no `Depends-on` marker orders these tasks, so any ordering the executor chooses must merge their concurrent edits to one file.

**Tech Stack:** Python 3.11 + pytest. Run the suite with `python3 -m pytest` from the repo root. The package lives at `evals/drainprobe/probecli/` and is importable as `probecli` — `tests/drainprobe/conftest.py` already puts `evals/drainprobe` on `sys.path`; do not add another path shim. Test files go in `tests/drainprobe/` and must keep the `test_drainprobe_` name prefix (test basenames are unique across the whole suite).

---

### Task 1: --verbose flag

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `evals/drainprobe/probecli/cli.py`
- Test: `tests/drainprobe/test_drainprobe_verbose.py`

- [ ] **Step 1: Write failing tests** for the verbose flag:
  - `build_parser()` accepts `--verbose` (`action="store_true"`, default `False`).
  - With `--verbose`, `main` prints a header line `rows: <n>` (the count of rows about to print) before the row lines; without it, output is unchanged.
  - Example: `main(["--verbose"])` prints `rows: 3` then the three row lines.
- [ ] **Step 2: Implement** in `evals/drainprobe/probecli/cli.py`: add the parser argument and the header print in `main`.

### Task 2: --format option

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `evals/drainprobe/probecli/cli.py`
- Test: `tests/drainprobe/test_drainprobe_format.py`

- [ ] **Step 1: Write failing tests** for row rendering:
  - A new function `render(row, fmt)`: `("ada", 3)` renders as `"ada 3"` for `fmt="plain"` and `"ada,3"` for `fmt="csv"`.
  - `build_parser()` accepts `--format` with `choices=["plain", "csv"]`, default `"plain"`.
  - `main(["--format", "csv"])` prints every row through `render(..., "csv")`; the default output stays exactly as before.
- [ ] **Step 2: Implement** in `evals/drainprobe/probecli/cli.py`: add `render`, the parser argument, and route `main`'s row printing through `render`.

### Task 3: --limit option

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `evals/drainprobe/probecli/cli.py`
- Test: `tests/drainprobe/test_drainprobe_limit.py`

- [ ] **Step 1: Write failing tests** for row limiting:
  - A new function `clamp(rows, limit)`: `limit=None` returns all rows as a list; otherwise the first `limit` rows; negative `limit` raises `ValueError("limit must be >= 0")`.
  - `build_parser()` accepts `--limit` (`type=int`, default `None`).
  - `main(["--limit", "1"])` prints only the first row.
- [ ] **Step 2: Implement** in `evals/drainprobe/probecli/cli.py`: add `clamp`, the parser argument, and apply `clamp` to the rows in `main`.

### Task 4: text padding helper

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `evals/drainprobe/probecli/textutil.py`
- Test: `tests/drainprobe/test_drainprobe_textutil.py`

- [ ] **Step 1: Write failing tests** for `pad(text, width)`:
  - Pads `text` with trailing spaces to `width`; text already at or beyond `width` is returned unchanged.
  - Negative `width` raises `ValueError("width must be >= 0")`.
  - Examples: `pad("ab", 5)` → `"ab   "`; `pad("abcdef", 3)` → `"abcdef"`.
- [ ] **Step 2: Implement** `pad` in `evals/drainprobe/probecli/textutil.py`.

### Task 5: Full-suite verification

**Type:** gate

**Files:** none

- [ ] Run `python3 -m pytest` from the repo root and confirm every test passes, including the pre-existing drainprobe smoke tests and the rest of the repository suite.
