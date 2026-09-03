"""The four operator documents and the code they describe say the same things.

This one file replaces about 230 sentence pins. Those pins asserted that a
paragraph still read the way it read when it was written, which made every
document edit a test edit and caught nothing a reader would have missed. What
they never caught is the class that actually costs a run: a page naming a flag
the CLI does not have, a row the doctor does not report, a script that is not
there, or a name that was retired two releases ago.

So the checks here are structural. Each one compares a document against the
code or the contract it claims to describe, and none of them can be satisfied
by rewording:

  * every ``--flag`` on SKILL.md's launch line exists in ``fleet/launch.mjs``'s
    usage string (run-59 lost a launch to a documented flag the driver did not
    have; this is the pin that made that class inexpressible, kept);
  * the doctor's ``ROW_IDS`` are exactly ``first-run.md``'s ``## `` headings, in
    order, so a red row always has a section to send the operator to;
  * every ``fleet/<name>.mjs`` and ``fleet/<name>.sh`` the documents name is a
    file that exists;
  * the literals the documents teach — the unit the launcher starts, the
    directory the engine is cloned into, the shape of a VM name — are the ones
    ``fleet/CONTRACT.md`` declares, and the unit is a file in ``fleet/``;
  * no document attaches a GitHub integration other than ``fleet-runs`` to a
    tag (the contract's grant rule);
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

CONTRACT = ROOT / "fleet/CONTRACT.md"
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


# ── the contract's literals ──────────────────────────────────────────────────

# Each of these reads a literal out of `fleet/CONTRACT.md` and checks that the
# documents teach that literal and not its predecessor. The contract is the
# authority; a doc that drifts from it is a doc sending an operator to a unit,
# a path or a VM name that is not there.

# The launcher starts an INSTANCE of a template: `fleet-run@<N>.service` in the
# documents is the file `fleet/fleet-run@.service` with `<N>` as its `%i`. No
# `--no-block` is admitted by this regex on purpose (Counsel 3): with Type=exec
# the blocking `start` is the launch ack, and a doc teaching `--no-block` again
# would teach an operator to ignore it.
START_UNIT_RE = re.compile(r"systemctl --user start (fleet-[\w-]+@)<N>\.service")
# A start line that still carries the flag — prose that says "no `--no-block`"
# is allowed to explain why.
NO_BLOCK_START_RE = re.compile(r"--no-block start")
ENGINE_DIR_RE = re.compile(r"(/home/exedev/engines/)<sha>")
VM_NAME_RE = re.compile(r"\*\*VM name:\*\*\s*`(fleet-r)<N>-")


def contract_literal(regex, what):
    match = regex.search(read(CONTRACT))
    assert match, f"{CONTRACT} no longer declares {what} in the shape this pin reads"
    return match.group(1)


def test_the_documents_start_the_unit_the_contract_names():
    template = contract_literal(START_UNIT_RE, "the unit the launcher starts")
    instance = f"{template}<N>.service"
    for document in (RUNBOOK, FIRST_RUN, CONTRACT):
        assert instance in read(document), f"{document} does not name `{instance}`"
        assert not NO_BLOCK_START_RE.search(read(document)), (
            f"{document} still shows a `--no-block start` line"
        )
    assert (ROOT / "fleet" / f"{template}.service").is_file(), (
        f"the contract's template `{template}.service` is not a file in fleet/ — "
        "the golden copies it from there"
    )


def test_the_documents_name_the_engine_directory_the_contract_declares():
    engine_dir = contract_literal(ENGINE_DIR_RE, "the engine directory")
    for document in (RUNBOOK, FIRST_RUN):
        assert engine_dir in read(document), f"{document} does not name `{engine_dir}`"


# A VM name the documents show: the contract's prefix, then the run number.
DOC_VM_NAME_RE = re.compile(r"fleet-r(?:<N>|\d+)-")
# The pre-lift shape, where the run number was the whole name.
OLD_VM_NAME_RE = re.compile(r"fleet-run-(?:<N>|\d+)\b")


def test_vm_names_in_the_documents_follow_the_contract():
    prefix = contract_literal(VM_NAME_RE, "the VM name pattern")
    assert DOC_VM_NAME_RE.pattern.startswith(prefix), (
        f"this pin's own VM-name regex no longer starts with the contract's `{prefix}`"
    )
    for document in (RUNBOOK, SKILL):
        text = read(document)
        assert DOC_VM_NAME_RE.search(text), f"{document} shows no `{prefix}<N>-…` VM name"
    for document in DOCUMENTS:
        old = OLD_VM_NAME_RE.findall(read(document))
        assert not old, f"{document} still names a VM by run number alone: {old!r}"


# ── the grant rule: only fleet-runs rides the tag ────────────────────────────

# Backslash-continued shell lines are one command.
CONTINUATION_RE = re.compile(r"\\\n\s*")
ADD_GITHUB_RE = re.compile(r"integrations add github[^\n]*")
NAME_RE = re.compile(r"--name\s+([\w<>-]+)")


def github_add_commands(path):
    return ADD_GITHUB_RE.findall(CONTINUATION_RE.sub(" ", read(path)))


def test_documents_attach_no_target_integration_to_a_tag():
    commands = []
    for document in DOCUMENTS:
        commands.extend(github_add_commands(document))
    assert commands, "no document shows an `integrations add github` command"
    for command in commands:
        name = NAME_RE.search(command)
        assert name, f"an `integrations add github` command carries no --name: {command}"
        if "--attach" in command:
            assert name.group(1) == "fleet-runs", (
                "a document attaches a GitHub integration other than fleet-runs "
                f"at creation: {command}"
            )
        if name.group(1).endswith("-ro"):
            assert "--readonly" in command, f"the -ro object is not --readonly: {command}"
            assert "--act-as-user" not in command, f"the -ro object acts as user: {command}"
        if name.group(1).endswith("-rw"):
            assert "--act-as-user" in command, f"the -rw object does not --act-as-user: {command}"


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
    # Counsel 2 (fleet/CONTRACT.md v2): the mutable boot unit, the engine
    # pre-clone, the engine scope, the comment-polling start signal.
    "fleet-boot.service",
    "/home/exedev/repo",
    "systemd-run --scope",
    "KillMode=process",
    "shim.log",
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
