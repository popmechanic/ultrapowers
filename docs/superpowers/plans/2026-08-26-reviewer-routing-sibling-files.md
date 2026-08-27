# Reviewer Routing on SIBLING FILES Implementation Plan (#285 + #245)

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Acceptance:** suite — engine prompt-text change pinned by the drift test; the issue-mandated A/B eval (Task 3) is the behavioral gate and runs before merge.

**Goal:** Make reviewer plan-defect routing mechanical on SIBLING FILES (own-file interface defects become blocking; "when in doubt, gate" deleted) and fix the FILES-footprint wording (sibling carve-out + severity ceiling), then prove it on a seeded A/B fixture before merging.

**Architecture:** Edit the canonical prompt source (`references/reviewer-prompts.md`), re-bake into `waves.js`, keep the drift pin green. Author a new eval fixture seeding one class-2 (own-file interface) and one class-1 (sibling-file) plan-verbatim defect. Run 4 serial ab_runner cells; adopt per the spec's gate.

**Tech Stack:** Python 3 + pytest (drift pin), JS (waves.js prompt constants), ab_runner.py (eval cells).

**Spec:** docs/superpowers/specs/2026-08-26-reviewer-routing-sibling-files.md

## Global Constraints

- FROZEN periphery untouched: `gate_check.py`, `ultra_gate.py`, `run_lock.sh`, sealing scripts, compiler diagnostic vocabulary — zero diff.
- Baked prompts: edit `references/reviewer-prompts.md` AND `waves.js` together; `tests/test_no_prompt_drift.py` must pass.
- Implementer "Plan-supplied code that is genuinely defective" line (conservative implement-then-report) stays byte-unchanged.
- `evals/ab_runner.py` code untouched (the fixture is data-only to the runner).
- Full suite green: `python3 -m pytest` (baseline 1169).

---

### Task 1: Prompt source edits + re-bake

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Test: `tests/test_no_prompt_drift.py`

**Interfaces:**
- Produces: the three edited prompt spans (Edits 1–3 below), identically worded in both files (drift-normalized).

- [ ] **Step 1: Run the drift pin to confirm green baseline**

Run: `python3 -m pytest tests/test_no_prompt_drift.py -q` → all pass.

- [ ] **Step 2: Edit 1 — routing replacement (REVIEWER_PROMPT block)**

In `references/reviewer-prompts.md`, inside the "Plan-supplied code is not privileged" paragraph, replace the span from `Prefix the detail `plan-defect:` — and route by blast radius.` through `— when in doubt, gate.` (inclusive) with exactly:

```
Prefix the detail `plan-defect:`. Cross-task routing is mechanical, not a judgment call: report severity `minor` so the finding routes to the pre-merge gate ONLY when (1) applying the fix would require editing a path listed in `SIBLING FILES` — a same-wave sibling owns it and fixing here would violate worktree isolation — or (2) the defect is observable only with two or more merged branches present. Every other confirmed defect — including a defect in an interface on this task's own files whose consumers are downstream tasks — is reported at its true severity so the fix loop applies it now, and the fix carries the same `plan-defect:` disclosure; a downstream consumer has not started and will implement against the corrected surface.
```

The paragraph's leading sentence ("Plan-supplied code is not privileged: …report it rather than waiving it as spec-faithful.") and trailing sentence ("When the diff already diverges from plan text under a disclosed `plan-defect:` concern …") stay unchanged.

- [ ] **Step 3: Edit 2 — FILES-footprint sentence (REVIEWER_PROMPT block)**

Replace the sentence `An undisclosed out-of-`FILES` modification — one the implementer did not surface as an `out-of-FILES:` concern — is itself a `minor` issue, not a blocking one.` with exactly:

```
The out-of-`FILES` footprint is itself at most a `minor` finding, disclosed or not; judge the change's own content under the other items at its true severity. Sibling-owned paths are never footprint — the `SIBLING FILES` rule governs them, and creating or modifying one stays blocking.
```

- [ ] **Step 4: Edit 3 — implementer footprint bullet (IMPLEMENTER_PROMPT block)**

In the "Read the packet's `## Files changed`" bullet, change `a modified path outside it is allowed when the task requires it — a plan-mandated gate command or check is forcing context, not a scope violation —` to `a modified path outside it is allowed when the task requires it (sibling-owned paths excepted — see `SIBLING FILES`) — a plan-mandated gate command or check is forcing context, not a scope violation —`.

- [ ] **Step 5: Re-bake waves.js**

Copy each edited span into the corresponding `const` strings in `skills/ultrapowers/harnesses/waves.js` (REVIEWER_PROMPT: the routing paragraph line and the FILES-footprint line; IMPLEMENTER_PROMPT: the footprint bullet line). Words must match; formatting normalizes.

- [ ] **Step 6: Run the drift pin + canary**

Run: `python3 -m pytest tests/test_no_prompt_drift.py tests/test_canary.py -q` → all pass (the canary's JS-parse check guards the string edits).

- [ ] **Step 7: Commit**

```bash
git add skills/ultrapowers/references/reviewer-prompts.md skills/ultrapowers/harnesses/waves.js
git commit -m "feat(engine): reviewer routing keyed on SIBLING FILES; FILES-footprint sibling carve-out + severity ceiling (#285, #245)"
```

### Task 2: A/B fixture `flawed-routing`

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `evals/fixtures/flawed-routing/plan.md`
- Create: `evals/fixtures/flawed-routing/version.txt`
- Create: `evals/fixtures/flawed-routing/project/apistub/__init__.py`
- Create: `evals/fixtures/flawed-routing/project/tests/test_smoke.py`
- Create: `evals/fixtures/flawed-routing/acceptance/test_acceptance_routing.py`

**Interfaces:**
- Produces: fixture directory consumable by `evals/ab_runner.py --fixture flawed-routing` (layout contract: plan.md + project/ + acceptance/).

Design (from the spec): a 5-task apistub plan, waves 1→{2,3,4}→5. Two seeded plan-verbatim defects: **class-2** in Task 1 (FIELDS insertion order contradicts the task's own stated contract; own-file fix; downstream consumers), **class-1** in Task 3 (wire schema version 1 contradicts the stated v2 criterion; the corrective edit spans the sibling-owned store module). Task bodies avoid sibling path tokens outside fences (no manufactured compile edges) and avoid cross-sibling `Consumes` (no interface edges) so tasks 2/3/4 stay one wave.

- [ ] **Step 1: Project skeleton**

Mirror the `flawed` fixture's skeleton: `project/apistub/__init__.py` carries
the one-line package docstring (`"""apistub — an in-memory users API, no
network."""`) and `project/tests/test_smoke.py` asserts the package imports
with a docstring (byte-copies of `evals/fixtures/flawed/project/*`).
(Amended post-review for fidelity: the build copied the `flawed` precedent
rather than the originally-planned empty files — behavior identical.)

- [ ] **Step 2: Write `plan.md`**

Exact content (the seeded defects are deliberate — do NOT correct them):

````markdown
# Apistub Users API v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan may also be executed by `/ultrapowers`.

**Acceptance:** sealed SEAL_ID_PLACEHOLDER (sha256:SEAL_SHA_PLACEHOLDER)

**Goal:** Build an in-memory users API in five tasks: schema first; validation, serialization, and storage in parallel on top of it; handlers joining all three. No network code — `route` is a plain function.

**Tech Stack:** Python 3.11 + pytest. Run the suite with `python3 -m pytest tests/ -q` from the repo root.

---

### Task 1: User schema

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `apistub/schema.py`
- Test: `tests/test_schema.py`

**Interfaces:**
- Produces: `User`
- Produces: `FIELDS`

The creation-payload contract: `FIELDS` maps payload field names to their types. Insertion order matters and is part of the contract: `name` first, then `email` — downstream validation reports errors in `FIELDS` order.

- [ ] **Step 1: Write the tests** for the schema module, exactly:

```python
from apistub.schema import User, FIELDS


def test_user_dataclass():
    u = User(1, "Ada", "ada@ex.com")
    assert (u.id, u.name, u.email) == (1, "Ada", "ada@ex.com")


def test_fields_contract():
    assert set(FIELDS) == {"name", "email"}
    assert FIELDS["name"] is str and FIELDS["email"] is str
```

- [ ] **Step 2: Implement** `apistub/schema.py`, exactly:

```python
from dataclasses import dataclass


@dataclass
class User:
    id: int
    name: str
    email: str


FIELDS = {"email": str, "name": str}
```

- [ ] **Step 3: Run** `python3 -m pytest tests/test_schema.py -q` → PASS. Commit.

### Task 2: Payload validation

**Type:** implementation
**Depends-on:** 1

**Files:**
- Create: `apistub/validate.py`
- Test: `tests/test_validate.py`

**Interfaces:**
- Consumes: `FIELDS` (from Task 1)
- Produces: `validate_payload(payload: dict) -> list[str]`

Errors are appended for each key in `schema.FIELDS`, in `FIELDS` order (the contract puts `name` first): if missing, `f"missing: {key}"`; else if not an instance of the declared type, `f"wrong type: {key}"`. After the field loop: if `email` is present and a `str` but lacks `"@"`, append `"invalid: email"`. Unknown keys are ignored.

- [ ] **Step 1: Write the tests**, exactly:

```python
from apistub.validate import validate_payload


def test_valid_payload():
    assert validate_payload({"name": "Ada", "email": "ada@ex.com"}) == []


def test_missing_both():
    errs = validate_payload({})
    assert set(errs) == {"missing: name", "missing: email"}


def test_bad_email():
    assert validate_payload({"name": "Ada", "email": "nope"}) == ["invalid: email"]
```

- [ ] **Step 2: Implement** `apistub/validate.py`, exactly:

```python
from apistub import schema


def validate_payload(payload):
    errors = []
    for key, typ in schema.FIELDS.items():
        if key not in payload:
            errors.append(f"missing: {key}")
        elif not isinstance(payload[key], typ):
            errors.append(f"wrong type: {key}")
    email = payload.get("email")
    if isinstance(email, str) and "@" not in email:
        errors.append("invalid: email")
    return errors
```

- [ ] **Step 3: Run** `python3 -m pytest tests/test_validate.py -q` → PASS. Commit.

### Task 3: Serialization

**Type:** implementation
**Depends-on:** 1

**Files:**
- Create: `apistub/serialize.py`
- Test: `tests/test_serialize.py`

**Interfaces:**
- Consumes: `User` (from Task 1)
- Produces: `to_json(user) -> str`

`to_json` returns `json.dumps` of `{"v": <wire schema version>, "id": ..., "name": ..., "email": ...}` in exactly that key order, default separators. **Acceptance criterion: the wire schema version MUST be 2** — this plan implements the v2 key-order contract. The store module owned by sibling Task 4 declares the same wire version as a module constant per its verbatim code; keep the two in agreement.

- [ ] **Step 1: Write the tests**, exactly:

```python
import json

from apistub.schema import User
from apistub.serialize import to_json


def test_round_trip_fields():
    data = json.loads(to_json(User(1, "Ada", "ada@ex.com")))
    assert data["id"] == 1 and data["name"] == "Ada" and data["email"] == "ada@ex.com"
    assert list(data)[0] == "v"
```

- [ ] **Step 2: Implement** `apistub/serialize.py`, exactly:

```python
import json


def to_json(user):
    return json.dumps({"v": 1, "id": user.id, "name": user.name, "email": user.email})
```

- [ ] **Step 3: Run** `python3 -m pytest tests/test_serialize.py -q` → PASS. Commit.

### Task 4: In-memory store

**Type:** implementation
**Depends-on:** 1

**Files:**
- Create: `apistub/store.py`
- Test: `tests/test_store.py`

**Interfaces:**
- Consumes: `User` (from Task 1)
- Produces: `InMemoryStore`

`InMemoryStore.add(name, email)` assigns ids starting at 1 and returns the created `schema.User`; `get(id)` returns the `User` or `None`; `all()` returns users in insertion order.

- [ ] **Step 1: Write the tests**, exactly:

```python
from apistub.store import InMemoryStore


def test_add_assigns_ids():
    s = InMemoryStore()
    u1 = s.add("Ada", "ada@ex.com")
    u2 = s.add("Bob", "bob@ex.com")
    assert (u1.id, u2.id) == (1, 2)
    assert s.get(1).name == "Ada" and s.get(3) is None
    assert [u.name for u in s.all()] == ["Ada", "Bob"]
```

- [ ] **Step 2: Implement** `apistub/store.py`, exactly:

```python
from apistub.schema import User

SCHEMA_VERSION = 1  # wire schema version embedded by serialization


class InMemoryStore:
    def __init__(self):
        self._users = {}
        self._next = 1

    def add(self, name, email):
        user = User(self._next, name, email)
        self._users[self._next] = user
        self._next += 1
        return user

    def get(self, user_id):
        return self._users.get(user_id)

    def all(self):
        return list(self._users.values())
```

- [ ] **Step 3: Run** `python3 -m pytest tests/test_store.py -q` → PASS. Commit.

### Task 5: Handlers and routing

**Type:** implementation
**Depends-on:** 2, 3, 4

**Files:**
- Create: `apistub/handlers.py`
- Test: `tests/test_handlers.py`

**Interfaces:**
- Consumes: `validate_payload` (Task 2), `to_json` (Task 3), `InMemoryStore` (Task 4)
- Produces: `route(store, method: str, path: str, payload: dict | None) -> tuple[int, str]`

`route` supports `("POST", "/users", payload)` → validate; on errors return `(400, json.dumps({"errors": errors}))`; else `(201, to_json(store.add(payload["name"], payload["email"])))`. `("GET", "/users/<id>", None)` → `(200, to_json(user))` or `(404, "{}")`. Anything else → `(405, "{}")`.

- [ ] **Step 1: Write the tests**, exactly:

```python
import json

from apistub.handlers import route
from apistub.store import InMemoryStore


def test_post_and_get():
    s = InMemoryStore()
    code, body = route(s, "POST", "/users", {"name": "Ada", "email": "ada@ex.com"})
    assert code == 201 and json.loads(body)["id"] == 1
    code, body = route(s, "GET", "/users/1", None)
    assert code == 200 and json.loads(body)["name"] == "Ada"
    assert route(s, "GET", "/users/9", None) == (404, "{}")


def test_post_invalid():
    s = InMemoryStore()
    code, body = route(s, "POST", "/users", {})
    assert code == 400 and set(json.loads(body)["errors"]) == {"missing: name", "missing: email"}
    assert route(s, "PUT", "/users", None) == (405, "{}")
```

- [ ] **Step 2: Implement** `apistub/handlers.py`, exactly:

```python
import json

from apistub.serialize import to_json
from apistub.validate import validate_payload


def route(store, method, path, payload):
    if method == "POST" and path == "/users":
        errors = validate_payload(payload or {})
        if errors:
            return 400, json.dumps({"errors": errors})
        return 201, to_json(store.add(payload["name"], payload["email"]))
    if method == "GET" and path.startswith("/users/"):
        user = store.get(int(path.rsplit("/", 1)[1]))
        return (200, to_json(user)) if user else (404, "{}")
    return 405, "{}"
```

- [ ] **Step 3: Run** `python3 -m pytest tests/ -q` → PASS. Commit.
````

- [ ] **Step 3: Write the acceptance suite** `acceptance/test_acceptance_routing.py`, exactly:

```python
"""Held-out acceptance: asserts the CORRECT contracts the seeded plan-verbatim
defects violate — FIELDS order (class-2 seed) and wire schema version 2
(class-1 seed) — plus the integrated POST/GET seam."""
import json

from apistub import schema, serialize, store, validate
from apistub.handlers import route


def test_fields_insertion_order_name_first():
    assert list(schema.FIELDS) == ["name", "email"]


def test_validation_errors_in_fields_order():
    assert validate.validate_payload({}) == ["missing: name", "missing: email"]


def test_wire_schema_version_is_2():
    data = json.loads(serialize.to_json(schema.User(1, "Ada", "ada@ex.com")))
    assert data["v"] == 2
    assert store.SCHEMA_VERSION == 2


def test_integrated_post_get():
    s = store.InMemoryStore()
    code, body = route(s, "POST", "/users", {"name": "Ada", "email": "ada@ex.com"})
    assert code == 201
    code, body = route(s, "GET", "/users/1", None)
    assert code == 200 and json.loads(body)["email"] == "ada@ex.com"
```

- [ ] **Step 4: Seal + placeholders**

Run `python3 skills/ultrapowers/scripts/seal_hash.py evals/fixtures/flawed-routing/acceptance` → digest. Replace `SEAL_SHA_PLACEHOLDER` with the digest and `SEAL_ID_PLACEHOLDER` with its first 12 hex chars in `plan.md`.

- [ ] **Step 5: version.txt**

```
1-flawed-routing (2026-08-26)
A/B instrument for #285 reviewer routing. Two INTENTIONAL plan-verbatim
defects — do NOT "fix" them; the bugs ARE the fixture:
- class-2 (Task 1): FIELDS = {"email":..., "name":...} contradicts the task's
  own stated contract (name first). Own-file fix; consumers downstream.
- class-1 (Task 3): to_json embeds "v": 1 against the stated v2 criterion;
  the corrective edit spans sibling-owned store.py (SCHEMA_VERSION = 1).
Task-local tests are deliberately order-/version-insensitive so worktree
suites stay green; the sealed acceptance asserts the correct contracts.
```

- [ ] **Step 6: Verify fixture compiles and stays one wave**

Run: `python3 skills/ultrapowers/scripts/compile_plan.py evals/fixtures/flawed-routing/plan.md` → waves `[[1],[2,3,4],[5]]` (tasks 2/3/4 one wave — no manufactured edge between 3 and 4). Then `python3 -m pytest tests/test_fixture_seals.py tests/test_compile_plan.py -q` → green (fixture not in the pin list — flawed precedent).

- [ ] **Step 7: Commit**

```bash
git add evals/fixtures/flawed-routing
git commit -m "feat(evals): flawed-routing A/B fixture — class-1/class-2 seeded routing defects (#285)"
```

### Task 3: A/B cells + adjudication record

**Type:** manual
**Depends-on:** 1, 2

Serial `ab_runner.py` cells (drives the real claude CLI; RUN_LOCK conventions apply — one at a time):

1. `python3 evals/ab_runner.py --engine-ref c758831 --engine-label A --fixture flawed-routing`
2. `python3 evals/ab_runner.py --engine-ref <feature-branch> --engine-label B --fixture flawed-routing`
3. `python3 evals/ab_runner.py --engine-ref <feature-branch> --engine-label B --fixture contend`
4. `python3 evals/ab_runner.py --engine-ref <feature-branch> --engine-label B --fixture mixed`

Read each cell's run dir (receipt, report, gate report, acceptance result). Apply the spec's adoption gate verbatim (per-seed routing outcomes; instrument precondition; ≤2 re-runs per cell). Write `evals/frontier/results/2026-08-26-routing-ab.md` recording every cell and the verdict. Adopt → proceed to merge; fail → branch does not merge, findings to #285.

### Task 4: Suite gate

**Type:** gate
**Depends-on:** 1, 2

Run: `python3 -m pytest` → green (≥1169). `bash skills/ultrapowers/scripts/run_acceptance.sh --suite-gate --base main` semantics: waves.js was touched, so the covering `.mjs` sims run and must print their ALL-SCENARIOS-PASSED sentinel.

## Operator smoke

- do: `grep -c "when in doubt, gate" skills/ultrapowers/harnesses/waves.js skills/ultrapowers/references/reviewer-prompts.md`
- see: `0` for both files — the doubt-default is gone from source and bake.
- do: open `evals/frontier/results/2026-08-26-routing-ab.md`
- see: 4+ cells recorded, per-seed routing table, an explicit ADOPT verdict with the class-1 seed gated in both arms.
- do: `python3 skills/ultrapowers/scripts/compile_plan.py evals/fixtures/flawed-routing/plan.md | head`
- see: three waves with tasks 2, 3, 4 sharing the middle wave.
