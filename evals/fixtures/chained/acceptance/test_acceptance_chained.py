"""Held-out acceptance tests for the chained fixture. Never shown to executors."""
import pytest


def test_validate_rejects_bad_entries():
    from ledger.model import Entry
    with pytest.raises(ValueError, match="empty description"):
        Entry(date="2026-01-15", description="   ", amount_cents=1).validate()
    with pytest.raises(ValueError, match="bad date"):
        Entry(date="2026-1-15", description="x", amount_cents=1).validate()
    assert Entry(date="2026-01-15", description="x", amount_cents=1).validate() is None


def test_parse_line_happy_path():
    from ledger.parse import parse_line
    e = parse_line("2026-01-15|coffee|-4.50")
    assert (e.date, e.description, e.amount_cents) == ("2026-01-15", "coffee", -450)


def test_parse_line_errors():
    from ledger.parse import parse_line
    with pytest.raises(ValueError, match="bad line"):
        parse_line("2026-01-15|coffee")
    with pytest.raises(ValueError, match="bad amount"):
        parse_line("2026-01-15|coffee|-4.5")
    with pytest.raises(ValueError, match="bad date"):
        parse_line("01/15/2026|coffee|1.00")


def test_running_balance():
    from ledger.model import Entry
    from ledger.balance import running_balance
    entries = [Entry("2026-01-01", "a", 1000),
               Entry("2026-01-02", "b", -450),
               Entry("2026-01-03", "c", 200)]
    assert running_balance(entries) == [1000, 550, 750]
    assert running_balance([]) == []


def test_format_cents():
    from ledger.report import format_cents
    assert format_cents(1000) == "$10.00"
    assert format_cents(-450) == "-$4.50"
    assert format_cents(0) == "$0.00"


def test_format_report():
    from ledger.model import Entry
    from ledger.report import format_report
    entries = [Entry("2026-01-01", "pay", 1000),
               Entry("2026-01-02", "coffee", -450)]
    assert format_report(entries) == (
        "2026-01-01 pay $10.00\n"
        "2026-01-02 coffee -$4.50\n"
        "TOTAL $5.50"
    )
    assert format_report([]) == "TOTAL $0.00"


def test_cli_end_to_end(tmp_path, capsys):
    from ledger.cli import main
    f = tmp_path / "ledger.txt"
    f.write_text("2026-01-01|pay|10.00\n\n2026-01-02|coffee|-4.50\n")
    assert main([str(f)]) == 0
    out = capsys.readouterr().out
    assert "TOTAL $5.50" in out


def test_cli_error_path(tmp_path, capsys):
    from ledger.cli import main
    f = tmp_path / "bad.txt"
    f.write_text("not a ledger line\n")
    assert main([str(f)]) == 1
    err = capsys.readouterr().err
    assert err.startswith("error: ")
