"""Pre-existing smoke tests for the base registry/bootstrap wiring."""
import pytest

from app.registry import bootstrap, DEFAULT_CONFIG


def test_bootstrap_returns_working_app_with_default_config():
    app = bootstrap()
    assert app.config["app_name"] == DEFAULT_CONFIG["app_name"]


def test_bootstrap_merges_config_overrides():
    app = bootstrap({"app_name": "custom"})
    assert app.config["app_name"] == "custom"
    assert app.config["max_records"] == DEFAULT_CONFIG["max_records"]


def test_base_crud_and_report_routes_are_wired():
    app = bootstrap()
    created = app.call("POST", "/records", name="coffee", amount=3)
    assert created["id"] == 1
    assert created["category"] == "uncategorized"
    assert app.call("GET", "/records/{id}", id=created["id"]) == created
    assert app.call("GET", "/records") == [created]
    assert app.call("GET", "/report") == "uncategorized: 3"
    assert app.call("DELETE", "/records/{id}", id=created["id"]) == {"deleted": 1}
    assert app.call("GET", "/records") == []


def test_export_route_rejects_a_format_it_does_not_know():
    """`_export` raises ValueError for a format that is neither enabled in
    config nor present in EXPORT_FORMATS.

    This holds both while EXPORT_FORMATS is empty and after a feature fills
    it in, so it stays green as the app grows. Do NOT assert that the
    *default* format fails: EXPORT_FORMATS is a lookup table a feature is
    expected to populate, and pinning "/export is broken" would turn that
    feature landing into a smoke-test failure."""
    app = bootstrap()
    with pytest.raises(ValueError):
        app.call("GET", "/export", fmt="xml")


def test_two_bootstraps_do_not_share_store_state():
    a = bootstrap()
    b = bootstrap()
    a.call("POST", "/records", name="x", amount=1)
    assert a.call("GET", "/records") != []
    assert b.call("GET", "/records") == []
