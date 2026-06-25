import json, pathlib, sys
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
import superpowers_contract as sc  # noqa: E402
import check_superpowers_compat as ck  # noqa: E402


def _full_tree(root):
    by_file = defaultdict(list)
    for e in sc.MANIFEST:
        by_file[e["rel"]].append(e)
    for rel, entries in by_file.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        toks = [e.get("any_of", [e.get("token")])[0] for e in entries if not e.get("exists_only")]
        p.write_text("\n".join(toks) + "\n")


def _home_with(tmp_path, install_path, version):
    home = tmp_path / "home"
    (home / "plugins").mkdir(parents=True, exist_ok=True)
    (home / "settings.json").write_text(json.dumps({"enabledPlugins": {}}))
    (home / "plugins/installed_plugins.json").write_text(json.dumps(
        {"plugins": {"superpowers@m": [{"installPath": str(install_path),
                                        "version": version, "gitCommitSha": "x"}]}}))
    return home


def test_exit_zero_when_all_tokens_present(tmp_path, capsys):
    sp = tmp_path / "sp"; _full_tree(sp)
    home = _home_with(tmp_path, sp, sc.TESTED_AGAINST)
    assert ck.main(home, tmp_path) == 0


def test_advisory_on_version_delta_still_exit_zero(tmp_path, capsys):
    sp = tmp_path / "sp"; _full_tree(sp)
    home = _home_with(tmp_path, sp, "6.0.99")  # != TESTED_AGAINST
    rc = ck.main(home, tmp_path)
    assert rc == 0
    assert "advisory" in capsys.readouterr().out.lower()


def test_nonzero_and_names_missing_token(tmp_path, capsys):
    sp = tmp_path / "sp"; _full_tree(sp)
    # break one token: blank the writing-plans file
    (sp / "skills/writing-plans/SKILL.md").write_text("nothing useful\n")
    home = _home_with(tmp_path, sp, sc.TESTED_AGAINST)
    rc = ck.main(home, tmp_path)
    assert rc != 0
    assert "### Task N:" in capsys.readouterr().out


def test_skip_when_no_superpowers(tmp_path, capsys):
    home = tmp_path / "home"
    (home / "plugins").mkdir(parents=True, exist_ok=True)
    (home / "settings.json").write_text(json.dumps({"enabledPlugins": {}}))
    (home / "plugins/installed_plugins.json").write_text(json.dumps({"plugins": {}}))
    rc = ck.main(home, tmp_path)
    assert rc == 0
    assert "skip" in capsys.readouterr().out.lower()
