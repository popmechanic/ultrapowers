"""Held-out acceptance tests for the contend fixture. Never shown to executors."""
import pytest


def test_verbose_header_counts_printed_rows(capsys):
    from clitool.cli import main
    assert main(["--verbose"]) == 0
    out = capsys.readouterr().out.strip().splitlines()
    assert out[0] == "rows: 3"
    assert out[1:] == ["ada 3", "bob 5", "eve 1"]


def test_default_output_is_unchanged_plain(capsys):
    from clitool.cli import main
    assert main([]) == 0
    out = capsys.readouterr().out.strip().splitlines()
    assert out == ["ada 3", "bob 5", "eve 1"]


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


def test_features_compose(capsys):
    from clitool.cli import main
    assert main(["--verbose", "--format", "csv", "--limit", "2"]) == 0
    out = capsys.readouterr().out.strip().splitlines()
    assert out == ["rows: 2", "ada,3", "bob,5"]


def test_pad_widths_and_validation():
    from clitool.textutil import pad
    assert pad("ab", 5) == "ab   "
    assert pad("abcdef", 3) == "abcdef"
    assert pad("", 2) == "  "
    with pytest.raises(ValueError):
        pad("x", -1)
