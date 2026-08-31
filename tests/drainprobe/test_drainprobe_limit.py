"""Tests for the --limit option: row clamping in the drainprobe report CLI."""
import pytest

from probecli.cli import ROWS, build_parser, clamp, main


def test_clamp_none_returns_all_rows_as_list():
    rows = (("ada", 3), ("bob", 5), ("eve", 1))
    assert clamp(rows, None) == [("ada", 3), ("bob", 5), ("eve", 1)]


def test_clamp_none_returns_a_list_not_the_original_container():
    rows = [("ada", 3), ("bob", 5)]
    clamped = clamp(rows, None)
    assert isinstance(clamped, list)
    assert clamped is not rows


def test_clamp_takes_the_first_limit_rows():
    rows = [("ada", 3), ("bob", 5), ("eve", 1)]
    assert clamp(rows, 2) == [("ada", 3), ("bob", 5)]


def test_clamp_zero_returns_no_rows():
    assert clamp([("ada", 3), ("bob", 5)], 0) == []


def test_clamp_limit_above_length_returns_all_rows():
    rows = [("ada", 3), ("bob", 5)]
    assert clamp(rows, 9) == [("ada", 3), ("bob", 5)]


def test_clamp_negative_limit_raises_value_error():
    with pytest.raises(ValueError) as excinfo:
        clamp([("ada", 3)], -1)
    assert str(excinfo.value) == "limit must be >= 0"


def test_parser_limit_defaults_to_none():
    args = build_parser().parse_args([])
    assert args.limit is None


def test_parser_parses_limit_as_int():
    args = build_parser().parse_args(["--limit", "2"])
    assert args.limit == 2


def test_main_with_limit_one_prints_only_the_first_row(capsys):
    assert main(["--limit", "1"]) == 0
    assert capsys.readouterr().out == "ada 3\n"


def test_main_with_limit_two_prints_the_first_two_rows(capsys):
    assert main(["--limit", "2"]) == 0
    assert capsys.readouterr().out == "ada 3\nbob 5\n"


def test_main_without_limit_prints_every_row(capsys):
    assert main([]) == 0
    assert capsys.readouterr().out == "ada 3\nbob 5\neve 1\n"


def test_main_does_not_mutate_the_module_level_rows(capsys):
    main(["--limit", "1"])
    capsys.readouterr()
    assert ROWS == [("ada", 3), ("bob", 5), ("eve", 1)]
