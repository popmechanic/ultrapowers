"""Pre-existing smoke tests for the base router."""
import pytest

from app.router import Router, RouteNotFoundError, RouteAlreadyRegisteredError


def test_register_and_dispatch_with_kwargs():
    r = Router()
    r.register("GET", "/ping", lambda name: "pong %s" % name)
    assert r.dispatch("GET", "/ping", name="a") == "pong a"


def test_method_is_case_insensitive_on_register_and_dispatch():
    r = Router()
    r.register("get", "/x", lambda: "ok")
    assert r.dispatch("GET", "/x") == "ok"
    assert r.dispatch("get", "/x") == "ok"


def test_dispatch_unknown_route_raises():
    r = Router()
    with pytest.raises(RouteNotFoundError):
        r.dispatch("GET", "/missing")


def test_duplicate_register_raises():
    r = Router()
    r.register("GET", "/x", lambda: "ok")
    with pytest.raises(RouteAlreadyRegisteredError):
        r.register("GET", "/x", lambda: "again")


def test_routes_lists_sorted_method_path_pairs():
    r = Router()
    r.register("GET", "/b", lambda: None)
    r.register("POST", "/a", lambda: None)
    assert r.routes() == [("GET", "/b"), ("POST", "/a")]
