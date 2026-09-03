"""`/ultrapowers setup` walks each red row (task 2, wave 0 of run-54).

The skill stays a client: it runs `fleet/doctor.mjs`, reads the JSON, and for
every row that is not `ok` sends the human to a section of
`references/first-run.md` named for that row's `id`. This file is the exam for
that contract, one assertion group per Proof leg:

  (a) M1 — frontmatter `argument-hint`/`description`, and `validate_skill.py`
      still prints `skill ok` once SKILL.md names the new reference.
  (b,c,d) M2 — the `## Setup` section carries three verbatim sentences: how to
      invoke the doctor, how to walk the red rows, and how `--probe` ends setup.
  (e,f) M3 — the `## Client` section carries the doctor-before-rsync sentence
      and the sentence naming `~/.ultrapowers/fleet.json` and its defaults.
  (g) M4 — the launch snippet is parameterised: every `rsync -a`/`ssh -n` line
      addresses `<orchestrator>.exe.xyz`, and the retired "no local fallback"
      sentence is gone.
  (h) M5 — `first-run.md` has exactly the six doctor row ids as `## `
      headings, in the doctor's order; each bridges to its RUNBOOK heading; the
      secret-touching and hand-built rows carry their verbatim sentences; and no
      section hands a human a bare destructive `ssh exe.dev "rm` fence.
  (i) M6 — neither file shouts.

Prose wraps, so every "contains this sentence verbatim" check compares
whitespace-normalised text: a line break inside a pinned sentence is allowed,
a changed word is not.

Offline: reads two committed files and runs one committed script.
"""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/ultrapowers/SKILL.md"
FIRST_RUN = ROOT / "skills/ultrapowers/references/first-run.md"
VALIDATE = "skills/ultrapowers/scripts/validate_skill.py"
SKILL_DIR = "skills/ultrapowers"

# --- the contract's literals, copied from the task text -------------------

ARGUMENT_HINT = "argument-hint: <plan-path> | setup"

DOCTOR_INVOCATION = (
    "Run the doctor from the plugin cache: "
    "`node <plugin-root>/fleet/doctor.mjs --json`, where `<plugin-root>` is "
    "two directories above this skill's base directory."
)
RED_ROW_WALK = (
    "For each row whose status is not `ok`, in order, open "
    "`references/first-run.md` at the section named for that row's `id` and "
    "follow it; every command a human has to run interactively is theirs to "
    "run, offered as `! <command>`, and nothing in this mode builds the golden "
    "for them."
)
PROBE_ENDS_SETUP = (
    "When the five read-only rows are `ok`, run the doctor once more with "
    "`--probe`; a `ready` verdict ends setup."
)
DOCTOR_BEFORE_RSYNC = (
    "Before the rsync, run the doctor with `--target <repo>` and without "
    "`--probe`; a verdict other than `ready` means there is no fleet to launch "
    "on for this target — offer `/ultrapowers setup` and stop."
)
CONFIG_SOURCE = (
    "The orchestrator hostname and its checkout path come from "
    "`~/.ultrapowers/fleet.json` (`orchestrator`, `repoDir`); their defaults "
    "are `fleet-orchestrator` and `/home/exedev/repo`."
)
RETIRED_SENTENCE = (
    "Nothing runs here and there is no local fallback: without the fleet, say "
    "so and stop."
)
TOKEN_SENTENCE = (
    "The token is written to a 0600 file directly from the command's output, "
    "never through the clipboard, and its value is never pasted into this "
    "conversation."
)
GOLDEN_SENTENCE = (
    "The golden is built by the human, one RUNBOOK step at a time, and "
    "re-checked with the doctor after each; this walk verifies, it does not "
    "build."
)

# The doctor's six rows, in the doctor's order, each with the exact RUNBOOK
# heading its `fix` names.
ROWS = [
    ("exe-dev", "exe.dev account"),
    ("orchestrator", "Orchestrator VM"),
    ("golden", "Golden VM build"),
    ("token", "Engine auth — the Max subscription, delivered per run (#213)"),
    ("github-token", "GitHub auth (#368) — the orchestrator opens the PR"),
    ("preflight", "Preflight"),
]
ROW_IDS = [row_id for row_id, _ in ROWS]

# Split so this exam does not itself gain the whole words it forbids.
SHOUTY = ("NEV" + "ER", "ALW" + "AYS", "MU" + "ST")

DESTRUCTIVE_FENCE_START = 'ssh exe.dev "rm'


# --- helpers --------------------------------------------------------------

def norm(text):
    """Collapse runs of whitespace: prose in markdown wraps at the margin."""
    return re.sub(r"\s+", " ", text).strip()


def read(path):
    assert path.is_file(), f"{path.relative_to(ROOT)} not found"
    return path.read_text(encoding="utf-8")


def frontmatter_lines():
    m = re.match(r"^---\n(.*?)\n---\n", read(SKILL), re.DOTALL)
    assert m, "SKILL.md has no YAML frontmatter"
    return m.group(1).splitlines()


def sections(text):
    """[(heading, body)] for each `## ` heading, skipping fenced regions."""
    out, in_fence, heading, buf = [], False, None, []
    for line in text.splitlines():
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
        elif not in_fence and line.startswith("## "):
            if heading is not None:
                out.append((heading, "\n".join(buf)))
            heading, buf = line[3:].strip(), []
            continue
        if heading is not None:
            buf.append(line)
    if heading is not None:
        out.append((heading, "\n".join(buf)))
    return out


def section_body(text, wanted, label):
    found = [body for heading, body in sections(text) if heading == wanted]
    assert len(found) == 1, (
        f"{label}: expected exactly one `## {wanted}` heading, found "
        f"{len(found)}"
    )
    return found[0]


def setup_section():
    return section_body(read(SKILL), "Setup", "SKILL.md")


def client_section():
    return section_body(read(SKILL), "Client", "SKILL.md")


# --- leg (a) [M1] ---------------------------------------------------------

def test_leg_a_argument_hint_line_is_exact():
    """(a)[M1] the frontmatter carries the two-mode argument hint, exactly."""
    hints = [ln for ln in frontmatter_lines() if ln.startswith("argument-hint:")]
    assert hints == [ARGUMENT_HINT], (
        f"(a)[M1] argument-hint line is {hints!r}, expected [{ARGUMENT_HINT!r}]"
    )


def test_leg_a_description_names_setup_mode():
    """(a)[M1] the description mentions `/ultrapowers setup`, so the skill
    is reachable by the phrase the user types."""
    desc = [ln for ln in frontmatter_lines() if ln.startswith("description:")]
    assert len(desc) == 1, f"(a)[M1] expected one description line, got {desc!r}"
    assert "/ultrapowers setup" in desc[0], (
        "(a)[M1] frontmatter description does not contain `/ultrapowers setup`: "
        + desc[0]
    )


def test_leg_a_validate_skill_prints_skill_ok():
    """(a)[M1] every `references/<file>` the SKILL.md names resolves."""
    proc = subprocess.run(
        [sys.executable, VALIDATE, SKILL_DIR],
        cwd=ROOT, capture_output=True, text=True,
    )
    assert proc.returncode == 0, (
        f"(a)[M1] validate_skill.py exited {proc.returncode}:\n"
        f"{proc.stdout}{proc.stderr}"
    )
    assert proc.stdout.strip() == "skill ok", (
        f"(a)[M1] validate_skill.py stdout was {proc.stdout!r}, "
        "expected 'skill ok'"
    )


# --- legs (b) (c) (d) [M2]: the `## Setup` section -------------------------

def test_leg_b_setup_section_occurs_exactly_once():
    """(b)[M2] `## Setup` is a single section — setup_section() asserts it."""
    headings = [h for h, _ in sections(read(SKILL))]
    assert headings.count("Setup") == 1, (
        f"(b)[M2] `## Setup` appears {headings.count('Setup')} times in "
        f"SKILL.md headings {headings!r}"
    )


def test_leg_b_setup_section_carries_doctor_invocation_sentence():
    """(b)[M2] the section says how to invoke the doctor from the plugin
    cache, addressing `<plugin-root>` relatively rather than by cache path."""
    assert norm(DOCTOR_INVOCATION) in norm(setup_section()), (
        "(b)[M2] `## Setup` is missing, verbatim:\n" + DOCTOR_INVOCATION
    )


def test_leg_c_setup_section_carries_red_row_walk_sentence():
    """(c)[M2] the section says how to walk each not-`ok` row: in order, into
    the first-run.md section named for the row id, offering `! <command>`."""
    assert norm(RED_ROW_WALK) in norm(setup_section()), (
        "(c)[M2] `## Setup` is missing, verbatim:\n" + RED_ROW_WALK
    )


def test_leg_d_setup_section_carries_probe_sentence():
    """(d)[M2] the section says how setup ends: re-run with `--probe`, a
    `ready` verdict finishes."""
    assert norm(PROBE_ENDS_SETUP) in norm(setup_section()), (
        "(d)[M2] `## Setup` is missing, verbatim:\n" + PROBE_ENDS_SETUP
    )


# --- legs (e) (f) [M3]: the `## Client` section ---------------------------

def test_leg_e_client_section_runs_doctor_before_rsync():
    """(e)[M3] the client checks for a fleet before shipping a plan at one,
    and offers `/ultrapowers setup` when there is none."""
    assert norm(DOCTOR_BEFORE_RSYNC) in norm(client_section()), (
        "(e)[M3] `## Client` is missing, verbatim:\n" + DOCTOR_BEFORE_RSYNC
    )


def test_leg_f_client_section_names_the_config_file_and_defaults():
    """(f)[M3] the client says where `<orchestrator>` and `<repoDir>` come
    from, with the two defaults spelled out."""
    assert norm(CONFIG_SOURCE) in norm(client_section()), (
        "(f)[M3] `## Client` is missing, verbatim:\n" + CONFIG_SOURCE
    )


# --- leg (g) [M4]: the launch snippet is parameterised ---------------------

def _launch_lines():
    return [
        ln for ln in read(SKILL).splitlines()
        if ln.strip().startswith("rsync -a") or ln.strip().startswith("ssh -n")
    ]


def test_leg_g_snippet_has_launch_lines():
    """(g)[M4] the four numbered client steps keep their launch snippet —
    a SKILL.md with no such line would pass the next test vacuously."""
    assert _launch_lines(), (
        "(g)[M4] no line of SKILL.md begins with `rsync -a` or `ssh -n`"
    )


def test_leg_g_launch_lines_address_the_configured_orchestrator():
    """(g)[M4] every launch line addresses `<orchestrator>.exe.xyz`, never the
    hardcoded `fleet-orchestrator.exe.xyz`."""
    for line in _launch_lines():
        assert "<orchestrator>.exe.xyz" in line, (
            "(g)[M4] launch line does not address `<orchestrator>.exe.xyz`:\n"
            + line
        )
        assert "fleet-orchestrator.exe.xyz" not in line, (
            "(g)[M4] launch line still hardcodes `fleet-orchestrator.exe.xyz`:\n"
            + line
        )


def test_leg_g_retired_no_local_fallback_sentence_is_absent():
    """(g)[M4] "say so and stop" is now "offer setup and stop", so the old
    closing sentence is gone from the file."""
    assert norm(RETIRED_SENTENCE) not in norm(read(SKILL)), (
        "(g)[M4] SKILL.md still carries the retired sentence:\n"
        + RETIRED_SENTENCE
    )


# --- leg (h) [M5]: references/first-run.md --------------------------------

def test_leg_h_first_run_exists():
    """(h)[M5] the bridge file this task creates."""
    assert FIRST_RUN.is_file(), (
        "(h)[M5] skills/ultrapowers/references/first-run.md not found"
    )


def test_leg_h_headings_are_the_six_row_ids_in_order():
    """(h)[M5] one section per doctor row, named by `id`, in the doctor's
    order — so the walk can index by row id alone."""
    headings = [h for h, _ in sections(read(FIRST_RUN))]
    assert headings == ROW_IDS, (
        f"(h)[M5] first-run.md `## ` headings are {headings!r}, expected "
        f"{ROW_IDS!r}"
    )


def test_leg_h_each_section_bridges_to_its_runbook_heading():
    """(h)[M5] each section points at the RUNBOOK section its row's `fix`
    names, spelled exactly as the RUNBOOK heading."""
    bodies = dict(sections(read(FIRST_RUN)))
    for row_id, runbook_heading in ROWS:
        assert row_id in bodies, f"(h)[M5] first-run.md has no `## {row_id}`"
        wanted = "RUNBOOK §" + runbook_heading
        assert norm(wanted) in norm(bodies[row_id]), (
            f"(h)[M5] the `{row_id}` section does not contain, verbatim:\n"
            + wanted
        )


def test_leg_h_token_section_hands_over_the_command_and_the_secret_rule():
    """(h)[M5] the first of the two sections that touch a secret names the
    command the human runs and states the 0600-direct-from-output rule."""
    bodies = dict(sections(read(FIRST_RUN)))
    assert "token" in bodies, "(h)[M5] first-run.md has no `## token`"
    assert "claude setup-token" in bodies["token"], (
        "(h)[M5] the `token` section does not mention `claude setup-token`"
    )
    assert norm(TOKEN_SENTENCE) in norm(bodies["token"]), (
        "(h)[M5] the `token` section is missing, verbatim:\n" + TOKEN_SENTENCE
    )


def test_leg_h_golden_section_says_the_walk_verifies_not_builds():
    """(h)[M5] the golden is hand-built one RUNBOOK step at a time; this walk
    checks the result, it does not reproduce the steps."""
    bodies = dict(sections(read(FIRST_RUN)))
    assert "golden" in bodies, "(h)[M5] first-run.md has no `## golden`"
    assert norm(GOLDEN_SENTENCE) in norm(bodies["golden"]), (
        "(h)[M5] the `golden` section is missing, verbatim:\n" + GOLDEN_SENTENCE
    )


def test_leg_h_no_section_opens_a_destructive_ssh_fence():
    """(h)[M5] the probe VM is removed by the doctor's own `--probe`, never by
    a bare `rm` a human could mistype: no fence in this file opens with one."""
    for heading, body in sections(read(FIRST_RUN)):
        lines = body.splitlines()
        for i, line in enumerate(lines[:-1]):
            if line.lstrip().startswith("```"):
                nxt = lines[i + 1].lstrip()
                assert not nxt.startswith(DESTRUCTIVE_FENCE_START), (
                    f"(h)[M5] the `{heading}` section opens a fenced block with "
                    f"a destructive command:\n{nxt}"
                )


# --- leg (i) [M6]: neither file shouts ------------------------------------

def test_leg_i_neither_file_uses_the_shouted_imperatives():
    """(i)[M6] no upper-case whole-word imperative in either file."""
    pattern = re.compile(r"\b(" + "|".join(SHOUTY) + r")\b")
    for path in (SKILL, FIRST_RUN):
        m = pattern.search(read(path))
        assert m is None, (
            f"(i)[M6] {path.relative_to(ROOT)} contains the shouted word "
            f"{m.group(0)!r} at offset {m.start()}"
        )
