"""Tests for the --limit option: `clamp` plus its wiring into the parser and main."""
import pytest

from probecli.cli import ROWS, build_parser, clamp, main


def test_clamp_none_returns_all_rows_as_list():
    rows = list(ROWS)
    assert clamp(rows, None) == [("ada", 3), ("bob", 5), ("eve", 1)]


def test_clamp_none_returns_a_list_even_for_a_non_list_iterable():
    assert clamp(tuple(ROWS), None) == [("ada", 3), ("bob", 5), ("eve", 1)]


def test_clamp_takes_the_first_limit_rows():
    assert clamp(list(ROWS), 2) == [("ada", 3), ("bob", 5)]


def test_clamp_zero_returns_no_rows():
    assert clamp(list(ROWS), 0) == []


def test_clamp_limit_beyond_length_returns_every_row():
    assert clamp(list(ROWS), 10) == [("ada", 3), ("bob", 5), ("eve", 1)]


def test_clamp_negative_limit_raises_value_error():
    with pytest.raises(ValueError) as excinfo:
        clamp(list(ROWS), -1)
    assert str(excinfo.value) == "limit must be >= 0"


def test_parser_limit_defaults_to_none():
    args = build_parser().parse_args([])
    assert args.limit is None


def test_parser_limit_parses_as_int():
    args = build_parser().parse_args(["--limit", "2"])
    assert args.limit == 2


def test_main_with_limit_one_prints_only_the_first_row(capsys):
    assert main(["--limit", "1"]) == 0
    assert capsys.readouterr().out == "ada 3\n"


def test_main_without_limit_still_prints_every_row(capsys):
    assert main([]) == 0
    assert capsys.readouterr().out == "ada 3\nbob 5\neve 1\n"
