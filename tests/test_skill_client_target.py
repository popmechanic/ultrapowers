"""The skill launches against the repository it is run in (task 6, run-55).

`/ultrapowers <plan-path>` derives its target from the checkout the operator
ran it in, stages the plan outside the engine checkout, pins the engine to the
newest release, and launches the Task-4 CLI grammar
(`<plan-file> run-<N> --target <owner>/<repo> --base <sha>`). This file is the
exam for that contract, one assertion group per Proof leg:

  (a) M1 — the `## Client` section carries S1-S5 verbatim (whitespace
      collapsed); when one is absent the exam names the first one missing.
  (b) M2 — the section's fenced `bash` block carries the four launch lines
      verbatim, and the drive-one line keeps the detached shape
      (`setsid -f node fleet/drive-one.mjs`, `</dev/null`, `2>&1`) and the
      `--target <repo> --base <baseSha>` grammar.
  (c) M3 — the retired vocabulary is gone: `--plan-from-assignment`,
      `pinRepoDir`, `--pr-base`, and any line that both rsyncs and names
      `docs/superpowers`.
  (d) M4 — the two BASE sentences the sibling repo tests pin are still there,
      the `## Setup` section is byte-identical to the literal frozen in this
      file, and `validate_skill.py` still prints `skill ok`.

Prose wraps, so every "contains this verbatim" check compares
whitespace-collapsed text: a line break inside a pinned sentence is allowed, a
changed word is not.

Offline: reads one committed file and runs one committed script.
"""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/ultrapowers/SKILL.md"
VALIDATE = "skills/ultrapowers/scripts/validate_skill.py"
SKILL_DIR = "skills/ultrapowers"

# --- M1: the five sentences, copied from the task text --------------------

S1 = (
    "The target is the repository this skill is run in: `repo` is "
    "`gh repo view --json nameWithOwner -q .nameWithOwner` and `baseSha` is "
    "`git rev-parse HEAD`."
)
S2 = (
    "When `git rev-parse @{upstream}` fails or prints a different sha, say "
    "that the base is not on GitHub yet, ask the operator to push, and stop."
)
S3 = (
    "Stage the plan on the orchestrator under `/home/exedev/plans/run-<N>/`; "
    "nothing under `docs/` lives there."
)
S4 = (
    "Pin the engine to the newest release on `main`, or to the ref the "
    "operator names when the run is about an engine change, and read the "
    "chosen version back:"
)
S5 = "The laptop never fetches a run branch."

SENTENCES = [("S1", S1), ("S2", S2), ("S3", S3), ("S4", S4), ("S5", S5)]

# --- M2: the four lines of the fenced `bash` block -------------------------

L_MKDIR = "ssh <orchestrator>.exe.xyz 'mkdir -p /home/exedev/plans/run-<N>'"
L_RSYNC = (
    "rsync -a <plan-path> <plan-stem>.gate-verdicts.json "
    "<orchestrator>.exe.xyz:/home/exedev/plans/run-<N>/"
)
L_PIN = (
    "ssh <orchestrator>.exe.xyz 'git -C <repoDir> fetch -q origin && "
    "git -C <repoDir> checkout -q $(git -C <repoDir> log -1 --format=%H "
    "origin/main -- .claude-plugin/plugin.json) && "
    "git -C <repoDir> show HEAD:.claude-plugin/plugin.json'"
)
L_LAUNCH = (
    "ssh -n <orchestrator>.exe.xyz 'mkdir -p /home/exedev/fleet-evidence && "
    "cd <repoDir> && setsid -f node fleet/drive-one.mjs "
    "/home/exedev/plans/run-<N>/<plan-basename> run-<N> --target <repo> "
    "--base <baseSha> --golden <golden> --db-dir /tmp/fleet-orch-run-<N> "
    "</dev/null >/home/exedev/fleet-evidence/drive-run-<N>.out 2>&1'"
)

BLOCK_LINES = [
    ("mkdir", L_MKDIR),
    ("rsync", L_RSYNC),
    ("engine pin", L_PIN),
    ("launch", L_LAUNCH),
]

DETACHED = "setsid -f node fleet/drive-one.mjs"
CLI_GRAMMAR = "--target <repo> --base <baseSha>"

# --- M3: the vocabulary that leaves ---------------------------------------

FORBIDDEN_TOKENS = ["--plan-from-assignment", "pinRepoDir", "--pr-base"]

# --- M4: what stays ---------------------------------------------------------

DOCTOR_BEFORE_RSYNC = (
    "Before the rsync, run the doctor with `--target <repo>` and without "
    "`--probe`; a verdict other than `ready` means there is no fleet to launch "
    "on for this target — offer `/ultrapowers setup` and stop."
)
CONFIG_SOURCE = (
    "The orchestrator hostname, its checkout path and the golden's name come "
    "from `~/.ultrapowers/fleet.json` (`orchestrator`, `repoDir`, `golden`); "
    "their defaults are `fleet-orchestrator`, `/home/exedev/repo` and "
    "`fleet-golden`."
)
KEPT_SENTENCES = [
    ("doctor-before-rsync", DOCTOR_BEFORE_RSYNC),
    ("fleet.json defaults", CONFIG_SOURCE),
]

SETUP_SECTION_AT_BASE = (
    """The fleet is six pieces, and the doctor is the only thing that knows whether
you have them.

Run the doctor from the plugin cache: `node <plugin-root>/fleet/doctor.mjs --json`, where `<plugin-root>` is two directories above this skill's base directory.
The harness prints `Base directory for this skill:` when it loads this file;
the cache path itself differs by version and by host, so derive it rather than
naming it. The doctor answers with one row per piece — `exe-dev`,
`orchestrator`, `golden`, `token`, `github-token`, `preflight`, in that order —
each carrying a `status` of `ok`, `missing` or `skipped`, a human `detail`, and
a `fix` naming the `fleet/RUNBOOK.md` section that builds it. Read the rows
back to the user as a short list before touching anything.

For each row whose status is not `ok`, in order, open `references/first-run.md` at the section named for that row's `id` and follow it; every command a human has to run interactively is theirs to run, offered as `! <command>`, and nothing in this mode builds the golden for them.
The order matters: each piece is built on the one above it, so a `missing`
`orchestrator` makes everything below it unreadable rather than absent.
Re-run the doctor after each row and show the user the row that just turned
`ok`.

When the five read-only rows are `ok`, run the doctor once more with `--probe`; a `ready` verdict ends setup.
The probe is the one check that costs a VM: it clones the golden into a
throwaway named `fleet-doctor-probe`, runs `fleet/preflight.mjs` against it,
and removes it. Anything short of `ready` leaves a row still red — go back to
its section.

Configuration lives in `~/.ultrapowers/fleet.json`; the doctor takes
`--config <path>` to read it from somewhere else."""
)


# --- helpers --------------------------------------------------------------

def norm(text):
    """Collapse runs of whitespace: prose in markdown wraps at the margin."""
    return re.sub(r"\s+", " ", text).strip()


def read(path=SKILL):
    assert path.is_file(), f"{path} not found"
    return path.read_text(encoding="utf-8")


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


def section_body(wanted):
    found = [body for heading, body in sections(read()) if heading == wanted]
    assert len(found) == 1, (
        f"SKILL.md: expected exactly one `## {wanted}` heading, found "
        f"{len(found)}"
    )
    return found[0]


def client_section():
    return section_body("Client")


def bash_blocks(body):
    """The bodies of the fenced blocks in `body` whose info string is `bash`."""
    out, buf, info = [], None, None
    for line in body.splitlines():
        if line.lstrip().startswith("```"):
            if buf is None:
                buf, info = [], line.strip().lstrip("`").strip()
            else:
                if info == "bash":
                    out.append("\n".join(buf))
                buf, info = None, None
            continue
        if buf is not None:
            buf.append(line)
    return out


def client_bash_blocks():
    blocks = bash_blocks(client_section())
    assert blocks, "(b)[M2] the `## Client` section has no fenced `bash` block"
    return blocks


# --- leg (a) [M1]: the five sentences -------------------------------------

def test_leg_a_names_the_first_missing_client_sentence():
    """(a)[M1] S1-S5 are all in the `## Client` section, collapsed; when one
    is not, this names the first one that is absent."""
    section = norm(client_section())
    missing = [(tag, text) for tag, text in SENTENCES if norm(text) not in section]
    assert not missing, (
        f"(a)[M1] `## Client` is missing {len(missing)} of the five pinned "
        f"sentences; the first absent is {missing[0][0]}, verbatim:\n"
        + missing[0][1]
    )


def test_leg_a_s1_derives_the_target_from_the_checkout():
    """(a)[M1] S1: `repo` from `gh repo view`, `baseSha` from `git rev-parse
    HEAD` — nothing per-project to configure."""
    assert norm(S1) in norm(client_section()), (
        "(a)[M1] `## Client` is missing S1, verbatim:\n" + S1
    )


def test_leg_a_s2_stops_when_the_base_is_not_pushed():
    """(a)[M1] S2: an unpushed base is a stop, not a launch."""
    assert norm(S2) in norm(client_section()), (
        "(a)[M1] `## Client` is missing S2, verbatim:\n" + S2
    )


def test_leg_a_s3_stages_the_plan_outside_the_engine_checkout():
    """(a)[M1] S3: the plan is staged under `/home/exedev/plans/run-<N>/`."""
    assert norm(S3) in norm(client_section()), (
        "(a)[M1] `## Client` is missing S3, verbatim:\n" + S3
    )


def test_leg_a_s4_pins_the_engine_to_the_newest_release():
    """(a)[M1] S4: pin to the newest release on `main` (or the operator's ref)
    and read the chosen version back."""
    assert norm(S4) in norm(client_section()), (
        "(a)[M1] `## Client` is missing S4, verbatim:\n" + S4
    )


def test_leg_a_s5_keeps_the_laptop_out_of_the_run_branch():
    """(a)[M1] S5: the laptop reads the receipt in the PR, it does not fetch."""
    assert norm(S5) in norm(client_section()), (
        "(a)[M1] `## Client` is missing S5, verbatim:\n" + S5
    )


# --- leg (b) [M2]: the fenced block ---------------------------------------

def test_leg_b_block_carries_all_four_lines():
    """(b)[M2] each of the four lines — mkdir, rsync, engine pin, launch — is
    in a fenced `bash` block of the `## Client` section, collapsed."""
    blocks = [norm(block) for block in client_bash_blocks()]
    for tag, line in BLOCK_LINES:
        assert any(norm(line) in block for block in blocks), (
            f"(b)[M2] no fenced `bash` block of `## Client` carries the {tag} "
            "line, verbatim:\n" + line
        )


def _launch_line():
    lines = [
        line
        for block in client_bash_blocks()
        for line in block.splitlines()
        if "node fleet/drive-one.mjs" in line
    ]
    assert len(lines) == 1, (
        "(b)[M2] expected exactly one `node fleet/drive-one.mjs` line in the "
        f"`## Client` fenced block(s), found {len(lines)}: {lines!r}"
    )
    return lines[0]


def test_leg_b_launch_line_is_detached():
    """(b)[M2] the launch keeps the shape every ssh launch of a fleet driver
    keeps: `setsid -f node fleet/drive-one.mjs`, `</dev/null`, `2>&1`."""
    line = _launch_line()
    assert DETACHED in line, (
        f"(b)[M2] the launch line does not carry `{DETACHED}`:\n" + line
    )
    assert "</dev/null" in line, (
        "(b)[M2] the launch line has no `</dev/null` stdin redirect:\n" + line
    )
    assert "2>&1" in line, (
        "(b)[M2] the launch line has no `2>&1` stderr redirect:\n" + line
    )


def test_leg_b_launch_line_uses_the_target_and_base_grammar():
    """(b)[M2] the launch passes the derived pair through the Task-4 CLI
    grammar, in that order."""
    line = _launch_line()
    assert CLI_GRAMMAR in line, (
        f"(b)[M2] the launch line does not carry `{CLI_GRAMMAR}`:\n" + line
    )


# --- leg (c) [M3]: the vocabulary that leaves -----------------------------

def test_leg_c_retired_tokens_are_absent():
    """(c)[M3] the plan no longer travels in the assignment, the drive no
    longer pins a repo dir, and the client names no PR base."""
    text = read()
    for token in FORBIDDEN_TOKENS:
        assert token not in text, (
            f"(c)[M3] SKILL.md still contains the retired token `{token}`"
        )


def test_leg_c_no_line_rsyncs_into_docs_superpowers():
    """(c)[M3] the plan is staged under `/home/exedev/plans/`, so no line both
    rsyncs and names `docs/superpowers`."""
    offenders = [
        line
        for line in read().splitlines()
        if "rsync" in line and "docs/superpowers" in line
    ]
    assert not offenders, (
        "(c)[M3] SKILL.md still rsyncs into `docs/superpowers`:\n"
        + "\n".join(offenders)
    )


# --- leg (d) [M4]: what stays ---------------------------------------------

def test_leg_d_the_pinned_base_sentences_are_still_present():
    """(d)[M4] the doctor-before-rsync sentence and the `fleet.json` defaults
    sentence — pinned by sibling repo tests — survive the rewrite. Either one
    absent fails this leg."""
    text = norm(read())
    missing = [tag for tag, s in KEPT_SENTENCES if norm(s) not in text]
    assert not missing, (
        "(d)[M4] SKILL.md dropped BASE sentence(s) "
        + ", ".join(missing)
        + ":\n"
        + "\n".join(s for tag, s in KEPT_SENTENCES if tag in missing)
    )


def test_leg_d_setup_section_matches_the_frozen_literal():
    """(d)[M4] `## Setup` reads exactly as the literal above: a change to the
    six-piece walk is a deliberate re-pin here, never a drift."""
    assert section_body("Setup").strip() == SETUP_SECTION_AT_BASE, (
        "(d)[M4] the `## Setup` section no longer matches the frozen literal; "
        "re-pin it here when the setup walk changes on purpose"
    )


def test_leg_d_validate_skill_prints_skill_ok():
    """(d)[M4] the rewritten skill still validates: frontmatter intact, every
    `references/<file>` it names resolves."""
    proc = subprocess.run(
        [sys.executable, VALIDATE, SKILL_DIR],
        cwd=ROOT, capture_output=True, text=True,
    )
    assert proc.returncode == 0, (
        f"(d)[M4] validate_skill.py exited {proc.returncode}:\n"
        f"{proc.stdout}{proc.stderr}"
    )
    assert proc.stdout.strip() == "skill ok", (
        f"(d)[M4] validate_skill.py stdout was {proc.stdout!r}, "
        "expected 'skill ok'"
    )
