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
