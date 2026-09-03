"""Exam for task 7 — "The RUNBOOK, the first-run walk and the README say what
the fleet now is".

Claim: a person building or reading the fleet finds no step that installs a
plugin on the golden, learns that the orchestrator checkout is the engine every
run pushes, and sees that the GitHub token has to reach every repository they
will drive.

Written at BASE 3fee7e7318168bb19a575ca4953dc51192b47ff3, before any of the
three documents were rewritten. Every test below names the Proof leg (a)-(g)
and the Machine clause (M1-M7) it encodes:

  (a)/M1  the RUNBOOK's §Golden VM build slice has no line containing
          `claude plugin`, and still carries each of M1's eight retained
          literals
  (b)/M2  the RUNBOOK contains the M2 paragraph opener and none of the four
          retired phrases
  (c)/M3  §Orchestrator VM carries the engine-pin line and the push-rule
          sentence, the latter followed within ten lines by a ```bash fence
  (d)/M4  §GitHub auth carries M4's two sentences and no longer says
          `only popmechanic/ultrapowers`
  (e)/M5  §Live W1 run carries the drive launch line, the race launch line with
          `--target <owner>/<repo> --base <sha>` after `--k 3`, an rsync line
          staging into `/home/exedev/plans/run-<fresh>/`, and no
          `--plan-from-assignment`
  (f)/M6  `first-run.md` §golden has no `plugin` and gains M6's sentence,
          §orchestrator gains M6's two sentences, and the two sentences M6
          keeps are still present
  (g)/M7  `README.md`'s `### Before your first run` subsection — and the
          `**Where it runs.**` paragraph inside it — carries M7's sentence, and
          the README with that subsection removed still hashes to the frozen
          BASE digest below

Reading note. Prose in all three files hard-wraps, so every "verbatim" check
compares whitespace-collapsed text: every word, backtick, dash, digit and mark
of punctuation has to match exactly, but where the author puts a line break is
free. Checks about *lines* (M1's `claude plugin` ban, M5's rsync destination,
M3's fence-follows-sentence) read the raw lines instead, because the leg is
about the shape of a line.

One BASE fact is frozen here as a literal, computed from `README.md` at
3fee7e7 (blob 0022e8b19a86af0f3bed524e80d466e74e7d90ff) before any edit existed:

    sha256(README.md with the `### Before your first run` subsection removed)
      = 4b8a6341ccbac8b0be02fbd932832c20c9005bd7ae7fb1a26bd144b900c17fae
"""

import hashlib
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
RUNBOOK = ROOT / "fleet" / "RUNBOOK.md"
FIRST_RUN = ROOT / "skills" / "ultrapowers" / "references" / "first-run.md"
README = ROOT / "README.md"

BASE = "3fee7e7318168bb19a575ca4953dc51192b47ff3"

# --- M1 -------------------------------------------------------------------

GOLDEN_SECTION = "Golden VM build"
M1_BANNED_ON_A_LINE = "claude plugin"
M1_RETAINED = (
    "bun.sh/install",
    "bun install --offline",
    "--break-system-packages",
    "import xdist",
    "du -sh ~/.bun/install/cache",
    "fleet-golden-next",
    "settings.json",
    "claude --version",
)

# --- M2 -------------------------------------------------------------------

M2_OPENER = "**The engine is the orchestrator checkout, pushed as `fleet-engine` (#575).**"
# The prefix of the opener that has to start a line, so that the opener really
# begins a paragraph rather than sitting mid-sentence. Short enough to survive
# any wrapping the author chooses for the rest of the opener.
M2_OPENER_LINE_PREFIX = "**The engine is the orchestrator checkout,"
M2_RETIRED = (
    "pluginInstallCommands",
    "re-installs the plugin",
    "engine under test is the pushed base",
    "--engine one-driver",
)

# --- M3 -------------------------------------------------------------------

ORCHESTRATOR_SECTION = "Orchestrator VM"
M3_ENGINE_PIN_LINE = (
    "ssh fleet-orchestrator.exe.xyz 'git -C /home/exedev/repo fetch -q origin "
    "&& git -C /home/exedev/repo checkout -q "
    "$(git -C /home/exedev/repo log -1 --format=%H origin/main "
    "-- .claude-plugin/plugin.json) "
    "&& git -C /home/exedev/repo show HEAD:.claude-plugin/plugin.json'"
)
M3_PUSH_RULE = (
    "The orchestrator shell has no GitHub push credential (the drive pushes "
    "with its own token inside `drive.mjs`), so adoption or rescue work done "
    "by hand there is fetched to the laptop over ssh and pushed from the laptop:"
)
M3_FENCE = "```bash"
M3_FENCE_WITHIN_LINES = 10

# --- M4 -------------------------------------------------------------------

GITHUB_AUTH_SECTION = "GitHub auth"
M4_SENTENCES = (
    "Repository access: every repository you will drive with `/ultrapowers`, "
    "ultrapowers itself included.",
    "A target outside the token's repository access parks the run at publish "
    "with a 403; the branch and its receipts are still pinned in the target's "
    "cache clone under `/home/exedev/targets/`.",
)
M4_RETIRED = "only popmechanic/ultrapowers"

# --- M5 -------------------------------------------------------------------

LIVE_RUN_SECTION = "Live W1 run"
M5_DRIVE_LINE = (
    "ssh -n fleet-orchestrator.exe.xyz 'mkdir -p /home/exedev/fleet-evidence "
    "&& cd /home/exedev/repo && setsid -f node fleet/drive-one.mjs "
    "/home/exedev/plans/run-<fresh>/<the-approved-plan>.md run-<fresh> "
    "--target <owner>/<repo> --base <sha> </dev/null "
    ">/home/exedev/fleet-evidence/drive-run-<fresh>.out 2>&1'"
)
M5_RACE_MARKER = "node fleet/race.mjs launch"
M5_RACE_K = "--k 3"
M5_RACE_TARGET = "--target <owner>/<repo> --base <sha>"
M5_RSYNC_DESTINATION = "/home/exedev/plans/run-<fresh>/"
M5_RETIRED = "--plan-from-assignment"

# --- M6 -------------------------------------------------------------------

M6_GOLDEN_SECTION = "golden"
M6_ORCHESTRATOR_SECTION = "orchestrator"
M6_GOLDEN_BANNED = "plugin"
M6_GOLDEN_SENTENCE = (
    "the repo clone at `/home/exedev/repo` is the engine every run checks out "
    "at the `fleet-engine` ref the orchestrator pushes"
)
M6_ORCHESTRATOR_SENTENCES = (
    "Its checkout at `/home/exedev/repo` is the engine: what is checked out "
    "there is what every run pushes to its sandbox, and the launch step pins "
    "it to the newest release on `main` first.",
    "The GitHub token it holds has to reach every repository you will drive; "
    "ultrapowers itself is one of them.",
)
M6_KEPT_SENTENCES = (
    "The golden is built by the human, one RUNBOOK step at a time, and "
    "re-checked with the doctor after each; this walk verifies, it does not build.",
    "The token is written to a 0600 file directly from the command's output, "
    "never through the clipboard, and its value is never pasted into this "
    "conversation.",
)

# --- M7 -------------------------------------------------------------------

M7_HEADING = "### Before your first run"
M7_PARAGRAPH_OPENER = "**Where it runs.**"
M7_SENTENCE = (
    "A run builds the repository you run `/ultrapowers` in and opens its pull "
    "request there; ultrapowers itself is just one such repository."
)
BASE_README_WITHOUT_SUBSECTION_SHA256 = (
    "4b8a6341ccbac8b0be02fbd932832c20c9005bd7ae7fb1a26bd144b900c17fae"
)


# --- helpers --------------------------------------------------------------


def read(path):
    assert path.is_file(), "%s is missing" % path.relative_to(ROOT)
    return path.read_text(encoding="utf-8")


def flat(text):
    """`text` with every run of whitespace collapsed to a single space."""
    return " ".join(text.split())


def heading_indexes(lines):
    """Indexes of the `## ` heading lines of `lines`, skipping fenced blocks.

    A ``` fence toggles; a `## ` line inside one is a shell comment, not a
    heading.
    """
    indexes = []
    inside_fence = False
    for index, raw in enumerate(lines):
        line = raw.rstrip("\n")
        if line.lstrip().startswith("```"):
            inside_fence = not inside_fence
            continue
        if not inside_fence and line.startswith("## "):
            indexes.append(index)
    return indexes


def headings(text):
    lines = text.splitlines(keepends=True)
    return [lines[i].rstrip("\n")[3:].strip() for i in heading_indexes(lines)]


def section_lines(path, name):
    """The lines of the `## <name>…` section of `path`: its heading up to the next.

    `name` is matched as a prefix of the heading text, so a heading that carries
    a trailing issue reference (`GitHub auth (#368) — …`) is found by the name
    the task uses for it. The prefix has to select exactly one heading.
    """
    text = read(path)
    lines = text.splitlines(keepends=True)
    indexes = heading_indexes(lines)
    titles = [lines[i].rstrip("\n")[3:].strip() for i in indexes]
    matches = [p for p, title in enumerate(titles) if title.startswith(name)]
    assert len(matches) == 1, (
        "%s must have exactly one `## ` heading beginning %r; it has %d "
        "(headings: %r)"
        % (path.relative_to(ROOT), name, len(matches), titles)
    )
    position = matches[0]
    start = indexes[position]
    end = indexes[position + 1] if position + 1 < len(indexes) else len(lines)
    return [line.rstrip("\n") for line in lines[start:end]]


def section_text(path, name):
    return "\n".join(section_lines(path, name))


# --- leg (a) [M1] ---------------------------------------------------------


def test_leg_a_m1_golden_build_has_no_line_installing_a_plugin():
    """(a)/M1 — no line of §Golden VM build contains `claude plugin`."""
    offenders = [
        (number, line)
        for number, line in enumerate(section_lines(RUNBOOK, GOLDEN_SECTION), 1)
        if M1_BANNED_ON_A_LINE in line
    ]
    assert offenders == [], (
        "fleet/RUNBOOK.md §%s still has lines containing %r (line numbers are "
        "relative to the section heading): %r"
        % (GOLDEN_SECTION, M1_BANNED_ON_A_LINE, offenders)
    )


def test_leg_a_m1_golden_build_keeps_all_eight_retained_literals():
    """(a)/M1 — each of the eight literals M1 names survives in §Golden VM build."""
    body = section_text(RUNBOOK, GOLDEN_SECTION)
    absent = [literal for literal in M1_RETAINED if literal not in body]
    assert absent == [], (
        "fleet/RUNBOOK.md §%s lost literals M1 requires it to keep: %r"
        % (GOLDEN_SECTION, absent)
    )


# --- leg (b) [M2] ---------------------------------------------------------


def test_leg_b_m2_the_runbook_carries_the_engine_paragraph_opener():
    """(b)/M2 — the RUNBOOK contains the M2 opener, verbatim."""
    assert flat(M2_OPENER) in flat(read(RUNBOOK)), (
        "fleet/RUNBOOK.md does not contain, verbatim:\n%s" % M2_OPENER
    )


def test_leg_b_m2_the_opener_begins_a_paragraph():
    """(b)/M2 — the opener starts a line, so it opens a paragraph."""
    starts = [
        line
        for line in read(RUNBOOK).splitlines()
        if line.startswith(M2_OPENER_LINE_PREFIX)
    ]
    assert starts, (
        "no line of fleet/RUNBOOK.md begins %r, so the M2 opener does not begin "
        "a paragraph" % M2_OPENER_LINE_PREFIX
    )


def test_leg_b_m2_the_runbook_carries_none_of_the_four_retired_phrases():
    """(b)/M2 — none of `pluginInstallCommands`, `re-installs the plugin`,
    `engine under test is the pushed base`, `--engine one-driver` survives."""
    body = flat(read(RUNBOOK))
    survivors = [phrase for phrase in M2_RETIRED if flat(phrase) in body]
    assert survivors == [], (
        "fleet/RUNBOOK.md still contains retired phrases: %r" % survivors
    )


# --- leg (c) [M3] ---------------------------------------------------------


def test_leg_c_m3_orchestrator_carries_the_engine_pin_line():
    """(c)/M3 — §Orchestrator VM contains the engine-pin line (collapsed)."""
    body = flat(section_text(RUNBOOK, ORCHESTRATOR_SECTION))
    assert flat(M3_ENGINE_PIN_LINE) in body, (
        "fleet/RUNBOOK.md §%s does not contain the engine-pin line:\n%s"
        % (ORCHESTRATOR_SECTION, M3_ENGINE_PIN_LINE)
    )


def test_leg_c_m3_orchestrator_keeps_the_push_rule_sentence():
    """(c)/M3 — §Orchestrator VM keeps the push-rule sentence verbatim."""
    body = flat(section_text(RUNBOOK, ORCHESTRATOR_SECTION))
    assert flat(M3_PUSH_RULE) in body, (
        "fleet/RUNBOOK.md §%s does not contain, verbatim:\n%s"
        % (ORCHESTRATOR_SECTION, M3_PUSH_RULE)
    )


def test_leg_c_m3_a_bash_fence_follows_the_push_rule_sentence():
    """(c)/M3 — a ```bash fence opens within ten lines of the sentence's end."""
    lines = section_lines(RUNBOOK, ORCHESTRATOR_SECTION)
    ends = [
        index
        for index in range(len(lines))
        if flat(M3_PUSH_RULE) in flat("\n".join(lines[max(0, index - 9): index + 1]))
    ]
    assert ends, (
        "fleet/RUNBOOK.md §%s does not contain the push-rule sentence, so no "
        "fence can follow it" % ORCHESTRATOR_SECTION
    )
    end = ends[0]
    window = lines[end + 1: end + 1 + M3_FENCE_WITHIN_LINES]
    assert any(line.strip().startswith(M3_FENCE) for line in window), (
        "no %r fence opens within %d lines after the push-rule sentence in "
        "fleet/RUNBOOK.md §%s; the lines that follow it are %r"
        % (M3_FENCE, M3_FENCE_WITHIN_LINES, ORCHESTRATOR_SECTION, window)
    )


# --- leg (d) [M4] ---------------------------------------------------------


def test_leg_d_m4_github_auth_states_both_new_sentences():
    """(d)/M4 — §GitHub auth contains M4's two sentences, verbatim."""
    body = flat(section_text(RUNBOOK, GITHUB_AUTH_SECTION))
    for sentence in M4_SENTENCES:
        assert flat(sentence) in body, (
            "fleet/RUNBOOK.md §%s does not contain, verbatim:\n%s"
            % (GITHUB_AUTH_SECTION, sentence)
        )


def test_leg_d_m4_github_auth_no_longer_scopes_the_token_to_one_repository():
    """(d)/M4 — §GitHub auth no longer says `only popmechanic/ultrapowers`."""
    body = flat(section_text(RUNBOOK, GITHUB_AUTH_SECTION))
    assert flat(M4_RETIRED) not in body, (
        "fleet/RUNBOOK.md §%s still contains %r"
        % (GITHUB_AUTH_SECTION, M4_RETIRED)
    )


# --- leg (e) [M5] ---------------------------------------------------------


def test_leg_e_m5_live_run_carries_the_drive_launch_line():
    """(e)/M5 — §Live W1 run contains the drive launch line (collapsed)."""
    body = flat(section_text(RUNBOOK, LIVE_RUN_SECTION))
    assert flat(M5_DRIVE_LINE) in body, (
        "fleet/RUNBOOK.md §%s does not contain the drive launch line:\n%s"
        % (LIVE_RUN_SECTION, M5_DRIVE_LINE)
    )


def test_leg_e_m5_the_race_line_carries_the_same_target_and_base_after_k_3():
    """(e)/M5 — the `fleet/race.mjs launch` line carries `--k 3` and then
    `--target <owner>/<repo> --base <sha>`."""
    candidates = [
        flat(line)
        for line in section_lines(RUNBOOK, LIVE_RUN_SECTION)
        if M5_RACE_MARKER in flat(line)
    ]
    assert candidates, (
        "fleet/RUNBOOK.md §%s has no line containing %r"
        % (LIVE_RUN_SECTION, M5_RACE_MARKER)
    )
    matching = [
        line
        for line in candidates
        if M5_RACE_K in line
        and M5_RACE_TARGET in line
        and line.index(M5_RACE_TARGET) > line.index(M5_RACE_K)
    ]
    assert matching, (
        "no %r line in fleet/RUNBOOK.md §%s carries %r after %r; the candidate "
        "lines are %r"
        % (
            M5_RACE_MARKER,
            LIVE_RUN_SECTION,
            M5_RACE_TARGET,
            M5_RACE_K,
            candidates,
        )
    )


def test_leg_e_m5_the_rsync_line_stages_into_the_run_plans_directory():
    """(e)/M5 — an `rsync` line's destination ends `/home/exedev/plans/run-<fresh>/`."""
    rsyncs = [
        line.strip()
        for line in section_lines(RUNBOOK, LIVE_RUN_SECTION)
        if line.strip().startswith("rsync ")
    ]
    assert rsyncs, (
        "fleet/RUNBOOK.md §%s has no line beginning `rsync `" % LIVE_RUN_SECTION
    )
    staging = [line for line in rsyncs if line.split()[-1].endswith(M5_RSYNC_DESTINATION)]
    assert staging, (
        "no `rsync` line in fleet/RUNBOOK.md §%s has a destination ending %r; "
        "its rsync lines are %r"
        % (LIVE_RUN_SECTION, M5_RSYNC_DESTINATION, rsyncs)
    )


def test_leg_e_m5_live_run_no_longer_names_plan_from_assignment():
    """(e)/M5 — §Live W1 run contains no `--plan-from-assignment`."""
    body = section_text(RUNBOOK, LIVE_RUN_SECTION)
    assert M5_RETIRED not in body, (
        "fleet/RUNBOOK.md §%s still contains %r" % (LIVE_RUN_SECTION, M5_RETIRED)
    )


# --- leg (f) [M6] ---------------------------------------------------------


def test_leg_f_m6_first_run_golden_names_no_plugin():
    """(f)/M6 — `first-run.md` §golden contains no `plugin`."""
    offenders = [
        line
        for line in section_lines(FIRST_RUN, M6_GOLDEN_SECTION)
        if M6_GOLDEN_BANNED in line
    ]
    assert offenders == [], (
        "skills/ultrapowers/references/first-run.md §%s still names %r on: %r"
        % (M6_GOLDEN_SECTION, M6_GOLDEN_BANNED, offenders)
    )


def test_leg_f_m6_first_run_golden_says_the_clone_is_the_engine():
    """(f)/M6 — §golden contains M6's golden sentence, verbatim."""
    body = flat(section_text(FIRST_RUN, M6_GOLDEN_SECTION))
    assert flat(M6_GOLDEN_SENTENCE) in body, (
        "skills/ultrapowers/references/first-run.md §%s does not contain, "
        "verbatim:\n%s" % (M6_GOLDEN_SECTION, M6_GOLDEN_SENTENCE)
    )


def test_leg_f_m6_first_run_orchestrator_states_both_sentences():
    """(f)/M6 — §orchestrator contains M6's two sentences, verbatim."""
    body = flat(section_text(FIRST_RUN, M6_ORCHESTRATOR_SECTION))
    for sentence in M6_ORCHESTRATOR_SENTENCES:
        assert flat(sentence) in body, (
            "skills/ultrapowers/references/first-run.md §%s does not contain, "
            "verbatim:\n%s" % (M6_ORCHESTRATOR_SECTION, sentence)
        )


def test_leg_f_m6_first_run_keeps_the_two_sentences_it_is_told_to_keep():
    """(f)/M6 — the build-by-hand sentence and the 0600-token sentence survive."""
    body = flat(read(FIRST_RUN))
    for sentence in M6_KEPT_SENTENCES:
        assert flat(sentence) in body, (
            "skills/ultrapowers/references/first-run.md no longer contains, "
            "verbatim:\n%s" % sentence
        )


# --- leg (g) [M7] ---------------------------------------------------------


def first_run_subsection_span(lines):
    """(start, end) line indexes of the `### Before your first run` subsection.

    It runs from its heading up to the next `## ` or `### ` heading, or to the
    end of the file.
    """
    starts = [
        index
        for index, line in enumerate(lines)
        if line.rstrip() == M7_HEADING
    ]
    assert len(starts) == 1, (
        "README.md must contain the %r heading exactly once; found %d"
        % (M7_HEADING, len(starts))
    )
    start = starts[0]
    end = len(lines)
    for index in range(start + 1, len(lines)):
        stripped = lines[index].rstrip()
        if stripped.startswith("## ") or stripped.startswith("### "):
            end = index
            break
    return start, end


def first_run_subsection(text):
    lines = text.splitlines(keepends=True)
    start, end = first_run_subsection_span(lines)
    return "".join(lines[start:end])


def without_first_run_subsection(text):
    lines = text.splitlines(keepends=True)
    start, end = first_run_subsection_span(lines)
    return "".join(lines[:start] + lines[end:])


def where_it_runs_paragraph(text):
    """The `**Where it runs.**` paragraph: its opening line up to the next blank."""
    lines = first_run_subsection(text).splitlines()
    starts = [
        index for index, line in enumerate(lines) if line.startswith(M7_PARAGRAPH_OPENER)
    ]
    assert starts, (
        "the %r subsection of README.md has no line beginning %r"
        % (M7_HEADING, M7_PARAGRAPH_OPENER)
    )
    start = starts[0]
    end = len(lines)
    for index in range(start + 1, len(lines)):
        if not lines[index].strip():
            end = index
            break
    return "\n".join(lines[start:end])


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def test_leg_g_m7_the_subsection_carries_the_new_sentence():
    """(g)/M7 — the `### Before your first run` subsection contains M7's sentence."""
    body = flat(first_run_subsection(read(README)))
    assert flat(M7_SENTENCE) in body, (
        "the %r subsection of README.md does not contain, verbatim:\n%s"
        % (M7_HEADING, M7_SENTENCE)
    )


def test_leg_g_m7_the_sentence_sits_in_the_where_it_runs_paragraph():
    """(g)/M7 — M7 puts the sentence in the `**Where it runs.**` paragraph."""
    paragraph = flat(where_it_runs_paragraph(read(README)))
    assert flat(M7_SENTENCE) in paragraph, (
        "the %r paragraph of README.md does not contain, verbatim:\n%s\n"
        "the paragraph reads:\n%s"
        % (M7_PARAGRAPH_OPENER, M7_SENTENCE, paragraph)
    )


def test_leg_g_m7_every_byte_outside_the_subsection_is_unchanged_from_base():
    """(g)/M7 — removing the subsection restores BASE 3fee7e7's README bytes."""
    reconstructed = without_first_run_subsection(read(README))
    assert digest(reconstructed) == BASE_README_WITHOUT_SUBSECTION_SHA256, (
        "README.md outside the %r subsection is not byte-identical to BASE %s: "
        "the reconstruction hashes to %s, expected %s"
        % (
            M7_HEADING,
            BASE,
            digest(reconstructed),
            BASE_README_WITHOUT_SUBSECTION_SHA256,
        )
    )


def test_leg_g_m7_the_digest_check_is_live_not_vacuous():
    """(g)/M7's control — one appended character outside the subsection moves
    the digest, so the check above can actually fail."""
    text = read(README)
    lines = text.splitlines(keepends=True)
    start, _ = first_run_subsection_span(lines)
    assert start > 0, (
        "README.md begins with the %r heading, so there is no byte outside the "
        "subsection to tamper with" % M7_HEADING
    )
    # Append one character to the last line before the subsection — outside it.
    tampered = list(lines)
    tampered[start - 1] = tampered[start - 1].rstrip("\n") + "x\n"
    assert digest(without_first_run_subsection("".join(tampered))) != (
        BASE_README_WITHOUT_SUBSECTION_SHA256
    ), (
        "the reconstruction check is vacuous: appending a character outside the "
        "%r subsection still hashes to the frozen BASE digest" % M7_HEADING
    )
