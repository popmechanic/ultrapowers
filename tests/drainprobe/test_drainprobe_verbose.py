"""Tests for the drainprobe report CLI's --verbose flag."""
from probecli.cli import build_parser, main


def test_parser_accepts_verbose_flag():
    args = build_parser().parse_args(["--verbose"])
    assert args.verbose is True


def test_verbose_defaults_to_false():
    args = build_parser().parse_args([])
    assert args.verbose is False


def test_main_with_verbose_prints_row_count_header_then_rows(capsys):
    assert main(["--verbose"]) == 0
    out = capsys.readouterr().out.strip().splitlines()
    assert out == ["rows: 3", "ada 3", "bob 5", "eve 1"]


def test_main_without_verbose_output_unchanged(capsys):
    assert main([]) == 0
    out = capsys.readouterr().out.strip().splitlines()
    assert out == ["ada 3", "bob 5", "eve 1"]
