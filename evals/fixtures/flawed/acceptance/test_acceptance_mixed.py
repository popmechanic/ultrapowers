"""Held-out acceptance tests for the mixed fixture. Never shown to executors."""
import json


def test_schema_contract():
    from apistub.schema import User, FIELDS
    u = User(1, "Ada", "ada@ex.com")
    assert (u.id, u.name, u.email) == (1, "Ada", "ada@ex.com")
    assert list(FIELDS) == ["name", "email"]
    assert FIELDS["name"] is str and FIELDS["email"] is str


def test_validate_payload_error_order():
    from apistub.validate import validate_payload
    assert validate_payload({"name": "Ada", "email": "ada@ex.com"}) == []
    assert validate_payload({}) == ["missing: name", "missing: email"]
    assert validate_payload({"name": 7, "email": "ada-at-ex"}) == \
        ["wrong type: name", "invalid: email"]
    assert validate_payload({"name": "Ada", "email": "a@b", "extra": 1}) == []


def test_to_json_exact_shape():
    from apistub.schema import User
    from apistub.serialize import to_json
    assert to_json(User(1, "Ada", "ada@ex.com")) == \
        '{"id": 1, "name": "Ada", "email": "ada@ex.com"}'


def test_store_autoincrement_and_lookup():
    from apistub.store import MemoryStore
    s = MemoryStore()
    a = s.add("Ada", "ada@ex.com")
    b = s.add("Bob", "bob@ex.com")
    assert (a.id, b.id) == (1, 2)
    assert s.get(2).name == "Bob"
    assert s.get(99) is None
    assert [u.name for u in s.list()] == ["Ada", "Bob"]


def test_create_user_handler():
    from apistub.store import MemoryStore
    from apistub.handlers import create_user
    s = MemoryStore()
    status, body = create_user(s, {"name": "Ada", "email": "ada@ex.com"})
    assert status == 201
    assert json.loads(body) == {"id": 1, "name": "Ada", "email": "ada@ex.com"}
    status, body = create_user(s, {"email": "no-at"})
    assert status == 400
    assert json.loads(body) == {"errors": ["missing: name", "invalid: email"]}


def test_get_user_handler():
    from apistub.store import MemoryStore
    from apistub.handlers import create_user, get_user
    s = MemoryStore()
    create_user(s, {"name": "Ada", "email": "ada@ex.com"})
    assert get_user(s, 1)[0] == 200
    status, body = get_user(s, 42)
    assert status == 404
    assert json.loads(body) == {"errors": ["not found"]}


def test_route_dispatch():
    from apistub.store import MemoryStore
    from apistub.app import route
    s = MemoryStore()
    status, body = route(s, "POST", "/users", {"name": "Ada", "email": "a@b"})
    assert status == 201
    status, body = route(s, "GET", "/users/1")
    assert status == 200 and json.loads(body)["name"] == "Ada"
    status, body = route(s, "DELETE", "/users/1")
    assert status == 404 and json.loads(body) == {"errors": ["no route"]}
