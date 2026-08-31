"""Task 2: the --format option and the render() row helper."""
import pytest

from probecli.cli import ROWS, build_parser, main, render


def test_render_plain():
    assert render(("ada", 3), "plain") == "ada 3"


def test_render_csv():
    assert render(("ada", 3), "csv") == "ada,3"


def test_render_every_row():
    assert [render(row, "plain") for row in ROWS] == ["ada 3", "bob 5", "eve 1"]
    assert [render(row, "csv") for row in ROWS] == ["ada,3", "bob,5", "eve,1"]


def test_parser_format_default_is_plain():
    args = build_parser().parse_args([])
    assert args.format == "plain"


def test_parser_format_accepts_choices():
    assert build_parser().parse_args(["--format", "plain"]).format == "plain"
    assert build_parser().parse_args(["--format", "csv"]).format == "csv"


def test_parser_format_rejects_unknown_choice():
    with pytest.raises(SystemExit):
        build_parser().parse_args(["--format", "json"])


def test_main_csv_prints_every_row_rendered_as_csv(capsys):
    assert main(["--format", "csv"]) == 0
    out = capsys.readouterr().out.strip().splitlines()
    assert out == ["ada,3", "bob,5", "eve,1"]


def test_main_default_output_unchanged(capsys):
    assert main([]) == 0
    out = capsys.readouterr().out.strip().splitlines()
    assert out == ["ada 3", "bob 5", "eve 1"]


def test_main_explicit_plain_matches_default(capsys):
    assert main(["--format", "plain"]) == 0
    out = capsys.readouterr().out.strip().splitlines()
    assert out == ["ada 3", "bob 5", "eve 1"]
