"""The golden is a script, and these are the claims the script makes.

`fleet/golden-setup.sh` builds the image, `fleet/golden-bootstrap.sh` is the few
hundred bytes that fetch it at a sha, and `fleet/golden.sh` builds, verifies and
swaps. Every exam here runs one of them and watches what it does — a stub
`FLEET_SSH` stands in for the whole exe.dev platform, a stub `curl` stands in
for GitHub. Nothing here pins a sentence of a document.

The gotchas being defended are the ones the RUNBOOK's §Golden VM build paid for
in dead images: a setup script that runs as `exedev` (so every privileged line
needs `sudo -n`), a bootstrap that must fit down a pipe, and a golden that must
carry no credentials.

Offline: no network, no ssh, no VM.
"""
import configparser
import json
import os
import pathlib
import shutil
import stat
import subprocess
import textwrap

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SETUP = ROOT / "fleet/golden-setup.sh"
BOOTSTRAP = ROOT / "fleet/golden-bootstrap.sh"
GOLDEN = ROOT / "fleet/golden.sh"
UNIT = ROOT / "fleet/fleet-boot.service"

# The contract's literal. The golden's settings.json is the only file the image
# carries that Claude Code reads, and this is exactly what it must hold.
SETTINGS = {
    "env": {"CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS": "0"},
    "permissions": {"defaultMode": "bypassPermissions"},
}

SHA = "a" * 40


def sh_lines(path):
    """Executable lines only — a comment is not something the shell runs."""
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if line and not line.startswith("#"):
            yield line


def run(argv, **kw):
    kw.setdefault("capture_output", True)
    kw.setdefault("text", True)
    return subprocess.run(argv, **kw)


# --- the scripts parse ------------------------------------------------------


def test_posix_scripts_pass_sh_n():
    for path in (SETUP, BOOTSTRAP):
        r = run(["sh", "-n", str(path)])
        assert r.returncode == 0, f"{path.name}: {r.stderr}"


def test_all_scripts_pass_bash_n():
    for path in (SETUP, BOOTSTRAP, GOLDEN):
        r = run(["bash", "-n", str(path)])
        assert r.returncode == 0, f"{path.name}: {r.stderr}"


def test_scripts_are_executable():
    for path in (SETUP, BOOTSTRAP, GOLDEN):
        assert path.stat().st_mode & stat.S_IXUSR, f"{path.name} is not executable"


# --- the golden carries no credentials --------------------------------------


def test_setup_script_names_no_anthropic_anything():
    # The OAuth token lives at exe.dev's edge and reaches only the engine's
    # child environment. An image that carries ANTHROPIC_* could leak the
    # subscription if a single clone were compromised.
    assert "ANTHROPIC" not in SETUP.read_text()


def test_settings_heredoc_is_the_contract_object():
    text = SETUP.read_text().splitlines()
    starts = [i for i, l in enumerate(text) if l.endswith("<<'JSON'")]
    assert len(starts) == 1, "expected exactly one settings.json heredoc"
    i = starts[0] + 1
    body = []
    while text[i].strip() != "JSON":
        body.append(text[i])
        i += 1
    assert json.loads("\n".join(body)) == SETTINGS


# --- the script runs as exedev, not root ------------------------------------


@pytest.mark.parametrize("needle", ["apt-get", "ln -sf"])
def test_privileged_lines_take_sudo_n(needle):
    # exe.dev runs a setup script as `exedev`. Without `sudo -n` the install
    # stops on "Could not open lock file" and the VM comes up with no node.
    hits = [l for l in sh_lines(SETUP) if needle in l]
    assert hits, f"no {needle!r} line at all — this check would pass vacuously"
    offenders = [l for l in hits if "sudo -n" not in l]
    assert offenders == [], offenders


def test_bun_is_proved_on_a_non_login_shell():
    # `bash -lc 'bun --version'` passes on exactly the broken image (#456), so
    # the proof has to be a non-login shell.
    lines = list(sh_lines(SETUP))
    assert any("bash -c 'bun --version'" in l for l in lines), lines
    assert [l for l in lines if "bash -lc" in l] == []


def test_the_stamp_is_the_scripts_own_bytes():
    lines = [l for l in sh_lines(SETUP) if "sha256sum" in l]
    assert any('sha256sum "$0"' in l for l in lines), lines


# --- the bootstrap ----------------------------------------------------------


def print_bootstrap(sha=SHA):
    r = run([str(GOLDEN), "print-bootstrap", "--sha", sha])
    assert r.returncode == 0, r.stderr
    return r.stdout


def test_generated_bootstrap_fits_down_the_pipe():
    # `new --setup-script=/dev/stdin` takes one script; over /exec the ceiling
    # is 64 KB and 30 s. Ten KiB is the budget the design set.
    assert len(print_bootstrap().encode()) < 10 * 1024


def test_generated_bootstrap_names_the_versioned_url():
    url = f"https://raw.githubusercontent.com/popmechanic/ultrapowers/{SHA}/fleet/golden-setup.sh"
    out = print_bootstrap()
    assert url in out
    assert f"SHA={SHA}" in out


def test_generated_bootstrap_exports_the_sha_for_the_setup_script():
    # The image must be built from the commit the script came from. Without
    # this the clone sits on the default branch and a golden built for an
    # unmerged branch dies on the first file that branch added.
    out = print_bootstrap()
    assert f"GOLDEN_SHA={SHA}" in out or "GOLDEN_SHA=$SHA" in out
    assert "export GOLDEN_SHA" in out


def test_setup_checks_the_clone_out_at_the_bootstrapped_sha():
    lines = list(sh_lines(SETUP))
    checkout = [l for l in lines if "checkout" in l]
    assert any('"$GOLDEN_SHA"' in l for l in checkout), checkout
    assert any("fetch -q origin" in l and '"$GOLDEN_SHA"' in l for l in lines), lines
    # The checkout has to precede everything read out of the repo.
    at = next(i for i, l in enumerate(lines) if "checkout" in l and "GOLDEN_SHA" in l)
    for needle in ("npm ci", "fleet-boot.service", '"$REPO_DIR/$BUN_FIXTURE"'):
        later = [i for i, l in enumerate(lines) if needle in l]
        assert later and min(later) > at, f"{needle} is read before the checkout"


def _curl_stub(bindir, payload="echo RAN-SETUP\n"):
    stub = bindir / "curl"
    stub.write_text(
        textwrap.dedent(
            """\
            #!/bin/sh
            out=""; prev=""
            for a in "$@"; do
              if [ "$prev" = "-o" ]; then out=$a; fi
              prev=$a
            done
            [ -n "$out" ] || exit 3
            printf '#!/bin/sh\\n%s' "$PAYLOAD" > "$out"
            """
        )
    )
    stub.chmod(0o755)
    return {"PAYLOAD": payload}


def test_the_template_refuses_to_run(tmp_path):
    bindir = tmp_path / "bin"
    bindir.mkdir()
    env = dict(os.environ, PATH=f"{bindir}:{os.environ['PATH']}", TMPDIR=str(tmp_path))
    env.update(_curl_stub(bindir))
    r = run(["sh", str(BOOTSTRAP)], env=env)
    assert r.returncode != 0
    assert "template" in r.stderr


def test_the_generated_bootstrap_fetches_and_runs_the_setup_script(tmp_path):
    bindir = tmp_path / "bin"
    bindir.mkdir()
    boot = tmp_path / "boot.sh"
    boot.write_text(print_bootstrap())
    env = dict(os.environ, PATH=f"{bindir}:{os.environ['PATH']}", TMPDIR=str(tmp_path))
    # The payload echoes the sha the bootstrap exported, so this proves the
    # setup script really receives GOLDEN_SHA and not just that the line exists.
    env.update(_curl_stub(bindir, payload='echo "RAN-SETUP $GOLDEN_SHA"\n'))
    r = run(["sh", str(boot)], env=env)
    assert r.returncode == 0, r.stderr
    assert f"RAN-SETUP {SHA}" in r.stdout
    assert (tmp_path / "golden-setup.sh").exists()


# --- the boot unit ----------------------------------------------------------


def test_boot_unit_starts_the_sandbox_boot_script_at_boot():
    cfg = configparser.ConfigParser()
    cfg.optionxform = str
    cfg.read_string(UNIT.read_text())
    assert cfg["Service"]["ExecStart"] == "/home/exedev/repo/fleet/sandbox-boot.sh"
    assert cfg["Install"]["WantedBy"] == "default.target"
    assert cfg["Service"]["Restart"] == "on-failure"
    assert cfg["Service"]["RestartSec"] == "10"
    assert cfg["Service"]["Type"] == "simple"
    # The script backgrounds `busybox httpd` for the status page; the default
    # kill mode reaps it with the script and the janitor never sees `done`.
    assert cfg["Service"]["KillMode"] == "process"


def test_verify_does_not_require_a_lockfile():
    # fleet/package-lock.json is gitignored, so `npm ci` -> `npm install` is the
    # live path in the image. Nothing in verify may ask for a lockfile.
    assert "package-lock" not in GOLDEN.read_text()


def test_setup_installs_and_enables_the_boot_unit():
    text = SETUP.read_text()
    assert "fleet/fleet-boot.service" in text  # the checked-in unit, not a copy
    assert "systemctl --user enable fleet-boot.service" in text
    assert "loginctl enable-linger" in text
    # `systemctl --user` cannot find the bus without this, and a first-boot
    # setup script has no XDG_RUNTIME_DIR of its own.
    assert "XDG_RUNTIME_DIR=/run/user/$(id -u)" in text


def test_setup_installs_the_six_hour_deadman():
    text = SETUP.read_text()
    assert "OnActiveSec=6h" in text
    assert "/home/exedev/repo/fleet/sandbox-boot.sh deadman" in text
    assert "systemctl --user enable fleet-deadman.timer" in text


# --- golden.sh verify, against a stubbed platform ---------------------------


def head_sha():
    return run(["git", "-C", str(ROOT), "rev-parse", "HEAD"]).stdout.strip()


def sha256_of_setup():
    tool = shutil.which("sha256sum")
    argv = [tool, str(SETUP)] if tool else ["shasum", "-a", "256", str(SETUP)]
    return run(argv).stdout.split()[0]


STUB = """\
#!/bin/sh
printf '%s\\n' "$*" >> "$STUB_LOG"
host=$1
cmd=$2
case "$cmd" in
  'cat /home/exedev/.fleet-golden') echo "$STUB_STAMP" ;;
  *'rev-parse HEAD'*) echo "$STUB_HEAD" ;;
  'node --version') echo v24.4.0 ;;
  'npm --version') echo 11.0.0 ;;
  *'bun --version'*) echo 1.4.0 ;;
  *'import xdist'*) echo 3.6.1 ;;
  *'stat -c %a'*) echo "$STUB_MODE" ;;
  *'is-enabled fleet-boot.service'*) echo "$STUB_ENABLED" ;;
  *'grep -c ANTHROPIC'*) echo "$STUB_ANTHROPIC" ;;
  'rm '*) echo '{"removed":true}' ;;
  'rename '*) echo '{"renamed":true}' ;;
  *'ls --json'*) echo "$STUB_LS" ;;
  *) echo "stub: unhandled [$host] [$cmd]" >&2; exit 9 ;;
esac
"""


@pytest.fixture
def stub(tmp_path):
    path = tmp_path / "ssh-stub"
    path.write_text(STUB)
    path.chmod(0o755)
    log = tmp_path / "log"
    log.write_text("")

    def call(argv, **over):
        env = dict(
            os.environ,
            FLEET_SSH=str(path),
            STUB_LOG=str(log),
            STUB_STAMP=sha256_of_setup(),
            STUB_HEAD=head_sha(),
            STUB_MODE="600",
            STUB_ENABLED="enabled",
            STUB_ANTHROPIC="0",
            STUB_LS='["fleet-golden","fleet-run-1"]',
        )
        env.update(over)
        return run([str(GOLDEN)] + argv, env=env)

    call.log = log
    return call


def test_verify_passes_when_the_stamp_matches_the_checked_in_script(stub):
    r = stub(["verify", "fleet-golden-next"])
    assert r.returncode == 0, r.stdout + r.stderr
    rows = ("stamp:", "engine clone:", "node:", "npm:", "bun:", "xdist:",
            "settings.json: 600")
    for row in rows:
        assert row in r.stdout, r.stdout


def test_verify_fails_and_names_both_stamps_when_the_image_drifted(stub):
    wrong = "b" * 64
    r = stub(["verify", "fleet-golden-next"], STUB_STAMP=wrong)
    assert r.returncode != 0
    assert wrong in r.stderr
    assert sha256_of_setup() in r.stderr


@pytest.mark.parametrize(
    "override, expected",
    [
        ({"STUB_HEAD": "c" * 40}, "engine clone"),
        ({"STUB_MODE": "644"}, "644"),
        ({"STUB_ENABLED": "disabled"}, "disabled"),
        ({"STUB_ANTHROPIC": "1"}, "ANTHROPIC"),
    ],
)
def test_verify_fails_on_each_posture_check(stub, override, expected):
    r = stub(["verify", "fleet-golden-next"], **override)
    assert r.returncode != 0
    assert expected in r.stderr


def test_verify_refuses_a_name_that_is_not_a_name(stub):
    r = stub(["verify", "fleet-golden; rm -rf /"])
    assert r.returncode != 0
    assert "VM name" in r.stderr


# --- golden.sh swap ---------------------------------------------------------


def test_swap_removes_the_old_golden_then_renames_the_new_one(stub):
    r = stub(
        ["swap", "--from", "fleet-golden-next", "--to", "fleet-golden"],
        STUB_LS='["fleet-golden"]',
    )
    assert r.returncode == 0, r.stdout + r.stderr
    issued = [l for l in stub.log.read_text().splitlines() if l.startswith("exe.dev ")]
    assert issued[0] == "exe.dev rm fleet-golden --json"
    assert issued[1] == "exe.dev rename fleet-golden-next fleet-golden"
    assert issued[2] == "exe.dev ls --json"


def test_swap_fails_when_the_rename_did_not_take(stub):
    r = stub(
        ["swap", "--from", "fleet-golden-next", "--to", "fleet-golden"],
        STUB_LS='["fleet-golden-next"]',
    )
    assert r.returncode != 0
    assert "ls --json" in r.stderr
