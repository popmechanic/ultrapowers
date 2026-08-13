"""Pre-existing smoke tests for the base report renderer."""
from app.report import render_report, totals_by_category


def test_totals_by_category_sums_amounts():
    records = [
        {"category": "food", "amount": 3},
        {"category": "food", "amount": 2},
        {"category": "fun", "amount": 5},
    ]
    assert totals_by_category(records) == {"food": 5, "fun": 5}


def test_totals_by_category_defaults_missing_category():
    records = [{"amount": 1}]
    assert totals_by_category(records) == {"uncategorized": 1}


def test_render_report_is_sorted_by_category():
    records = [{"category": "b", "amount": 1}, {"category": "a", "amount": 2}]
    assert render_report(records) == "a: 2\nb: 1"


def test_render_report_empty():
    assert render_report([]) == ""
