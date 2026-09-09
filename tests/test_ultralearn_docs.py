"""ultralearn's SKILL.md and its harvester agree.

The two sentence pins that stood here (a deleted paragraph, three phrases in
`reading-lenses.md`) are gone with the rest of the prose diet. What survives is
the pair that reads code: the skill names the script and the file it consumes,
and every flag it advertises is a flag the CLI actually has.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/ultralearn/SKILL.md"
HARVEST = ROOT / "skills/ultralearn/scripts/harvest_fleet_runs.py"


def test_skill_names_the_fleet_harvester_and_its_corpus():
    text = SKILL.read_text()
    assert "harvest_fleet_runs.py" in text
    assert "events.jsonl" in text


def test_every_flag_the_skill_advertises_exists():
    help_text = subprocess.run(
        [sys.executable, str(HARVEST), "--help"],
        capture_output=True, text=True, check=True).stdout
    advertised = set(re.findall(r"`?(--[a-z][a-z-]+)", SKILL.read_text()))
    for flag in advertised & {"--evidence", "--run", "--cache", "--force",
                              "--origin", "--engine-version", "--slice-budget"}:
        assert flag in help_text, f"SKILL.md advertises {flag}, the CLI has no such flag"


# --- Task 3: the skill says how a catch is counted and that N is read off the
# curve. The section is addressed the way the task's `Run:` lines address it,
# `sed -n '/^## The catch counter/,/^## Verb 2/p'` — from the heading through
# the `## Verb 2` line, both boundaries included.

COUNTER = ROOT / "skills/ultralearn/scripts/catch_counter.py"
REPORT = ROOT / "skills/ultralearn/scripts/catch_report.py"
VALIDATE = ROOT / "skills/ultrapowers/scripts/validate_skill.py"

CATCH_HEADING = "## The catch counter"
VERB1_HEADING = "## Verb 1"
VERB2_HEADING = "## Verb 2"


def _heading_line(prefix):
    """1-based line number of the one line starting with `prefix`, as grep -n."""
    hits = [n for n, line in enumerate(SKILL.read_text().splitlines(), 1)
            if line.startswith(prefix)]
    assert len(hits) == 1, (
        f"SKILL.md has {len(hits)} lines starting with {prefix!r}, expected exactly one")
    return hits[0]


def _catch_section():
    """The catch-counter section's text, as the task's `sed -n` range prints it."""
    lines = SKILL.read_text().splitlines()
    start = _heading_line(CATCH_HEADING) - 1
    end = len(lines)
    for n in range(start + 1, len(lines)):
        if lines[n].startswith(VERB2_HEADING):
            end = n + 1
            break
    return "\n".join(lines[start:end]) + "\n"


def _help(script):
    return subprocess.run([sys.executable, str(script), "--help"],
                          capture_output=True, text=True, check=True).stdout


def test_catch_counter_heading_sits_between_the_two_verbs():
    # Leg (a) [M1]: `## The catch counter` exists once, after `## Verb 1` and
    # before `## Verb 2` — the three line numbers strictly increasing.
    verb1 = _heading_line(VERB1_HEADING)
    catch = _heading_line(CATCH_HEADING)
    verb2 = _heading_line(VERB2_HEADING)
    assert verb1 < catch < verb2, (
        f"expected `{VERB1_HEADING}` ({verb1}) < `{CATCH_HEADING}` ({catch}) "
        f"< `{VERB2_HEADING}` ({verb2})")


def test_catch_section_names_the_scripts_the_row_and_the_ledger():
    # Leg (b) [M2]: the section names both scripts, the row kind, and the file
    # the counter appends to.
    section = _catch_section()
    for name in ("catch_counter.py", "catch_report.py", "catch-count",
                 "docs/superpowers/observations/ledger.jsonl"):
        assert name in section, f"the catch-counter section does not name {name!r}"


def test_catch_section_states_the_rule_and_names_the_two_record_fields():
    # Leg (c) [M3]: `never the test` before `re-run alone`; `examEdited` and
    # `writes` spelled as code tokens — the record fields, not the bare verb.
    section = _catch_section()
    assert re.search(r"never the test.*re-run alone", section, re.S), (
        "the section does not say `never the test` before `re-run alone`")

    exam_edited = r"[^ \n]examEdited[^ \n]"
    writes_field = r"[^ \n]writes[^ \n] in the receipt"
    assert re.search(exam_edited, section), (
        "the section does not spell `examEdited` as a code token")
    assert re.search(writes_field, section), (
        "the section does not spell `writes` as a code token followed by ` in the receipt`")

    prose = "the counter writes the ledger"
    assert not re.search(exam_edited, prose)
    assert not re.search(writes_field, prose), (
        "the `writes` pin matches a bare verb, so it does not pin the record field")


def test_catch_section_reads_n_off_the_curve():
    # Leg (d) [M4]: `--n`, `curve`, `not fixed`.
    section = _catch_section()
    for token in ("--n", "curve", "not fixed"):
        assert token in section, f"the catch-counter section does not contain {token!r}"


def test_every_flag_the_catch_section_advertises_exists():
    # Leg (e) [M5]: every `--[a-z][a-z-]*` token in the section is a flag one of
    # the two CLIs prints under `--help`.
    section = _catch_section()
    advertised = set(re.findall(r"--[a-z][a-z-]*", section))
    both = _help(COUNTER) + "\n" + _help(REPORT)
    for flag in sorted(advertised):
        assert flag in both, (
            f"the catch-counter section advertises {flag}, neither CLI has such a flag")
    assert "--nope" not in both, (
        "the union of the two help texts contains `--nope`, so this check pins nothing")


def test_validate_skill_accepts_the_ultralearn_skill():
    # Leg (f) [M6]: the skill still validates.
    done = subprocess.run([sys.executable, str(VALIDATE), str(ROOT / "skills/ultralearn")],
                          capture_output=True, text=True)
    assert done.returncode == 0, (
        f"validate_skill.py exited {done.returncode}\n{done.stdout}{done.stderr}")
