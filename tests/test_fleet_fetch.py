import os
import stat
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/ultralearn/scripts"))
import fleet_fetch  # noqa: E402


def _stub(bin_dir, name, body):
    bin_dir.mkdir(parents=True, exist_ok=True)
    p = bin_dir / name
    p.write_text("#!/bin/sh\n" + body)
    p.chmod(p.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    return p


def _path_with(monkeypatch, bin_dir):
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")


LISTING = "fleet-run-24-100\nfleet-run-30-200\nfleet-run-31-300\n"


def test_list_remote_bundles_parses_the_listing(tmp_path, monkeypatch):
    _path_with(monkeypatch, tmp_path / "bin")
    _stub(tmp_path / "bin", "ssh", f"printf '{LISTING}'\n")
    assert fleet_fetch.list_remote_bundles("h") == [
        "fleet-run-24-100", "fleet-run-30-200", "fleet-run-31-300"]


def test_list_remote_bundles_ignores_non_bundle_lines(tmp_path, monkeypatch):
    _path_with(monkeypatch, tmp_path / "bin")
    _stub(tmp_path / "bin", "ssh", "printf 'README\\nfleet-run-30-200\\n'\n")
    assert fleet_fetch.list_remote_bundles("h") == ["fleet-run-30-200"]


def test_list_remote_bundles_on_ssh_failure_is_advisory(tmp_path, monkeypatch):
    _path_with(monkeypatch, tmp_path / "bin")
    _stub(tmp_path / "bin", "ssh", "exit 255\n")
    assert fleet_fetch.list_remote_bundles("h") == []


def test_fetch_bundles_writes_one_tarball_per_bundle(tmp_path, monkeypatch):
    _path_with(monkeypatch, tmp_path / "bin")
    _stub(tmp_path / "bin", "ssh", f"printf '{LISTING}'\n")
    # scp's last argument is the destination path; write a marker there.
    _stub(tmp_path / "bin", "scp", 'eval "dest=\\${$#}"; printf tarball > "$dest"\n')
    got = fleet_fetch.fetch_bundles("h", tmp_path / "dest")
    assert [p.parent.name for p in got] == [
        "fleet-run-24-100", "fleet-run-30-200", "fleet-run-31-300"]
    assert all(p.name == "sandbox-logs.tgz" and p.read_text() == "tarball" for p in got)


def test_fetch_bundles_filters_by_run_id(tmp_path, monkeypatch):
    _path_with(monkeypatch, tmp_path / "bin")
    _stub(tmp_path / "bin", "ssh", f"printf '{LISTING}'\n")
    _stub(tmp_path / "bin", "scp", 'eval "dest=\\${$#}"; printf tarball > "$dest"\n')
    got = fleet_fetch.fetch_bundles("h", tmp_path / "dest", run_ids=["run-30"])
    assert [p.parent.name for p in got] == ["fleet-run-30-200"]


def test_fetch_bundles_skips_a_failed_copy(tmp_path, monkeypatch):
    _path_with(monkeypatch, tmp_path / "bin")
    _stub(tmp_path / "bin", "ssh", f"printf '{LISTING}'\n")
    _stub(tmp_path / "bin", "scp", "exit 1\n")
    assert fleet_fetch.fetch_bundles("h", tmp_path / "dest") == []
