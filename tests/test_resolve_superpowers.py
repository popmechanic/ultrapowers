import json, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
import resolve_superpowers as rs  # noqa: E402


def _write(p, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj))


def _setup(tmp_path, enabled, installed, project_enabled=None):
    home = tmp_path / "home"
    _write(home / "settings.json", {"enabledPlugins": enabled})
    _write(home / "plugins/installed_plugins.json", {"version": 1, "plugins": installed})
    project = tmp_path / "proj"
    if project_enabled is not None:
        _write(project / ".claude/settings.json", {"enabledPlugins": project_enabled})
    (project / ".claude").mkdir(parents=True, exist_ok=True)
    return home, project


def _install(path, version, sha):
    return [{"installPath": path, "version": version, "gitCommitSha": sha}]


def test_picks_enabled_excludes_disabled(tmp_path):
    home, project = _setup(
        tmp_path,
        enabled={"superpowers@claude-plugins-official": False},
        installed={
            "superpowers@claude-plugins-official": _install("/c/6.0.3", "6.0.3", "aaa"),
            "superpowers@superpowers-marketplace": _install("/m/6.0.0", "6.0.0", "bbb"),
        },
    )
    res = rs.resolve_active(home, project)
    assert res["ambiguous"] is False
    assert [a["version"] for a in res["active"]] == ["6.0.0"]
    assert res["active"][0]["marketplace"] == "superpowers-marketplace"


def test_absent_entry_is_enabled_by_default(tmp_path):
    home, project = _setup(
        tmp_path, enabled={},
        installed={"superpowers@m": _install("/m/6.0.0", "6.0.0", "bbb")},
    )
    res = rs.resolve_active(home, project)
    assert [a["version"] for a in res["active"]] == ["6.0.0"]


def test_project_settings_override_user(tmp_path):
    # user enables official; project disables it -> excluded.
    home, project = _setup(
        tmp_path,
        enabled={"superpowers@official": True},
        installed={"superpowers@official": _install("/c/6.0.3", "6.0.3", "aaa")},
        project_enabled={"superpowers@official": False},
    )
    res = rs.resolve_active(home, project)
    assert res["active"] == []


def test_multiple_enabled_flags_ambiguous(tmp_path):
    home, project = _setup(
        tmp_path, enabled={},
        installed={
            "superpowers@a": _install("/a/6.0.0", "6.0.0", "x"),
            "superpowers@b": _install("/b/6.0.3", "6.0.3", "y"),
        },
    )
    res = rs.resolve_active(home, project)
    assert res["ambiguous"] is True
    assert len(res["active"]) == 2


def test_none_installed(tmp_path):
    home, project = _setup(tmp_path, enabled={}, installed={"frontend-design@x": _install("/f", "1", "z")})
    res = rs.resolve_active(home, project)
    assert res == {"active": [], "ambiguous": False}
