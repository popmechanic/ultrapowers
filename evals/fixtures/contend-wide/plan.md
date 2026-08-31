# Clitool Wide Report Flags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan may also be executed by `/ultrapowers`.

**Acceptance:** suite — the committed suite is the verification.

**Goal:** Add eight independent flags to the `report` CLI — `--verbose`, `--format`, `--limit`, `--sort`, `--reverse`, `--total`, `--header`, `--json`. The eight flag tasks are functionally independent (each owns its parser line, its helper function, and its line in `main`) but all eight genuinely edit `clitool/cli.py`. That same-file contention is deliberate and left unserialized: no `Depends-on` marker orders these tasks, so any ordering the executor chooses must merge their concurrent edits to one file.

**Tech Stack:** Python 3.11 + pytest. Run the suite with `python3 -m pytest tests/ -q` from the repo root.

---

### Task 1: --verbose flag

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `clitool/cli.py`
- Test: `tests/test_verbose.py`

- [ ] **Step 1: Write failing tests** for the verbose flag:
  - A new function `header(n)`: returns the string `"rows: <n>"`; `header(3)` → `"rows: 3"`.
  - `build_parser()` accepts `--verbose` (`action="store_true"`, default `False`).
  - With `--verbose`, `main` prints `header(<n>)` (the count of rows about to print) before the row lines; without it, output is unchanged.
  - Example: `main(["--verbose"])` prints `rows: 3` then the three row lines.
- [ ] **Step 2: Implement** in `clitool/cli.py`: add `header`, the parser argument, and the header print in `main`.

### Task 2: --format option

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `clitool/cli.py`
- Test: `tests/test_format.py`

- [ ] **Step 1: Write failing tests** for row rendering:
  - A new function `render(row, fmt)`: `("ada", 3)` renders as `"ada 3"` for `fmt="plain"` and `"ada,3"` for `fmt="csv"`.
  - `build_parser()` accepts `--format` with `choices=["plain", "csv"]`, default `"plain"`.
  - `main(["--format", "csv"])` prints every row through `render(..., "csv")`; the default output stays exactly as before.
- [ ] **Step 2: Implement** in `clitool/cli.py`: add `render`, the parser argument, and route `main`'s row printing through `render`.

### Task 3: --limit option

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `clitool/cli.py`
- Test: `tests/test_limit.py`

- [ ] **Step 1: Write failing tests** for row limiting:
  - A new function `clamp(rows, limit)`: `limit=None` returns all rows as a list; otherwise the first `limit` rows; negative `limit` raises `ValueError("limit must be >= 0")`.
  - `build_parser()` accepts `--limit` (`type=int`, default `None`).
  - `main(["--limit", "1"])` prints only the first row.
- [ ] **Step 2: Implement** in `clitool/cli.py`: add `clamp`, the parser argument, and apply `clamp` to the rows in `main`.

### Task 4: --sort flag

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `clitool/cli.py`
- Test: `tests/test_sort.py`

- [ ] **Step 1: Write failing tests** for row sorting:
  - A new function `sort_rows(rows)`: returns a new list sorted by name ascending; `[("eve", 1), ("ada", 3)]` → `[("ada", 3), ("eve", 1)]`; the input list is not mutated.
  - `build_parser()` accepts `--sort` (`action="store_true"`, default `False`).
  - `main(["--sort"])` prints the rows in name order: `ada 3`, `bob 5`, `eve 1`; without `--sort`, output order is unchanged.
- [ ] **Step 2: Implement** in `clitool/cli.py`: add `sort_rows`, the parser argument, and apply `sort_rows` to the rows in `main` when the flag is set.

### Task 5: --reverse flag

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `clitool/cli.py`
- Test: `tests/test_reverse.py`

- [ ] **Step 1: Write failing tests** for row reversal:
  - A new function `reverse_rows(rows)`: returns a new list with the rows in reverse order; `[("ada", 3), ("bob", 5)]` → `[("bob", 5), ("ada", 3)]`; the input list is not mutated.
  - `build_parser()` accepts `--reverse` (`action="store_true"`, default `False`).
  - `main(["--reverse"])` prints `eve 1`, `bob 5`, `ada 3` (the default rows, last first); without `--reverse`, output order is unchanged.
- [ ] **Step 2: Implement** in `clitool/cli.py`: add `reverse_rows`, the parser argument, and apply `reverse_rows` to the rows in `main` when the flag is set.

### Task 6: --total flag

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `clitool/cli.py`
- Test: `tests/test_total.py`

- [ ] **Step 1: Write failing tests** for the total footer:
  - A new function `total(rows)`: returns the sum of the counts; `[("ada", 3), ("bob", 5)]` → `8`; `[]` → `0`.
  - `build_parser()` accepts `--total` (`action="store_true"`, default `False`).
  - With `--total`, `main` prints a footer line `total: <n>` (the sum over the rows just printed) after the row lines; without it, output is unchanged.
  - Example: `main(["--total"])` prints the three row lines then `total: 9`.
- [ ] **Step 2: Implement** in `clitool/cli.py`: add `total`, the parser argument, and the footer print in `main`.

### Task 7: --header flag

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `clitool/cli.py`
- Test: `tests/test_header.py`

- [ ] **Step 1: Write failing tests** for the column header:
  - A new function `column_header()`: returns the exact string `"name count"`.
  - `build_parser()` accepts `--header` (`action="store_true"`, default `False`).
  - With `--header`, `main` prints `name count` immediately before the row lines; without it, output is unchanged.
  - Example: `main(["--header"])` prints `name count` then the three row lines.
- [ ] **Step 2: Implement** in `clitool/cli.py`: add `column_header`, the parser argument, and the header print in `main`.

### Task 8: --json flag

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `clitool/cli.py`
- Test: `tests/test_json.py`

- [ ] **Step 1: Write failing tests** for JSON output:
  - A new function `to_json(rows)`: returns the rows as a compact JSON array string of `{"name": ..., "count": ...}` objects; `[("ada", 3)]` → `'[{"name": "ada", "count": 3}]'` (use `json.dumps` with default separators).
  - `build_parser()` accepts `--json` (`action="store_true"`, default `False`).
  - `main(["--json"])` prints exactly one line — `to_json` of the rows — instead of the per-row lines; without `--json`, output is unchanged.
  - Example: `main(["--json"])` prints `[{"name": "ada", "count": 3}, {"name": "bob", "count": 5}, {"name": "eve", "count": 1}]`.
- [ ] **Step 2: Implement** in `clitool/cli.py`: add `to_json`, the parser argument, and the single-line JSON print in `main` when the flag is set.
