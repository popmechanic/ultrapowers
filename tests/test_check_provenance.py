"""`check_provenance.py`: Claim quotes and Authorized-by anchors resolve.

The compiler is a pure function — it checks the provenance tag's *form* and
stops (spec 2026-08-31 §4.4). Resolution (does `#NNN` exist, and does the
operator sentence still read verbatim in it) needs the network, so it lives in
this pre-compile script. Every test here drives it through the `--gh` seam
against a `tmp_path` stand-in, so the suite never touches the network and never
runs the real `gh`.
"""
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills/ultrawrite/scripts/check_provenance.py"

# The canned body of issue #489, as `gh issue view 489 --json body -q .body`
# would print it. The operator sentence Task 1 quotes is the middle paragraph.
ISSUE_489 = (
    "### What we want\n"
    "\n"
    "An operator asks for a widget of a given size and gets one back, or a clear\n"
    "error when the size is not a positive whole number.\n"
    "\n"
    "Filed after the 2026-08 corpus review.\n"
)
QUOTED = ("An operator asks for a widget of a given size and gets one back, or a clear\n"
          "error when the size is not a positive whole number.")

HEADER = (
    "# Plan: Widget Kit\n"
    "\n"
    "**Grammar:** claims-v1\n"
    "\n"
    "**Acceptance:** waived — inline test plan\n"
    "\n"
    "---\n"
    "\n"
)


def _task(tid, claim, authorized_by):
    """One well-formed claims-v1 task; only the Claim and Authorized-by slots
    vary, since those two are all this script reads."""
    return (
        "### Task %s: The widget constructor\n"
        "\n"
        "**Type:** implementation\n"
        "\n"
        "**Files:**\n"
        "- Create: `widgetkit/widget%s.py`\n"
        "\n"
        "**Claim:** %s\n"
        "Machine: `make_widget(3)` returns a `Widget` whose `size` is `3`.\n"
        "\n"
        "**Authorized-by:** %s\n"
        "\n"
        "**Interfaces:**\n"
        "- Produces: `make_widget(n: int) -> Widget`\n"
        "\n"
        "**Context:** `widgetkit/` is a flat package with no registry to update.\n"
        "\n"
        "**Proof:**\n"
        "- Test: `tests/test_widget.py`\n"
        "\n"
        "**Stale-if:**\n"
        "- issue-closed: #489\n"
    ) % (tid, tid, claim, authorized_by)


def _plan(tmp_path, *tasks):
    path = tmp_path / "plan.md"
    path.write_text(HEADER + "\n".join(tasks), encoding="utf-8")
    return path


def _fake_gh(tmp_path, bodies=None):
    """A `gh` stand-in under `tmp_path`: prints a canned body for a known issue
    number, exits 3 for any other, and appends every invocation to a log."""
    bodies = {"489": ISSUE_489} if bodies is None else bodies
    log = tmp_path / "gh.log"
    cases = []
    for number, body in bodies.items():
        canned = tmp_path / ("issue-%s.txt" % number)
        canned.write_text(body, encoding="utf-8")
        cases.append('  %s) cat %s ;;' % (number, canned))
    script = tmp_path / "fake-gh"
    script.write_text(
        "#!/bin/sh\n"
        'printf "%%s\\n" "$*" >> %s\n'
        'case "$3" in\n%s\n  *) exit 3 ;;\nesac\n' % (log, "\n".join(cases)),
        encoding="utf-8")
    script.chmod(0o755)
    return script, log


def _run(plan, gh, env=None):
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(plan), "--gh", str(gh)],
        capture_output=True, text=True, env=env)


def _invocations(log):
    return log.read_text(encoding="utf-8").splitlines() if log.exists() else []


def test_verbatim_quote_resolves(tmp_path):
    plan = _plan(tmp_path, _task("1", QUOTED + " (quoted from #489)", "#489"))
    gh, log = _fake_gh(tmp_path)
    proc = _run(plan, gh)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert proc.stdout == "provenance: ok — 1 claim quote and 1 anchor resolve\n"
    # The quote and the anchor name the same issue: one fetch, of the exact shape
    # `gh issue view <n> --json body -q .body`.
    assert _invocations(log) == ["issue view 489 --json body -q .body"]


def test_rewrapped_quote_is_still_verbatim(tmp_path):
    # Markdown hard-wrapping is not paraphrase: the same words, rewrapped by the
    # authoring agent, still string-match the issue body.
    rewrapped = ("An operator asks for a widget of a given size and gets one\n"
                 "back, or a clear error when the size is not a positive whole number.")
    plan = _plan(tmp_path, _task("1", rewrapped + " (quoted from #489)", "#489"))
    gh, _ = _fake_gh(tmp_path)
    proc = _run(plan, gh)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_paraphrased_quote_refuses(tmp_path):
    paraphrase = ("An operator requests a widget of some size and receives one, or an\n"
                  "error if the size is not a positive integer.")
    plan = _plan(tmp_path, _task("3", paraphrase + " (quoted from #489)", "#489"))
    gh, _ = _fake_gh(tmp_path)
    proc = _run(plan, gh)
    assert proc.returncode == 2, proc.stdout + proc.stderr
    assert proc.stdout == "provenance: task 3 claim is not verbatim in #489\n"


def test_quoted_issue_that_does_not_exist_refuses(tmp_path):
    plan = _plan(tmp_path, _task("2", QUOTED + " (quoted from #777)", "#489"))
    gh, _ = _fake_gh(tmp_path)
    proc = _run(plan, gh)
    assert proc.returncode == 2, proc.stdout + proc.stderr
    assert proc.stdout == (
        "provenance: task 2 claim quotes #777, which does not resolve\n")


def test_unknown_authorized_by_anchor_refuses(tmp_path):
    plan = _plan(tmp_path, _task("1", QUOTED + " (quoted from #489)", "#489; #501"))
    gh, _ = _fake_gh(tmp_path)
    proc = _run(plan, gh)
    assert proc.returncode == 2, proc.stdout + proc.stderr
    assert proc.stdout == (
        "provenance: task 1 Authorized-by anchor #501 does not resolve\n")


def test_one_line_per_failure(tmp_path):
    plan = _plan(
        tmp_path,
        _task("1", "A widget is made from a size. (quoted from #489)", "#489"),
        _task("3", QUOTED + " (quoted from #489)", "#501"))
    gh, _ = _fake_gh(tmp_path)
    proc = _run(plan, gh)
    assert proc.returncode == 2, proc.stdout + proc.stderr
    assert proc.stdout.splitlines() == [
        "provenance: task 1 claim is not verbatim in #489",
        "provenance: task 3 Authorized-by anchor #501 does not resolve",
    ]


def test_elicited_claims_are_skipped(tmp_path):
    plan = _plan(
        tmp_path,
        _task("1", "An operator lists the sizes they want. (elicited)",
              "spec `docs/superpowers/specs/2026-08-31-owned-authoring-skill.md` §3"))
    gh, log = _fake_gh(tmp_path)
    proc = _run(plan, gh)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert proc.stdout == "provenance: ok — 0 claim quotes and 0 anchors resolve\n"
    assert _invocations(log) == []


def test_legacy_plan_has_nothing_to_resolve(tmp_path):
    path = tmp_path / "plan.md"
    path.write_text(
        "# Plan: Legacy\n\n**Acceptance:** waived — inline test plan\n\n"
        "### Task 1: Do the thing\n\n**Type:** implementation\n\n"
        "**Depends-on:** none\n", encoding="utf-8")
    gh, log = _fake_gh(tmp_path)
    proc = _run(path, gh)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert _invocations(log) == []


def test_never_runs_the_real_gh(tmp_path):
    # A sabotage `gh` first on PATH: if the script ever resolved the binary by
    # name instead of honouring --gh, this body would make the paraphrase pass.
    sabotage = tmp_path / "bin"
    sabotage.mkdir()
    real = sabotage / "gh"
    real.write_text("#!/bin/sh\necho REAL-GH-CALLED\n", encoding="utf-8")
    real.chmod(0o755)
    plan = _plan(tmp_path, _task("3", "REAL-GH-CALLED (quoted from #489)", "#489"))
    gh, log = _fake_gh(tmp_path)
    # First on PATH, so a bare-name resolution would find it; the rest of PATH
    # stays so the fake `gh` (a /bin/sh script) can still find its own tools.
    env = dict(os.environ, PATH="%s:%s" % (sabotage, os.environ["PATH"]))
    proc = _run(plan, gh, env=env)
    assert proc.returncode == 2, proc.stdout + proc.stderr
    assert proc.stdout == "provenance: task 3 claim is not verbatim in #489\n"
    assert "REAL-GH-CALLED" not in proc.stdout + proc.stderr
    assert _invocations(log) == ["issue view 489 --json body -q .body"]


def test_missing_plan_file_is_a_usage_error(tmp_path):
    gh, _ = _fake_gh(tmp_path)
    proc = _run(tmp_path / "nope.md", gh)
    assert proc.returncode == 1
    assert "no such plan" in proc.stderr


def test_claim_that_is_only_its_provenance_tag_refuses(tmp_path):
    # A Claim whose whole operator sentence is the tag that closes it strips to
    # "", and `"" in body` is always True — so before the guard this signed off
    # vacuously against a #489 that resolves. An empty sentence quotes nothing.
    plan = _plan(tmp_path, _task("1", "(quoted from #489)", "#489"))
    gh, _ = _fake_gh(tmp_path)
    proc = _run(plan, gh)
    assert proc.returncode == 2, proc.stdout + proc.stderr
    assert "empty operator sentence" in proc.stdout
    assert proc.stdout == (
        "provenance: task 1 claim quotes #489 with an empty operator "
        "sentence — the Claim is nothing but its provenance tag\n")
