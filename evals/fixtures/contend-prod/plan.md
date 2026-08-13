# Eventboard Contended Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan may also be executed by `/ultrapowers`.

**Acceptance:** sealed 6752e4ce1b25 (sha256:6752e4ce1b25d9898538af705c6a3daae1030ae8dc8875947295f5c7f33c1714)

**Goal:** Add four independent features to the `eventboard` service — input validation, an export formatter, a rate-limit/quota guard, and an audit log. Each feature is its own new module with its own test suite, but all four genuinely extend `app/registry.py`: a two-key config block in `DEFAULT_CONFIG`, and a registration line in the "feature wiring" section at the bottom of the file (an import plus one append/update call). No feature edits `bootstrap()`'s body or any other feature's module. That same-file contention on `registry.py` is deliberate and left unserialized: no `Depends-on` marker orders these tasks, so any ordering the executor chooses must merge their concurrent edits to one file.

**Tech Stack:** Python 3.11 + pytest. Run the suite with `python3 -m pytest tests/ -q` from the repo root (`project/`).

**Reading `app/registry.py` first:** every task below assumes you've read the module docstring at the top of `app/registry.py` — it documents the four hook lists (`PRE_CREATE_HOOKS`, `POST_CREATE_HOOKS`, `DISPATCH_HOOKS`, `EXPORT_FORMATS`) and their exact call signatures. `DISPATCH_HOOKS` run for **every** `App.call(...)`, in append order, before the router dispatches — including calls that will later fail validation, and including calls made with no `actor` kwarg (hooks that read `kwargs.get("actor", "anonymous")` see `"anonymous"`).

---

### Task 1: Input-validation layer

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `app/validation.py`
- Modify: `app/registry.py`
- Test: `tests/test_validation.py`

- [ ] **Step 1: Write failing tests** in `tests/test_validation.py` for `app/validation.py`:
  - `ValidationError` is an `Exception` subclass.
  - `validate_fields(fields, required_fields, max_amount)`:
    - raises `ValidationError("missing field: name")` when `fields` has no `"name"` key and `"name"` is in `required_fields` — check the message names the field.
    - raises `ValidationError("missing field: amount")` the same way for a missing `"amount"`, and when BOTH are missing, the error names `"name"` first (required_fields order).
    - raises `ValidationError` containing `"numeric"` when `amount` is a string (e.g. `"3"`).
    - raises `ValidationError` containing `"numeric"` when `amount` is a `bool` (`True`/`False` are not valid amounts even though `isinstance(True, int)` is `True` in Python — this is the edge case the check must not miss).
    - raises `ValidationError` containing `"non-negative"` when `amount` is `-1`.
    - accepts `amount == 0` (boundary: zero is valid, not "negative").
    - raises `ValidationError` containing `"max_amount"` when `amount` is one more than `max_amount`; accepts `amount == max_amount` exactly (boundary).
    - raises `ValidationError` containing `"non-empty string"` when `name` is `""`, when `name` is `"   "` (whitespace-only), and when `name` is not a string (e.g. `42`).
    - on success, returns a **new** dict (the input dict is unmodified) whose `"name"` is stripped of leading/trailing whitespace, and every other key/value from the input is preserved unchanged.
    - a `fields` dict with EXTRA keys beyond `required_fields` passes validation untouched (validation is additive, not a schema whitelist).
  - `pre_create_hook(store, config, fields)` calls `validate_fields` using `config["validation_required_fields"]` and `config["validation_max_amount"]` — assert it raises/passes consistently with direct `validate_fields` calls using a `config` dict shaped like `{"validation_required_fields": [...], "validation_max_amount": ...}` (the `store` argument is unused by this hook; pass `None`).
  - That's 10 assertions across the cases above; write one test function per bullet (or group tightly related boundary pairs into one function) rather than one giant test.

- [ ] **Step 2: Run to verify failure** — `python3 -m pytest tests/test_validation.py -v` → FAIL (`app/validation.py` doesn't exist).

- [ ] **Step 3: Implement `app/validation.py`** — `ValidationError`, `validate_fields`, `pre_create_hook`, per Step 1's contract exactly (check `required_fields` presence first, in order; only validate `amount`/`name` when the key is present in `fields`, since `required_fields` may not include them for a differently-configured caller).

- [ ] **Step 4: Wire the registry** — in `app/registry.py`:
  - add two keys to `DEFAULT_CONFIG`, near its existing keys (do not reorder or reformat the existing lines): `"validation_required_fields": ["name", "amount"]` and `"validation_max_amount": 100000`.
  - in the "feature wiring" section at the bottom of the file, add:
    ```python
    from app import validation  # noqa: E402
    PRE_CREATE_HOOKS.append(validation.pre_create_hook)
    ```

- [ ] **Step 5: Run to verify pass** — `python3 -m pytest tests/test_validation.py tests/ -v` → PASS, including the pre-existing `tests/test_registry.py`.

- [ ] **Step 6: Commit.**

```bash
git add app/validation.py app/registry.py tests/test_validation.py
git commit -m "feat(eventboard): input-validation layer on record creation"
```

---

### Task 2: Export/report formatter

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `app/export.py`
- Modify: `app/registry.py`
- Test: `tests/test_export.py`

- [ ] **Step 1: Write failing tests** in `tests/test_export.py` for `app/export.py`:
  - `to_csv([])` returns `""` (empty list, no header row either — an empty export has no columns to name).
  - `to_csv(records)` emits a header row of every field name that appears across ALL records, **sorted alphabetically**, then one row per record in input order, with a missing field on a given record rendered as an empty cell (records need not share every field).
  - `to_csv` renders non-string values (`int`, `float`) via plain `str()` — assert an integer amount round-trips as its decimal digits with no `.0` suffix.
  - `to_json([])` returns `"[]"`.
  - `to_json(records)` round-trips through `json.loads` back to the same list of dicts, and its keys are sorted (`sort_keys=True` — assert the raw string, not just the parsed value, so key ordering is actually pinned).
  - `FORMATS` is a dict with exactly the keys `"csv"` and `"json"` mapping to `to_csv`/`to_json`.
  - `render(records, "csv")` and `render(records, "json")` delegate to the matching function (equality-check the output against calling `to_csv`/`to_json` directly).
  - `render(records, "xml")` raises `ValueError` whose message contains `"xml"`.
  - That's 8 cases; add a 9th and 10th covering a single-record list for both formats (the degenerate n=1 case, which the header-row logic in `to_csv` handles differently from n=0 and n>=2).

- [ ] **Step 2: Run to verify failure** — `python3 -m pytest tests/test_export.py -v` → FAIL.

- [ ] **Step 3: Implement `app/export.py`** — `to_csv`, `to_json`, `FORMATS`, `render`, per Step 1's contract exactly.

- [ ] **Step 4: Wire the registry** — in `app/registry.py`:
  - add two keys to `DEFAULT_CONFIG`, near its existing keys: `"export_default_format": "csv"` and `"export_formats_enabled": ["csv", "json"]`.
  - in the "feature wiring" section, add:
    ```python
    from app import export  # noqa: E402
    EXPORT_FORMATS.update(export.FORMATS)
    ```
  - **Do not** add a route or touch `bootstrap()` — `GET /export` is already registered and already calls `_export`, which reads `EXPORT_FORMATS` and `config["export_default_format"]`/`config["export_formats_enabled"]`; your registration line is the only thing `/export` is waiting on.

- [ ] **Step 5: Run to verify pass** — `python3 -m pytest tests/test_export.py tests/ -v` → PASS. Also confirm end-to-end: `bootstrap().call("GET", "/export")` on an app with two created records returns the same string as `export.to_csv` on those records.

- [ ] **Step 6: Commit.**

```bash
git add app/export.py app/registry.py tests/test_export.py
git commit -m "feat(eventboard): CSV/JSON export formatter, wired to the pre-existing /export route"
```

---

### Task 3: Rate-limit/quota module

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `app/ratelimit.py`
- Modify: `app/registry.py`
- Test: `tests/test_ratelimit.py`

- [ ] **Step 1: Write failing tests** in `tests/test_ratelimit.py` for `app/ratelimit.py`. Call `reset()` at the start of every test (module-global counters — tests must not leak into each other):
  - `RateLimitExceededError` is an `Exception` subclass.
  - `check_and_increment("k", 3)` returns `1`, `2`, `3` on the first three calls for key `"k"`, then raises `RateLimitExceededError` on the fourth — assert the message contains both the key and the limit.
  - the counter is **per key**: exhausting `"a"`'s quota does not affect `"b"`'s (interleave calls to two keys and assert neither raises before its own limit).
  - `reset()` clears ALL keys' counters, not just one.
  - `dispatch_hook(store, config, "GET", "/records", {})` never raises and never increments (rate limiting applies to writes, not reads) — assert this by calling it `max_per_window + 5` times with the same config and confirming no error, then confirm a subsequent `POST` still starts counting from zero relative to its own key... actually assert this directly: call `dispatch_hook` with `"GET"` many times, then call `check_and_increment` on the same key used internally and confirm it starts at `1` (GET calls never touched the counter).
  - `dispatch_hook(store, config, "POST", "/records", kwargs)` reads its key from `kwargs.get("actor", "anonymous")` — two calls with no `"actor"` key share the `"anonymous"` counter; a call with `actor="x"` uses a separate counter from `"anonymous"`.
  - `dispatch_hook` reads its limit from `config["rate_limit_max_per_window"]` — a `config` with limit `1` raises on the second same-key `POST`, a `config` with limit `2` does not.
  - That's 8 cases across the calls above (some bullets are 2 assertions) — write enough test functions to cover each named behavior separately; do not collapse them into one mega-test, since a fold conflict resolution needs to see which individual case broke.

- [ ] **Step 2: Run to verify failure** — `python3 -m pytest tests/test_ratelimit.py -v` → FAIL.

- [ ] **Step 3: Implement `app/ratelimit.py`** — `RateLimitExceededError`, `_counts` (module-global dict), `reset`, `check_and_increment`, `dispatch_hook`, per Step 1's contract exactly (`dispatch_hook` is a no-op for any method other than `"POST"`).

- [ ] **Step 4: Wire the registry** — in `app/registry.py`:
  - add two keys to `DEFAULT_CONFIG`, near its existing keys: `"rate_limit_max_per_window": 5` and `"rate_limit_window_seconds": 60` (the seconds value is recorded for a future wall-clock window and is not read by any code in this plan — `dispatch_hook` counts calls, not time, per its module docstring).
  - in the "feature wiring" section, add:
    ```python
    from app import ratelimit  # noqa: E402
    DISPATCH_HOOKS.append(ratelimit.dispatch_hook)
    ```

- [ ] **Step 5: Run to verify pass** — `python3 -m pytest tests/test_ratelimit.py tests/ -v` → PASS.

- [ ] **Step 6: Commit.**

```bash
git add app/ratelimit.py app/registry.py tests/test_ratelimit.py
git commit -m "feat(eventboard): per-actor rate-limit/quota guard on POST /records"
```

---

### Task 4: Audit log

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `app/audit.py`
- Modify: `app/registry.py`
- Test: `tests/test_audit.py`

- [ ] **Step 1: Write failing tests** in `tests/test_audit.py` for `app/audit.py`. Call `clear()` at the start of every test (module-global log — tests must not leak into each other):
  - `entries()` on a fresh (cleared) log returns `[]`.
  - `record("GET", "/records", "alice", 500)` appends exactly one entry `{"method": "GET", "path": "/records", "actor": "alice"}` to `entries()`.
  - `entries()` returns entries in call order (append three distinct records, assert the returned list order).
  - `entries()` returns a **copy** — mutating the returned list does not affect a later `entries()` call.
  - the cap: `max_entries=3` and four `record(...)` calls leaves exactly 3 entries, and they are the **last** 3 (oldest dropped first) — assert both the length and which entries survived.
  - the cap is checked/enforced on every call, not just at the end — a sequence of 5 calls with `max_entries=2` never has `entries()` exceed length 2 at any point (call `record` one at a time and assert length `<= 2` after each).
  - `dispatch_hook(store, config, "GET", "/records", {})` appends an entry with `actor == "anonymous"` (no `"actor"` kwarg given) and `method == "GET"`, `path == "/records"`.
  - `dispatch_hook(store, config, "POST", "/records", {"actor": "bob", "name": "x"})` appends an entry with `actor == "bob"` — the log entry has exactly the three keys `method`/`path`/`actor`, never the record fields (`"name"` must not leak into the audit entry).
  - `dispatch_hook` reads its cap from `config["audit_log_max_entries"]` — a `config` with cap `1` and two calls to `dispatch_hook` leaves exactly 1 entry.
  - `dispatch_hook` fires for **every** method, not just `POST`/`GET` — call it once with `"DELETE"` and once with `"PUT"` and assert both appended (unlike rate limiting, the audit log does not special-case the method).
  - That's 10 cases; one test function per bullet.

- [ ] **Step 2: Run to verify failure** — `python3 -m pytest tests/test_audit.py -v` → FAIL.

- [ ] **Step 3: Implement `app/audit.py`** — `_log` (module-global list), `clear`, `entries`, `record`, `dispatch_hook`, per Step 1's contract exactly.

- [ ] **Step 4: Wire the registry** — in `app/registry.py`:
  - add two keys to `DEFAULT_CONFIG`, near its existing keys: `"audit_log_enabled": True` (recorded for a future on/off switch and not read by any code in this plan — `dispatch_hook` always logs, per its module docstring) and `"audit_log_max_entries": 500`.
  - in the "feature wiring" section, add:
    ```python
    from app import audit  # noqa: E402
    DISPATCH_HOOKS.append(audit.dispatch_hook)
    ```

- [ ] **Step 5: Run to verify pass** — `python3 -m pytest tests/test_audit.py tests/ -v` → PASS.

- [ ] **Step 6: Commit.**

```bash
git add app/audit.py app/registry.py tests/test_audit.py
git commit -m "feat(eventboard): audit log of every dispatched call"
```

---

### Task 5: Full-suite verification

**Type:** gate

**Files:** none

- [ ] Run `python3 -m pytest tests/ -q` from the repo root (`project/`) and confirm every test passes, including the pre-existing smoke tests in `tests/test_router.py`, `tests/test_storage.py`, `tests/test_report.py`, and `tests/test_registry.py`. `app/registry.py` should now carry all four features' config blocks and all four wiring lines with no other lines disturbed.
