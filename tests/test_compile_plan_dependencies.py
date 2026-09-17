"""The plan declares its packages on one header line, and the compiler carries
them (Task 1 of the "declare the environment, not discover it" plan).

One header line beside `**Exam command:**`, read through the same
`_plan_header_value` scan every other plan-level declaration is read through:

    **Dependencies:** tailwindcss@^4 @tailwindcss/vite dev: eslint @shadcn/lint

  * `parse_dependencies(md_text)` is `None` when the header carries no such
    line, and otherwise `{"runtime": [...], "dev": [...]}` — the words before
    the first `dev:` word in order, then the words after it in order, each
    group `[]` when it is empty (M1).
  * `dependencies_violations(md_text)` is `[]` for an absent line and for a
    well-formed one, and otherwise one `dependencies:`-prefixed string per
    defect: a word that is not a package spec (`name` or `name@range`, with
    `name` matching `^(@[A-Za-z0-9_.-]+/)?[A-Za-z0-9_.-]+$` and `range`
    matching `^[A-Za-z0-9_.^~=+-]+$`), a second `dev:` word, or a line whose
    two groups are both empty (M2).
  * The compiler's stdout JSON and its `--emit-args` file each carry a
    `dependencies` key holding exactly the M1 object when the header has the
    line, and neither carries the key — absent, not null — when it does not
    (M3).
  * `--check` refuses a defective line, printing every M2 string on stderr,
    and prints `PLAN OK` for a well-formed one (M4).
  * The two authoring documents say what the line is for (M5).

Each plan below is a real claims-v1 plan written to a temp directory with the
gate-verdict record claims-v1 compiles against, hashed by the gate's own
extractor, and compiled by a subprocess — so the M3 and M4 legs read the
compiler the way the launcher does: off stdout, off the emitted args file, off
the exit code and off stderr. The M1 and M2 legs ask the two produced
functions directly, since the Interfaces slot names them as the contract later
tasks read.
"""
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
# The compiler's own probe fixture: the plan whose header has no such line, and
# so the no-key case of M3.
FIXTURE_PLAN = ROOT / "evals/fixtures/claims/plan.md"

# The module is imported, not `from`-imported, on purpose: at BASE neither
# produced name exists, and an attribute miss on an imported module reads as
# the absent implementation rather than as a broken import line.
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
import compile_plan  # noqa: E402

sys.path.insert(0, str(ROOT / "skills/ultrawrite/scripts"))
from extract_gate_input import gate_input, verdicts_path  # noqa: E402

# --------------------------------------------------------------------------- #
# The plan shape. One one-task claims-v1 body, parameterized on the single      #
# thing these legs vary: the header `**Dependencies:**` line (and, for leg (c), #
# a line in the task body instead). Everything else is the fixed grammar the    #
# compiler requires — the header with its Tech Stack line, the six body slots,  #
# a numbered Machine clause, a cited leg, a provenance tag, a predicate         #
# Stale-if. Verified at BASE: this plan checks `PLAN OK` and compiles clean     #
# with the header line and without it, so the line is inert until the           #
# implementation reads it.                                                      #
# --------------------------------------------------------------------------- #

HEAD = """# Dependency probe

**Grammar:** claims-v1

**Acceptance:** waived — exam fixture; this plan is compiled, never executed

**Claim:** An operator gets the app with its packages already installed. (elicited)

**Tech Stack:** Bun + React. Run the suite with `bun test` from the repo root.
{header_deps}"""

TASK = """
### Task 1: The sim

**Type:** implementation

**Files:**
- Modify: `fleet/tests/sim_a.mjs`
- Test: `tests/test_sim_a.py`

**Claim:** An operator running the sim sees it pass. (derived)
Machine: M1. The sim prints `PASSED`.

**Authorized-by:** the operator's decision of 2026-09-17

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** The sim is a standalone script with no registry to update.

**Proof:**
- Test: `tests/test_sim_a.py`
- The suite asserts the sim prints `PASSED`. [M1]

**Stale-if:**
- path-exists: `fleet/tests/sim_a.mjs`
{body_deps}"""

# The Claim's own line, verbatim, and the object M1 must read out of it.
CLAIM_LINE = "tailwindcss@^4 @tailwindcss/vite dev: eslint @shadcn/lint"
CLAIM_OBJECT = {"runtime": ["tailwindcss@^4", "@tailwindcss/vite"],
                "dev": ["eslint", "@shadcn/lint"]}


def make_plan(header_deps=None, body_deps=None):
    """The plan text. `header_deps` is the value after `**Dependencies:**` on
    the header line (None for a plan carrying no such line); `body_deps` is the
    same, placed in the task body below the first `### Task` heading instead."""
    def line(value):
        return "" if value is None else "\n**Dependencies:** %s\n" % value
    return (HEAD.format(header_deps=line(header_deps))
            + TASK.format(body_deps=line(body_deps)))


def write_plan(tmp_path, name, text):
    """The plan plus the gate-verdict artifact claims-v1 compiles against
    (spec §4.5), hashed by the gate's own extractor so a fixture edit re-signs
    itself rather than going stale against a hand-copied digest."""
    plan = tmp_path / name
    plan.write_text(text)
    entry = gate_input(plan, "1")
    verdicts_path(plan).write_text(json.dumps(
        {"tasks": {"1": {"hash": entry["hash"], "verdict": "pass",
                         "reason": "fixture"}},
         "tally": {"dispatched": 1, "rejected": 0}}))
    return plan


def run_compiler(plan, *flags):
    return subprocess.run([sys.executable, str(COMPILER), str(plan), *flags],
                          capture_output=True, text=True)


def compile_with_args(tmp_path, plan, stem):
    """Compile one plan with `--emit-args` (which requires `--emit-launch`) and
    return (stdout JSON, emitted args JSON). Both payloads land under
    `tmp_path`, so nothing here writes into the repository."""
    args_file = tmp_path / (stem + ".args.json")
    p = run_compiler(plan,
                     "--emit-launch", str(tmp_path / (stem + ".launch.json")),
                     "--emit-args", str(args_file))
    assert p.returncode == 0, p.stdout + p.stderr
    return json.loads(p.stdout), json.loads(args_file.read_text())


def violations(header_deps):
    """`dependencies_violations` on a plan whose header carries that value."""
    return compile_plan.dependencies_violations(make_plan(header_deps))


# ── (a) M1: the Claim's own line parses into the Claim's own object ────────
# "`parse_dependencies` on a plan whose header reads `**Dependencies:**
# tailwindcss@^4 @tailwindcss/vite dev: eslint @shadcn/lint` returns exactly
# {"runtime": [...], "dev": [...]}" — the words before the first `dev:` word
# in order as `runtime`, the words after it in order as `dev`.


def test_the_claims_line_parses_into_the_claims_object():
    """(a)/[M1]: the four packages, in order, two of them development-only."""
    assert compile_plan.parse_dependencies(
        make_plan(CLAIM_LINE)) == CLAIM_OBJECT


# ── (b) M1: an absent line, and a line that is all `dev:` ──────────────────
# "on a header with no such line it returns `None`, and on `**Dependencies:**
# dev: eslint` it returns `{"runtime": [], "dev": ["eslint"]}`" — the empty
# group is `[]`, and the whole answer is None only when the line is absent.


def test_a_header_without_the_line_parses_to_none():
    """(b)/[M1]: no line at all is None — not an empty object."""
    assert compile_plan.parse_dependencies(make_plan()) is None


def test_a_line_that_is_all_dev_has_an_empty_runtime_group():
    """(b)/[M1]: `dev:` is the only group marker, so a line that opens with it
    is legal and its runtime group is `[]`."""
    assert compile_plan.parse_dependencies(
        make_plan("dev: eslint")) == {"runtime": [], "dev": ["eslint"]}


# ── (c) M1: the line is a plan-level declaration or it is nothing ──────────
# "a line whose only occurrence is inside a task body, below the first `###
# Task` heading, returns `None`" — the header is everything before the first
# task heading, the same scan `_plan_header_value` runs.


def test_the_line_inside_a_task_body_is_not_a_declaration():
    """(c)/[M1]: the same line below the first `### Task` heading declares
    nothing — the plan parses as one with no line at all."""
    assert compile_plan.parse_dependencies(
        make_plan(header_deps=None, body_deps=CLAIM_LINE)) is None


# ── (d) M2: the clean cases raise nothing ──────────────────────────────────
# "`dependencies_violations` is `[]` for the absent line and for the
# well-formed line of leg (a)".


def test_no_line_yields_no_violations():
    """(d)/[M2]: a plan with no such line is refused nothing."""
    assert compile_plan.dependencies_violations(make_plan()) == []


def test_the_claims_line_yields_no_violations():
    """(d)/[M2]: the Claim's own four-package line is well-formed."""
    assert violations(CLAIM_LINE) == []


# ── (e) M2: a word that is not a package spec, named in the refusal ────────
# "for each of the words `a;b`, `pad@>=1`, `x*y` and `@scope` (a scope with no
# name), a line carrying that word yields one string beginning `dependencies:`
# that contains that word". A spec is `name` or `name@range`; the character
# classes are closed because the engine hands each spec to a shell as one
# single-quoted word.


def _assert_one_violation_naming(word):
    got = violations(word)
    assert len(got) == 1, got
    assert got[0].startswith("dependencies:"), got[0]
    assert word in got[0], got[0]


def test_a_shell_separator_is_not_a_package_spec():
    """(e)/[M2]: `a;b` — a `;` is not in the name class."""
    _assert_one_violation_naming("a;b")


def test_a_comparison_range_is_not_a_package_spec():
    """(e)/[M2]: `pad@>=1` — `>` is not in the range class, though `^4`,
    `~1.2`, `4.x` and `==1.0` are."""
    _assert_one_violation_naming("pad@>=1")


def test_a_glob_is_not_a_package_spec():
    """(e)/[M2]: `x*y` — a `*` is not in the name class."""
    _assert_one_violation_naming("x*y")


def test_a_scope_with_no_name_is_not_a_package_spec():
    """(e)/[M2]: `@scope` — the scope prefix only counts when a `/` and a name
    follow it."""
    _assert_one_violation_naming("@scope")


# ── (f) M2: the two structural defects of the line itself ──────────────────
# "`**Dependencies:** a dev: b dev: c` yields a string beginning
# `dependencies:` naming `dev:` twice, and `**Dependencies:** dev:` yields one
# saying the line names no package."

NAMES_NO_PACKAGE = re.compile(r"(?i)no package|empty")


def test_a_second_dev_word_is_refused():
    """(f)/[M2]: `dev:` is the one group marker, so a second occurrence is a
    defect, and the refusal names the marker."""
    got = violations("a dev: b dev: c")
    assert len(got) == 1, got
    assert got[0].startswith("dependencies:"), got[0]
    assert "dev:" in got[0], got[0]


def test_a_line_with_both_groups_empty_is_refused():
    """(f)/[M2]: `**Dependencies:** dev:` declares nothing at all — one
    refusal, saying the line names no package."""
    got = violations("dev:")
    assert len(got) == 1, got
    assert got[0].startswith("dependencies:"), got[0]
    assert NAMES_NO_PACKAGE.search(got[0]), got[0]


# ── (g) M3: both compiled payloads carry the object ────────────────────────
# "compiling the leg-(a) plan with `--emit-args`: the stdout JSON's
# `dependencies` and the args file's `dependencies` are each deep-equal to the
# leg-(a) object". The shared literal every task of this plan reads.


def test_both_compiled_payloads_carry_the_dependencies_object(tmp_path):
    """(g)/[M3]: the stdout `result` dict and the emitted args file each hold
    exactly the M1 object — one computation, two payloads, never two
    answers."""
    plan = write_plan(tmp_path, "g.md", make_plan(CLAIM_LINE))
    out, args = compile_with_args(tmp_path, plan, "g")
    assert out["dependencies"] == CLAIM_OBJECT
    assert args["dependencies"] == CLAIM_OBJECT


# ── (h) M3: a plan without the line produces the payloads BASE produces ────
# "compiling `evals/fixtures/claims/plan.md` with `--emit-args`: neither the
# stdout JSON nor the args file has a `dependencies` key" — ABSENT, not null,
# from both.


def test_a_plan_without_the_line_carries_no_such_key(tmp_path):
    """(h)/[M3]: the compiler's own probe fixture has no `**Dependencies:**`
    line, so neither payload grows a key — the args file is the one BASE
    emits."""
    out, args = compile_with_args(tmp_path, FIXTURE_PLAN, "h")
    assert "dependencies" not in out, sorted(out)
    assert "dependencies" not in args, sorted(args)


# ── (i) M4: the authoring-time verdict ─────────────────────────────────────
# "`--check` on a plan carrying `**Dependencies:** a;b` exits non-zero with
# `dependencies:` on stderr, and `--check` on the leg-(a) plan exits 0 with
# `PLAN OK` on stdout." M4 pins the channel: every M2 string prints on stderr.


def test_check_refuses_a_defective_line_on_stderr(tmp_path):
    """(i)/[M4]: a misspelled line is refused at `--check` — non-zero, with
    every M2 string for that plan on stderr, and no `PLAN OK`."""
    text = make_plan("a;b")
    plan = write_plan(tmp_path, "i1.md", text)
    p = run_compiler(plan, "--check")
    assert p.returncode != 0, p.stdout + p.stderr
    assert "PLAN OK" not in (p.stdout + p.stderr), p.stdout + p.stderr
    assert "dependencies:" in p.stderr, p.stdout + p.stderr
    # "prints every M2 string on stderr" — the sentence naming the offending
    # word among them.
    for line in compile_plan.dependencies_violations(text):
        assert line in p.stderr, (line, p.stdout + p.stderr)


def test_check_passes_the_well_formed_line(tmp_path):
    """(i)/[M4]: the refusal is the defect and nothing else about the line —
    the Claim's own four-package plan prints `PLAN OK` and exits 0."""
    plan = write_plan(tmp_path, "i2.md", make_plan(CLAIM_LINE))
    p = run_compiler(plan, "--check")
    assert p.returncode == 0, p.stdout + p.stderr
    assert p.stdout.strip() == "PLAN OK"


# ── (j) M5: the two authoring documents say what the line is for ───────────
# The Proof's three `Run:` lines, verbatim: the `**Dependencies:**` line named
# beside `**Exam command:**` in §The document of the authoring skill, with its
# `dev:` group and the rule that a package is declared there and never added by
# a task editing a manifest; and one `- **Dependencies:**` row saying the same
# for a TinyApp plan in §The two knobs.

RUN_DOCUMENT_RULE = (
    r"""sed -n '/^## The document/,/^## Task shape/p' """
    r"""skills/ultrawrite/SKILL.md | tr '\n' ' ' """
    r"""| grep -q 'Dependencies:.*dev:.*never.*manifest'""")
RUN_DOCUMENT_POSITION = (
    r"""sed -n '/^## The document/,/^## Task shape/p' """
    r"""skills/ultrawrite/SKILL.md | tr '\n' ' ' """
    r"""| grep -q 'Exam command:.*Dependencies:'""")
RUN_GREENFIELD_ROW = (
    r"""sed -n '/^## The two knobs/,/^## Why it earns/p' """
    r"""skills/ultrawrite/references/greenfield-stack.md | tr '\n' ' ' """
    r"""| grep -q 'bootstrapCmd:.*Dependencies:.*dev:'""")


def _shell(cmd):
    return subprocess.run(["bash", "-c", cmd], cwd=str(ROOT),
                          capture_output=True, text=True)


def test_skill_the_document_section_states_the_rule():
    """(j)/[M5], Run: 1 — §The document says the line carries a `dev:` group
    and that a package is never added by a task editing a manifest."""
    p = _shell(RUN_DOCUMENT_RULE)
    assert p.returncode == 0, (
        "§The document of skills/ultrawrite/SKILL.md does not say the "
        "`**Dependencies:**` line carries a `dev:` group and that a package "
        "is never added by a task editing a manifest")


def test_skill_the_document_section_places_it_beside_the_exam_command():
    """(j)/[M5], Run: 2 — and names it beside `**Exam command:**`, which is
    where the line goes."""
    p = _shell(RUN_DOCUMENT_POSITION)
    assert p.returncode == 0, (
        "§The document of skills/ultrawrite/SKILL.md does not name the "
        "`**Dependencies:**` line beside `**Exam command:**`")


def test_greenfield_reference_carries_the_dependencies_row():
    """(j)/[M5], Run: 3 — §The two knobs of the greenfield reference carries
    the `- **Dependencies:**` row beside its `bootstrapCmd:` row."""
    p = _shell(RUN_GREENFIELD_ROW)
    assert p.returncode == 0, (
        "§The two knobs of skills/ultrawrite/references/greenfield-stack.md "
        "carries no `- **Dependencies:**` row naming the `dev:` group")
