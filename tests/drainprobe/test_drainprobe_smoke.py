"""Pre-existing smoke test: the base CLI parses no args and prints all rows."""
from probecli.cli import build_parser, main


def test_parser_builds_and_accepts_no_args():
    args = build_parser().parse_args([])
    assert args is not None


def test_main_prints_every_row(capsys):
    assert main([]) == 0
    out = capsys.readouterr().out.strip().splitlines()
    assert out == ["ada 3", "bob 5", "eve 1"]
