"""Held-out acceptance tests for the contend-wide fixture. Never shown to executors."""
import pytest


def test_default_output_is_unchanged_plain(capsys):
    from clitool.cli import main
    assert main([]) == 0
    out = capsys.readouterr().out.strip().splitlines()
    assert out == ["ada 3", "bob 5", "eve 1"]


def test_verbose_header_counts_printed_rows(capsys):
    from clitool.cli import header, main
    assert header(3) == "rows: 3"
    assert main(["--verbose"]) == 0
    out = capsys.readouterr().out.strip().splitlines()
    assert out[0] == "rows: 3"
    assert out[1:] == ["ada 3", "bob 5", "eve 1"]


def test_render_csv_and_plain():
    from clitool.cli import render
    assert render(("ada", 3), "plain") == "ada 3"
    assert render(("ada", 3), "csv") == "ada,3"


def test_csv_format_end_to_end(capsys):
    from clitool.cli import main
    assert main(["--format", "csv"]) == 0
    out = capsys.readouterr().out.strip().splitlines()
    assert out == ["ada,3", "bob,5", "eve,1"]


def test_limit_clamps_and_validates(capsys):
    from clitool.cli import clamp, main
    assert clamp([1, 2, 3], None) == [1, 2, 3]
    assert clamp([1, 2, 3], 2) == [1, 2]
    assert clamp([1, 2, 3], 0) == []
    with pytest.raises(ValueError):
        clamp([1], -1)
    assert main(["--limit", "1"]) == 0
    assert capsys.readouterr().out.strip().splitlines() == ["ada 3"]


def test_sort_orders_by_name(capsys):
    from clitool.cli import main, sort_rows
    rows = [("eve", 1), ("ada", 3)]
    assert sort_rows(rows) == [("ada", 3), ("eve", 1)]
    assert rows == [("eve", 1), ("ada", 3)]
    assert main(["--sort"]) == 0
    out = capsys.readouterr().out.strip().splitlines()
    assert out == ["ada 3", "bob 5", "eve 1"]


def test_reverse_flips_row_order(capsys):
    from clitool.cli import main, reverse_rows
    rows = [("ada", 3), ("bob", 5)]
    assert reverse_rows(rows) == [("bob", 5), ("ada", 3)]
    assert rows == [("ada", 3), ("bob", 5)]
    assert main(["--reverse"]) == 0
    out = capsys.readouterr().out.strip().splitlines()
    assert out == ["eve 1", "bob 5", "ada 3"]


def test_total_footer_sums_counts(capsys):
    from clitool.cli import main, total
    assert total([("ada", 3), ("bob", 5)]) == 8
    assert total([]) == 0
    assert main(["--total"]) == 0
    out = capsys.readouterr().out.strip().splitlines()
    assert out == ["ada 3", "bob 5", "eve 1", "total: 9"]


def test_header_line_precedes_rows(capsys):
    from clitool.cli import column_header, main
    assert column_header() == "name count"
    assert main(["--header"]) == 0
    out = capsys.readouterr().out.strip().splitlines()
    assert out == ["name count", "ada 3", "bob 5", "eve 1"]


def test_json_prints_single_array_line(capsys):
    from clitool.cli import main, to_json
    assert to_json([("ada", 3)]) == '[{"name": "ada", "count": 3}]'
    assert main(["--json"]) == 0
    out = capsys.readouterr().out.strip().splitlines()
    assert out == ['[{"name": "ada", "count": 3}, '
                   '{"name": "bob", "count": 5}, '
                   '{"name": "eve", "count": 1}]']
