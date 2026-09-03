"""Pin (Task 3, #589 claims-v2): the three prose documents state the `Run:` proof mode.

The claim: when an author writes a plan, `skills/ultrawrite/SKILL.md` tells them a
prose task's proof is a command and not a sentence pin, and `fleet/roles/examiner.md`
says the examiner has nothing to write for a task whose Proof names no `Test:` path.
`skills/ultrapowers/references/plan-markers.md` — the runtime half of the marker
reference — carries the same three runtime facts about a `Run:` bullet: who executes
it, what event it emits, and what a non-zero exit costs.

Each test below names the Proof leg (a)-(e) and the Machine clause M1-M5 it encodes.

Reading notes.

  * Prose in these files is hard-wrapped at their own margins, so every pin compares
    whitespace-collapsed text: each word, backtick and mark of punctuation has to
    match exactly, but where the author breaks a line is free.
  * Legs (b) and (c) compare against `git show 0a3559a:` — the BASE sha, frozen as a
    literal. A read-back from `HEAD` would compare the edited file with itself and
    pass for any edit at all.
  * Leg (e)'s shouted-word counts are likewise frozen BASE literals (0/0/0 in each of
    the three files, measured at `0a3559a`), not re-read from the tree.
  * Each verbatim sentence is paired with a mutation the task names. The mutation
    assertions are what keep the pin live: a sentence that is present and a sentence
    whose negation is absent cannot both be satisfied by pasting either one.
"""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = "0a3559a"

SKILL_PATH = "skills/ultrawrite/SKILL.md"
EXAMINER_PATH = "fleet/roles/examiner.md"
MARKERS_PATH = "skills/ultrapowers/references/plan-markers.md"


def flat(text):
    """Collapse every run of whitespace to one space; wrapping is free, words are not."""
    return " ".join(text.split())


def read(rel):
    return (ROOT / rel).read_text()


def base_text(rel):
    """The file's bytes at BASE (`0a3559a`), not at HEAD."""
    done = subprocess.run(
        ["git", "show", f"{BASE}:{rel}"],
        cwd=ROOT, capture_output=True, text=True,
    )
    assert done.returncode == 0, (
        f"cannot read {rel} at BASE {BASE}: {done.stderr.strip()}"
    )
    return done.stdout


# --- the pinned sentences, verbatim from the task's Machine clauses ---------

M1_RUN_BULLET = (
    "A `Run:` bullet names a command the driver executes in the task's clone after "
    "the implementer's patch lands; its exit code and output are evidence the "
    "reviewer reads against the legs, and a non-zero exit sends the task to the fix "
    "loop."
)
M1_PROSE_TASK = (
    "A task whose deliverable is prose proves itself with `Run:` commands, never "
    "with a test that matches sentences of a document."
)
M2_SELF_REVIEW = (
    "No Proof pins a sentence of a document as its evidence; a prose task's Proof "
    "is a `Run:`."
)
M3_EXAMINER = (
    "A task whose Proof names no `Test:` path has no exam to write, and the "
    "examiner is not dispatched for it."
)
M4_MARKERS = (
    "A `Run:` bullet is executed by the driver in the task's clone after the "
    "implementer's patch; each execution is a `driver:proof-run` event, and a "
    "non-zero exit is a blocking review issue that sends the task to fix."
)

# --- the mutations each leg requires to be absent ---------------------------

# (a) `driver` -> `implementer`, one word of M1_RUN_BULLET.
M1_RUN_BULLET_MUTATED = M1_RUN_BULLET.replace(
    "the driver executes", "the implementer executes", 1
)
# (a) `never` -> `only`, one word of M1_PROSE_TASK.
M1_PROSE_TASK_MUTATED = M1_PROSE_TASK.replace("commands, never with", "commands, only with", 1)
# (b) polarity: `No Proof pins` -> `A Proof may pin`.
M2_SELF_REVIEW_MUTATED = M2_SELF_REVIEW.replace("No Proof pins", "A Proof may pin", 1)
# (c) polarity, both directions the task names.
M3_EXAMINER_MUTATIONS = (
    M3_EXAMINER.replace("has no exam", "has an exam", 1),
    M3_EXAMINER.replace("is not dispatched", "is dispatched", 1),
)
# (d) polarity, both directions the task names.
M4_MARKERS_MUTATIONS = (
    M4_MARKERS.replace("is a blocking", "is not a blocking", 1),
    M4_MARKERS.replace("executed by the driver", "executed by the implementer", 1),
)

# The three words are assembled from pieces so this file carries none of them as
# whole words: it is itself one of the files the fleet's M7 leg walks, and that leg
# fails a file that gains a shouted word against BASE. The counts stay frozen 0s.
SHOUT_WORDS = ("NEV" + "ER", "ALW" + "AYS", "MU" + "ST")
BASE_SHOUT_COUNTS = {SHOUT_WORDS[0]: 0, SHOUT_WORDS[1]: 0, SHOUT_WORDS[2]: 0}


# --- markdown structure helpers --------------------------------------------

def _heading_lines(text, pattern):
    """Indices of lines matching `pattern` outside fenced code blocks."""
    hits = []
    fenced = False
    for i, line in enumerate(text.splitlines()):
        if line.lstrip().startswith("```"):
            fenced = not fenced
            continue
        if not fenced and pattern.match(line):
            hits.append(i)
    return hits


def sections(text, pattern):
    """[(heading, whole section text)] for headings matching `pattern`, fences skipped."""
    lines = text.splitlines()
    starts = _heading_lines(text, pattern)
    out = []
    for n, start in enumerate(starts):
        end = starts[n + 1] if n + 1 < len(starts) else len(lines)
        out.append((lines[start], "\n".join(lines[start:end])))
    return out


LEVEL_2 = re.compile(r"^## ")
ANY_HEADING = re.compile(r"^#{1,6} ")


def section_starting(text, heading_prefix):
    """The one `## ` section whose heading starts with `heading_prefix`."""
    found = [
        body for heading, body in sections(text, LEVEL_2)
        if heading.startswith(heading_prefix)
    ]
    assert len(found) == 1, (
        f"expected exactly one section headed {heading_prefix!r}, found {len(found)}"
    )
    return found[0]


def proof_bullet(text):
    """The `- **Proof:**` list item of SKILL.md, up to the next `- **` bullet."""
    lines = text.splitlines()
    starts = [i for i, line in enumerate(lines) if line.startswith("- **Proof:**")]
    assert len(starts) == 1, (
        f"expected exactly one `- **Proof:**` bullet in {SKILL_PATH}, found {len(starts)}"
    )
    start = starts[0]
    end = len(lines)
    for j in range(start + 1, len(lines)):
        if lines[j].startswith("- **"):
            end = j
            break
    return "\n".join(lines[start:end])


def paragraphs(text):
    """Whitespace-collapsed paragraphs, blank-line separated, empties dropped."""
    return [flat(block) for block in re.split(r"\n\s*\n", text) if flat(block)]


# --- leg (a) / M1: the Proof bullet names the `Run:` mode -------------------

def test_leg_a_m1_proof_bullet_states_what_a_run_bullet_is():
    """(a)/M1 — the `- **Proof:**` bullet carries the M1 `Run:` sentence verbatim."""
    bullet = flat(proof_bullet(read(SKILL_PATH)))
    assert M1_RUN_BULLET in bullet, (
        f"{SKILL_PATH}'s Proof bullet does not contain, whitespace-collapsed:\n"
        f"  {M1_RUN_BULLET}\nbullet reads:\n  {bullet}"
    )


def test_leg_a_m1_proof_bullet_states_how_a_prose_task_proves_itself():
    """(a)/M1 — the same bullet carries the M1 prose-task sentence verbatim."""
    bullet = flat(proof_bullet(read(SKILL_PATH)))
    assert M1_PROSE_TASK in bullet, (
        f"{SKILL_PATH}'s Proof bullet does not contain, whitespace-collapsed:\n"
        f"  {M1_PROSE_TASK}\nbullet reads:\n  {bullet}"
    )


def test_leg_a_m1_the_one_word_mutations_are_absent():
    """(a)/M1 — `driver`->`implementer` and `never`->`only` appear nowhere in the skill.

    The driver executes a `Run:`, not the implementer; and a prose task proves itself
    *never* with a sentence match. Either mutation reverses the rule the bullet states.
    """
    skill = flat(read(SKILL_PATH))
    assert M1_RUN_BULLET_MUTATED not in skill, (
        f"{SKILL_PATH} says the implementer executes a `Run:`; the driver does"
    )
    assert M1_PROSE_TASK_MUTATED not in skill, (
        f"{SKILL_PATH} says a prose task proves itself *only* with a sentence match; "
        "M1 says never"
    )


# --- leg (b) / M2: Self-review gains the rule, two sections stay at BASE ----

def test_leg_b_m2_self_review_forbids_pinning_a_sentence():
    """(b)/M2 — the `## Self-review` list carries the M2 sentence verbatim."""
    self_review = flat(section_starting(read(SKILL_PATH), "## Self-review"))
    assert M2_SELF_REVIEW in self_review, (
        f"{SKILL_PATH}'s `## Self-review` list does not contain, whitespace-collapsed:\n"
        f"  {M2_SELF_REVIEW}"
    )


def test_leg_b_m2_the_polarity_mutation_is_absent():
    """(b)/M2 — `No Proof pins` -> `A Proof may pin` appears nowhere in the skill."""
    assert M2_SELF_REVIEW_MUTATED not in flat(read(SKILL_PATH)), (
        f"{SKILL_PATH} permits pinning a sentence of a document; M2 forbids it"
    )


def test_leg_b_m2_elicit_the_claim_section_is_its_base_text():
    """(b)/M2 — `## Elicit the claim` equals its `git show 0a3559a:` bytes, collapsed."""
    heading = "## Elicit the claim"
    now = flat(section_starting(read(SKILL_PATH), heading))
    at_base = flat(section_starting(base_text(SKILL_PATH), heading))
    assert now == at_base, (
        f"{SKILL_PATH}'s {heading!r} section changed against BASE {BASE}"
    )


def test_leg_b_m2_worktree_pure_section_is_its_base_text():
    """(b)/M2 — `## The worktree-pure contract` equals its BASE bytes, collapsed."""
    heading = "## The worktree-pure contract"
    now = flat(section_starting(read(SKILL_PATH), heading))
    at_base = flat(section_starting(base_text(SKILL_PATH), heading))
    assert now == at_base, (
        f"{SKILL_PATH}'s {heading!r} section changed against BASE {BASE}"
    )


# --- leg (c) / M3: the examiner knows when it is not dispatched -------------

def test_leg_c_m3_examiner_states_it_is_not_dispatched_without_a_test_path():
    """(c)/M3 — `fleet/roles/examiner.md` carries the M3 sentence verbatim."""
    assert M3_EXAMINER in flat(read(EXAMINER_PATH)), (
        f"{EXAMINER_PATH} does not contain, whitespace-collapsed:\n  {M3_EXAMINER}"
    )


def test_leg_c_m3_the_polarity_mutations_are_absent():
    """(c)/M3 — `has an exam` and `is dispatched` readings appear nowhere in the role."""
    examiner = flat(read(EXAMINER_PATH))
    for mutated in M3_EXAMINER_MUTATIONS:
        assert mutated not in examiner, (
            f"{EXAMINER_PATH} contains the reversed reading:\n  {mutated}"
        )


def test_leg_c_m3_the_rest_of_the_examiner_role_is_its_base_text():
    """(c)/M3 — with the added sentence removed, the role equals its BASE bytes.

    The M3 sentence may land as its own paragraph or be joined to an existing one;
    either way, taking it back out has to leave BASE's paragraphs exactly.
    """
    kept = []
    for para in paragraphs(read(EXAMINER_PATH)):
        without = flat(para.replace(M3_EXAMINER, " "))
        if without:
            kept.append(without)
    assert kept == paragraphs(base_text(EXAMINER_PATH)), (
        f"{EXAMINER_PATH} differs from BASE {BASE} beyond the one added sentence"
    )


# --- leg (d) / M4: the marker reference states the runtime -------------------

def test_leg_d_m4_a_proof_section_states_the_run_bullet_runtime():
    """(d)/M4 — a `plan-markers.md` section headed with `Proof` carries M4 verbatim."""
    text = read(MARKERS_PATH)
    proof_sections = [
        body for heading, body in sections(text, ANY_HEADING) if "Proof" in heading
    ]
    assert proof_sections, (
        f"{MARKERS_PATH} has no section whose heading contains `Proof`"
    )
    assert any(M4_MARKERS in flat(body) for body in proof_sections), (
        f"no `Proof` section of {MARKERS_PATH} contains, whitespace-collapsed:\n"
        f"  {M4_MARKERS}"
    )


def test_leg_d_m4_the_polarity_mutations_are_absent():
    """(d)/M4 — `is not a blocking` and `executed by the implementer` are absent."""
    markers = flat(read(MARKERS_PATH))
    for mutated in M4_MARKERS_MUTATIONS:
        assert mutated not in markers, (
            f"{MARKERS_PATH} contains the reversed reading:\n  {mutated}"
        )


# --- leg (e) / M5: the skill validates and nothing shouts -------------------

def test_leg_e_m5_validate_skill_prints_skill_ok():
    """(e)/M5 — `validate_skill.py skills/ultrawrite` exits 0 and prints `skill ok`."""
    done = subprocess.run(
        [sys.executable, "skills/ultrapowers/scripts/validate_skill.py", "skills/ultrawrite"],
        cwd=ROOT, capture_output=True, text=True,
    )
    assert done.returncode == 0, (
        f"validate_skill.py exited {done.returncode}:\n{done.stdout}{done.stderr}"
    )
    lines = [line for line in done.stdout.splitlines() if line.strip()]
    assert lines and lines[-1].strip() == "skill ok", (
        f"validate_skill.py printed {done.stdout!r}, not `skill ok`"
    )


def test_leg_e_m5_no_shouted_whole_word_is_added_to_the_three_files():
    """(e)/M5 — whole-word NEV/ALW/MU counts are BASE's 0, 0 and 0 in each file.

    Frozen literals measured at `0a3559a`, not a read-back: against HEAD the
    comparison is a tautology once the edit is committed.
    """
    for rel in (SKILL_PATH, EXAMINER_PATH, MARKERS_PATH):
        text = read(rel)
        counts = {
            word: len(re.findall(r"\b" + word + r"\b", text)) for word in SHOUT_WORDS
        }
        assert counts == BASE_SHOUT_COUNTS, (
            f"{rel} shouts: counts are {counts!r}, BASE {BASE} had {BASE_SHOUT_COUNTS!r}"
        )
