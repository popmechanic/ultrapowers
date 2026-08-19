"""Held-out acceptance tests for the contend-prod fixture. Never shown to
executors. Black-box over the four features' documented behaviors plus the
composed registry (app/registry.py's DEFAULT_CONFIG + wiring section after
all four tasks land).

Runs against a fully-implemented eventboard: `app.registry.bootstrap`,
`app.validation`, `app.export`, `app.ratelimit`, `app.audit`.
"""
import pytest


# ---------------------------------------------------------------------------
# Task 1: input-validation layer
# ---------------------------------------------------------------------------

def test_validation_rejects_missing_required_fields_in_order():
    from app.validation import ValidationError, validate_fields
    with pytest.raises(ValidationError, match="missing field: name"):
        validate_fields({"amount": 1}, required_fields=["name", "amount"], max_amount=100)
    with pytest.raises(ValidationError, match="missing field: name"):
        validate_fields({}, required_fields=["name", "amount"], max_amount=100)


def test_validation_amount_type_and_bool_edge_case():
    from app.validation import ValidationError, validate_fields
    with pytest.raises(ValidationError, match="numeric"):
        validate_fields({"name": "a", "amount": "3"}, required_fields=["name", "amount"], max_amount=100)
    with pytest.raises(ValidationError, match="numeric"):
        validate_fields({"name": "a", "amount": True}, required_fields=["name", "amount"], max_amount=100)


def test_validation_amount_bounds_inclusive():
    from app.validation import ValidationError, validate_fields
    with pytest.raises(ValidationError, match="non-negative"):
        validate_fields({"name": "a", "amount": -1}, required_fields=["name", "amount"], max_amount=100)
    ok = validate_fields({"name": "a", "amount": 0}, required_fields=["name", "amount"], max_amount=100)
    assert ok["amount"] == 0
    with pytest.raises(ValidationError, match="max_amount"):
        validate_fields({"name": "a", "amount": 101}, required_fields=["name", "amount"], max_amount=100)
    ok = validate_fields({"name": "a", "amount": 100}, required_fields=["name", "amount"], max_amount=100)
    assert ok["amount"] == 100


def test_validation_name_non_empty_and_stripped():
    from app.validation import ValidationError, validate_fields
    for bad in ("", "   ", 42):
        with pytest.raises(ValidationError, match="non-empty string"):
            validate_fields({"name": bad, "amount": 1}, required_fields=["name", "amount"], max_amount=100)
    ok = validate_fields({"name": "  ada  ", "amount": 1}, required_fields=["name", "amount"], max_amount=100)
    assert ok["name"] == "ada"


def test_validation_preserves_extra_fields_and_does_not_mutate_input():
    from app.validation import validate_fields
    fields = {"name": "ada", "amount": 1, "category": "x"}
    result = validate_fields(fields, required_fields=["name", "amount"], max_amount=100)
    assert result == {"name": "ada", "amount": 1, "category": "x"}
    assert fields["name"] == "ada"  # input untouched


def test_validation_wired_into_post_records():
    from app.registry import bootstrap
    from app.validation import ValidationError
    from app import ratelimit
    ratelimit.reset()
    app = bootstrap()
    with pytest.raises(ValidationError):
        app.call("POST", "/records", amount=1)
    ratelimit.reset()
    record = app.call("POST", "/records", name="  padded  ", amount=1)
    assert record["name"] == "padded"


# ---------------------------------------------------------------------------
# Task 2: export/report formatter
# ---------------------------------------------------------------------------

def test_export_csv_empty_and_header_row():
    from app.export import to_csv
    assert to_csv([]) == ""
    rows = [{"name": "ada", "amount": 3}, {"name": "bob", "amount": 5}]
    out = to_csv(rows)
    lines = out.split("\n")
    assert lines[0] == "amount,name"
    assert lines[1:] == ["3,ada", "5,bob"]


def test_export_csv_handles_missing_fields_and_int_formatting():
    from app.export import to_csv
    rows = [{"name": "ada", "amount": 3}, {"name": "bob"}]
    out = to_csv(rows)
    lines = out.split("\n")
    assert lines[0] == "amount,name"
    assert lines[1] == "3,ada"
    assert lines[2] == ",bob"


def test_export_json_round_trips_and_sorts_keys():
    import json
    from app.export import to_json
    assert to_json([]) == "[]"
    rows = [{"b": 1, "a": 2}]
    out = to_json(rows)
    assert out == '[{"a": 2, "b": 1}]'
    assert json.loads(out) == rows


def test_export_render_dispatches_and_rejects_unknown_format():
    from app.export import render, to_csv, to_json
    rows = [{"name": "ada", "amount": 3}]
    assert render(rows, "csv") == to_csv(rows)
    assert render(rows, "json") == to_json(rows)
    with pytest.raises(ValueError, match="xml"):
        render(rows, "xml")


def test_export_wired_to_the_export_route():
    from app.registry import bootstrap
    from app import ratelimit
    ratelimit.reset()
    app = bootstrap()
    app.call("POST", "/records", name="a", amount=3, category="food")
    ratelimit.reset()
    app.call("POST", "/records", name="b", amount=5, category="fun")
    csv_out = app.call("GET", "/export")
    json_out = app.call("GET", "/export", fmt="json")
    assert csv_out.startswith("amount,category,id,name")
    assert json_out.startswith("[")
    with pytest.raises(ValueError):
        app.call("GET", "/export", fmt="xml")


# ---------------------------------------------------------------------------
# Task 3: rate-limit/quota module
# ---------------------------------------------------------------------------

def test_ratelimit_per_key_counters_independent():
    from app.ratelimit import check_and_increment, reset, RateLimitExceededError
    reset()
    assert check_and_increment("a", 2) == 1
    assert check_and_increment("b", 2) == 1
    assert check_and_increment("a", 2) == 2
    with pytest.raises(RateLimitExceededError):
        check_and_increment("a", 2)
    assert check_and_increment("b", 2) == 2  # b unaffected by a's exhaustion


def test_ratelimit_reset_clears_all_keys():
    from app.ratelimit import check_and_increment, reset
    reset()
    check_and_increment("a", 1)
    check_and_increment("b", 1)
    reset()
    assert check_and_increment("a", 1) == 1
    assert check_and_increment("b", 1) == 1


def test_ratelimit_dispatch_hook_ignores_reads():
    from app.ratelimit import dispatch_hook, reset
    reset()
    config = {"rate_limit_max_per_window": 1}
    for _ in range(5):
        dispatch_hook(None, config, "GET", "/records", {})
    # a GET never consumed the "anonymous" write quota
    dispatch_hook(None, config, "POST", "/records", {})
    with pytest.raises(Exception):
        dispatch_hook(None, config, "POST", "/records", {})


def test_ratelimit_dispatch_hook_keys_on_actor():
    from app.ratelimit import dispatch_hook, reset, RateLimitExceededError
    reset()
    config = {"rate_limit_max_per_window": 1}
    dispatch_hook(None, config, "POST", "/records", {"actor": "alice"})
    with pytest.raises(RateLimitExceededError):
        dispatch_hook(None, config, "POST", "/records", {"actor": "alice"})
    # a different actor is unaffected
    dispatch_hook(None, config, "POST", "/records", {"actor": "bob"})


def test_ratelimit_wired_into_post_records_end_to_end():
    from app.registry import bootstrap
    from app import ratelimit
    from app.ratelimit import RateLimitExceededError
    ratelimit.reset()
    app = bootstrap({"rate_limit_max_per_window": 3})
    for _ in range(3):
        app.call("POST", "/records", name="x", amount=1, actor="alice")
    with pytest.raises(RateLimitExceededError):
        app.call("POST", "/records", name="x", amount=1, actor="alice")
    # a different actor still has quota
    app.call("POST", "/records", name="x", amount=1, actor="bob")


# ---------------------------------------------------------------------------
# Task 4: audit log
# ---------------------------------------------------------------------------

def test_audit_records_append_in_order():
    from app.audit import clear, entries, record
    clear()
    record("GET", "/records", "alice", 500)
    record("POST", "/records", "bob", 500)
    assert entries() == [
        {"method": "GET", "path": "/records", "actor": "alice"},
        {"method": "POST", "path": "/records", "actor": "bob"},
    ]


def test_audit_entries_returns_a_copy():
    from app.audit import clear, entries, record
    clear()
    record("GET", "/records", "alice", 500)
    snapshot = entries()
    snapshot.append({"method": "X", "path": "Y", "actor": "Z"})
    assert entries() == [{"method": "GET", "path": "/records", "actor": "alice"}]


def test_audit_cap_drops_oldest_and_holds_at_all_times():
    from app.audit import clear, entries, record
    clear()
    for i in range(5):
        record("GET", "/records", "actor%d" % i, 2)
        assert len(entries()) <= 2
    assert entries() == [
        {"method": "GET", "path": "/records", "actor": "actor3"},
        {"method": "GET", "path": "/records", "actor": "actor4"},
    ]


def test_audit_dispatch_hook_defaults_actor_and_excludes_record_fields():
    from app.audit import clear, entries, dispatch_hook
    clear()
    config = {"audit_log_max_entries": 500}
    dispatch_hook(None, config, "GET", "/records", {})
    dispatch_hook(None, config, "POST", "/records", {"actor": "bob", "name": "x"})
    assert entries() == [
        {"method": "GET", "path": "/records", "actor": "anonymous"},
        {"method": "POST", "path": "/records", "actor": "bob"},
    ]


def test_audit_dispatch_hook_fires_for_every_method():
    from app.audit import clear, entries, dispatch_hook
    clear()
    config = {"audit_log_max_entries": 500}
    dispatch_hook(None, config, "DELETE", "/records/{id}", {})
    dispatch_hook(None, config, "PUT", "/records/{id}", {})
    assert [e["method"] for e in entries()] == ["DELETE", "PUT"]


# ---------------------------------------------------------------------------
# Composed registry: config defaults + wiring, all four features present
# ---------------------------------------------------------------------------

def test_default_config_carries_all_four_feature_blocks():
    from app.registry import DEFAULT_CONFIG
    assert DEFAULT_CONFIG["validation_required_fields"] == ["name", "amount"]
    assert DEFAULT_CONFIG["validation_max_amount"] == 100000
    assert DEFAULT_CONFIG["export_default_format"] == "csv"
    assert set(DEFAULT_CONFIG["export_formats_enabled"]) == {"csv", "json"}
    assert DEFAULT_CONFIG["rate_limit_max_per_window"] == 5
    assert DEFAULT_CONFIG["rate_limit_window_seconds"] == 60
    assert DEFAULT_CONFIG["audit_log_enabled"] is True
    assert DEFAULT_CONFIG["audit_log_max_entries"] == 500
    # base config keys still present and untouched
    assert DEFAULT_CONFIG["app_name"] == "eventboard"
    assert DEFAULT_CONFIG["max_records"] == 10000
    assert DEFAULT_CONFIG["default_category"] == "uncategorized"


def test_all_four_hooks_are_registered_exactly_once():
    from app import registry, validation, export, ratelimit, audit
    assert registry.PRE_CREATE_HOOKS.count(validation.pre_create_hook) == 1
    assert registry.DISPATCH_HOOKS.count(ratelimit.dispatch_hook) == 1
    assert registry.DISPATCH_HOOKS.count(audit.dispatch_hook) == 1
    assert registry.EXPORT_FORMATS["csv"] is export.to_csv
    assert registry.EXPORT_FORMATS["json"] is export.to_json


def test_full_flow_create_export_over_quota_and_audit_agree():
    """One end-to-end composed scenario touching all four features on a
    single bootstrap: valid creates succeed and are exported and audited,
    an invalid create is rejected by validation but still consumes quota
    and is still audited (DISPATCH_HOOKS run before the router dispatches,
    ahead of PRE_CREATE_HOOKS validation).

    Asserts only facts that hold under EVERY legal wiring order: the plan
    leaves the relative append order of the two DISPATCH_HOOKS (rate limit
    and audit) unpinned, so a call that a dispatch hook *rejects* may or may
    not have been audited first."""
    from app.registry import bootstrap
    from app.validation import ValidationError
    from app.ratelimit import RateLimitExceededError
    from app import ratelimit, audit

    ratelimit.reset()
    audit.clear()
    app = bootstrap({"rate_limit_max_per_window": 2})

    r1 = app.call("POST", "/records", name="ada", amount=3, actor="ada", category="food")
    assert r1["id"] == 1

    with pytest.raises(ValidationError):
        app.call("POST", "/records", amount=1, actor="ada")  # 2nd call for "ada": consumes quota, fails validation

    with pytest.raises(RateLimitExceededError):
        app.call("POST", "/records", name="ada2", amount=1, actor="ada")  # 3rd call: over quota

    exported = app.call("GET", "/export")
    assert exported == "actor,amount,category,id,name\nada,3,food,1,ada"

    # The first two calls for "ada" are both within quota, so no dispatch hook
    # can short-circuit them and both are audited whichever hook runs first.
    # The 3rd (over-quota) call is deliberately not pinned: whether the audit
    # hook sees it depends on the unpinned hook order.
    ada_entries = [e for e in audit.entries() if e["actor"] == "ada"]
    assert ada_entries[:2] == [
        {"method": "POST", "path": "/records", "actor": "ada"},
        {"method": "POST", "path": "/records", "actor": "ada"},
    ]
    assert 2 <= len(ada_entries) <= 3
    assert all(e["method"] == "POST" and e["path"] == "/records" for e in ada_entries)
