"""Task 1: the `--verbose` flag adds a `rows: <n>` header before the row lines."""
from probecli.cli import build_parser, main


def test_parser_defaults_verbose_to_false():
    args = build_parser().parse_args([])
    assert args.verbose is False


def test_parser_accepts_verbose_flag():
    args = build_parser().parse_args(["--verbose"])
    assert args.verbose is True


def test_verbose_action_is_store_true():
    action = {a.dest: a for a in build_parser()._actions}["verbose"]
    assert action.option_strings == ["--verbose"]
    assert action.const is True
    assert action.nargs == 0
    assert action.default is False


def test_main_with_verbose_prints_header_then_rows(capsys):
    assert main(["--verbose"]) == 0
    out = capsys.readouterr().out
    assert out == "rows: 3\nada 3\nbob 5\neve 1\n"


def test_main_without_verbose_output_unchanged(capsys):
    assert main([]) == 0
    out = capsys.readouterr().out
    assert out == "ada 3\nbob 5\neve 1\n"
