"""Pin: every documented over-ssh launch of a fleet driver detaches.

#524 item 1. Measured live on the orchestrator (real OpenSSH `sshd-session`,
remote shell `/bin/bash`, 2026-09-01 21:50 UTC), a 45 s child under each launch
shape, wall of the `ssh -n` client:

    A  nohup node -e … </dev/null >f 2>&1 &            47 s
    E  nohup node -e … </dev/null >f 2>&1 & disown     47 s
    G  nohup node -e … </dev/null >f 2>&1 & exit 0     47 s
    D  setsid -f node -e … </dev/null >f 2>&1           2 s
    F  (nohup node -e … </dev/null >f 2>&1 &)           2 s

So the redirects alone do not release the channel; a new session does.
`setsid -f` is the canonical form — one token, greppable, `/bin/setsid` present
on the golden — and the redirects stay, since a detached job that still holds
the channel's fds blocks the client just the same.
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
RUNBOOK = ROOT / "fleet" / "RUNBOOK.md"
SKILL = ROOT / "skills" / "ultrapowers" / "SKILL.md"

DRIVER = re.compile(r"node fleet/(?:drive-one|race)\.mjs")
DETACHED = re.compile(r"setsid -f node fleet/(?:drive-one|race)\.mjs")
STDOUT_REDIRECT = re.compile(r">\s*\S*/\S+")


def launch_lines(path):
    """Every line of `path` that starts a fleet driver inside an ssh command."""
    return [
        line
        for line in path.read_text().splitlines()
        if DRIVER.search(line) and "ssh " in line
    ]


def test_the_files_are_readable():
    assert RUNBOOK.is_file()
    assert SKILL.is_file()


def test_every_launch_line_puts_setsid_f_immediately_before_node():
    for path in (RUNBOOK, SKILL):
        lines = launch_lines(path)
        for line in lines:
            for match in DRIVER.finditer(line):
                prefix = line[: match.start()]
                assert prefix.endswith("setsid -f "), (
                    f"{path.name}: launch not detached with `setsid -f`: {line}"
                )
            assert DETACHED.search(line), f"{path.name}: {line}"


def test_every_launch_line_keeps_all_three_fd_redirects():
    for path in (RUNBOOK, SKILL):
        for line in launch_lines(path):
            assert "</dev/null" in line, f"{path.name}: no stdin redirect: {line}"
            assert STDOUT_REDIRECT.search(line), (
                f"{path.name}: no stdout redirect to a file path: {line}"
            )
            assert "2>&1" in line, f"{path.name}: no stderr redirect: {line}"


def test_no_bare_nohup_job_launches_a_driver():
    for path in (RUNBOOK, SKILL):
        text = path.read_text()
        assert "nohup node fleet/drive-one.mjs" not in text, path.name
        assert "nohup node fleet/race.mjs" not in text, path.name


def test_the_launch_lines_are_all_still_there():
    # A deletion must not be able to green this file.
    assert len(launch_lines(RUNBOOK)) >= 3
    assert len(launch_lines(SKILL)) >= 1


def test_the_runbook_documents_a_race_launch():
    assert any(
        "node fleet/race.mjs launch" in line for line in launch_lines(RUNBOOK)
    )
