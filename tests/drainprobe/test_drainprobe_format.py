"""Tests for the `--format` option and the `render` row helper."""
import pytest

from probecli.cli import ROWS, build_parser, main, render


def test_render_plain():
    assert render(("ada", 3), "plain") == "ada 3"


def test_render_csv():
    assert render(("ada", 3), "csv") == "ada,3"


def test_render_every_row_plain():
    assert [render(row, "plain") for row in ROWS] == ["ada 3", "bob 5", "eve 1"]


def test_render_every_row_csv():
    assert [render(row, "csv") for row in ROWS] == ["ada,3", "bob,5", "eve,1"]


def test_parser_format_default_is_plain():
    args = build_parser().parse_args([])
    assert args.format == "plain"


@pytest.mark.parametrize("fmt", ["plain", "csv"])
def test_parser_accepts_format_choices(fmt):
    args = build_parser().parse_args(["--format", fmt])
    assert args.format == fmt


def test_parser_rejects_unknown_format():
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
