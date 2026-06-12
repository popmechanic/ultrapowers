# Confkit Layered Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan may also be executed by `/ultrapowers`.

**Acceptance:** sealed 08e1b4f94c8a (sha256:08e1b4f94c8aee238cb24fa8d6a3c7475e9547aaf22fc451ae2c755258045610)

**Goal:** Add two configuration layers — environment-variable overrides, then file loading with merge precedence — to `confkit/config.py`. Both tasks edit the same module, so they must run sequentially.

**Tech Stack:** Python 3.11 + pytest. Run the suite with `python3 -m pytest tests/ -q` from the repo root.

---

### Task 1: Environment-variable override layer

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `confkit/config.py`
- Test: `tests/test_env_overrides.py`

- [ ] **Step 1: Write failing tests** for two new functions in `confkit/config.py`:
  - `parse_value(raw)`: `"true"`/`"false"` (case-insensitive) → `True`/`False`; an optional leading `-` followed by all digits → `int`; anything else → the string unchanged.
  - `load_env_overrides(environ)`: takes a mapping; for every key starting with `CONFKIT_`, emit `{key_without_prefix.lower(): parse_value(value)}`. Other keys are ignored.
  - Example: `load_env_overrides({"CONFKIT_PORT": "9000", "PATH": "/bin"})` → `{"port": 9000}`.
- [ ] **Step 2: Implement** both functions in `confkit/config.py`. Do not change `get_config` yet.

### Task 2: File layer and merge precedence

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `confkit/config.py`
- Test: `tests/test_file_layer.py`

- [ ] **Step 1: Write failing tests** for the file layer and the new `get_config` signature:
  - `load_file(path)`: read the file; strip each line; skip blank lines and lines starting with `#`; every other line must contain `=` or raise `ValueError("bad line")`; split on the FIRST `=`; key is the stripped left side, value is `parse_value` of the stripped right side.
  - `get_config(path=None, environ=None)`: start from a copy of `DEFAULTS`; if `path` is given, update with `load_file(path)`; if `environ` is given, update with Task 1's `load_env_overrides(environ)`. Precedence: defaults < file < env.
  - `get_config()` with no arguments still returns the defaults (existing tests must keep passing).
- [ ] **Step 2: Implement** in `confkit/config.py`.

### Task 3: Full-suite verification

**Type:** gate

**Files:** none

- [ ] Run `python3 -m pytest tests/ -q` from the repo root and confirm every test passes, including the pre-existing default-config tests.
