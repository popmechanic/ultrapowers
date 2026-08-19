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
- Create: `app/rules.py`
- Create: `app/profiles.py`
- Create: `app/coerce.py`
- Modify: `app/registry.py`
- Test: `tests/test_validation.py`
- Test: `tests/test_schema.py`
- Test: `tests/test_rules.py`
- Test: `tests/test_profiles.py`
- Test: `tests/test_coerce.py`

- [ ] **Step 1a: Write failing tests** in `tests/test_schema.py` for `app/schema.py` — the declarative toolkit `app/validation.py` builds on. One test function per bullet:
  - `ERROR_CATALOG` is a dict with **exactly** the keys `"missing"`, `"numeric"`, `"non_negative"`, `"max"`, `"non_empty"`, `"type_str"`, each mapping to a `str.format` template.
  - `format_error("missing", field="name")` returns **exactly** `"missing field: name"`.
  - `format_error("numeric", field="amount", got="str")` returns **exactly** `"field amount must be numeric (got str)"`.
  - `format_error("non_negative", field="amount")` returns **exactly** `"field amount must be non-negative"`.
  - `format_error("max", field="amount", limit=100)` returns **exactly** `"field amount exceeds max_amount 100"`.
  - `format_error("non_empty", field="name")` returns **exactly** `"field name must be a non-empty string"`.
  - `format_error("type_str", field="name")` returns **exactly** `"field name must be a string"`.
  - `format_error("nope")` raises `KeyError` (unknown code — never a silent fallback message).
  - `check_required({"amount": 1}, ["name", "amount"])` returns `["name"]`; with both missing returns `["name", "amount"]` in **required_fields order** (not dict order — pass a dict whose insertion order disagrees and assert); with none missing returns `[]`.
  - `is_valid_amount`: `True` for `0`, `5`, and `3.5`; `False` for `True`, `False` (bools are not amounts even though `isinstance(True, int)`), `"3"`, `None`, `float("nan")`, `float("inf")`, `float("-inf")` (use `math.isfinite`; NaN must not slip through a `>=` chain). Overflow edge: `is_valid_amount(10**400)` returns `True` without raising — an int is always finite, so only `float` values go through `math.isfinite`; a naive implementation that passes every value to `math.isfinite` raises `OverflowError` on an int too large to convert to float (assert the call returns `True`, which also proves it did not raise).
  - `is_non_empty_str`: `True` for `"a"` and `" a "` (has non-whitespace content); `False` for `""`, `"   "`, `42`, `None`.
  - `SchemaError` is an `Exception` subclass, distinct from `KeyError`/`ValueError`.
  - `compile_spec(spec)` compiles a declarative field spec — a dict mapping field name → rules dict whose only legal keys are `"required"` (bool), `"type"` (`"str"` or `"number"`), `"non_empty"` (bool), `"max"` (number) — into a reusable validator callable. Compile-time checks (no fields needed): an unknown rule key raises `ValueError` naming the key; a `"type"` value outside the two legal strings raises `ValueError` naming the value; `compile_spec({})` compiles and its validator accepts any dict unchanged.
  - the compiled `validator(fields)`:
    - checks every `required: True` field first, in **spec insertion order**, raising `SchemaError` with the exact `format_error("missing", ...)` message for the first absent one.
    - then, per present field with rules, checks that field's rules in the **fixed order** `type` → `non_empty` → `max` and raises on the **first** failure only: `"type": "number"` enforces `is_valid_amount` (so bools, numeric strings, NaN and infinities all fail) raising the `"numeric"` catalog message; `"type": "str"` enforces `isinstance(str)` raising the `"type_str"` message (never `"non_empty"` — assert a field with BOTH `type: "str"` and `non_empty: True` given the value `42` raises the `type_str` message, since the type rule fails first); `"non_empty": True` enforces `is_non_empty_str` raising the `"non_empty"` message; `"max": N` enforces `value <= N` raising the `"max"` message (boundary: equal passes) — and a `max` rule on a value that is not comparable to a number (e.g. `"abc"` with no `type` rule) raises the `"numeric"` message rather than crashing with `TypeError` or silently passing (assert both `compile_spec` and `validate_collect` on that shape).
    - on success returns a **new** dict in which every field whose rules include `non_empty: True` is `.strip()`ed, everything else copied through unchanged — the input dict is never mutated (assert), and the validator is reusable and deterministic (two calls on equal inputs return equal results).
    - fields present in `fields` but absent from the spec pass through untouched (specs constrain, they do not whitelist).
  - `merge_specs(a, b)` returns a **new** spec that is the union of two specs: fields unique to either side copy through; a field present in both merges its rules dicts; the same rule key on the same field with **unequal** values raises `ValueError` naming both the field and the key (equal values merge silently). Assert the exact merged spec for `{"name": {"required": True}}` + `{"name": {"non_empty": True}, "amount": {"type": "number"}}`; neither input is mutated.
  - `describe_spec(spec)` renders an exact multi-line string: one line per field in **sorted** field order, each line `"<field>: <key>=<value>"` with the rule keys sorted and comma-joined (e.g. `"amount: max=100, type=number"`); `describe_spec({})` returns exactly `"(empty spec)"`. Pin the expected value as a **literal string** in the test for a two-field spec — never build it by iterating the spec in the test (a derived expected value is a tautology).
  - `diff_specs(a, b)` returns exactly `{"added": [...], "removed": [...], "changed": [...]}` — field names only in `b` (sorted), only in `a` (sorted), and in both with unequal rules dicts (sorted); identical specs yield three empty lists. Assert the exact dict for a pair exercising all three buckets at once; neither input is mutated.
  - `spec_from_config(config, prefix)` collects every config key starting with `prefix`, strips the prefix to get the field name, and uses the value (a rules dict) as that field's rules; keys without the prefix are ignored; the result compiles via `compile_spec` (assert end-to-end: build a config, derive the spec, compile, validate a passing and a failing `fields` dict).
  - `spec_to_config(spec, prefix)` is the inverse: returns exactly `{prefix + field: <rules dict copy>}` for every field (assert the exact dict, and that mutating a returned rules dict leaves the spec untouched); round-trip both ways — `spec_from_config(spec_to_config(spec, "s_"), "s_") == spec` for a two-field spec, and the config→spec→config direction restores every prefixed key.
  - `spec_summary_line(spec)` returns exactly `"<N> fields, <M> rules"` where `N` is the field count and `M` the total rule count across all fields; `spec_summary_line({})` returns exactly `"0 fields, 0 rules"` — pin both literals.
  - `validate_collect(spec, fields)` returns a **list of all** error message strings (unlike the compiled validator, which raises on the first): required-miss messages first in spec order, then **at most one message per present field** — the first failing rule in the same fixed `type` → `non_empty` → `max` order (never two messages for one field — assert the combined `type: "str"` + `non_empty: True` shape with value `42` yields exactly `["field n must be a string"]`), in spec order, `[]` when clean. Assert the exact three-element list for a fixture missing one required field and two other fields each violating one rule.
  - That's 14 more schema functions beyond the catalog/predicate ones — roughly 30 test functions in this file all told; one per bullet or sub-bullet.

- [ ] **Step 1a-bis: Write failing tests** in `tests/test_rules.py` for `app/rules.py` — a pure rule-combinator layer on top of `app/schema.py`'s predicates. One test function per bullet:
  - `RuleError` is an `Exception` subclass, distinct from `schema.SchemaError`.
  - `rule(name, predicate)` returns `{"name": name, "test": predicate}`; an empty or non-string `name` raises `ValueError`.
  - `check(value, r)` returns `bool(r["test"](value))`.
  - `all_of(*rules)` returns a composite rule passing iff every child passes; its name is exactly `"all(" + ",".join(child names) + ")"`; `all_of()` (no children) passes every value and is named `"all()"`.
  - `any_of(*rules)` passes iff at least one child passes, named `"any(...)"` the same way; `any_of()` with no children raises `ValueError` (vacuous any is a bug, not a policy).
  - `negate(r)` inverts, named exactly `"not(<name>)"`.
  - `when(cond, then)` passes when `cond` fails OR `then` passes (material implication), named exactly `"when(<cond name>,<then name>)"` — assert all four truth-table cells.
  - `explain(value, r)` returns exactly `"<name>: pass"` or `"<name>: fail"`.
  - `apply_rules(fields, rules_by_field)` — `rules_by_field` maps field name → one rule — returns the list of `"field <f> failed <rule name>"` strings in `rules_by_field` **insertion order** (skipping fields absent from `fields`), `[]` when everything passes; `fields` is never mutated (assert).
  - `first_failure(fields, rules_by_field)` returns the `(field, rule name)` tuple of the first failure in insertion order, or `None`.
  - `explain_failures(fields, rules_by_field)` returns the list of `explain(value, rule)` strings for **failing fields only**, in `rules_by_field` insertion order (fields absent from `fields` are skipped, passing fields contribute nothing); `[]` when everything passes. Assert the exact list for a mapping with one passing and two failing fields.
  - `BUILTINS` is a dict with exactly the keys `"number"`, `"str"`, `"non_empty"` whose rules wrap `schema.is_valid_amount`, `isinstance(str)`, and `schema.is_non_empty_str` respectively (check names and behavior).
  - `parse_rule(text)` parses a `&`-joined builtin list: `parse_rule("number")` returns the `"number"` builtin rule; `parse_rule("number&non_empty")` returns an `all_of` composite over the two, in text order; an unknown token raises `ValueError` naming the token; `parse_rule("")` raises `ValueError`.
  - `parse_rules(text_by_field)` maps a dict of field name → `&`-joined rule text through `parse_rule`: returns `{field: parse_rule(text)}` in insertion order; an unknown token raises `ValueError` naming **both** the field and the token; `parse_rules({})` returns `{}`. Compose end-to-end: `apply_rules(fields, parse_rules({...}))` — assert the exact failure-message list for a two-field mapping with one failing field.
  - `describe_rules(rules_by_field)` renders an exact multi-line string: one line per field in **insertion order**, each exactly `"<field>: <rule name>"`; `describe_rules({})` returns exactly `"(no rules)"`. Pin the expected value as a **literal** for a two-field mapping using one builtin and one composite rule.
  - delegation is real: monkeypatch `schema.is_valid_amount` to always return `False` and assert `check(5, BUILTINS["number"])` — via a fresh `parse_rule("number")` — now fails (pins that `rules` calls through to `app.schema`, not a private copy).
  - That's 16 test functions in this file; one per bullet — and every `name` assertion (builtins and composites alike) pins the exact string, not just dict membership.

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
  - `validate_many(entries, required_fields, max_amount)` — `entries` is a list of `fields` dicts — returns a `(validated, errors)` pair: `validated` is the list of successfully-validated (new) dicts in input order, `errors` is a list of `(index, str(err))` tuples for the failures, also in input order. Assert the exact pair for a four-entry fixture where entries 1 and 3 fail for different reasons; the input list and its dicts are unmutated.
  - `error_code(message)` maps an error-message string back to its `ERROR_CATALOG` code by matching against the catalog's templates — exactly one test per code (`"missing field: name"` → `"missing"`, and so on for all six), and an unmatchable message raises `ValueError`. Build the matcher from `schema.ERROR_CATALOG` at call time, not from a second hand-written table (monkeypatch a catalog entry and assert the mapping follows it).
  - `explain_config(config)` renders exactly `"validation config:\n  required: <comma-joined required_fields>\n  max_amount: <value>"` from `config["validation_required_fields"]` / `config["validation_max_amount"]` — pin the **literal** expected string for two different configs (never rebuild it with a format expression mirroring the implementation).
  - That's 21 cases across the cases above; write one test function per bullet (or group tightly related boundary pairs into one function) rather than one giant test.

- [ ] **Step 1c: Write failing tests** in `tests/test_profiles.py` for `app/profiles.py` — a named-profile layer over `app/schema.py` specs (it imports `app.schema` only; pure, no module state beyond the `PROFILES` constant). One test function per bullet:
  - `ProfileError` is an `Exception` subclass, distinct from `schema.SchemaError`.
  - `PROFILES` is exactly `{"record": {"name": {"required": True, "type": "str", "non_empty": True}, "amount": {"required": True, "type": "number", "max": 100000}}, "draft": {"name": {"type": "str"}}, "import": {"name": {"required": True, "type": "str", "non_empty": True}, "amount": {"type": "number"}}}` — pin the whole dict.
  - `get_profile(name)` returns a **deep copy** of the named spec (mutating a returned rules dict leaves `PROFILES` untouched — assert); an unknown name raises `ProfileError` naming it.
  - `validate_profile(fields, name)` compiles via `schema.compile_spec(get_profile(name))` and returns the validator's result — pin the delegation with a monkeypatched recorder on `schema.compile_spec` (assert the exact spec argument), then end-to-end: a passing `fields` dict for `"record"` comes back stripped-and-copied per the compiled-validator contract, and `validate_profile({}, "record")` raises `schema.SchemaError` with exactly `"missing field: name"`.
  - `merge_profiles(a, b)` returns `schema.merge_specs` of the two named specs (recorder pin on the argument pair) — assert `merge_profiles("draft", "import")` equals exactly the `"import"` spec (the shared `type: "str"` merges silently), and that `PROFILES` is unmutated.
  - `describe_profile(name)` returns exactly `schema.describe_spec(get_profile(name))` — pin the literal for `"draft"`: `"name: type=str"`.
  - `compare_profiles(a, b)` returns `schema.diff_specs` of the two named specs — assert `compare_profiles("draft", "import")` is exactly `{"added": ["amount"], "removed": [], "changed": ["name"]}`.
  - `profile_from_config(config, name)` derives a spec from every config key prefixed `"profile_" + name + "_"` via `schema.spec_from_config` (recorder pin on the prefix argument) — end-to-end: `{"profile_x_name": {"required": True}, "other": 1}` yields a spec whose compiled validator raises exactly `"missing field: name"` on `{}`.
  - `profile_summary(name)` returns exactly `"<name>: " + schema.spec_summary_line(get_profile(name))` — pin the literal `"draft: 1 fields, 1 rules"`.
  - `validate_all_profiles(fields)` returns a dict mapping **every** profile name to `schema.validate_collect(spec, fields)` — assert the exact dict for `fields={}`: `{"draft": [], "import": ["missing field: name"], "record": ["missing field: name", "missing field: amount"]}`.
  - `strictest(names)` returns the name whose spec carries the most rules (total rule-dict entries across fields); ties break alphabetically; an empty `names` raises `ProfileError`. Assert `strictest(["draft", "import"]) == "import"` and `strictest(["record", "import", "draft"]) == "record"`.
  - That's 11 test functions; one per bullet.

- [ ] **Step 1d: Write failing tests** in `tests/test_coerce.py` for `app/coerce.py` — a pre-validation coercion layer (imports `app.schema` only). One test function per bullet:
  - `CoerceError` is an `Exception` subclass, distinct from `schema.SchemaError`.
  - `COERCE_CATALOG` is exactly `{"amount": "cannot coerce {field} to a number (got {value!r})", "flag": "cannot coerce {field} to a flag (got {value!r})"}` — pin the whole dict; every `CoerceError` message is built from it (no other message literals in the module).
  - `parse_amount("3", field="amount")` returns `3` and `type(...) is int`; `"3.5"` returns `3.5`; `"  7 "` returns `7` (stripped); a non-str number (`4`, `3.5`) passes through unchanged; `True`/`False` raise `CoerceError` (bools are not amounts); `"abc"`, `""`, `None`, `"nan"`, `"inf"` all raise.
  - every successful `parse_amount` result satisfies `schema.is_valid_amount` — pin the delegation: monkeypatch `schema.is_valid_amount` to always return `False` and assert `parse_amount("3", field="a")` now raises `CoerceError`.
  - exact message: `str(err)` for `parse_amount("abc", field="amount")` is exactly `"cannot coerce amount to a number (got 'abc')"`.
  - `parse_flag(value, field)`: `True` for `"true"`, `"yes"`, `"1"`, `"on"` (case-insensitive, stripped — assert `"  YES "`); `False` for `"false"`, `"no"`, `"0"`, `"off"`; a real `bool` passes through unchanged; anything else raises `CoerceError` — `str(err)` for `parse_flag("maybe", field="active")` is exactly `"cannot coerce active to a flag (got 'maybe')"`.
  - `coerce_fields(fields, spec)`: for every spec field whose rules include `"type": "number"` and whose value in `fields` is a `str`, the value is replaced with `parse_amount(value, field=field)`; str-typed and un-specced fields pass through untouched; non-str numbers untouched; returns a **new** dict — the input is never mutated (assert).
  - `coerce_report(fields, spec)` returns a `(coerced, errors)` pair: `errors` is a list of `(field, str(err))` tuples for the failed coercions in **spec insertion order**, each failed field copied through unchanged in `coerced` — assert the exact pair for a fixture with two failing and one succeeding coercion.
  - end-to-end with `schema`: under `spec = {"amount": {"required": True, "type": "number"}}`, `compile_spec(spec)`'s validator accepts `coerce_fields({"amount": "42"}, spec)` but raises exactly `"field amount must be numeric (got str)"` on the uncoerced dict — pin both.
  - `describe_coercions(spec)` renders one line per number-typed field in **sorted** order, each exactly `"<field>: number"`; a spec with none returns exactly `"(no coercions)"` — pin the literal for `{"amount": {"type": "number"}, "name": {"type": "str"}}`: `"amount: number"`.
  - That's 10 test functions; one per bullet.

- [ ] **Step 2: Run to verify failure** — `python3 -m pytest tests/test_schema.py tests/test_rules.py tests/test_validation.py tests/test_profiles.py tests/test_coerce.py -v` → FAIL (none of the modules exist).

- [ ] **Step 3: Implement `app/schema.py`, then `app/rules.py`, then `app/validation.py`** — `schema`: `ERROR_CATALOG`, `format_error`, `check_required`, `is_valid_amount`, `is_non_empty_str`, `SchemaError`, `compile_spec`, `merge_specs`, `describe_spec`, `diff_specs`, `spec_from_config`, `spec_to_config`, `spec_summary_line`, `validate_collect`, per Step 1a exactly; `rules`: `RuleError`, `rule`, `check`, `all_of`, `any_of`, `negate`, `when`, `explain`, `apply_rules`, `first_failure`, `explain_failures`, `describe_rules`, `BUILTINS`, `parse_rule`, `parse_rules`, per Step 1a-bis exactly (every predicate that exists in `schema` is called through `app.schema` — no reimplementation); `validation`: `ValidationError`, `validate_fields`, `validate_many`, `error_code`, `explain_config`, `pre_create_hook`, per Step 1b exactly (check `required_fields` presence first, in order, via `schema.check_required`; only validate `amount`/`name` when the key is present in `fields`, since `required_fields` may not include them for a differently-configured caller; **no error-message string literals in `validation.py`** — every message is built by `schema.format_error`). Then implement `app/profiles.py` — `ProfileError`, `PROFILES`, `get_profile`, `validate_profile`, `merge_profiles`, `describe_profile`, `compare_profiles`, `profile_from_config`, `profile_summary`, `validate_all_profiles`, `strictest`, per Step 1c exactly (every spec operation goes through `app.schema` — no reimplementation) — and `app/coerce.py` — `CoerceError`, `COERCE_CATALOG`, `parse_amount`, `parse_flag`, `coerce_fields`, `coerce_report`, `describe_coercions`, per Step 1d exactly. Neither module touches `app/registry.py` (library layers only).

- [ ] **Step 4: Wire the registry** — in `app/registry.py`:
  - add two keys to `DEFAULT_CONFIG`, near its existing keys (do not reorder or reformat the existing lines): `"validation_required_fields": ["name", "amount"]` and `"validation_max_amount": 100000`.
  - in the "feature wiring" section at the bottom of the file, add:
    ```python
    from app import validation  # noqa: E402
    PRE_CREATE_HOOKS.append(validation.pre_create_hook)
    ```

- [ ] **Step 5: Run to verify pass** — `python3 -m pytest tests/test_schema.py tests/test_rules.py tests/test_validation.py tests/test_profiles.py tests/test_coerce.py tests/ -v` → PASS, including the pre-existing `tests/test_registry.py`.

- [ ] **Step 6: Commit.**

```bash
git add app/validation.py app/schema.py app/rules.py app/profiles.py app/coerce.py app/registry.py tests/test_validation.py tests/test_schema.py tests/test_rules.py tests/test_profiles.py tests/test_coerce.py
git commit -m "feat(eventboard): input-validation layer + schema toolkit on record creation"
```

---

### Task 2: Export/report formatter + tabular toolkit

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `app/export.py`
- Create: `app/tabular.py`
- Create: `app/colspec.py`
- Create: `app/report.py`
- Modify: `app/registry.py`
- Test: `tests/test_export.py`
- Test: `tests/test_tabular.py`
- Test: `tests/test_colspec.py`
- Test: `tests/test_report.py`

- [ ] **Step 1a: Write failing tests** in `tests/test_tabular.py` for `app/tabular.py` — the column-model toolkit `app/export.py` builds on. One test function per bullet:
  - `columns([])` returns `[]`; `columns(records)` returns the **sorted union** of every key across all records (records need not share keys — assert with two records whose key sets differ).
  - `cell(None)` returns `""`; `cell(3)` returns `"3"` (no `.0` suffix); `cell(3.5)` returns `"3.5"`; `cell("x")` returns `"x"` — plain `str()` except the `None` case.
  - `escape_csv("plain")` returns `"plain"` unquoted; `escape_csv("a,b")` returns `'"a,b"'`; `escape_csv('say "hi"')` returns `'"say ""hi"""'` (inner quotes doubled, whole cell quoted); `escape_csv("line1\nline2")` wraps in quotes; `escape_csv("")` returns `""` (empty cell stays unquoted).
  - `widths(records, cols)` returns a dict mapping each column name to `max(len(header), max cell width)` — assert against a fixture where one column's header is **strictly wider than every cell in that column** (a tie between header and widest cell does not pin the `len(header)` term) and another column's widest value is a cell.
  - `pad("ab", 4, "left")` returns `"ab  "`; `pad("ab", 4, "right")` returns `"  ab"`; a value already at or beyond the width is returned unchanged (never truncated — assert with a 5-char value and width 4); any other `align` string raises `ValueError` naming it **even when the value already meets the width** (validate `align` before any short-circuit — assert `pad("abcde", 4, "center")` raises).
  - `sanitize_flat(value)` replaces every tab and newline in `cell(value)`'s rendering with a single space (assert on a value containing both, and that a clean value passes through byte-identical) — the helper flat single-line formats build on.
  - `escape_html(value)` renders `cell(value)` with `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, `"` → `&quot;` (ampersand first — assert `escape_html("<a & \"b\">")` is exactly `"&lt;a &amp; &quot;b&quot;&gt;"`), and a clean value passes through byte-identical.
  - `truncate(value, width, marker="...")` returns `value` unchanged when `len(value) <= width`; otherwise the first `width - len(marker)` characters plus the marker (assert exact strings for both cases); `width < len(marker)` raises `ValueError`.
  - `wrap(value, width)` greedily wraps on spaces into a list of lines each `<= width` (assert the exact list for a three-word value that wraps at two widths); a single word longer than `width` is hard-split at `width` (assert exactly); `wrap("", width)` returns `[""]`; `width < 1` raises `ValueError`.
  - `fit(value, width, align)` composes `truncate` then `pad` — an over-long value is truncated to `width` (marker included), a short one padded per `align` (assert exact strings for both; assert the bad-`align` `ValueError` also raises here, delegated to `pad`).
  - `render_row(cells, widths_list, align)` renders one pipe-table row exactly as `"| " + " | ".join(padded cells) + " |"` with each cell padded to its width (assert the exact string for a two-cell row); mismatched `len(cells) != len(widths_list)` raises `ValueError`.
- [ ] **Step 1b: Write failing tests** in `tests/test_export.py` for `app/export.py`:
  - `to_csv([])` returns `""` (empty list, no header row either — an empty export has no columns to name).
  - `to_csv(records)` emits a header row of every field name that appears across ALL records, **sorted alphabetically**, then one row per record in input order, with a missing field on a given record rendered as an empty cell (records need not share every field).
  - `to_csv` renders non-string values (`int`, `float`) via plain `str()` — assert an integer amount round-trips as its decimal digits with no `.0` suffix.
  - `to_json([])` returns `"[]"`.
  - `to_json(records)` round-trips through `json.loads` back to the same list of dicts, and its keys are sorted (`sort_keys=True` — assert the raw string, not just the parsed value, so key ordering is actually pinned).
  - `to_csv` escapes cells via `tabular.escape_csv`: a record whose `name` contains a comma renders as one quoted cell (assert the exact line), a value containing a double-quote doubles it, and a simple record with no special characters renders **byte-identical to the unescaped join** (escaping must never change the plain case).
  - `to_markdown([])` returns `""`. `to_markdown(records)` renders a pipe table: a header row of the sorted column names, a separator row of dashes, then one row per record — every cell padded with trailing spaces to its `tabular.widths` column width, missing fields as empty (padded) cells. Assert the **exact multi-line string** for a two-record fixture with unequal key sets — and pin the expected value as a **literal string in the test**: an `expected` built by calling `tabular.columns`/`widths`/`pad` (the helpers the implementation itself uses) is a tautology that passes under a broken `widths`, and is a review-blocking defect, not a style nit.
  - `to_ndjson([])` returns `""`. `to_ndjson(records)` renders one JSON object per line (`sort_keys=True`, no trailing newline): assert the exact string for two records, and that each line round-trips through `json.loads`.
  - `to_markdown` takes an `align` keyword, default `"left"`: `"left"` pads cells per `tabular.pad(..., "left")` with a `---` separator row; `"right"` pads with `"right"` and renders each separator cell as dashes ending in a colon (`--:` style, width-matched); assert the **exact multi-line string** (a literal in the test, per the rule above) for a small fixture under each alignment, and that any other `align` value raises `ValueError` (delegated to `tabular.pad` — do not duplicate the check), **including on a fixture whose cells all already meet their column widths** (the delegation must not be skippable by pad's width short-circuit).
  - `to_tsv([])` returns `""`. `to_tsv(records)` renders the sorted-column header then one tab-joined row per record, every cell **and every header name** passed through `tabular.sanitize_flat` (a cell or column name containing a tab or newline renders with spaces instead — assert the exact line for each; an unsanitized header breaks the TSV grid); missing fields are empty cells.
  - `to_html([])` returns `""`. `to_html(records)` renders exactly `"<table>"`, a header row `"<tr><th>col</th>...</tr>"` of the sorted column names, one `"<tr><td>cell</td>...</tr>"` per record in input order (missing fields as empty `<td></td>`), and `"</table>"`, newline-joined, every cell and header passed through `tabular.escape_html`. Assert the **exact multi-line literal** for a two-record fixture with unequal key sets where one value contains `&` and `<`.
  - `parse_csv(text)` is the inverse of `to_csv`: `parse_csv("")` returns `[]`; otherwise the first line is the header and each further line yields a dict of header → cell **string** (parsing never re-types values — an exported `3` comes back as `"3"`, assert this explicitly). It must handle quoted cells: `'"a,b"'` yields the cell `"a,b"`, doubled quotes inside a quoted cell yield one quote, and a quoted cell containing a newline spans lines (assert by round-tripping a record whose value contains a comma, a quote, and a newline: `parse_csv(to_csv([rec]))` equals the record with all values stringified). An unterminated quote raises `ValueError`. Single-column corner: `parse_csv("a\n")` returns exactly `[{"a": ""}]` (a header plus one empty-cell row — the trailing empty row must not be dropped), while `parse_csv("a")` (no trailing newline) returns `[]` (header only). This is a real parser — a `line.split(",")` implementation fails the quoted-cell cases.
  - `FORMATS` is a dict with exactly the keys `"csv"`, `"json"`, `"md"`, `"ndjson"`, `"tsv"` mapping to `to_csv`/`to_json`/`to_markdown`/`to_ndjson`/`to_tsv`.
  - `EXTRA_FORMATS` is a dict with exactly the key `"html"` mapping to `to_html` — kept out of `FORMATS` (and out of the registry) deliberately; nothing route-reachable changes.
  - `render(records, fmt)` delegates to the matching function for all five `FORMATS` (equality-check each against the direct call).
  - `render(records, "xml")` raises `ValueError` whose message contains `"xml"`; `render(records, "html")` also raises (`render` serves `FORMATS` only — assert it).
  - `render_any(records, fmt)` serves `FORMATS` first, then `EXTRA_FORMATS` (equality-check `"csv"` and `"html"` against the direct calls); an unknown fmt raises `ValueError` naming it.
  - `summary_line(records)` returns exactly `"<N> records, <M> columns"` with `M` from `tabular.columns` (assert the literal for a two-record unequal-keys fixture, and `"0 records, 0 columns"` for `[]`).
  - Add single-record (n=1) coverage for all five `FORMATS` **plus `to_html`** — the degenerate case the header/width logic handles differently from n=0 and n>=2.

- [ ] **Step 1c: Write failing tests** in `tests/test_colspec.py` for `app/colspec.py` — a column-projection layer (imports `app.tabular` only; pure). One test function per bullet:
  - `ColspecError` is an `Exception` subclass.
  - `parse_colspec("a,b:B,c")` returns exactly `[("a", "a"), ("b", "B"), ("c", "c")]` — `(source, header)` pairs, a bare token using its own name as header; whitespace around tokens and around the `:` is stripped (assert `"a , b : B"`); an empty string raises `ColspecError`; an empty token (`"a,,b"`) raises; a token with more than one `:` raises.
  - a duplicate **source** (`"a,a:A"`) raises `ColspecError` naming `"a"`; a duplicate **header** (`"a:X,b:X"`) raises naming `"X"`.
  - `project(records, pairs)` returns a **new** list of dicts, one per record in input order, whose keys are the headers in pair order and whose values come from the source fields — a source absent from a record yields `None`. Assert exactly `[{"a": 1, "B": None, "c": None}, {"a": None, "B": 2, "c": None}]` for `[{"a": 1, "x": 9}, {"b": 2}]` under `parse_colspec("a,b:B,c")`; the input records are never mutated.
  - `available(records, pairs)` returns a `(present, missing)` pair of **sorted** source-name lists split against `tabular.columns(records)` — pin the delegation with a monkeypatched recorder on `tabular.columns`, and assert exactly `(["a", "b"], ["c"])` for the fixture above.
  - `auto_colspec(records)` returns exactly `[(c, c) for c in tabular.columns(records)]` — assert `[("a", "a"), ("b", "b"), ("x", "x")]` for the fixture above.
  - `header_row(pairs)` returns exactly the headers in order: `["a", "B", "c"]`; `rename_map(pairs)` returns exactly the `{source: header}` entries **only** for pairs that rename: `{"b": "B"}`.
  - `select(records, sources)` keeps only the named source fields (present ones; order-preserving new dicts) and `drop(records, sources)` removes them — assert the exact lists for the fixture above and that inputs are unmutated; both raise `ColspecError` on an empty `sources` list.
  - `sanitize_headers(pairs)` returns a new pairs list with every header passed through `tabular.sanitize_flat` (recorder pin; a header containing a tab renders with a space; clean pairs come back equal).
  - `describe_colspec(pairs)` renders one line per pair in order, each exactly `"<header> <- <source>"`; `describe_colspec([])` returns exactly `"(no columns)"` — pin the three-line literal for `parse_colspec("a,b:B,c")`.
  - That's 10 test functions; one per bullet.

- [ ] **Step 1d: Write failing tests** in `tests/test_report.py` for `app/report.py` — a multi-section report composer (imports `app.export` and `app.colspec` only). One test function per bullet:
  - `ReportError` is an `Exception` subclass.
  - `section(title, records, fmt="md")` returns exactly `{"title": title, "records": records, "fmt": fmt}`; an empty or whitespace-only title raises `ReportError`; a fmt in neither `export.FORMATS` nor `export.EXTRA_FORMATS` raises `ReportError` naming it (`"html"` is accepted, `"xml"` raises).
  - `render_section(sec)` returns exactly `"## " + title + "\n\n" + export.render_any(records, fmt)` — pin the delegation with a monkeypatched recorder on `export.render_any`; a section with **empty** records returns exactly `"## <title>\n\n(no records)"` and `render_any` is **not** called (assert via the recorder).
  - `render_report(title, sections)` returns exactly `"# " + title + "\n\n"` + the rendered sections joined by `"\n\n"`; with an empty sections list it returns exactly `"# <title>\n\n(empty report)"`. Assert the full multi-line value for a two-section fixture — pinned as a **literal string** in the test, never rebuilt by calling `render_section` in the test (a derived expected value is a tautology).
  - duplicate section titles raise `ReportError` naming the title — from **both** `render_report` and `toc` (a shared check; assert both raise).
  - `toc(sections)` returns exactly the title list in order; `record_counts(sections)` returns exactly `{title: len(records)}`.
  - `summary(sections)` returns exactly `"<S> sections, <R> records"` (R = total across sections) — pin the literal `"2 sections, 3 records"` for the fixture; `summary([])` returns exactly `"0 sections, 0 records"`.
  - `render_index(sections)` renders one line per section in order, 1-based, each exactly `"<i>. <title> (<n> records)"`; `render_index([])` returns exactly `"(empty report)"` — pin the two-line literal.
  - `projected_section(title, records, pairs, fmt="md")` builds `section(title, colspec.project(records, pairs), fmt)` — recorder pin on `colspec.project`; end-to-end: `render_section(projected_section("T", [{"a": 1, "b": 2}], colspec.parse_colspec("a:A"), "csv"))` is exactly `"## T\n\nA\n1"`.
  - That's 9 test functions; one per bullet.

- [ ] **Step 2: Run to verify failure** — `python3 -m pytest tests/test_export.py tests/test_tabular.py tests/test_colspec.py tests/test_report.py -v` → FAIL.

- [ ] **Step 3: Implement `app/tabular.py` then `app/export.py`** — `columns`/`cell`/`escape_csv`/`widths`/`pad`/`sanitize_flat`/`escape_html`/`truncate`/`wrap`/`fit`/`render_row`, then `to_csv`, `to_json`, `to_markdown`, `to_ndjson`, `to_tsv`, `to_html`, `parse_csv`, `FORMATS`, `EXTRA_FORMATS`, `render`, `render_any`, `summary_line`, per Step 1's contracts exactly. `to_csv`, `to_markdown`, and `to_html` must build their column model and cells through `tabular` (no duplicated key-union, escaping, or str() logic in `export.py`). Then implement `app/colspec.py` — `ColspecError`, `parse_colspec`, `project`, `available`, `auto_colspec`, `header_row`, `rename_map`, `select`, `drop`, `sanitize_headers`, `describe_colspec`, per Step 1c exactly — and `app/report.py` — `ReportError`, `section`, `render_section`, `render_report`, `toc`, `record_counts`, `summary`, `render_index`, `projected_section`, per Step 1d exactly. Neither module touches `app/registry.py` (library layers only; the registry wiring below is unchanged).

- [ ] **Step 4: Wire the registry** — in `app/registry.py`:
  - add two keys to `DEFAULT_CONFIG`, near its existing keys: `"export_default_format": "csv"` and `"export_formats_enabled": ["csv", "json"]`.
  - in the "feature wiring" section, add:
    ```python
    from app import export  # noqa: E402
    EXPORT_FORMATS.update(export.FORMATS)
    ```
  - **Do not** add a route or touch `bootstrap()` — `GET /export` is already registered and already calls `_export`, which reads `EXPORT_FORMATS` and `config["export_default_format"]`/`config["export_formats_enabled"]`; your registration line is the only thing `/export` is waiting on.
  - **Do not** add `"md"`/`"ndjson"`/`"tsv"` to `"export_formats_enabled"` — the route serves exactly `csv` and `json`; the three new formats are registered in `EXPORT_FORMATS` but reachable only by direct `render(...)` calls until a future config change enables them.

- [ ] **Step 5: Run to verify pass** — `python3 -m pytest tests/test_export.py tests/test_tabular.py tests/test_colspec.py tests/test_report.py tests/ -v` → PASS. Also confirm end-to-end: `bootstrap().call("GET", "/export")` on an app with two created records returns the same string as `export.to_csv` on those records, and `app.call("GET", "/export", fmt="md")` raises `ValueError` (registered but not enabled).

- [ ] **Step 6: Commit.**

```bash
git add app/export.py app/tabular.py app/colspec.py app/report.py app/registry.py tests/test_export.py tests/test_tabular.py tests/test_colspec.py tests/test_report.py
git commit -m "feat(eventboard): CSV/JSON/MD/NDJSON export formatter + tabular toolkit, wired to the pre-existing /export route"
```

---

### Task 3: Rate-limit/quota module + windowed counter

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `app/ratelimit.py`
- Create: `app/quota.py`
- Create: `app/throttle.py`
- Create: `app/backoff.py`
- Create: `app/tiers.py`
- Modify: `app/registry.py`
- Test: `tests/test_ratelimit.py`
- Test: `tests/test_quota.py`
- Test: `tests/test_throttle.py`
- Test: `tests/test_backoff.py`
- Test: `tests/test_tiers.py`

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
  - `snapshot(window_seconds)` returns a dict mapping each key with at least one **in-window** hit to the sorted list of its in-window hit timestamps (aged-out hits excluded; keys with none omitted). Assert the exact dict after a scripted sequence of `take`/`advance` calls, and that the result is a deep copy — mutating a returned list does not change a later `snapshot` or `remaining` reading.
  - `time_to_next_slot("k", limit, window_seconds, burst=0)` returns `0.0` when `remaining` is positive; when exhausted it returns exactly `oldest_in_window_hit + window_seconds - now()` (the seconds until one slot frees — assert the exact float after a scripted sequence: two takes at t=0 with limit 2 and window 60, then `advance(10)` → `50.0`); with `window_seconds=float("inf")` and an exhausted key it returns `float("inf")`; with a zero allowance (`limit + burst == 0` — no hits will ever free a slot because none can be recorded) it returns `float("inf")` too, never raises (assert `time_to_next_slot("k", 0, 60) == float("inf")` on a fresh key — an implementation that reaches `min()` of an empty hit list crashes here). Boundary note: pruning keeps a hit sitting exactly at `now - window_seconds` (drop is strictly-older-than), so at the instant `time_to_next_slot` reads `0.0` the slot is *about to* free — callers retry strictly after the reset instant; assert both readings at that exact boundary (`take`s at t=0, limit 2, window 60, `advance(60)` → `time_to_next_slot == 0.0` AND `take` still raises). Read-only, like `remaining`.
  - `usage("k", limit, window_seconds, burst=0)` returns exactly `{"used": <in-window count>, "allowed": limit + burst, "remaining": <remaining(...)>, "reset_in": <time_to_next_slot(...)>}` — assert the exact dict in three states (fresh key, partially used, exhausted mid-window) after a scripted sequence; read-only (a subsequent `take` still succeeds where it should).
  - `purge(window_seconds)` drops every key's aged-out hits, removes keys left with none, and returns the total number of hits dropped — assert the exact count after a scripted sequence and that `snapshot(window_seconds)` no longer lists the emptied key; a second immediate `purge` returns `0`.

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
  - windowed end-to-end through the hook: with `config = {"rate_limit_max_per_window": 1, "rate_limit_window_seconds": 60}`, exhaust actor `"a"` via two `POST` `dispatch_hook` calls (second raises), then `quota.advance(61)` and assert a third `POST` for `"a"` passes — the hook reads its window via `config.get("rate_limit_window_seconds", 60)`.
  - minimal-config compatibility (**load-bearing — external callers pass only the limit key**): `dispatch_hook(None, {"rate_limit_max_per_window": 1}, "POST", "/records", {})` must work — no `KeyError` — counting against the default 60-second window and burst 0; assert the first call passes and the second same-key call raises. Only `rate_limit_max_per_window` may be a required key; window and burst are always read with `.get(...)` defaults.
  - burst through the hook: `config = {"rate_limit_max_per_window": 1, "rate_limit_burst": 1, "rate_limit_window_seconds": 60}` allows two same-actor `POST`s and raises on the third — the hook reads `config.get("rate_limit_burst", 0)`, and a config with no `"rate_limit_burst"` key behaves as burst 0.
  - `retry_after(key, config)` delegates to `quota.time_to_next_slot` with the key and `config["rate_limit_max_per_window"]` / `config["rate_limit_window_seconds"]` / `config.get("rate_limit_burst", 0)` — pin the delegation with a monkeypatched recorder (assert the exact argument tuple), then assert end-to-end: exhausted actor at t=0, `advance(10)`, `retry_after` reads `50.0` under a 60-second window.
  - `limit_headers(key, config)` returns exactly `{"X-RateLimit-Limit": "<limit>", "X-RateLimit-Remaining": "<remaining>", "X-RateLimit-Reset": "<time_to_next_slot>"}` — every value a **string** (`str()` of the underlying number), where `Limit` is the **configured limit alone** (burst is reflected only in `Remaining`'s full allowance — assert with a `rate_limit_burst: 1` config that `Limit` reads the bare limit while fresh-key `Remaining` reads limit+burst). Assert the exact dict in two states: a fresh key (`Remaining` = full allowance, `Reset` = `"0.0"`) and an exhausted key mid-window. Values come from `quota.remaining` / `quota.time_to_next_slot`; the function records no hit (assert a subsequent `take` still succeeds where it should). Config keys read with the same `.get` defaults as the hook (a minimal limit-only config works).
  - `status_line(key, config)` returns exactly `"<key>: <used>/<allowed>, reset in <reset_in>s"` built from `quota.usage(...)` — pin the **literal** expected string in two states (fresh and exhausted mid-window; e.g. `"mallory: 2/2, reset in 50.0s"`); read-only.
  - `check_many(keys, config)` returns a dict mapping each key in `keys` to the bool "would a `POST` for this key succeed right now" via `quota.remaining` — assert the exact dict for a three-key fixture with one exhausted key, and that **no** hit was recorded for any of them (each key's subsequent `take` behaves as before the call).
  - That's 18 cases across the calls above (some bullets are 2 assertions) — write enough test functions to cover each named behavior separately; do not collapse them into one mega-test, since a fold conflict resolution needs to see which individual case broke.

- [ ] **Step 1c: Write failing tests** in `tests/test_throttle.py` for `app/throttle.py` — a pure policy layer over `app/quota.py` (it imports `app.quota` only — never `app.ratelimit`; no module state of its own beyond the `POLICIES` constant). Call `quota.reset()` at the start of every test. One test function per bullet:
  - `PolicyError` is an `Exception` subclass.
  - `POLICIES` is exactly `{"POST /records": {"limit": 5, "window": 60, "burst": 0}, "GET /export": {"limit": 10, "window": 60, "burst": 2}}` (a module constant — pin the whole dict).
  - `match_policy(method, path, policies)` — policy keys are `"<METHOD> <path-prefix>"` strings — returns the policy dict whose method equals `method` and whose path-prefix is a prefix of `path`, choosing the **longest** matching prefix; no match returns `None`. Assert: `"GET /export/full"` matches the `"GET /export"` policy; with an added `"GET /export/full"` policy the longer key wins; a method mismatch (`"POST /export"`) returns `None`.
  - `key_for(method, path, actor)` returns exactly `"<method> <path>:<actor>"`.
  - `enforce(method, path, actor, policies)`: no matching policy → returns `None` and records nothing (assert quota untouched via a subsequent `take`); a match delegates to `quota.take(key_for(...), limit, window, burst=...)` — pin the delegation with a monkeypatched recorder asserting the exact argument tuple — and returns the in-window count.
  - an exhausted policy raises `PolicyError` (chained from `quota.QuotaExceededError` — assert with `pytest.raises(PolicyError)` and that the message contains both the key and the limit).
  - `remaining_for(method, path, actor, policies)` returns `None` when no policy matches, else `quota.remaining` under the policy's params — read-only (a subsequent `take` still succeeds where it should).
  - `describe_policies(policies)` renders an exact multi-line string: one line per key **sorted**, each exactly `"<key>: limit=<limit>, window=<window>, burst=<burst>"`; `describe_policies({})` returns exactly `"(no policies)"`. Pin the expected value as a **literal**.
  - end-to-end: two `enforce("POST", "/records", "mallory", {"POST /records": {"limit": 1, "window": 60, "burst": 0}})` calls — second raises `PolicyError`; `quota.advance(61)` frees it (third call passes).
  - That's 9 test functions; one per bullet.

- [ ] **Step 1d: Write failing tests** in `tests/test_backoff.py` for `app/backoff.py` — a deterministic retry-schedule calculator (imports `app.quota` only — never `app.ratelimit`; pure, no module state). Call `quota.reset()` at the start of every test. One test function per bullet:
  - `BackoffError` is an `Exception` subclass, distinct from `quota.QuotaExceededError`.
  - `schedule(base, factor, retries)` returns exactly `[base * factor**i for i in range(retries)]` as **floats** — assert `schedule(1.0, 2.0, 3) == [1.0, 2.0, 4.0]` and every element `is`-a `float`; `retries=0` returns `[]`; `base <= 0`, `factor < 1.0`, or `retries < 0` raises `BackoffError` naming the offending parameter.
  - `capped(seq, cap)` returns the element-wise `min` against `cap` — assert `capped([1.0, 2.0, 4.0], 3.0) == [1.0, 2.0, 3.0]` (a new list; input unmutated); `cap <= 0` raises `BackoffError`.
  - `total_wait(seq)` returns the float sum — `6.0` for `[1.0, 2.0, 3.0]`, `0.0` for `[]`.
  - `next_delay(attempt, base, factor, cap)` returns exactly `min(base * factor**attempt, cap)` — assert `next_delay(0, 1.0, 2.0, 60.0) == 1.0` and `next_delay(6, 1.0, 2.0, 60.0) == 60.0`; `attempt < 0` raises `BackoffError`.
  - `delay_until_free(key, config)` delegates to `quota.time_to_next_slot(key, config["rate_limit_max_per_window"], config.get("rate_limit_window_seconds", 60), burst=config.get("rate_limit_burst", 0))` — pin the delegation with a monkeypatched recorder asserting the exact argument tuple, then end-to-end: two `quota.take("k", 2, 60)` calls at t=0, `quota.advance(10)`, and `delay_until_free("k", {"rate_limit_max_per_window": 2, "rate_limit_window_seconds": 60})` reads exactly `50.0`. A minimal limit-only config works (window and burst default via `.get`).
  - `retry_plan(key, config, retries)` returns exactly `{"immediate": <quota.remaining(...) > 0>, "wait": <delay_until_free(key, config)>, "backoff": capped(schedule(config.get("backoff_base", 1.0), config.get("backoff_factor", 2.0), retries), config.get("backoff_cap", 60.0))}` — assert the exact dict twice: a fresh key under a limit-2 config with `retries=3` reads `{"immediate": True, "wait": 0.0, "backoff": [1.0, 2.0, 4.0]}`, and the exhausted mid-window state above reads `{"immediate": False, "wait": 50.0, "backoff": [1.0, 2.0, 4.0]}`. Read-only — no hit is ever recorded (a subsequent `take` still succeeds where it should).
  - `describe_schedule(seq)` returns exactly the comma-joined delays each suffixed `"s"` — `"1.0s, 2.0s, 4.0s"`; `describe_schedule([])` returns exactly `"(no retries)"` — pin both literals.
  - That's 8 test functions; one per bullet.

- [ ] **Step 1e: Write failing tests** in `tests/test_tiers.py` for `app/tiers.py` — an actor-tier policy layer over `app/throttle.py` (imports `app.throttle` and `app.quota` only; no module state beyond the `TIERS` constant). Call `quota.reset()` at the start of every test. One test function per bullet:
  - `TierError` is an `Exception` subclass, distinct from `throttle.PolicyError`.
  - `TIERS` is exactly `{"free": {"limit": 2, "window": 60, "burst": 0}, "pro": {"limit": 10, "window": 60, "burst": 2}, "internal": {"limit": 100, "window": 60, "burst": 10}}` — pin the whole dict.
  - `tier_of(actor, assignments)` reads the actor's tier from the `assignments` dict, defaulting to `"free"` for an unassigned actor; an assignment naming a tier absent from `TIERS` raises `TierError` naming **both** the actor and the bogus tier.
  - `policy_for(actor, assignments)` returns a **deep copy** of the tier's policy dict (mutating the result leaves `TIERS` untouched — assert).
  - `enforce_tier(method, path, actor, assignments)` builds the one-key policies dict `{"<method> <path>": policy_for(actor, assignments)}` and delegates to `throttle.enforce(method, path, actor, <that dict>)` — pin the delegation with a monkeypatched recorder asserting the exact argument tuple, then end-to-end: a `"free"` actor's third `enforce_tier("POST", "/records", "a", {})` raises `throttle.PolicyError` (limit 2), while a `"pro"`-assigned actor's counter is independent (interleave and assert).
  - `remaining_tier(method, path, actor, assignments)` delegates to `throttle.remaining_for` under the same one-key policies dict — read-only (a subsequent `enforce_tier` still succeeds where it should); assert the exact reading for a fresh free actor (`2`) and after one take (`1`).
  - `describe_tiers()` returns exactly `throttle.describe_policies(TIERS)` (recorder pin) — pin the literal: `"free: limit=2, window=60, burst=0\ninternal: limit=100, window=60, burst=10\npro: limit=10, window=60, burst=2"`.
  - `upgrade_path(tier)` returns the next tier by allowance — exactly `"pro"` for `"free"`, `"internal"` for `"pro"`, `None` for `"internal"`; an unknown tier raises `TierError` naming it.
  - That's 8 test functions; one per bullet.

- [ ] **Step 2: Run to verify failure** — `python3 -m pytest tests/test_quota.py tests/test_ratelimit.py tests/test_throttle.py tests/test_backoff.py tests/test_tiers.py -v` → FAIL.

- [ ] **Step 3: Implement `app/quota.py`, then `app/ratelimit.py`, then `app/throttle.py`** — `quota`: `QuotaExceededError`, `_clock`/`_hits` (module globals), `reset`, `now`, `advance`, `take`, `remaining`, `snapshot`, `time_to_next_slot`, `usage`, `purge`; `ratelimit`: `RateLimitExceededError(quota.QuotaExceededError)`, `reset`, `check_and_increment`, `dispatch_hook`, `retry_after`, `limit_headers`, `status_line`, `check_many`; `throttle`: `PolicyError`, `POLICIES`, `match_policy`, `key_for`, `enforce`, `remaining_for`, `describe_policies` (NOT wired into the registry — a library layer for future routes; the registry wiring below is unchanged), per Step 1's contracts exactly (`dispatch_hook` is a no-op for any method other than `"POST"`; all counting lives in `quota.take` — `ratelimit` keeps no counter state of its own; only `rate_limit_max_per_window` is a required config key — window and burst always default via `.get`). Then implement `app/backoff.py` — `BackoffError`, `schedule`, `capped`, `total_wait`, `next_delay`, `delay_until_free`, `retry_plan`, `describe_schedule`, per Step 1d exactly — and `app/tiers.py` — `TierError`, `TIERS`, `tier_of`, `policy_for`, `enforce_tier`, `remaining_tier`, `describe_tiers`, `upgrade_path`, per Step 1e exactly. Neither module touches `app/registry.py` (library layers only; the registry wiring below is unchanged).

- [ ] **Step 4: Wire the registry** — in `app/registry.py`:
  - add three keys to `DEFAULT_CONFIG`, near its existing keys: `"rate_limit_max_per_window": 5`, `"rate_limit_window_seconds": 60` (the hook passes it to `quota.take`; the logical clock only moves under tests, so shipped behavior is pure call-counting), and `"rate_limit_burst": 0`.
  - in the "feature wiring" section, add:
    ```python
    from app import ratelimit  # noqa: E402
    DISPATCH_HOOKS.append(ratelimit.dispatch_hook)
    ```

- [ ] **Step 5: Run to verify pass** — `python3 -m pytest tests/test_quota.py tests/test_ratelimit.py tests/test_throttle.py tests/test_backoff.py tests/test_tiers.py tests/ -v` → PASS.

- [ ] **Step 6: Commit.**

```bash
git add app/ratelimit.py app/quota.py app/throttle.py app/backoff.py app/tiers.py app/registry.py tests/test_ratelimit.py tests/test_quota.py tests/test_throttle.py tests/test_backoff.py tests/test_tiers.py
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
  - `to_report(entries)` renders an exact plain-text report: line `"audit report"`, line `"total: N"`, blank line, line `"by method:"` then one `"  <method>: <count>"` line per method **sorted alphabetically**, blank line, line `"by actor:"` then the same for actors — assert the **exact multi-line string** for a 4-entry fixture, pinned as a **literal in the test** (an `expected` assembled by calling `counts_by` or by re-joining computed lines is a tautology and a review-blocking defect); `to_report([])` is exactly `"audit report\ntotal: 0"` (no section headers for empty counts). Build the counts via `counts_by`, not a re-count.
  - `to_csv_report(entries)` renders exactly the line `"field,value,count"` followed by one `"method,<value>,<count>"` line per method sorted alphabetically, then one `"actor,<value>,<count>"` line per actor sorted alphabetically — assert the exact literal for the same 4-entry fixture; `to_csv_report([])` is exactly `"field,value,count"`. Counts via `counts_by`.
  - `top_actors(entries, n)` returns a list of `(actor, count)` tuples sorted by count **descending**, ties broken by actor **ascending**, truncated to `n` (assert the exact list on a fixture engineered to exercise the tie-break); `top_actors(entries, 0)` returns `[]`; a negative `n` raises `ValueError`.
  - `merge_entries(*entry_lists)` returns one new list concatenating the inputs in argument order — entries are **copies** (mutating a merged entry leaves the sources untouched — assert), inputs unmutated; `merge_entries()` returns `[]`.
  - `diff_summaries(a, b)` takes two `summary(...)` dicts and returns exactly `{"total": b_total - a_total, "by_method": {...}, "by_actor": {...}}` where each sub-dict maps only the values whose counts **changed** to `b_count - a_count` (a value absent from one side counts as 0; unchanged values are omitted). Assert the exact dict for two summaries with an added actor, a removed method, and an unchanged pair.
  - `counts_matrix(entries)` returns exactly the nested dict method → actor → count over the entries (only combinations that occur appear — no zero-filled cells); `counts_matrix([])` returns `{}`. Assert the exact nested dict on a 4-entry fixture where one method is used by two actors and one actor uses two methods.
  - `rollup(entries, fields)` generalizes both: `fields` is a non-empty ordered list drawn from the three legal names with no duplicates (empty, unknown-name, or duplicated fields raise `ValueError`); it returns counts nested by each field in order — assert `rollup(entries, ["method"]) == counts_by(entries, "method")` and `rollup(entries, ["method", "actor"]) == counts_matrix(entries)` (equality against BOTH helpers), plus one exact literal three-level dict for `["actor", "method", "path"]`; `rollup([], ["method"])` returns `{}`.
  - `format_entry(entry)` returns exactly `"<METHOD> <path> (<actor>)"`; an entry missing any of the three keys raises `ValueError` naming the missing key. `to_lines(entries)` returns the list of `format_entry` strings in order (`[]` for empty) — assert the exact list on a 3-entry fixture.
  - `group_by(entries, field)` returns a dict mapping each distinct value of `field` (one of `"method"`/`"path"`/`"actor"` — anything else raises `ValueError` naming the field) to the list of matching entry **copies** in original order; `group_by([], "method")` returns `{}`. Assert the exact dict on a 4-entry fixture and that mutating a grouped entry leaves the source untouched.
  - `search(entries, needle)` returns the entry copies where `needle` is a substring of **any** of the three field values, in original order; an empty `needle` raises `ValueError`; no match returns `[]`. Assert with a needle matching one entry's path and another entry's actor.
  - `to_markdown_report(entries)` renders exactly the pipe table `"| field | value | count |"`, separator `"| --- | --- | --- |"`, then one `"| method | <value> | <count> |"` row per method sorted alphabetically followed by one `"| actor | <value> | <count> |"` row per actor sorted alphabetically (same row order as `to_csv_report`, no cell padding). Assert the **exact multi-line literal** for the 4-entry fixture; `to_markdown_report([])` is exactly the header and separator lines. Counts via `counts_by`.
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
  - `record_many(triples, max_entries)` — `triples` is a list of `(method, path, actor)` tuples — appends each in order, enforcing the cap **after every append** (with `max_entries=2` and four triples, `entries()` never exceeds 2 at any point — assert via a monkeypatched `record` recorder or by interleaving `entries()` reads), and returns the number appended (always `len(triples)` — appends that immediately age out still count).
  - `dropped()` returns the number of entries evicted by the cap since the last `clear()` — `0` on a fresh log; after 5 records at `max_entries=3` it reads exactly `2`; `clear()` resets it to `0` (assert all three).
  - `export_state()` returns exactly `{"entries": <entries() copy>, "dropped": <dropped()>}` — a deep-enough copy that mutating the returned entries does not change the live log (assert).
  - `import_state(state)` replaces the log and the dropped counter from an `export_state()`-shaped dict — assert a full round-trip (`export_state` → `clear` → `import_state` → `entries()`/`dropped()` read back identical), and that later mutations of the dict passed in do not leak into the live log (the import copies).
  - That's 14 cases; one test function per bullet.

- [ ] **Step 2: Run to verify failure** — `python3 -m pytest tests/test_audit.py tests/test_audit_query.py -v` → FAIL.

- [ ] **Step 3: Implement `app/audit.py` then `app/audit_query.py`** — `audit`: `_log` (module-global list), `clear`, `entries`, `record`, `record_many`, `dropped`, `export_state`, `import_state`, `dispatch_hook`, per Step 1's contract exactly; `audit_query`: `filter_entries`, `counts_by`, `counts_matrix`, `rollup`, `last_n`, `redact`, `summary`, `recent`, `paginate`, `to_report`, `to_csv_report`, `to_markdown_report`, `top_actors`, `merge_entries`, `diff_summaries`, `group_by`, `search`, `format_entry`, `to_lines`, pure over its arguments per Step 1a (no import of `app.audit` inside the module — the integration test composes them from the test file).

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
