# Apistub Users API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan may also be executed by `/ultrapowers`.

**Goal:** Build an in-memory users API in six tasks forming a diamond: schema and storage are independent roots; validation and serialization build on the schema; handlers join all three; routing tops it off. No network code anywhere — `route` is a plain function.

**Tech Stack:** Python 3.11 + pytest. Run the suite with `python3 -m pytest tests/ -q` from the repo root.

---

### Task 1: User schema

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `apistub/schema.py`
- Test: `tests/test_schema.py`

- [ ] **Step 1: Write failing tests** for the schema module:
  - A dataclass `User` with fields `id: int`, `name: str`, `email: str`.
  - A module constant `FIELDS = {"name": str, "email": str}` — the creation-payload contract (insertion order matters: `name` first).
- [ ] **Step 2: Implement** `apistub/schema.py`.

### Task 2: Payload validation

**Type:** implementation
**Depends-on:** 1

**Files:**
- Create: `apistub/validate.py`
- Test: `tests/test_validate.py`

- [ ] **Step 1: Write failing tests** for `validate_payload(payload)`:
  - `payload` is a dict; returns a list of error strings, `[]` when valid.
  - For each key in `schema.FIELDS` (in `FIELDS` order): if missing, append `f"missing: {key}"`; else if not an instance of the declared type, append `f"wrong type: {key}"`.
  - After the field loop: if `email` is present and a `str` but does not contain `"@"`, append `"invalid: email"`.
  - Unknown keys in the payload are ignored.
- [ ] **Step 2: Implement** `validate_payload` in `apistub/validate.py`.

### Task 3: Serialization

**Type:** implementation
**Depends-on:** 1

**Files:**
- Create: `apistub/serialize.py`
- Test: `tests/test_serialize.py`

- [ ] **Step 1: Write failing tests** for `to_json(user)`:
  - Takes a `schema.User`; returns `json.dumps` of `{"id": ..., "name": ..., "email": ...}` with keys in exactly that insertion order and default separators.
  - Example: `to_json(User(1, "Ada", "ada@ex.com"))` → `'{"id": 1, "name": "Ada", "email": "ada@ex.com"}'`.
- [ ] **Step 2: Implement** `to_json` in `apistub/serialize.py`.

### Task 4: In-memory store

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `apistub/store.py`
- Test: `tests/test_store.py`

- [ ] **Step 1: Write failing tests** for `class MemoryStore`:
  - `add(name, email)` creates and returns a `schema.User` with an auto-incrementing integer `id` starting at 1.
  - `get(user_id)` returns the `User` or `None`.
  - `list()` returns all users in insertion order.
- [ ] **Step 2: Implement** `MemoryStore` in `apistub/store.py`.

### Task 5: Handlers

**Type:** implementation
**Depends-on:** 2, 3, 4

**Files:**
- Create: `apistub/handlers.py`
- Test: `tests/test_handlers.py`

- [ ] **Step 1: Write failing tests** for the handler functions, each returning a `(status: int, body: str)` tuple:
  - `create_user(store, payload)`: run Task 2's `validate_payload`; on errors return `(400, json.dumps({"errors": errors}))`; otherwise `store.add(...)` and return `(201, to_json(user))` using Task 3's serializer.
  - `get_user(store, user_id)`: found → `(200, to_json(user))`; missing → `(404, json.dumps({"errors": ["not found"]}))`.
- [ ] **Step 2: Implement** both handlers in `apistub/handlers.py`.

### Task 6: Router

**Type:** implementation
**Depends-on:** 5

**Files:**
- Create: `apistub/app.py`
- Test: `tests/test_app.py`

- [ ] **Step 1: Write failing tests** for `route(store, method, path, payload=None)`:
  - `("POST", "/users")` → Task 5's `create_user(store, payload)`.
  - `("GET", "/users/<digits>")` → `get_user(store, int(<digits>))`.
  - Anything else → `(404, json.dumps({"errors": ["no route"]}))`.
- [ ] **Step 2: Implement** `route` in `apistub/app.py`.

### Task 7: Full-suite verification

**Type:** gate

**Files:** none

- [ ] Run `python3 -m pytest tests/ -q` from the repo root and confirm every test passes, including the pre-existing smoke test.
