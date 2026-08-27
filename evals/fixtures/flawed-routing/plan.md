# Apistub Users API v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan may also be executed by `/ultrapowers`.

**Acceptance:** sealed 74a867ad3c7f (sha256:74a867ad3c7fc4173a9e5aada660daa76c16aeb7e721baed0cd0f88f074343d6)

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
