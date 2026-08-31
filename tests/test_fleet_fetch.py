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


# ---------- #464 item 2: no remote shell, and a tight bundle alphabet ----------

def test_fetch_uses_the_sftp_protocol_so_no_remote_shell_expands_the_path(
        tmp_path, monkeypatch):
    # `scp -s` forces SFTP, which does not expand the remote path through a
    # shell. Without it the remote spec is shell-interpreted on the far side.
    _path_with(monkeypatch, tmp_path / "bin")
    _stub(tmp_path / "bin", "ssh", f"printf '{LISTING}'\n")
    _stub(tmp_path / "bin", "scp",
          'printf "%s\\n" "$@" >> "$ARGLOG"; eval "dest=\\${$#}"; printf t > "$dest"\n')
    monkeypatch.setenv("ARGLOG", str(tmp_path / "argv.txt"))
    fleet_fetch.fetch_bundles("h", tmp_path / "dest", run_ids=["run-30"])
    assert "-s" in (tmp_path / "argv.txt").read_text().splitlines()


def test_bundle_names_with_shell_metacharacters_are_not_listed(tmp_path, monkeypatch):
    _path_with(monkeypatch, tmp_path / "bin")
    _stub(tmp_path / "bin", "ssh",
          "printf 'fleet-run-a;touch$IFS/tmp/x-1\\nfleet-run-`id`-2\\nfleet-run-30-200\\n'\n")
    assert fleet_fetch.list_remote_bundles("h") == ["fleet-run-30-200"]


def test_a_failed_copy_reports_the_skip_on_stderr(tmp_path, monkeypatch, capsys):
    # Deleting every _warn() must not leave the suite green.
    _path_with(monkeypatch, tmp_path / "bin")
    _stub(tmp_path / "bin", "ssh", f"printf '{LISTING}'\n")
    _stub(tmp_path / "bin", "scp", "exit 1\n")
    fleet_fetch.fetch_bundles("h", tmp_path / "dest")
    assert "skipping" in capsys.readouterr().err


def test_a_failed_listing_reports_the_skip_on_stderr(tmp_path, monkeypatch, capsys):
    _path_with(monkeypatch, tmp_path / "bin")
    _stub(tmp_path / "bin", "ssh", "exit 255\n")
    fleet_fetch.list_remote_bundles("h")
    assert "skipping" in capsys.readouterr().err


def test_default_remote_root_tracks_the_drivers_shipped_evidence_dir():
    """The fetcher's remote root and the driver's `evidenceDir` are the same
    directory named twice, in two languages, with nothing tying them together.
    #466 moved the driver's default off /tmp and would have left this one
    pointing at a path that no longer receives evidence — and the failure is
    SILENT: `ls` on a missing dir lists nothing, `list_remote_bundles` is
    advisory by design, and the sense pass reads zero bundles as 'no runs'."""
    import re
    drive_one = (Path(__file__).resolve().parents[1] / "fleet/drive-one.mjs").read_text()
    m = re.search(r"^\s*evidenceDir:\s*'([^']+)'", drive_one, re.M)
    assert m, "fleet/drive-one.mjs no longer declares an evidenceDir default"
    assert fleet_fetch.DEFAULT_REMOTE_ROOT == f"{m.group(1)}/sandbox-logs", (
        f"fetcher default {fleet_fetch.DEFAULT_REMOTE_ROOT!r} does not match the "
        f"driver's evidenceDir {m.group(1)!r}")
