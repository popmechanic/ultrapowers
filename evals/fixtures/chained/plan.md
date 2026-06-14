# Ledger Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan may also be executed by `/ultrapowers`.

**Acceptance:** sealed 4b5e2d78b16f (sha256:4b5e2d78b16f5d9c6128e32065081837c9350a285bf5c2ff953c86c979c0c466)

**Goal:** Build a five-stage ledger pipeline — validation, parsing, balance computation, report formatting, CLI — where each stage builds strictly on the previous one.

**Tech Stack:** Python 3.11 + pytest. Run the suite with `python3 -m pytest tests/ -q` from the repo root.

---

### Task 1: Entry validation

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `ledger/model.py`
- Test: `tests/test_validate.py`

- [ ] **Step 1: Write failing tests** for a new method `Entry.validate(self)`:
  - Raises `ValueError("empty description")` when `self.description.strip()` is empty.
  - Raises `ValueError("bad date")` unless `self.date` fully matches `\d{4}-\d{2}-\d{2}`.
  - Returns `None` on a valid entry.
- [ ] **Step 2: Implement** `validate` on the `Entry` dataclass in `ledger/model.py`.

### Task 2: Line parser

**Type:** implementation
**Depends-on:** 1

**Files:**
- Create: `ledger/parse.py`
- Test: `tests/test_parse.py`

- [ ] **Step 1: Write failing tests** for `parse_line(line)`:
  - Input format is `DATE|DESCRIPTION|AMOUNT`, e.g. `2026-01-15|coffee|-4.50`.
  - Split on `|`; anything other than exactly 3 fields raises `ValueError("bad line")`.
  - AMOUNT is dollars with exactly two decimal places, optional leading `-` (regex `-?\d+\.\d{2}`); anything else raises `ValueError("bad amount")`. Convert to integer cents (`"-4.50"` → `-450`).
  - Construct an `Entry`, call `entry.validate()` (so invalid dates/descriptions raise from Task 1's method), and return it.
- [ ] **Step 2: Implement** `parse_line` in `ledger/parse.py`.

### Task 3: Running balance

**Type:** implementation
**Depends-on:** 2

**Files:**
- Create: `ledger/balance.py`
- Test: `tests/test_balance.py`

- [ ] **Step 1: Write failing tests** for `running_balance(entries)`:
  - Takes a list of `Entry`; returns the list of cumulative sums of `amount_cents`.
  - Example: amounts `[1000, -450, 200]` → `[1000, 550, 750]`.
  - Empty list returns `[]`.
  - Tests should build entries via Task 2's `parse_line` to exercise the pipeline.
- [ ] **Step 2: Implement** `running_balance` in `ledger/balance.py`.

### Task 4: Report formatter

**Type:** implementation
**Depends-on:** 3

**Files:**
- Create: `ledger/report.py`
- Test: `tests/test_report.py`

- [ ] **Step 1: Write failing tests** for `format_cents(cents)` and `format_report(entries)`:
  - `format_cents(1000)` → `"$10.00"`; `format_cents(-450)` → `"-$4.50"`; `format_cents(0)` → `"$0.00"`.
  - `format_report(entries)` returns one line per entry — `f"{date} {description} {formatted_amount}"` — followed by a final line `f"TOTAL {formatted_total}"`, where the total is the last value of Task 3's `running_balance` (or 0 for no entries). Lines joined with `"\n"`, no trailing newline.
- [ ] **Step 2: Implement** both functions in `ledger/report.py`.

### Task 5: CLI entry point

**Type:** implementation
**Depends-on:** 4

**Files:**
- Create: `ledger/cli.py`
- Test: `tests/test_cli.py`

- [ ] **Step 1: Write failing tests** for `main(argv)`:
  - `argv` is a list whose first element is a path to a ledger file.
  - Read the file, skip blank (whitespace-only) lines, parse each remaining line with Task 2's `parse_line`, print Task 4's `format_report(entries)` to stdout, return `0`.
  - On any `ValueError`, print `f"error: {message}"` to stderr and return `1`.
  - Tests use `tmp_path` for fixture files and `capsys` for output.
- [ ] **Step 2: Implement** `main` in `ledger/cli.py`.

### Task 6: Full-suite verification

**Type:** gate

**Files:** none

- [ ] Run `python3 -m pytest tests/ -q` from the repo root and confirm every test passes, including the pre-existing model tests.
