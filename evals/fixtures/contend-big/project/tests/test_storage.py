"""Pre-existing smoke tests for the base in-memory store."""
import pytest

from app.storage import Store, NotFoundError


def test_create_assigns_incrementing_ids():
    s = Store()
    a = s.create({"name": "a"})
    b = s.create({"name": "b"})
    assert a["id"] == 1 and b["id"] == 2


def test_create_returns_a_copy_not_the_live_record():
    s = Store()
    r = s.create({"name": "a"})
    r["name"] = "mutated"
    assert s.get(r["id"])["name"] == "a"


def test_get_missing_raises_not_found():
    s = Store()
    with pytest.raises(NotFoundError):
        s.get(999)


def test_delete_removes_and_returns_marker():
    s = Store()
    r = s.create({"name": "a"})
    assert s.delete(r["id"]) == {"deleted": r["id"]}
    with pytest.raises(NotFoundError):
        s.get(r["id"])


def test_delete_missing_raises_not_found():
    s = Store()
    with pytest.raises(NotFoundError):
        s.delete(999)


def test_all_and_filter():
    s = Store()
    s.create({"name": "a", "category": "x"})
    s.create({"name": "b", "category": "y"})
    assert len(s.all()) == 2
    assert [r["name"] for r in s.filter(category="y")] == ["b"]
    assert s.filter(category="none") == []


def test_filter_with_no_predicate_returns_all():
    s = Store()
    s.create({"name": "a"})
    assert s.filter() == s.all()


def test_count():
    s = Store()
    assert s.count() == 0
    s.create({"name": "a"})
    assert s.count() == 1
