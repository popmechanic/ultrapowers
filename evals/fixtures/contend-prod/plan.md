# Eventboard Contended Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan may also be executed by `/ultrapowers`.

**Acceptance:** sealed 4d131df61152 (sha256:4d131df611521b11c39a23f2cb5eb5d379d7c0f3c3c7896d835397d78f860c6c)

**Goal:** Add four independent features to the `eventboard` service — input validation, an export formatter, a rate-limit/quota guard, and an audit log. Each feature is a pair of new modules (its user-facing module plus the toolkit it builds on) with its own test suites, but all four genuinely extend `app/registry.py`: a config block (two or three keys) in `DEFAULT_CONFIG`, and a registration line in the "feature wiring" section at the bottom of the file (an import plus one append/update call). No feature edits `bootstrap()`'s body or any other feature's module. That same-file contention on `registry.py` is deliberate and left unserialized: no `Depends-on` marker orders these tasks, so any ordering the executor chooses must merge their concurrent edits to one file.

**Tech Stack:** Python 3.11 + pytest. Run the suite with `python3 -m pytest tests/ -q` from the repo root (`project/`).

**Reading `app/registry.py` first:** every task below assumes you've read the module docstring at the top of `app/registry.py` — it documents the four hook lists (`PRE_CREATE_HOOKS`, `POST_CREATE_HOOKS`, `DISPATCH_HOOKS`, `EXPORT_FORMATS`) and their exact call signatures. `DISPATCH_HOOKS` run for **every** `App.call(...)`, in append order, before the router dispatches — including calls that will later fail validation, and including calls made with no `actor` kwarg (hooks that read `kwargs.get("actor", "anonymous")` see `"anonymous"`).

---

### Task 1: Input-validation layer + schema toolkit

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `app/validation.py`
- Create: `app/schema.py`
- Modify: `app/registry.py`
- Test: `tests/test_validation.py`
- Test: `tests/test_schema.py`

- [ ] **Step 1a: Write failing tests** in `tests/test_schema.py` for `app/schema.py` — the declarative toolkit `app/validation.py` builds on. One test function per bullet:
  - `ERROR_CATALOG` is a dict with **exactly** the keys `"missing"`, `"numeric"`, `"non_negative"`, `"max"`, `"non_empty"`, each mapping to a `str.format` template.
  - `format_error("missing", field="name")` returns **exactly** `"missing field: name"`.
  - `format_error("numeric", field="amount", got="str")` returns **exactly** `"field amount must be numeric (got str)"`.
  - `format_error("non_negative", field="amount")` returns **exactly** `"field amount must be non-negative"`.
  - `format_error("max", field="amount", limit=100)` returns **exactly** `"field amount exceeds max_amount 100"`.
  - `format_error("non_empty", field="name")` returns **exactly** `"field name must be a non-empty string"`.
  - `format_error("nope")` raises `KeyError` (unknown code — never a silent fallback message).
  - `check_required({"amount": 1}, ["name", "amount"])` returns `["name"]`; with both missing returns `["name", "amount"]` in **required_fields order** (not dict order — pass a dict whose insertion order disagrees and assert); with none missing returns `[]`.
  - `is_valid_amount`: `True` for `0`, `5`, and `3.5`; `False` for `True`, `False` (bools are not amounts even though `isinstance(True, int)`), `"3"`, `None`, `float("nan")`, `float("inf")`, `float("-inf")` (use `math.isfinite`; NaN must not slip through a `>=` chain).
  - `is_non_empty_str`: `True` for `"a"` and `" a "` (has non-whitespace content); `False` for `""`, `"   "`, `42`, `None`.
  - `SchemaError` is an `Exception` subclass, distinct from `KeyError`/`ValueError`.
  - `compile_spec(spec)` compiles a declarative field spec — a dict mapping field name → rules dict whose only legal keys are `"required"` (bool), `"type"` (`"str"` or `"number"`), `"non_empty"` (bool), `"max"` (number) — into a reusable validator callable. Compile-time checks (no fields needed): an unknown rule key raises `ValueError` naming the key; a `"type"` value outside the two legal strings raises `ValueError` naming the value; `compile_spec({})` compiles and its validator accepts any dict unchanged.
  - the compiled `validator(fields)`:
    - checks every `required: True` field first, in **spec insertion order**, raising `SchemaError` with the exact `format_error("missing", ...)` message for the first absent one.
    - then, per present field with rules, in spec order: `"type": "number"` enforces `is_valid_amount` (so bools, numeric strings, NaN and infinities all fail) raising the `"numeric"` catalog message; `"type": "str"` enforces `isinstance(str)`; `"non_empty": True` enforces `is_non_empty_str` raising the `"non_empty"` message; `"max": N` enforces `value <= N` raising the `"max"` message (boundary: equal passes).
    - on success returns a **new** dict in which every field whose rules include `non_empty: True` is `.strip()`ed, everything else copied through unchanged — the input dict is never mutated (assert), and the validator is reusable and deterministic (two calls on equal inputs return equal results).
    - fields present in `fields` but absent from the spec pass through untouched (specs constrain, they do not whitelist).
  - That's 10 more schema functions beyond the catalog/predicate ones — roughly 22 test functions in this file all told; one per bullet or sub-bullet.

- [ ] **Step 1b: Write failing tests** in `tests/test_validation.py` for `app/validation.py`:
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
  - exact messages, via the catalog: `str(err)` for a missing `name` is **exactly** `"missing field: name"`; for `amount=True` it is exactly `"field amount must be numeric (got bool)"` (`got` is always `type(value).__name__`); for `amount=-1` exactly `"field amount must be non-negative"`; for an over-max amount exactly `"field amount exceeds max_amount {max_amount}"`; for a bad name exactly `"field name must be a non-empty string"` — every message comes from `schema.format_error`, so these pin the delegation.
  - float amounts are legal: `3.5` accepted when under `max_amount`; a float exactly equal to `max_amount` accepted (boundary holds for floats too).
  - `None`, `float("nan")`, `float("inf")`, and `float("-inf")` as `amount` (key present) all raise `ValidationError` containing `"numeric"`.
  - `name` internal whitespace is preserved: `"  ada lovelace  "` strips to `"ada lovelace"`; a non-ASCII name (`"Δ"`) is accepted unchanged.
  - `required_fields=[]` with `fields={}` passes and returns `{}`.
  - `max_amount=0`: `amount=0` accepted, `amount=1` raises `"max_amount"`.
  - the returned dict is a **shallow** copy: a mutable value (e.g. `fields["tags"] = [1, 2]`) is the **same object** in the result (`result["tags"] is fields["tags"]`).
  - delegation is real, not a reimplementation: monkeypatch `schema.is_valid_amount` to always return `False` and assert a previously-valid amount now raises `"numeric"` through `validate_fields`.
  - That's 18 cases across the cases above; write one test function per bullet (or group tightly related boundary pairs into one function) rather than one giant test.

- [ ] **Step 2: Run to verify failure** — `python3 -m pytest tests/test_schema.py tests/test_validation.py -v` → FAIL (neither module exists).

- [ ] **Step 3: Implement `app/schema.py` then `app/validation.py`** — `schema`: `ERROR_CATALOG`, `format_error`, `check_required`, `is_valid_amount`, `is_non_empty_str`, `SchemaError`, `compile_spec`, per Step 1a exactly; `validation`: `ValidationError`, `validate_fields`, `pre_create_hook`, per Step 1b exactly (check `required_fields` presence first, in order, via `schema.check_required`; only validate `amount`/`name` when the key is present in `fields`, since `required_fields` may not include them for a differently-configured caller; **no error-message string literals in `validation.py`** — every message is built by `schema.format_error`).

- [ ] **Step 4: Wire the registry** — in `app/registry.py`:
  - add two keys to `DEFAULT_CONFIG`, near its existing keys (do not reorder or reformat the existing lines): `"validation_required_fields": ["name", "amount"]` and `"validation_max_amount": 100000`.
  - in the "feature wiring" section at the bottom of the file, add:
    ```python
    from app import validation  # noqa: E402
    PRE_CREATE_HOOKS.append(validation.pre_create_hook)
    ```

- [ ] **Step 5: Run to verify pass** — `python3 -m pytest tests/test_schema.py tests/test_validation.py tests/ -v` → PASS, including the pre-existing `tests/test_registry.py`.

- [ ] **Step 6: Commit.**

```bash
git add app/validation.py app/schema.py app/registry.py tests/test_validation.py tests/test_schema.py
git commit -m "feat(eventboard): input-validation layer + schema toolkit on record creation"
```

---

### Task 2: Export/report formatter + tabular toolkit

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `app/export.py`
- Create: `app/tabular.py`
- Modify: `app/registry.py`
- Test: `tests/test_export.py`
- Test: `tests/test_tabular.py`

- [ ] **Step 1a: Write failing tests** in `tests/test_tabular.py` for `app/tabular.py` — the column-model toolkit `app/export.py` builds on. One test function per bullet:
  - `columns([])` returns `[]`; `columns(records)` returns the **sorted union** of every key across all records (records need not share keys — assert with two records whose key sets differ).
  - `cell(None)` returns `""`; `cell(3)` returns `"3"` (no `.0` suffix); `cell(3.5)` returns `"3.5"`; `cell("x")` returns `"x"` — plain `str()` except the `None` case.
  - `escape_csv("plain")` returns `"plain"` unquoted; `escape_csv("a,b")` returns `'"a,b"'`; `escape_csv('say "hi"')` returns `'"say ""hi"""'` (inner quotes doubled, whole cell quoted); `escape_csv("line1\nline2")` wraps in quotes; `escape_csv("")` returns `""` (empty cell stays unquoted).
  - `widths(records, cols)` returns a dict mapping each column name to `max(len(header), max cell width)` — assert against a fixture where one column's widest value is the header itself and another's is a cell.
  - `pad("ab", 4, "left")` returns `"ab  "`; `pad("ab", 4, "right")` returns `"  ab"`; a value already at or beyond the width is returned unchanged (never truncated — assert with a 5-char value and width 4); any other `align` string raises `ValueError` naming it.
  - `sanitize_flat(value)` replaces every tab and newline in `cell(value)`'s rendering with a single space (assert on a value containing both, and that a clean value passes through byte-identical) — the helper flat single-line formats build on.
- [ ] **Step 1b: Write failing tests** in `tests/test_export.py` for `app/export.py`:
  - `to_csv([])` returns `""` (empty list, no header row either — an empty export has no columns to name).
  - `to_csv(records)` emits a header row of every field name that appears across ALL records, **sorted alphabetically**, then one row per record in input order, with a missing field on a given record rendered as an empty cell (records need not share every field).
  - `to_csv` renders non-string values (`int`, `float`) via plain `str()` — assert an integer amount round-trips as its decimal digits with no `.0` suffix.
  - `to_json([])` returns `"[]"`.
  - `to_json(records)` round-trips through `json.loads` back to the same list of dicts, and its keys are sorted (`sort_keys=True` — assert the raw string, not just the parsed value, so key ordering is actually pinned).
  - `to_csv` escapes cells via `tabular.escape_csv`: a record whose `name` contains a comma renders as one quoted cell (assert the exact line), a value containing a double-quote doubles it, and a simple record with no special characters renders **byte-identical to the unescaped join** (escaping must never change the plain case).
  - `to_markdown([])` returns `""`. `to_markdown(records)` renders a pipe table: a header row of the sorted column names, a separator row of dashes, then one row per record — every cell padded with trailing spaces to its `tabular.widths` column width, missing fields as empty (padded) cells. Assert the **exact multi-line string** for a two-record fixture with unequal key sets.
  - `to_ndjson([])` returns `""`. `to_ndjson(records)` renders one JSON object per line (`sort_keys=True`, no trailing newline): assert the exact string for two records, and that each line round-trips through `json.loads`.
  - `to_markdown` takes an `align` keyword, default `"left"`: `"left"` pads cells per `tabular.pad(..., "left")` with a `---` separator row; `"right"` pads with `"right"` and renders each separator cell as dashes ending in a colon (`--:` style, width-matched); assert the **exact multi-line string** for a small fixture under each alignment, and that any other `align` value raises `ValueError` (delegated to `tabular.pad` — do not duplicate the check).
  - `to_tsv([])` returns `""`. `to_tsv(records)` renders the sorted-column header then one tab-joined row per record, every cell passed through `tabular.sanitize_flat` (a cell containing a tab or newline renders with spaces instead — assert the exact line); missing fields are empty cells.
  - `FORMATS` is a dict with exactly the keys `"csv"`, `"json"`, `"md"`, `"ndjson"`, `"tsv"` mapping to `to_csv`/`to_json`/`to_markdown`/`to_ndjson`/`to_tsv`.
  - `render(records, fmt)` delegates to the matching function for all five formats (equality-check each against the direct call).
  - `render(records, "xml")` raises `ValueError` whose message contains `"xml"`.
  - Add single-record (n=1) coverage for **all five** formats — the degenerate case the header/width logic handles differently from n=0 and n>=2.

- [ ] **Step 2: Run to verify failure** — `python3 -m pytest tests/test_export.py tests/test_tabular.py -v` → FAIL.

- [ ] **Step 3: Implement `app/tabular.py` then `app/export.py`** — `columns`/`cell`/`escape_csv`/`widths`/`pad`/`sanitize_flat`, then `to_csv`, `to_json`, `to_markdown`, `to_ndjson`, `to_tsv`, `FORMATS`, `render`, per Step 1's contracts exactly. `to_csv` and `to_markdown` must build their column model and cells through `tabular` (no duplicated key-union or str() logic in `export.py`).

- [ ] **Step 4: Wire the registry** — in `app/registry.py`:
  - add two keys to `DEFAULT_CONFIG`, near its existing keys: `"export_default_format": "csv"` and `"export_formats_enabled": ["csv", "json"]`.
  - in the "feature wiring" section, add:
    ```python
    from app import export  # noqa: E402
    EXPORT_FORMATS.update(export.FORMATS)
    ```
  - **Do not** add a route or touch `bootstrap()` — `GET /export` is already registered and already calls `_export`, which reads `EXPORT_FORMATS` and `config["export_default_format"]`/`config["export_formats_enabled"]`; your registration line is the only thing `/export` is waiting on.
  - **Do not** add `"md"`/`"ndjson"`/`"tsv"` to `"export_formats_enabled"` — the route serves exactly `csv` and `json`; the three new formats are registered in `EXPORT_FORMATS` but reachable only by direct `render(...)` calls until a future config change enables them.

- [ ] **Step 5: Run to verify pass** — `python3 -m pytest tests/test_export.py tests/test_tabular.py tests/ -v` → PASS. Also confirm end-to-end: `bootstrap().call("GET", "/export")` on an app with two created records returns the same string as `export.to_csv` on those records, and `app.call("GET", "/export", fmt="md")` raises `ValueError` (registered but not enabled).

- [ ] **Step 6: Commit.**

```bash
git add app/export.py app/tabular.py app/registry.py tests/test_export.py tests/test_tabular.py
git commit -m "feat(eventboard): CSV/JSON/MD/NDJSON export formatter + tabular toolkit, wired to the pre-existing /export route"
```

---

### Task 3: Rate-limit/quota module + windowed counter

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `app/ratelimit.py`
- Create: `app/quota.py`
- Modify: `app/registry.py`
- Test: `tests/test_ratelimit.py`
- Test: `tests/test_quota.py`

- [ ] **Step 1a: Write failing tests** in `tests/test_quota.py` for `app/quota.py` — the windowed counter `app/ratelimit.py` delegates to. It keeps a module-global **logical clock** (a float, seconds; no wall time anywhere — tests must be deterministic) plus a module-global hits store. Call `reset()` at the start of every test. One test function per bullet:
  - `QuotaExceededError` is an `Exception` subclass.
  - `now()` returns `0.0` after `reset()`; `advance(30)` returns the new clock value `30.0` and `now()` agrees; `advance(-1)` raises `ValueError` (the clock is monotonic) and leaves the clock unchanged.
  - `take("k", limit=2, window_seconds=60)` returns the in-window hit count after recording (`1`, then `2`), then raises `QuotaExceededError` on the third call — the message contains the key and the limit.
  - window pruning: two `take("k", 2, 60)` calls at t=0, `advance(61)`, then `take("k", 2, 60)` succeeds and returns `1` (both old hits aged out); a hit recorded at t=30 still counts at t=61 but not at t=91 (prune strictly older than `now - window_seconds`).
  - `window_seconds=float("inf")` never prunes: exhaust a key, `advance(10**6)`, the next `take` still raises.
  - burst: `take("k", limit=2, window_seconds=60, burst=1)` allows three hits, raises on the fourth; `burst=0` is the default.
  - per-key independence: exhausting `"a"` leaves `"b"`'s quota untouched with the same clock and window (interleave and assert).
  - `reset()` clears the clock AND every key's hits (exhaust a key, `reset()`, take succeeds at `1` and `now()` is `0.0`).
  - `remaining("k", limit, window_seconds, burst=0)` reports how many takes are left **without recording a hit**: it equals `limit + burst - in-window count`, floors at `0` when exhausted, and calling it twice in a row returns the same value (read-only — assert a subsequent `take` still succeeds where it should); after `advance` past the window it recovers to the full allowance.

- [ ] **Step 1b: Write failing tests** in `tests/test_ratelimit.py` for `app/ratelimit.py`. Call `reset()` at the start of every test (module-global counters — tests must not leak into each other):
  - `RateLimitExceededError` is an `Exception` subclass.
  - `check_and_increment("k", 3)` returns `1`, `2`, `3` on the first three calls for key `"k"`, then raises `RateLimitExceededError` on the fourth — assert the message contains both the key and the limit.
  - the counter is **per key**: exhausting `"a"`'s quota does not affect `"b"`'s (interleave calls to two keys and assert neither raises before its own limit).
  - `reset()` clears ALL keys' counters, not just one.
  - `dispatch_hook(store, config, "GET", "/records", {})` never raises and never increments (rate limiting applies to writes, not reads) — assert this by calling it `max_per_window + 5` times with the same config and confirming no error, then confirm a subsequent `POST` still starts counting from zero relative to its own key... actually assert this directly: call `dispatch_hook` with `"GET"` many times, then call `check_and_increment` on the same key used internally and confirm it starts at `1` (GET calls never touched the counter).
  - `dispatch_hook(store, config, "POST", "/records", kwargs)` reads its key from `kwargs.get("actor", "anonymous")` — two calls with no `"actor"` key share the `"anonymous"` counter; a call with `actor="x"` uses a separate counter from `"anonymous"`.
  - `dispatch_hook` reads its limit from `config["rate_limit_max_per_window"]` — a `config` with limit `1` raises on the second same-key `POST`, a `config` with limit `2` does not.
  - `ratelimit.reset()` also resets the quota clock (delegate to `quota.reset()` — after exhausting a key and advancing the clock, one `ratelimit.reset()` restores both `quota.now() == 0.0` and the key's full quota).
  - `RateLimitExceededError` subclasses `quota.QuotaExceededError`, and `check_and_increment` raises the **subclass** (catch `quota.QuotaExceededError` from `take` and re-raise; assert with both `pytest.raises(RateLimitExceededError)` and `pytest.raises(QuotaExceededError)`).
  - `check_and_increment(key, limit, window_seconds=float("inf"))` delegates to `quota.take` — pin the delegation, not a reimplementation: monkeypatch `quota.take` to a recorder and assert `check_and_increment("k", 3)` called it with `("k", 3, float("inf"))` and `burst=0`.
  - windowed end-to-end through the hook: with `config = {"rate_limit_max_per_window": 1, "rate_limit_window_seconds": 60}`, exhaust actor `"a"` via two `POST` `dispatch_hook` calls (second raises), then `quota.advance(61)` and assert a third `POST` for `"a"` passes — the hook reads its window from `config["rate_limit_window_seconds"]`.
  - burst through the hook: `config = {"rate_limit_max_per_window": 1, "rate_limit_burst": 1, "rate_limit_window_seconds": 60}` allows two same-actor `POST`s and raises on the third — the hook reads `config.get("rate_limit_burst", 0)`, and a config with no `"rate_limit_burst"` key behaves as burst 0.
  - That's 13 cases across the calls above (some bullets are 2 assertions) — write enough test functions to cover each named behavior separately; do not collapse them into one mega-test, since a fold conflict resolution needs to see which individual case broke.

- [ ] **Step 2: Run to verify failure** — `python3 -m pytest tests/test_quota.py tests/test_ratelimit.py -v` → FAIL.

- [ ] **Step 3: Implement `app/quota.py` then `app/ratelimit.py`** — `quota`: `QuotaExceededError`, `_clock`/`_hits` (module globals), `reset`, `now`, `advance`, `take`, `remaining`; `ratelimit`: `RateLimitExceededError(quota.QuotaExceededError)`, `reset`, `check_and_increment`, `dispatch_hook`, per Step 1's contracts exactly (`dispatch_hook` is a no-op for any method other than `"POST"`; all counting lives in `quota.take` — `ratelimit` keeps no counter state of its own).

- [ ] **Step 4: Wire the registry** — in `app/registry.py`:
  - add three keys to `DEFAULT_CONFIG`, near its existing keys: `"rate_limit_max_per_window": 5`, `"rate_limit_window_seconds": 60` (the hook passes it to `quota.take`; the logical clock only moves under tests, so shipped behavior is pure call-counting), and `"rate_limit_burst": 0`.
  - in the "feature wiring" section, add:
    ```python
    from app import ratelimit  # noqa: E402
    DISPATCH_HOOKS.append(ratelimit.dispatch_hook)
    ```

- [ ] **Step 5: Run to verify pass** — `python3 -m pytest tests/test_quota.py tests/test_ratelimit.py tests/ -v` → PASS.

- [ ] **Step 6: Commit.**

```bash
git add app/ratelimit.py app/quota.py app/registry.py tests/test_ratelimit.py tests/test_quota.py
git commit -m "feat(eventboard): per-actor rate-limit guard on POST /records over a windowed quota counter"
```

---

### Task 4: Audit log + query module

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `app/audit.py`
- Create: `app/audit_query.py`
- Modify: `app/registry.py`
- Test: `tests/test_audit.py`
- Test: `tests/test_audit_query.py`

- [ ] **Step 1a: Write failing tests** in `tests/test_audit_query.py` for `app/audit_query.py` — a **pure** read-side module over audit entry lists (every function takes `entries` as a plain list argument, imports nothing from `app.audit`, and never mutates its input — assert the input list and its dicts are unchanged after every call). One test function per bullet:
  - `filter_entries(entries, actor="a")`, `filter_entries(entries, method="POST")`, `filter_entries(entries, path="/records")` each keep exactly the matching entries in order; combined criteria AND together; no criteria returns every entry; the returned list is a **copy** (appending to it does not grow a later call's result).
  - `counts_by(entries, "method")` returns a dict of value → count (assert an exact dict over a 4-entry fixture); `counts_by(entries, "actor")` and `"path"` likewise; any other field name raises `ValueError` naming the field; `counts_by([], "method")` returns `{}`.
  - `last_n(entries, 2)` returns the final two entries in order; `last_n(entries, 0)` returns `[]`; `n` larger than the list returns the whole list (a copy); a negative `n` raises `ValueError`.
  - `redact(entries, ["actor"])` returns new entry dicts with `"actor"` replaced by `"***"` and the other keys untouched — the originals keep their real actors; `redact(entries, [])` returns equal-but-distinct dicts; a field name outside `{"method", "path", "actor"}` raises `ValueError`.
  - `summary([])` returns `{"total": 0, "by_method": {}, "by_actor": {}, "first": None, "last": None}`; on a non-empty fixture `summary` returns the exact dict with `total`, the two `counts_by` sub-dicts, and `first`/`last` as **copies** of the first and last entries.
  - `recent(entries, config)` returns `last_n(entries, config["audit_query_default_limit"])` — assert with a config of `{"audit_query_default_limit": 2}` and a 3-entry fixture.
  - `paginate(entries, page, per_page)` returns `{"page": page, "pages": total-page-count, "total": len(entries), "items": [...]}` with 1-based pages: assert the exact dict for pages 1 and 2 of a 5-entry fixture at `per_page=2` (page 3 has the lone remainder); a page past the end returns the correct metadata with `"items": []`; `paginate([], 1, 2)` returns `{"page": 1, "pages": 0, "total": 0, "items": []}`; `page < 1` or `per_page < 1` raises `ValueError`; `"items"` lists are copies (mutating one does not touch `entries`).
  - `to_report(entries)` renders an exact plain-text report: line `"audit report"`, line `"total: N"`, blank line, line `"by method:"` then one `"  <method>: <count>"` line per method **sorted alphabetically**, blank line, line `"by actor:"` then the same for actors — assert the **exact multi-line string** for a 4-entry fixture; `to_report([])` is exactly `"audit report\ntotal: 0"` (no section headers for empty counts). Build the counts via `counts_by`, not a re-count.
  - integration (the one non-pure test): after two `audit.dispatch_hook` calls with distinct actors, `filter_entries(audit.entries(), actor="bob")` finds exactly bob's entry.

- [ ] **Step 1b: Write failing tests** in `tests/test_audit.py` for `app/audit.py`. Call `clear()` at the start of every test (module-global log — tests must not leak into each other):
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

- [ ] **Step 2: Run to verify failure** — `python3 -m pytest tests/test_audit.py tests/test_audit_query.py -v` → FAIL.

- [ ] **Step 3: Implement `app/audit.py` then `app/audit_query.py`** — `audit`: `_log` (module-global list), `clear`, `entries`, `record`, `dispatch_hook`, per Step 1's contract exactly; `audit_query`: `filter_entries`, `counts_by`, `last_n`, `redact`, `summary`, `recent`, `paginate`, `to_report`, pure over its arguments per Step 1a (no import of `app.audit` inside the module — the integration test composes them from the test file).

- [ ] **Step 4: Wire the registry** — in `app/registry.py`:
  - add three keys to `DEFAULT_CONFIG`, near its existing keys: `"audit_log_enabled": True` (recorded for a future on/off switch and not read by any code in this plan — `dispatch_hook` always logs, per its module docstring), `"audit_log_max_entries": 500`, and `"audit_query_default_limit": 100` (read by `audit_query.recent`).
  - in the "feature wiring" section, add:
    ```python
    from app import audit  # noqa: E402
    DISPATCH_HOOKS.append(audit.dispatch_hook)
    ```

- [ ] **Step 5: Run to verify pass** — `python3 -m pytest tests/test_audit.py tests/test_audit_query.py tests/ -v` → PASS.

- [ ] **Step 6: Commit.**

```bash
git add app/audit.py app/audit_query.py app/registry.py tests/test_audit.py tests/test_audit_query.py
git commit -m "feat(eventboard): audit log of every dispatched call + pure query module"
```

---

### Task 5: Full-suite verification

**Type:** gate

**Files:** none

- [ ] Run `python3 -m pytest tests/ -q` from the repo root (`project/`) and confirm every test passes, including the pre-existing smoke tests in `tests/test_router.py`, `tests/test_storage.py`, `tests/test_report.py`, and `tests/test_registry.py`. `app/registry.py` should now carry all four features' config blocks and all four wiring lines with no other lines disturbed.
