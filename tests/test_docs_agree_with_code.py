"""The four operator documents and the code they describe say the same things.

This one file replaces about 230 sentence pins. Those pins asserted that a
paragraph still read the way it read when it was written, which made every
document edit a test edit and caught nothing a reader would have missed. What
they never caught is the class that actually costs a run: a page naming a flag
the CLI does not have, a row the doctor does not report, a script that is not
there, or a name that was retired two releases ago.

So the checks here are structural. Each one compares a document against the
code it claims to describe, and none of them can be satisfied by rewording:

  * every ``--flag`` on SKILL.md's launch line exists in ``fleet/launch.mjs``'s
    usage string (run-59 lost a launch to a documented flag the driver did not
    have; this is the pin that made that class inexpressible, kept);
  * the doctor's ``ROW_IDS`` are exactly ``first-run.md``'s ``## `` headings, in
    order, so a red row always has a section to send the operator to;
  * every ``fleet/<name>.mjs`` and ``fleet/<name>.sh`` the documents name is a
    file that exists;
  * the retired vocabulary of the pre-lift fleet appears in none of the four
    documents;
  * ``validate_skill.py`` still accepts ``skills/ultrapowers``.

Offline: reads committed files and runs one local Python script.
"""
import pathlib
import re
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]

SKILL = ROOT / "skills/ultrapowers/SKILL.md"
FIRST_RUN = ROOT / "skills/ultrapowers/references/first-run.md"
RUNBOOK = ROOT / "fleet/RUNBOOK.md"
README = ROOT / "README.md"

# The four operator-facing documents the fleet is read from.
DOCUMENTS = (SKILL, FIRST_RUN, RUNBOOK, README)

LAUNCH = ROOT / "fleet/launch.mjs"
DOCTOR = ROOT / "fleet/doctor.mjs"


def read(path):
    assert path.is_file(), f"{path} not found"
    return path.read_text(encoding="utf-8")


# ── the launch line and the launcher's flag vocabulary ───────────────────────

# The launch line is found by what it runs, not by where it sits.
LAUNCHER_INVOCATION = "fleet/launch.mjs"

# `--flag`, not `---` and not the tail of a word: the line also carries paths.
FLAG_RE = re.compile(r"(?<![\w-])--([A-Za-z][A-Za-z0-9-]*)")


def launch_line():
    """The single SKILL.md line that invokes the launcher."""
    lines = [
        line.strip()
        for line in read(SKILL).splitlines()
        if LAUNCHER_INVOCATION in line and line.strip().startswith("node ")
    ]
    assert len(lines) == 1, (
        f"expected exactly one `node …{LAUNCHER_INVOCATION}` line in {SKILL}, "
        f"found {len(lines)}: {lines!r}"
    )
    return lines[0]


def launch_flags():
    """Every `--flag` the launch line names, in the order it names them."""
    seen, out = set(), []
    for name in FLAG_RE.findall(launch_line()):
        if name not in seen:
            seen.add(name)
            out.append("--" + name)
    return out


# A `usage`-named binding, then either a template literal or `+`-joined quoted
# literals. Both shapes are read as text, so the pin costs no node process and
# does not care whether the usage text is a constant, an arrow function
# returning one, or a concatenation. Case-insensitive on the name, because the
# common shape is a `USAGE` constant with a `usage()` that returns it.
USAGE_HEAD_RE = re.compile(
    r"\busage\b\s*(?:=\s*(?:\([^)]*\)\s*=>\s*)?|\(\s*\)\s*\{\s*return\s+)", re.I)
TEMPLATE_RE = re.compile(r"`((?:[^`\\]|\\.)*)`")
QUOTED_PART_RE = re.compile(r"\s*(['\"])((?:[^'\"\\]|\\.)*)\1\s*(\+)?")


def _literal_at(text, pos):
    """The string literal starting at `pos`, or None if there is not one."""
    template = TEMPLATE_RE.match(text, pos)
    if template:
        return template.group(1)
    parts = []
    while True:
        part = QUOTED_PART_RE.match(text, pos)
        if not part:
            break
        parts.append(part.group(2))
        pos = part.end()
        if not part.group(3):
            break
    return "".join(parts) if parts else None


def usage_string():
    """What `fleet/launch.mjs`'s usage reads as.

    Every `usage`-named binding is tried and the longest literal wins, so a
    file carrying both `const USAGE = \\`…\\`` and `usage = () => USAGE` reads
    back as the text rather than as the empty tail of the indirection.
    """
    text = read(LAUNCH)
    candidates = []
    for head in USAGE_HEAD_RE.finditer(text):
        literal = _literal_at(text, head.end())
        if literal:
            candidates.append(literal)
    assert candidates, (
        f"{LAUNCH} has no `usage` binding whose value reads as a string "
        "literal — the launcher's usage text is what the page's launch line is "
        "checked against, so it has to be findable as text"
    )
    return max(candidates, key=len)


def test_usage_reads_as_a_flag_vocabulary():
    """The read of `usage` produces the launcher's usage line, not noise."""
    usage = usage_string()
    assert "launch.mjs" in usage, (
        "`usage` did not read back as the launcher's usage line; got: " + repr(usage)
    )


def test_launch_line_carries_the_required_flags():
    """An empty read would satisfy the pin below without checking anything."""
    flags = launch_flags()
    for required in ("--target", "--base"):
        assert required in flags, (
            f"the launch line does not carry `{required}`: {flags!r}"
        )


def test_every_launch_line_flag_exists_in_the_launcher():
    usage = usage_string()
    unknown = [flag for flag in launch_flags() if flag not in usage]
    assert not unknown, (
        f"{SKILL} names {len(unknown)} flag(s) `fleet/launch.mjs` does not have: "
        + ", ".join(unknown)
        + "\nlaunch line:\n" + launch_line()
        + "\nusage:\n" + usage
    )


# ── the doctor's rows and the walk's sections ────────────────────────────────

ROW_IDS_RE = re.compile(r"ROW_IDS\s*=\s*Object\.freeze\(\s*\[(.*?)\]", re.S)
HEADING_RE = re.compile(r"^## (.+)$", re.M)


def doctor_row_ids():
    text = read(DOCTOR)
    match = ROW_IDS_RE.search(text)
    assert match, f"{DOCTOR} has no `ROW_IDS = Object.freeze([…])` to read"
    ids = re.findall(r"['\"]([^'\"]+)['\"]", match.group(1))
    assert ids, f"{DOCTOR}'s ROW_IDS is empty"
    return ids


def test_first_run_has_a_section_per_doctor_row_in_order():
    """A red row names a section; a section that names no row is dead prose."""
    assert doctor_row_ids() == HEADING_RE.findall(read(FIRST_RUN)), (
        "fleet/doctor.mjs's ROW_IDS and first-run.md's `## ` headings disagree: "
        f"{doctor_row_ids()!r} vs {HEADING_RE.findall(read(FIRST_RUN))!r}"
    )


def test_the_skill_sends_red_rows_to_the_walk():
    assert "references/first-run.md" in read(SKILL), (
        "SKILL.md no longer routes a red doctor row to the first-run walk"
    )


# ── every script the documents name exists ───────────────────────────────────

SCRIPT_RE = re.compile(r"(?<![\w./-])fleet/([A-Za-z0-9][A-Za-z0-9._-]*\.(?:mjs|sh))")


def named_scripts(path):
    return sorted({m for m in SCRIPT_RE.findall(read(path))})


@pytest.mark.parametrize("document", DOCUMENTS, ids=lambda p: p.name)
def test_every_fleet_script_a_document_names_exists(document):
    named = named_scripts(document)
    missing = [name for name in named if not (ROOT / "fleet" / name).is_file()]
    assert not missing, (
        f"{document} names {len(missing)} fleet script(s) that do not exist: "
        + ", ".join(missing)
    )


def test_the_documents_name_scripts_at_all():
    """A regex that matched nothing would make the pin above vacuous."""
    named = set()
    for document in DOCUMENTS:
        named.update(named_scripts(document))
    assert "doctor.mjs" in named, f"no document names fleet/doctor.mjs; found {sorted(named)}"
    assert "launch.mjs" in named, f"no document names fleet/launch.mjs; found {sorted(named)}"


# ── retired vocabulary ───────────────────────────────────────────────────────

# Each of these named a mechanism the lift removed. A document that still says
# one of them is instructing an operator to use something that is not there.
RETIRED = (
    "drive-one",
    "--plan-from-assignment",
    "fleet-orchestrator",
    "refs/fleet/",
    "github-token",
    "claude-oauth-token",
    "--pr-base",
    "sweep-branches",
    "update-cli",
)


@pytest.mark.parametrize("document", DOCUMENTS, ids=lambda p: p.name)
def test_no_document_names_a_retired_mechanism(document):
    text = read(document)
    found = [name for name in RETIRED if name in text]
    assert not found, (
        f"{document} still names retired fleet machinery: " + ", ".join(found)
    )


# ── the skill still validates ────────────────────────────────────────────────

def test_validate_skill_accepts_the_ultrapowers_skill():
    result = subprocess.run(
        [sys.executable,
         str(ROOT / "skills/ultrapowers/scripts/validate_skill.py"),
         str(ROOT / "skills/ultrapowers")],
        capture_output=True, text=True)
    assert result.returncode == 0, (
        "validate_skill.py rejected skills/ultrapowers:\n"
        + result.stdout + result.stderr
    )
