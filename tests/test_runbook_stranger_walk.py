"""Exam for task 1 — "A RUNBOOK whose first-boot script runs, in an order that works".

Claim: when I build the golden and the orchestrator from the RUNBOOK, the setup
script installs node and writes the golden's settings by itself, the orchestrator
page tells me to build the golden first, the GitHub check no longer pretends to
hide a token `gh` already masks, and the node comment says what exeuntu ships.

Written at BASE 597eda49ff198eb3b9423f9f31c4c8a676666264, where the first-boot
script still runs `apt-get` as a user who is not root, both `new` lines pass a
laptop path to a command that reads it on exe.dev's side, nothing writes the
golden's `~/.claude/settings.json`, and the GitHub check pipes through a filter
that matches nothing. Every test below names the Proof leg (a)-(g) and the
Machine clause (M1-M7) it encodes:

  (a)/M1  the heredoc body extracted from the Golden VM build's
          `cat > /tmp/fleet-golden-setup.sh <<'EOF'` … `EOF` block carries the M1
          lines as whole lines in that order, `sh -n` on the extracted script
          exits 0, the inner `JSON` heredoc body `json.loads` to the M1 object
          exactly, and no line of the file names `apt-get` without `sudo` on it
  (b)/M2  exactly two lines of the file contain `ssh exe.dev "new`, each carries
          `--setup-script=/dev/stdin` and ends with `< /tmp/fleet-golden-setup.sh`,
          and `--setup-script=/tmp/` occurs nowhere
  (c)/M3  the build-the-golden-first sentence is in the Orchestrator VM section,
          and a one-word mutation of it is not
  (d)/M4  `never recreate ~/.claude/settings.json` is gone from the file, the
          rebuild preamble states the settings sentence, and the Engine auth
          section keeps its `jq "del(` line and gains the no-op comment
  (e)/M5  exactly one line contains `gh auth status` and it is the M5 command
          exactly, `grep -v token` is absent, and the comment says `gh` masks it
  (f)/M6  the exeuntu-ships sentence is in a comment of the Golden VM build
          section, and a one-word mutation of it is not
  (g)/M7  the file still has 12 `## ` headings outside fences, still carries every
          M7 substring and sentence prefix, and its whole-word counts of the three
          shouted verbs are still BASE's 2, 0 and 0

Two BASE facts are frozen here as literals, read from `fleet/RUNBOOK.md` at
597eda4 before any edit existed:

    count of `## ` headings (outside fences) = 12
    whole-word counts of the shouted verbs   = 2, 0, 0

They are frozen rather than read back from `git show HEAD:` — once the implementer
commits, a comparison against `HEAD` compares the file with itself and passes for
any edit at all.

Reading note. Prose in this RUNBOOK wraps near column 78 and its fenced blocks
align their `#` comments to a column, so every prose pin here compares
whitespace-collapsed text: each word, dash, slash and mark of punctuation has to
match exactly, but where the author puts a line break — or how far a comment is
pushed right — is free. Prose pins also compare with backticks removed from both
sides: the task states these sentences inside code spans, which cannot carry
inner backticks, so whether the author writes ``~/.claude/settings.json`` bare or
in backticks is left to the author while every word stays pinned. A `#` at the
head of a line goes the same way: a sentence written as a comment inside a fenced
block wraps with a marker at the head of every continuation line, and the marker
is part of the wrapping. The script's own lines (leg (a)) and the command lines
(legs (b), (e)) are compared as whole lines, backticks and all.
"""

import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
RUNBOOK = ROOT / "fleet" / "RUNBOOK.md"

BASE = "597eda49ff198eb3b9423f9f31c4c8a676666264"
BASE_HEADING_COUNT = 12

GOLDEN_SECTION = "Golden VM build"
ORCHESTRATOR_SECTION = "Orchestrator VM"
ENGINE_AUTH_SECTION = "Engine auth"
GITHUB_AUTH_SECTION = "GitHub auth"
DOCTOR_SECTION = "Doctor"
LIVE_SECTION = "Live W1 run"

# --- M1 -------------------------------------------------------------------

HEREDOC_OPEN = "cat > /tmp/fleet-golden-setup.sh <<'EOF'"
HEREDOC_CLOSE = "EOF"

JSON_HEREDOC_OPEN = "cat > /home/exedev/.claude/settings.json <<'JSON'"
JSON_HEREDOC_CLOSE = "JSON"

# The whole lines the extracted script carries, in this order.
M1_SCRIPT_LINES = (
    "#!/bin/sh",
    "set -eu",
    "curl -fsSL https://deb.nodesource.com/setup_lts.x -o /tmp/nodesource-setup.sh",
    "sudo -n bash /tmp/nodesource-setup.sh",
    "sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs",
    "rm -f /tmp/nodesource-setup.sh",
    "install -d -m 700 /home/exedev/.claude",
    JSON_HEREDOC_OPEN,
    JSON_HEREDOC_CLOSE,
    "chmod 600 /home/exedev/.claude/settings.json",
)

# What the inner heredoc's body has to parse to, deep-equal.
M1_SETTINGS = {
    "env": {"CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS": "0"},
    "permissions": {"defaultMode": "bypassPermissions"},
}

# --- M2 -------------------------------------------------------------------

M2_NEW_MARKER = 'ssh exe.dev "new'
M2_STDIN_FLAG = "--setup-script=/dev/stdin"
M2_REDIRECT = "< /tmp/fleet-golden-setup.sh"
M2_LAPTOP_PATH_FLAG = "--setup-script=/tmp/"

# --- M3 -------------------------------------------------------------------

M3_SENTENCE = (
    "Build the golden first (§Golden VM build): step 1 reuses its setup script "
    "and step 2 tags it, so an orchestrator built before the golden stops at its "
    "first command."
)
# `reuses` occurs exactly once in the sentence, so the mutant differs by one word.
M3_MUTATED_WORD = ("reuses", "ignores")

# --- M4 -------------------------------------------------------------------

M4_RETIRED_PHRASE = "never recreate ~/.claude/settings.json"
M4_PREAMBLE_SENTENCE = (
    "The setup script writes ~/.claude/settings.json, so a from-scratch golden "
    "carries it; the doctor's golden row reads that file."
)
M4_JQ_LINE = 'jq "del(.env.ANTHROPIC_BASE_URL, .env.ANTHROPIC_API_KEY)"'
M4_NOOP_COMMENT = (
    "#    The file exists because the golden's setup script wrote it (§Golden VM "
    "build step 1); on a fresh golden this is a no-op."
)

# --- M5 -------------------------------------------------------------------

M5_MARKER = "gh auth status"
M5_COMMAND = (
    "ssh -n fleet-orchestrator.exe.xyz 'cd /home/exedev/repo && "
    "GH_TOKEN=$(cat /home/exedev/.fleet/github-token) gh auth status'"
)
M5_COMMENT_PHRASE = "gh prints the token masked"
M5_RETIRED_FILTER = "grep -v " + "token"

# --- M6 -------------------------------------------------------------------

M6_SENTENCE = (
    "exeuntu ships claude (Claude Code) and Shelley; node is not preinstalled, "
    "which is what the setup script is for."
)
# `ships` occurs exactly once in the sentence, so the mutant differs by one word.
M6_MUTATED_WORD = ("ships", "omits")

# --- M7 -------------------------------------------------------------------

M7_SUBSTRINGS = (
    "bun.sh/install",
    "bun install --offline",
    "--break-system-packages",
    "import xdist",
    "du -sh ~/.bun/install/cache",
    "fleet-golden-next",
    "settings.json",
    "claude --version",
)

# (section, prefix) — each sentence or line the file keeps, pinned by its opening.
M7_SECTION_PREFIXES = (
    (
        DOCTOR_SECTION,
        "`node fleet/doctor.mjs` is the read-only check of everything above",
    ),
    (
        GITHUB_AUTH_SECTION,
        "Every new target needs this token's repository access widened",
    ),
)
M7_LIVE_LINE_PREFIX = (
    "ssh -n fleet-orchestrator.exe.xyz 'mkdir -p /home/exedev/fleet-evidence && "
    "cd /home/exedev/repo && setsid -f node fleet/drive-one.mjs"
)

# The shouted words are assembled from pieces so this exam carries none of them
# as whole words itself — the repo-wide pin walks every file changed since BASE,
# this one included.
# A `#` at the head of a line: a fenced comment's marker, dropped by `prose`.
COMMENT_MARKER = re.compile(r"^[ \t]*#+[ \t]*", re.MULTILINE)

SHOUT_WORDS = ("NEV" + "ER", "ALW" + "AYS", "MU" + "ST")
BASE_SHOUT_COUNTS = {SHOUT_WORDS[0]: 2, SHOUT_WORDS[1]: 0, SHOUT_WORDS[2]: 0}


# --- helpers --------------------------------------------------------------


def read():
    return RUNBOOK.read_text(encoding="utf-8")


def lines():
    return [line.rstrip("\n") for line in read().splitlines()]


def flat(text):
    """`text` with every run of whitespace collapsed to one space."""
    return " ".join(text.split())


def prose(text):
    """The prose-pin normal form: no backticks, no comment markers, one space.

    Backticks go because the task states these sentences inside code spans, which
    cannot carry inner ones. A `#` opening a line goes because a sentence written
    as a comment inside a fenced block wraps with `#` at the head of every
    continuation line — the marker is part of the wrapping, not of the sentence.
    Both sides of every comparison are normalised the same way.
    """
    without_marks = COMMENT_MARKER.sub("", text.replace("`", ""))
    return flat(without_marks)


def comment_blocks(name):
    """The prose of each run of contiguous `#` comment lines inside `name`'s fences.

    One block per comment paragraph, so a sentence found in a block is a sentence
    the author wrote as one comment — not two neighbouring ones read together.
    """
    blocks = []
    current = []
    inside_fence = False
    for line in section_lines(name):
        if line.lstrip().startswith("```"):
            inside_fence = not inside_fence
            continue
        if inside_fence and line.lstrip().startswith("#"):
            current.append(line)
            continue
        if current:
            blocks.append(prose("\n".join(current)))
            current = []
    if current:
        blocks.append(prose("\n".join(current)))
    return blocks


def heading_indexes(raw_lines):
    """Indexes of the `## ` heading lines, skipping fenced blocks.

    A ``` fence toggles; a `## ` line inside one is a shell comment, not a heading.
    """
    indexes = []
    inside_fence = False
    for index, line in enumerate(raw_lines):
        if line.lstrip().startswith("```"):
            inside_fence = not inside_fence
            continue
        if not inside_fence and line.startswith("## "):
            indexes.append(index)
    return indexes


def headings(raw_lines):
    """The `## ` heading texts, in file order."""
    return [raw_lines[i][3:].strip() for i in heading_indexes(raw_lines)]


def section_lines(name):
    """The lines of the `## <name>…` section: its heading up to the next heading.

    `name` is matched as a prefix of the heading text, so `Engine auth` finds the
    heading carrying the `— the Max subscription…` suffix without pinning that
    suffix here. The prefix has to select exactly one heading.
    """
    raw_lines = lines()
    indexes = heading_indexes(raw_lines)
    titles = [raw_lines[i][3:].strip() for i in indexes]
    matches = [p for p, title in enumerate(titles) if title.startswith(name)]
    assert len(matches) == 1, (
        "fleet/RUNBOOK.md must have exactly one `## ` heading beginning %r; it "
        "has %d (headings: %r)" % (name, len(matches), titles)
    )
    position = matches[0]
    start = indexes[position]
    end = indexes[position + 1] if position + 1 < len(indexes) else len(raw_lines)
    return raw_lines[start:end]


def section(name):
    return "\n".join(section_lines(name))


def heredoc_body(raw_lines, opener, closer):
    """The lines between the one `opener` line and the next `closer` line.

    Both markers are matched as whole lines, ignoring indentation. Exactly one
    opener has to be present; the first `closer` after it ends the body.
    """
    opens = [i for i, line in enumerate(raw_lines) if line.strip() == opener]
    assert len(opens) == 1, (
        "expected exactly one line %r; found %d" % (opener, len(opens))
    )
    start = opens[0]
    for index in range(start + 1, len(raw_lines)):
        if raw_lines[index].strip() == closer:
            return raw_lines[start + 1:index], index
    raise AssertionError(
        "the heredoc opened by %r is never closed by a %r line" % (opener, closer)
    )


def setup_script_lines():
    """The body of the golden setup-script heredoc, from the Golden VM build section."""
    body, _ = heredoc_body(section_lines(GOLDEN_SECTION), HEREDOC_OPEN, HEREDOC_CLOSE)
    return body


def test_the_runbook_is_readable():
    assert RUNBOOK.is_file(), "fleet/RUNBOOK.md is missing"


# --- leg (a) [M1] ---------------------------------------------------------


def test_leg_a_m1_the_setup_script_carries_the_required_lines_in_order():
    """(a)/M1 — the extracted heredoc body has each M1 line, as a whole line, in order.

    Whole line, indentation aside: the line has to equal the M1 string, not merely
    contain it.

    This is the leg that makes the first-boot script run at all: `sudo -n` in
    front of every privileged command (the service runs as `exedev`), the
    nodesource script fetched to a file rather than piped into a shell that never
    gets the privilege, and the golden's `settings.json` written by the image.
    """
    body = setup_script_lines()
    stripped = [line.strip() for line in body]
    position = -1
    for expected in M1_SCRIPT_LINES:
        found = [i for i, line in enumerate(stripped) if line == expected]
        assert found, (
            "the /tmp/fleet-golden-setup.sh heredoc in fleet/RUNBOOK.md §%s has no "
            "line %r; its lines are %r" % (GOLDEN_SECTION, expected, stripped)
        )
        after = [i for i in found if i > position]
        assert after, (
            "the line %r appears in the setup script, but not after the previous "
            "required line (at index %d); the script's lines are %r"
            % (expected, position, stripped)
        )
        position = after[0]


def test_leg_a_m1_the_setup_script_starts_with_the_shebang_line():
    """(a)/M1 — the first line of the extracted script is exactly `#!/bin/sh`."""
    body = setup_script_lines()
    assert body, (
        "the /tmp/fleet-golden-setup.sh heredoc in fleet/RUNBOOK.md §%s is empty"
        % GOLDEN_SECTION
    )
    assert body[0] == M1_SCRIPT_LINES[0], (
        "the setup script's first line is %r, not %r" % (body[0], M1_SCRIPT_LINES[0])
    )


def test_leg_a_m1_the_extracted_script_parses_as_sh():
    """(a)/M1 — `sh -n` on the extracted script exits 0."""
    body = setup_script_lines()
    workdir = tempfile.mkdtemp(prefix="runbook-stranger-walk-")
    try:
        path = os.path.join(workdir, "fleet-golden-setup.sh")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("\n".join(body) + "\n")
        done = subprocess.run(["sh", "-n", path], capture_output=True)
        assert done.returncode == 0, (
            "`sh -n` on the setup script extracted from fleet/RUNBOOK.md §%s exited "
            "%d:\n%s\nthe script was:\n%s"
            % (
                GOLDEN_SECTION,
                done.returncode,
                done.stderr.decode("utf-8", "replace"),
                "\n".join(body),
            )
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def test_leg_a_m1_the_inner_heredoc_writes_exactly_the_two_settings_keys():
    """(a)/M1 — the `JSON` heredoc body `json.loads` deep-equal to the M1 object."""
    body, _ = heredoc_body(
        setup_script_lines(), JSON_HEREDOC_OPEN, JSON_HEREDOC_CLOSE
    )
    text = "\n".join(body)
    try:
        parsed = json.loads(text)
    except ValueError as error:
        raise AssertionError(
            "the settings.json heredoc body in fleet/RUNBOOK.md §%s is not JSON "
            "(%s); its body is:\n%s" % (GOLDEN_SECTION, error, text)
        )
    assert parsed == M1_SETTINGS, (
        "the settings.json the setup script writes parses to:\n%r\nexpected:\n%r"
        % (parsed, M1_SETTINGS)
    )


def test_leg_a_m1_no_line_runs_apt_get_without_sudo():
    """(a)/M1 — every line naming `apt-get` names `sudo` too.

    The first-boot service runs as `exedev`; a bare `apt-get` is the line that
    failed with `Could not open lock file … are you root?` on both new VMs.
    """
    offenders = [
        line for line in lines() if "apt-get" in line and "sudo" not in line
    ]
    assert offenders == [], (
        "fleet/RUNBOOK.md runs `apt-get` without `sudo` on these lines: %r" % offenders
    )


# --- leg (b) [M2] ---------------------------------------------------------


def new_command_lines():
    return [line for line in lines() if M2_NEW_MARKER in line]


def test_leg_b_m2_exactly_two_new_command_lines():
    """(b)/M2 — the golden's and the orchestrator's, and no third."""
    found = new_command_lines()
    assert len(found) == 2, (
        "fleet/RUNBOOK.md has %d lines containing %r, not 2: %r"
        % (len(found), M2_NEW_MARKER, found)
    )


def test_leg_b_m2_both_new_lines_pipe_the_script_through_stdin():
    """(b)/M2 — each `new` line carries `--setup-script=/dev/stdin` and ends with the redirect.

    A laptop path handed to `ssh exe.dev new` is read on exe.dev's side, where it
    does not exist; the script has to arrive on stdin.
    """
    for line in new_command_lines():
        assert M2_STDIN_FLAG in line, (
            "this `new` line does not pass %r:\n%s" % (M2_STDIN_FLAG, line)
        )
        assert line.rstrip().endswith(M2_REDIRECT), (
            "this `new` line does not end with %r:\n%s" % (M2_REDIRECT, line)
        )


def test_leg_b_m2_no_line_passes_a_laptop_path_as_the_setup_script():
    """(b)/M2 — `--setup-script=/tmp/` occurs nowhere in the file."""
    offenders = [line for line in lines() if M2_LAPTOP_PATH_FLAG in line]
    assert offenders == [], (
        "fleet/RUNBOOK.md still passes a laptop path as the setup script: %r"
        % offenders
    )


# --- leg (c) [M3] ---------------------------------------------------------


def test_leg_c_m3_the_orchestrator_section_says_build_the_golden_first():
    """(c)/M3 — §Orchestrator VM contains the M3 sentence verbatim (collapsed)."""
    body = prose(section(ORCHESTRATOR_SECTION))
    assert prose(M3_SENTENCE) in body, (
        "fleet/RUNBOOK.md §%s does not contain, verbatim:\n%s"
        % (ORCHESTRATOR_SECTION, M3_SENTENCE)
    )


def test_leg_c_m3_a_one_word_mutation_of_the_order_sentence_is_absent():
    """(c)/M3 — the control: the same sentence with one word swapped is not found."""
    original, replacement = M3_MUTATED_WORD
    assert M3_SENTENCE.count(original) == 1, (
        "this exam's mutation control is malformed: %r occurs %d times in the M3 "
        "sentence, not once" % (original, M3_SENTENCE.count(original))
    )
    mutant = prose(M3_SENTENCE.replace(original, replacement))
    assert mutant != prose(M3_SENTENCE), "the mutation control changed nothing"
    assert mutant not in prose(section(ORCHESTRATOR_SECTION)), (
        "fleet/RUNBOOK.md §%s contains the mutated sentence:\n%s"
        % (ORCHESTRATOR_SECTION, mutant)
    )


# --- leg (d) [M4] ---------------------------------------------------------


def test_leg_d_m4_the_never_recreate_claim_is_gone():
    """(d)/M4 — the file no longer says the steps never recreate the settings file.

    Compared with backticks dropped, so the phrase is caught however the path is
    marked up.
    """
    assert M4_RETIRED_PHRASE not in prose(read()), (
        "fleet/RUNBOOK.md still contains %r" % M4_RETIRED_PHRASE
    )


def test_leg_d_m4_the_rebuild_preamble_states_the_settings_sentence():
    """(d)/M4 — §Golden VM build contains the M4 preamble sentence verbatim."""
    body = prose(section(GOLDEN_SECTION))
    assert prose(M4_PREAMBLE_SENTENCE) in body, (
        "fleet/RUNBOOK.md §%s does not contain, verbatim:\n%s"
        % (GOLDEN_SECTION, M4_PREAMBLE_SENTENCE)
    )


def test_leg_d_m4_engine_auth_keeps_its_jq_line():
    """(d)/M4 — §Engine auth still carries the `jq "del(…)"` command."""
    body = flat(section(ENGINE_AUTH_SECTION))
    assert flat(M4_JQ_LINE) in body, (
        "fleet/RUNBOOK.md §%s no longer contains:\n%s"
        % (ENGINE_AUTH_SECTION, M4_JQ_LINE)
    )


def test_leg_d_m4_engine_auth_gains_the_no_op_comment():
    """(d)/M4 — §Engine auth explains that the golden's setup script wrote the file.

    The sentence has to be a comment of the section's fenced block — that is where
    the `jq` line it explains lives.
    """
    wanted = prose(M4_NOOP_COMMENT)
    blocks = comment_blocks(ENGINE_AUTH_SECTION)
    assert any(wanted in block for block in blocks), (
        "no comment of fleet/RUNBOOK.md §%s contains, verbatim:\n%s\nits comments "
        "are %r" % (ENGINE_AUTH_SECTION, M4_NOOP_COMMENT, blocks)
    )


# --- leg (e) [M5] ---------------------------------------------------------


def test_leg_e_m5_exactly_one_line_checks_gh_auth_status():
    """(e)/M5 — one line, and it is the M5 command exactly (collapsed)."""
    found = [line for line in lines() if M5_MARKER in line]
    assert len(found) == 1, (
        "fleet/RUNBOOK.md has %d lines containing %r, not 1: %r"
        % (len(found), M5_MARKER, found)
    )
    assert flat(found[0]) == flat(M5_COMMAND), (
        "the `gh auth status` line in fleet/RUNBOOK.md is:\n%s\nexpected exactly:\n%s"
        % (found[0].strip(), M5_COMMAND)
    )


def test_leg_e_m5_the_pointless_filter_is_gone():
    """(e)/M5 — the filter that matched nothing (`gh` prints `Token:` capitalised)."""
    offenders = [line for line in lines() if M5_RETIRED_FILTER in line]
    assert offenders == [], (
        "fleet/RUNBOOK.md still pipes through %r: %r" % (M5_RETIRED_FILTER, offenders)
    )


def test_leg_e_m5_the_comment_says_gh_masks_the_token():
    """(e)/M5 — §GitHub auth says `gh prints the token masked`."""
    body = prose(section(GITHUB_AUTH_SECTION))
    assert prose(M5_COMMENT_PHRASE) in body, (
        "fleet/RUNBOOK.md §%s does not contain %r"
        % (GITHUB_AUTH_SECTION, M5_COMMENT_PHRASE)
    )


# --- leg (f) [M6] ---------------------------------------------------------


def test_leg_f_m6_the_node_comment_says_what_exeuntu_ships():
    """(f)/M6 — a comment of §Golden VM build contains the M6 sentence verbatim.

    M6 puts this in step 1's comment, above the setup script it describes.
    """
    wanted = prose(M6_SENTENCE)
    blocks = comment_blocks(GOLDEN_SECTION)
    assert any(wanted in block for block in blocks), (
        "no comment of fleet/RUNBOOK.md §%s contains, verbatim:\n%s"
        % (GOLDEN_SECTION, M6_SENTENCE)
    )


def test_leg_f_m6_a_one_word_mutation_of_the_node_comment_is_absent():
    """(f)/M6 — the control: the same sentence with one word swapped is not found."""
    original, replacement = M6_MUTATED_WORD
    assert M6_SENTENCE.count(original) == 1, (
        "this exam's mutation control is malformed: %r occurs %d times in the M6 "
        "sentence, not once" % (original, M6_SENTENCE.count(original))
    )
    mutant = prose(M6_SENTENCE.replace(original, replacement))
    assert mutant != prose(M6_SENTENCE), "the mutation control changed nothing"
    assert not any(mutant in block for block in comment_blocks(GOLDEN_SECTION)), (
        "fleet/RUNBOOK.md §%s contains the mutated sentence:\n%s"
        % (GOLDEN_SECTION, mutant)
    )


# --- leg (g) [M7] ---------------------------------------------------------


def test_leg_g_m7_the_heading_count_is_unchanged_from_base():
    """(g)/M7 — 12 `## ` headings outside fences, BASE's count."""
    present = headings(lines())
    assert len(present) == BASE_HEADING_COUNT, (
        "fleet/RUNBOOK.md has %d `## ` headings, not BASE %s's %d; they are %r"
        % (len(present), BASE[:7], BASE_HEADING_COUNT, present)
    )


def test_leg_g_m7_every_kept_substring_survives():
    """(g)/M7 — each M7 substring is still somewhere in the file."""
    text = read()
    absent = [needle for needle in M7_SUBSTRINGS if needle not in text]
    assert absent == [], (
        "fleet/RUNBOOK.md lost these strings the edit had to keep: %r" % absent
    )


def test_leg_g_m7_every_kept_sentence_prefix_survives():
    """(g)/M7 — the §Doctor and §GitHub auth sentences still open as they did."""
    for name, prefix in M7_SECTION_PREFIXES:
        body = prose(section(name))
        assert prose(prefix) in body, (
            "fleet/RUNBOOK.md §%s no longer contains a sentence beginning:\n%s"
            % (name, prefix)
        )


def test_leg_g_m7_the_live_run_drive_line_survives():
    """(g)/M7 — a §Live W1 run line still begins with the `drive-one.mjs` invocation."""
    wanted = flat(M7_LIVE_LINE_PREFIX)
    candidates = [flat(line) for line in section_lines(LIVE_SECTION)]
    assert any(line.startswith(wanted) for line in candidates), (
        "no line of fleet/RUNBOOK.md §%s begins with:\n%s" % (LIVE_SECTION, wanted)
    )


def test_leg_g_m7_the_shouted_word_counts_are_the_base_counts():
    """(g)/M7 — whole-word counts of the three shouted verbs are BASE's 2, 0 and 0.

    Frozen literals, not a `git show HEAD:` read-back: against `HEAD` the
    comparison is a tautology once the edit is committed.
    """
    text = read()
    counts = {
        word: len(re.findall(r"\b" + word + r"\b", text)) for word in SHOUT_WORDS
    }
    assert counts == BASE_SHOUT_COUNTS, (
        "fleet/RUNBOOK.md's whole-word shouted counts are %r; BASE %s had %r"
        % (counts, BASE[:7], BASE_SHOUT_COUNTS)
    )
