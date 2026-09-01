"""Task 2: the --format option and the `render` row-rendering helper."""
import pytest

from probecli.cli import ROWS, build_parser, main, render


def test_render_plain():
    assert render(("ada", 3), "plain") == "ada 3"


def test_render_csv():
    assert render(("ada", 3), "csv") == "ada,3"


def test_parser_accepts_format_choices():
    action = next(
        a for a in build_parser()._actions if "--format" in a.option_strings
    )
    assert action.choices == ["plain", "csv"]


def test_format_defaults_to_plain():
    assert build_parser().parse_args([]).format == "plain"


def test_parser_accepts_explicit_format():
    assert build_parser().parse_args(["--format", "csv"]).format == "csv"
    assert build_parser().parse_args(["--format", "plain"]).format == "plain"


def test_parser_rejects_unknown_format():
    with pytest.raises(SystemExit):
        build_parser().parse_args(["--format", "tsv"])


def test_main_csv_prints_every_row_rendered_as_csv(capsys):
    assert main(["--format", "csv"]) == 0
    out = capsys.readouterr().out.strip().splitlines()
    assert out == ["ada,3", "bob,5", "eve,1"]
    assert out == [render(row, "csv") for row in ROWS]


def test_main_default_output_unchanged(capsys):
    assert main([]) == 0
    out = capsys.readouterr().out.strip().splitlines()
    assert out == ["ada 3", "bob 5", "eve 1"]


def test_main_explicit_plain_matches_default(capsys):
    assert main(["--format", "plain"]) == 0
    out = capsys.readouterr().out.strip().splitlines()
    assert out == ["ada 3", "bob 5", "eve 1"]
