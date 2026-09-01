"""Tests for the --limit option and the clamp() helper."""
import pytest

from probecli.cli import ROWS, build_parser, clamp, main


def test_clamp_none_returns_all_rows_as_list():
    rows = (("ada", 3), ("bob", 5), ("eve", 1))
    assert clamp(rows, None) == [("ada", 3), ("bob", 5), ("eve", 1)]


def test_clamp_returns_first_limit_rows():
    assert clamp(ROWS, 2) == [("ada", 3), ("bob", 5)]


def test_clamp_zero_returns_empty_list():
    assert clamp(ROWS, 0) == []


def test_clamp_limit_beyond_length_returns_all_rows():
    assert clamp(ROWS, 10) == [("ada", 3), ("bob", 5), ("eve", 1)]


def test_clamp_negative_limit_raises_value_error():
    with pytest.raises(ValueError) as excinfo:
        clamp(ROWS, -1)
    assert str(excinfo.value) == "limit must be >= 0"


def test_parser_limit_defaults_to_none():
    args = build_parser().parse_args([])
    assert args.limit is None


def test_parser_limit_parses_as_int():
    args = build_parser().parse_args(["--limit", "2"])
    assert args.limit == 2


def test_main_limit_one_prints_only_first_row(capsys):
    assert main(["--limit", "1"]) == 0
    assert capsys.readouterr().out == "ada 3\n"


def test_main_without_limit_prints_every_row(capsys):
    assert main([]) == 0
    assert capsys.readouterr().out == "ada 3\nbob 5\neve 1\n"
