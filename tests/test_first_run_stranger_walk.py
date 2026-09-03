"""Exam for task 2 — "The skill names the golden and the store, and pins its
launch line to the engine".

Claim: when a run is launched from a second fleet by the page, it lands on that
fleet's golden and on its own store, and the launch line can never again name a
flag `fleet/drive-one.mjs` does not have.

Written against BASE 597eda49ff198eb3b9423f9f31c4c8a676666264, where §Client's
launch line carries neither `--golden <golden>` nor `--db-dir`, the `fleet.json`
sentence names only `orchestrator` and `repoDir`, `first-run.md` says nothing
about build order or about where a from-scratch golden's
`~/.claude/settings.json` comes from, and `tests/test_launch_line_flags.py` does
not exist.

One assertion group per Proof leg; every test names its leg and its Machine
clause:

  (a) [M1] exactly one line of §Client's fenced `bash` blocks begins with the
      launch prefix, and that line — whitespace-collapsed — equals the M1 line,
      `--golden <golden> --db-dir /tmp/fleet-orch-run-<N>` and all.
  (b) [M2] both M2 sentences are whitespace-collapsed substrings of §Client, a
      one-word mutation of each is not, and the retired `fleet.json` sentence
      (the one that never names the golden) is absent from the whole file.
  (c) [M3] each M3 sentence is a whitespace-collapsed substring of its own
      `first-run.md` section — the order sentence in `## orchestrator`, the
      settings-file sentence in `## golden` — and a one-word mutation is not.
  (d) [M4] `python -m pytest -q tests/test_launch_line_flags.py` exits 0 here;
      the same command against a `mkdtemp` copy of `SKILL.md` (named by
      `ULTRAPOWERS_SKILL_MD`) whose launch line gained a flag generated at test
      time exits 1 and names that flag — once with the flag inserted straight
      after `--base <baseSha>`, once straight after the `run-<N>` positional.
  (e) [M5] `validate_skill.py skills/ultrapowers` exits 0 printing `skill ok`;
      the sha256 of §Setup's stripped body equals the digest frozen below; the
      mkdir, rsync and engine-pin lines of the launch block and the three kept
      sentences are still present; and each file's whole-word counts of the
      three shouted imperatives (see `SHOUTY`) are exactly 0, 0 and 0.

Reading notes:

  * Prose in both files wraps at the margin, so every "contains this verbatim"
    check compares runs of whitespace collapsed to one space. Per the global
    constraint, nothing else is normalised: every word, backtick, dash and mark
    of punctuation is pinned.
  * M5 annotates the §Setup body as "1750 bytes at BASE `597eda4`". The body as
    M5 defines it (heading's next line to the line before `## Client`, stripped)
    is 1756 bytes at BASE and hashes to the digest M5 gives; the digest is the
    pin, so only the digest is asserted here.
  * Leg (e) says "the four kept sentences"; M5 names three (the §Client doctor
    sentence, the `first-run.md` token sentence, the `first-run.md` golden
    sentence). All three are pinned below, alongside the three kept launch-block
    lines.

Offline: reads two committed files, runs one committed script and one committed
pytest file in a subprocess. Every temp path is a fresh `mkdtemp`, removed
before the test returns.
"""
import hashlib
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKILL_REL = "skills/ultrapowers/SKILL.md"
FIRST_RUN_REL = "skills/ultrapowers/references/first-run.md"
SKILL = ROOT / SKILL_REL
FIRST_RUN = ROOT / FIRST_RUN_REL
VALIDATE = "skills/ultrapowers/scripts/validate_skill.py"
SKILL_DIR = "skills/ultrapowers"
FLAG_PIN_REL = "tests/test_launch_line_flags.py"

# --- M1: the launch line, copied from the task text -----------------------

LAUNCH_PREFIX = (
    "ssh -n <orchestrator>.exe.xyz 'mkdir -p /home/exedev/fleet-evidence"
)
L_LAUNCH = (
    "ssh -n <orchestrator>.exe.xyz 'mkdir -p /home/exedev/fleet-evidence && "
    "cd <repoDir> && setsid -f node fleet/drive-one.mjs "
    "/home/exedev/plans/run-<N>/<plan-basename> run-<N> --target <repo> "
    "--base <baseSha> --golden <golden> --db-dir /tmp/fleet-orch-run-<N> "
    "</dev/null >/home/exedev/fleet-evidence/drive-run-<N>.out 2>&1'"
)

# --- M2: what §Client says about the fleet's names and its store ----------

CONFIG_SOURCE = (
    "The orchestrator hostname, its checkout path and the golden's name come "
    "from `~/.ultrapowers/fleet.json` (`orchestrator`, `repoDir`, `golden`); "
    "their defaults are `fleet-orchestrator`, `/home/exedev/repo` and "
    "`fleet-golden`."
)
STORE_PER_DRIVE = (
    "Every drive gets its own store directory (`--db-dir`): two drives sharing "
    "the default leave one of them blind to its own sandbox."
)
RETIRED_CONFIG_SOURCE = (
    "The orchestrator hostname and its checkout path come from "
    "`~/.ultrapowers/fleet.json` (`orchestrator`, `repoDir`); their defaults "
    "are `fleet-orchestrator` and `/home/exedev/repo`."
)

# One word changed in each: the pin is on the words, not on a lookalike.
M2_SENTENCES = [
    (
        "fleet.json names the golden",
        CONFIG_SOURCE,
        CONFIG_SOURCE.replace("and `fleet-golden`.", "and `fleet-golden-2`."),
    ),
    (
        "a store per drive",
        STORE_PER_DRIVE,
        STORE_PER_DRIVE.replace(
            "blind to its own sandbox", "blind to its own store"
        ),
    ),
]

# --- M3: the two `first-run.md` sentences, each in its own section ---------

M3_BUILD_ORDER = (
    "Build the golden first, even though the doctor lists this row above it: "
    "RUNBOOK §Orchestrator VM step 1 reuses the golden's setup script and step "
    "2 tags the golden."
)
M3_GOLDEN_SETTINGS = (
    "A from-scratch golden gets its `~/.claude/settings.json` from the setup "
    "script in RUNBOOK §Golden VM build step 1, and the doctor's golden row "
    "reads that file."
)
M3_SENTENCES = [
    (
        "orchestrator",
        "build-the-golden-first",
        M3_BUILD_ORDER,
        M3_BUILD_ORDER.replace("Build the golden first,", "Build the golden last,"),
    ),
    (
        "golden",
        "settings-from-the-setup-script",
        M3_GOLDEN_SETTINGS,
        M3_GOLDEN_SETTINGS.replace(
            "RUNBOOK §Golden VM build step 1,", "RUNBOOK §Golden VM build step 2,"
        ),
    ),
]

# --- M5: the frozen §Setup digest and everything that stays ---------------

SETUP_SHA256_AT_BASE = (
    "3519f6514af1dedc69019410a30d369c9af8a2f0fb53bdb1d48a5dda12dc1e49"
)

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
KEPT_BLOCK_LINES = [
    ("mkdir", L_MKDIR),
    ("rsync", L_RSYNC),
    ("engine pin", L_PIN),
]

KEPT_DOCTOR_SENTENCE = (
    "Before the rsync, run the doctor with `--target <repo>` and without "
    "`--probe`; a verdict other than `ready` means there is no fleet to launch "
    "on for this target — offer `/ultrapowers setup` and stop."
)
KEPT_TOKEN_SENTENCE = (
    "The token is written to a 0600 file directly from the command's output, "
    "never through the clipboard, and its value is never pasted into this "
    "conversation."
)
KEPT_GOLDEN_SENTENCE = (
    "The golden is built by the human, one RUNBOOK step at a time, and "
    "re-checked with the doctor after each; this walk verifies, it does not "
    "build."
)
KEPT_SENTENCES = [
    ("SKILL.md doctor-before-rsync", SKILL_REL, KEPT_DOCTOR_SENTENCE),
    ("first-run.md 0600 token", FIRST_RUN_REL, KEPT_TOKEN_SENTENCE),
    ("first-run.md golden-by-hand", FIRST_RUN_REL, KEPT_GOLDEN_SENTENCE),
]

# Spelled in halves (adjacent string literals concatenate) so this exam does not
# itself carry a whole-word occurrence of any of them.
SHOUTY = ("NEV" "ER", "ALW" "AYS", "MU" "ST")
SHOUTY_RE = re.compile(r"\b(" + "|".join(SHOUTY) + r")\b")


# --- helpers --------------------------------------------------------------

def norm(text):
    """Collapse runs of whitespace: prose in markdown wraps at the margin."""
    return re.sub(r"\s+", " ", text).strip()


def read(path):
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


def section_body(text, wanted, label):
    found = [body for heading, body in sections(text) if heading == wanted]
    assert len(found) == 1, (
        f"{label}: expected exactly one `## {wanted}` heading, found "
        f"{len(found)}"
    )
    return found[0]


def client_section(leg):
    return section_body(read(SKILL), "Client", f"{leg} SKILL.md")


def first_run_section(wanted, leg):
    return section_body(read(FIRST_RUN), wanted, f"{leg} first-run.md")


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


def client_bash_lines(leg):
    blocks = bash_blocks(client_section(leg))
    assert blocks, f"{leg} the `## Client` section has no fenced `bash` block"
    return [line for block in blocks for line in block.splitlines()]


def launch_lines(leg):
    """The §Client `bash` lines that begin with the M1 launch prefix."""
    return [
        line for line in client_bash_lines(leg) if line.strip().startswith(LAUNCH_PREFIX)
    ]


def the_launch_line(leg):
    lines = launch_lines(leg)
    assert len(lines) == 1, (
        f"{leg} expected exactly one line of `## Client`'s fenced `bash` "
        f"block(s) beginning `{LAUNCH_PREFIX}`, found {len(lines)}"
    )
    return lines[0].strip()


def setup_body_bytes(leg):
    """§Setup from the heading's next line to the line before `## Client`,
    stripped — the span M5 hashes."""
    lines = read(SKILL).splitlines()
    starts = [i for i, line in enumerate(lines) if line.strip() == "## Setup"]
    ends = [i for i, line in enumerate(lines) if line.strip() == "## Client"]
    assert len(starts) == 1, (
        f"{leg} SKILL.md has {len(starts)} `## Setup` headings, expected 1"
    )
    assert len(ends) == 1, (
        f"{leg} SKILL.md has {len(ends)} `## Client` headings, expected 1"
    )
    assert starts[0] < ends[0], (
        f"{leg} SKILL.md has `## Client` before `## Setup`"
    )
    return "\n".join(lines[starts[0] + 1:ends[0]]).strip().encode("utf-8")


def run_flag_pin(skill_md_override=None):
    """`python -m pytest -q tests/test_launch_line_flags.py`, optionally
    against another `SKILL.md` via `ULTRAPOWERS_SKILL_MD`."""
    env = dict(os.environ)
    env.pop("ULTRAPOWERS_SKILL_MD", None)
    if skill_md_override is not None:
        env["ULTRAPOWERS_SKILL_MD"] = str(skill_md_override)
    return subprocess.run(
        [sys.executable, "-m", "pytest", "-q", FLAG_PIN_REL],
        cwd=ROOT, capture_output=True, text=True, env=env,
    )


def mutated_skill_copy(directory, old, new, leg):
    """A copy of `SKILL.md` in `directory` whose launch line has `old`
    rewritten to `new`. Returns the copy's path."""
    text = read(SKILL)
    lines = text.splitlines()
    hits = [i for i, line in enumerate(lines) if "node fleet/drive-one.mjs" in line]
    assert len(hits) == 1, (
        f"{leg} expected exactly one `node fleet/drive-one.mjs` line in "
        f"SKILL.md, found {len(hits)}"
    )
    line = lines[hits[0]]
    assert old in line, (
        f"{leg} the launch line has no `{old}` to insert a flag after:\n{line}"
    )
    lines[hits[0]] = line.replace(old, new, 1)
    copy = pathlib.Path(directory) / "SKILL.md"
    copy.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return copy


def assert_flag_pin_rejects(old, new, flag, leg, where):
    """The flag pin, run against a mutant copy carrying `flag`, fails and names
    it."""
    directory = tempfile.mkdtemp(prefix="ultrapowers-launch-flag-")
    try:
        copy = mutated_skill_copy(directory, old, new, leg)
        proc = run_flag_pin(skill_md_override=copy)
        combined = proc.stdout + proc.stderr
        assert proc.returncode == 1, (
            f"{leg} `{FLAG_PIN_REL}` exited {proc.returncode} against a "
            f"SKILL.md whose launch line carries `{flag}` {where}; expected 1 "
            f"(a failing pytest run):\n{combined}"
        )
        assert flag in combined, (
            f"{leg} `{FLAG_PIN_REL}` failed against the {where} mutant but its "
            f"output never names `{flag}`:\n{combined}"
        )
    finally:
        shutil.rmtree(directory, ignore_errors=True)


# --- leg (a) [M1]: the launch line ----------------------------------------

def test_leg_a_exactly_one_launch_line_in_the_client_block():
    """(a)[M1] exactly one line of §Client's fenced `bash` block(s) begins with
    `ssh -n <orchestrator>.exe.xyz 'mkdir -p /home/exedev/fleet-evidence`."""
    lines = launch_lines("(a)[M1]")
    assert len(lines) == 1, (
        f"(a)[M1] `## Client`'s fenced `bash` block(s) carry {len(lines)} "
        f"lines beginning `{LAUNCH_PREFIX}`, expected exactly 1: {lines!r}"
    )


def test_leg_a_launch_line_equals_the_m1_line():
    """(a)[M1] that line, whitespace-collapsed, equals the M1 line — the
    golden and the per-run store travel in the launch, in that order."""
    line = norm(the_launch_line("(a)[M1]"))
    assert line == norm(L_LAUNCH), (
        "(a)[M1] the launch line is not the M1 line.\nexpected:\n"
        + L_LAUNCH
        + "\nfound:\n"
        + line
    )


def test_leg_a_launch_line_names_the_golden_and_a_per_run_store():
    """(a)[M1] the two flags the second fleet and the second concurrent drive
    depend on: `--golden <golden>` and `--db-dir /tmp/fleet-orch-run-<N>`."""
    line = norm(the_launch_line("(a)[M1]"))
    for fragment in ("--golden <golden>", "--db-dir /tmp/fleet-orch-run-<N>"):
        assert fragment in line, (
            f"(a)[M1] the launch line does not carry `{fragment}`:\n" + line
        )


# --- leg (b) [M2]: what §Client says --------------------------------------

def test_leg_b_client_names_the_golden_among_the_configured_values():
    """(b)[M2] the `fleet.json` sentence names `golden` and its default
    alongside `orchestrator` and `repoDir`."""
    assert norm(CONFIG_SOURCE) in norm(client_section("(b)[M2]")), (
        "(b)[M2] `## Client` does not contain, verbatim:\n" + CONFIG_SOURCE
    )


def test_leg_b_client_says_every_drive_gets_its_own_store():
    """(b)[M2] the store sentence states the cost of sharing the default:
    one drive blind to its own sandbox."""
    assert norm(STORE_PER_DRIVE) in norm(client_section("(b)[M2]")), (
        "(b)[M2] `## Client` does not contain, verbatim:\n" + STORE_PER_DRIVE
    )


def test_leg_b_one_word_mutations_of_the_two_sentences_are_absent():
    """(b)[M2] each pin is on the sentence's words: a one-word mutation of
    either is not in §Client."""
    body = norm(client_section("(b)[M2]"))
    for tag, original, mutated in M2_SENTENCES:
        assert norm(mutated) != norm(original), (
            f"(b)[M2] the {tag} control is not a mutation of its sentence"
        )
        assert norm(mutated) not in body, (
            f"(b)[M2] `## Client` carries the mutated {tag} sentence:\n"
            + mutated
        )


def test_leg_b_the_retired_fleet_json_sentence_is_gone():
    """(b)[M2] the BASE sentence — the one that never names the golden — is
    absent from SKILL.md: it was replaced, not duplicated."""
    assert norm(RETIRED_CONFIG_SOURCE) not in norm(read(SKILL)), (
        "(b)[M2] SKILL.md still contains the retired sentence:\n"
        + RETIRED_CONFIG_SOURCE
    )


# --- leg (c) [M3]: the two `first-run.md` sentences -----------------------

def test_leg_c_orchestrator_section_gives_the_build_order():
    """(c)[M3] `## orchestrator` says to build the golden first and why —
    step 1 reuses the golden's setup script, step 2 tags the golden."""
    body = norm(first_run_section("orchestrator", "(c)[M3]"))
    assert norm(M3_BUILD_ORDER) in body, (
        "(c)[M3] `## orchestrator` does not contain, verbatim:\n"
        + M3_BUILD_ORDER
    )


def test_leg_c_golden_section_says_where_settings_json_comes_from():
    """(c)[M3] `## golden` names the setup script a from-scratch golden's
    `~/.claude/settings.json` comes from, and the row that reads it."""
    body = norm(first_run_section("golden", "(c)[M3]"))
    assert norm(M3_GOLDEN_SETTINGS) in body, (
        "(c)[M3] `## golden` does not contain, verbatim:\n" + M3_GOLDEN_SETTINGS
    )


def test_leg_c_each_sentence_sits_in_its_own_section():
    """(c)[M3] both sentences are in the section M3 names, and a one-word
    mutation of neither is."""
    for heading, tag, original, mutated in M3_SENTENCES:
        body = norm(first_run_section(heading, "(c)[M3]"))
        assert norm(original) in body, (
            f"(c)[M3] `## {heading}` does not contain the {tag} sentence, "
            "verbatim:\n" + original
        )
        assert norm(mutated) != norm(original), (
            f"(c)[M3] the {tag} control is not a mutation of its sentence"
        )
        assert norm(mutated) not in body, (
            f"(c)[M3] `## {heading}` carries the mutated {tag} sentence:\n"
            + mutated
        )


# --- leg (d) [M4]: the CI pin on the launch line's flags -------------------

def test_leg_d_flag_pin_passes_here():
    """(d)[M4] `pytest -q tests/test_launch_line_flags.py` exits 0 in this
    tree: every `--flag` the page names is in `drive-one.mjs`'s `usage()`."""
    proc = run_flag_pin()
    assert proc.returncode == 0, (
        f"(d)[M4] `{FLAG_PIN_REL}` exited {proc.returncode}, expected 0:\n"
        f"{proc.stdout}{proc.stderr}"
    )


def test_leg_d_flag_pin_catches_a_flag_added_after_base():
    """(d)[M4] against a copy whose launch line gained a flag straight after
    `--base <baseSha>`, the pin fails and names the generated flag."""
    flag = "--probe-" + uuid.uuid4().hex
    assert_flag_pin_rejects(
        "--base <baseSha>",
        f"--base <baseSha> {flag} x",
        flag,
        "(d)[M4]",
        "after `--base <baseSha>`",
    )


def test_leg_d_flag_pin_catches_a_flag_added_after_the_run_id():
    """(d)[M4] the pin reads the whole launch line, not its tail: the same
    generated flag inserted straight after the `run-<N>` positional also
    fails."""
    flag = "--probe-" + uuid.uuid4().hex
    assert_flag_pin_rejects(
        "run-<N> --target",
        f"run-<N> {flag} x --target",
        flag,
        "(d)[M4]",
        "after the `run-<N>` positional",
    )


def test_leg_d_flag_pin_reads_the_skill_md_the_environment_names():
    """(d)[M4] `ULTRAPOWERS_SKILL_MD` is what makes the two mutants above
    checkable: pointed at an unmodified copy, the pin still passes."""
    directory = tempfile.mkdtemp(prefix="ultrapowers-launch-flag-")
    try:
        copy = pathlib.Path(directory) / "SKILL.md"
        copy.write_text(read(SKILL), encoding="utf-8")
        proc = run_flag_pin(skill_md_override=copy)
        assert proc.returncode == 0, (
            f"(d)[M4] `{FLAG_PIN_REL}` exited {proc.returncode} against an "
            "unmodified copy named by `ULTRAPOWERS_SKILL_MD`, expected 0:\n"
            f"{proc.stdout}{proc.stderr}"
        )
    finally:
        shutil.rmtree(directory, ignore_errors=True)


# --- leg (e) [M5]: what does not move -------------------------------------

def test_leg_e_validate_skill_prints_skill_ok():
    """(e)[M5] the edited skill still validates."""
    proc = subprocess.run(
        [sys.executable, VALIDATE, SKILL_DIR],
        cwd=ROOT, capture_output=True, text=True,
    )
    assert proc.returncode == 0, (
        f"(e)[M5] validate_skill.py exited {proc.returncode}:\n"
        f"{proc.stdout}{proc.stderr}"
    )
    assert proc.stdout.strip() == "skill ok", (
        f"(e)[M5] validate_skill.py stdout was {proc.stdout!r}, expected "
        "'skill ok'"
    )


def test_leg_e_setup_section_digest_is_unchanged():
    """(e)[M5] §Setup does not change in this task: the sha256 of its stripped
    body equals the digest frozen from BASE 597eda4."""
    body = setup_body_bytes("(e)[M5]")
    digest = hashlib.sha256(body).hexdigest()
    assert digest == SETUP_SHA256_AT_BASE, (
        f"(e)[M5] the `## Setup` body hashes to {digest} ({len(body)} bytes), "
        f"expected the BASE digest {SETUP_SHA256_AT_BASE}"
    )


def test_leg_e_the_three_kept_launch_block_lines_are_unchanged():
    """(e)[M5] the mkdir, rsync and engine-pin lines of the launch block
    survive: only the drive line changes."""
    lines = [norm(line) for line in client_bash_lines("(e)[M5]")]
    for tag, line in KEPT_BLOCK_LINES:
        assert norm(line) in lines, (
            f"(e)[M5] `## Client`'s fenced `bash` block(s) no longer carry the "
            f"{tag} line, verbatim:\n" + line
        )


def test_leg_e_the_kept_sentences_are_still_present():
    """(e)[M5] the doctor-before-rsync sentence in SKILL.md and the token and
    golden sentences in first-run.md — each pinned by an existing exam —
    survive this task."""
    text = {SKILL_REL: norm(read(SKILL)), FIRST_RUN_REL: norm(read(FIRST_RUN))}
    missing = [
        (tag, rel, sentence)
        for tag, rel, sentence in KEPT_SENTENCES
        if norm(sentence) not in text[rel]
    ]
    assert not missing, (
        f"(e)[M5] {len(missing)} kept sentence(s) dropped; the first is "
        f"{missing[0][0]} in {missing[0][1]}, verbatim:\n" + missing[0][2]
    )


def test_leg_e_neither_file_shouts():
    """(e)[M5] each file's whole-word counts of the three shouted imperatives
    (see `SHOUTY`) are exactly 0, 0 and 0 — the counts at BASE 597eda4."""
    for path, rel in ((SKILL, SKILL_REL), (FIRST_RUN, FIRST_RUN_REL)):
        text = read(path)
        counts = {word: len(re.findall(r"\b" + word + r"\b", text)) for word in SHOUTY}
        assert counts == {word: 0 for word in SHOUTY}, (
            f"(e)[M5] {rel} carries shouted whole-word imperative(s): "
            + ", ".join(f"{word}={n}" for word, n in counts.items() if n)
        )
