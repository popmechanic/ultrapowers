"""The `--check --renders` pin measures the compiler, not the tree.

`tests/test_compile_plan_proof_tests.py` freezes `--check --renders` stdout for
the claims corpus fixture. That render reads the whole tree: its blast-radius
paragraphs list every tracked code file mentioning a task's Produces symbols,
so any file a later task adds that happens to say `make_widget`, `catalog` or
`format_size` turns the pin red for a reason that has nothing to do with the
compiler (#563). The fix this exam grades is to stop comparing the
tree-dependent lines: the pin keeps `PLAN OK` and the `ADVISORY grammar:`
lines, which are a function of the plan text alone.

Legs (a)–(f) of task 3's Proof, one test each.
"""
import ast
import hashlib
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
PINNED_REL = "tests/test_compile_plan_proof_tests.py"
PINNED = ROOT / PINNED_REL
CHECK_NODE = PINNED_REL + "::test_claims_fixture_check_renders_stdout_is_unchanged"
ENTRY_NODES = [
    PINNED_REL + "::test_claims_fixture_entries_keep_every_other_key_at_its_base_value",
    PINNED_REL + "::test_wide_fixture_entries_keep_every_other_key_at_its_base_value",
]

# The blast-radius header prefix, spelled in pieces so leg (a)'s substring
# search over the pinned file is not answered by this exam's own text.
BLAST_PREFIX = "ADVISORY " + "blast-radius:"
GRAMMAR_WORDING = "ADVISORY grammar: Context is %d words"

# SHA-256 of each assignment's source segment at BASE ae24d58. A literal
# re-recorded against fresh compiler output fails leg (f).
BASE_WAVES_DIGESTS = {
    "BASE_CLAIMS_WAVES":
        "e6b769ab3920bd9135dc8f23884e3005984ab4da545ba6b010e80f3ae1bae242",
    "BASE_WIDE_WAVES":
        "352bda3d18abaa95ea46d9ec503d990efc75b63edaa1a640962dd858bce7cfc0",
}

PROBE_REL = "probe_added_by_exam.py"
PROBE_TEXT = (
    '"""A tracked code file the exam adds to a scratch tree."""\n'
    "make_widget = None\n"
    "catalog = None\n"
    "format_size = None\n"
)


def _pinned_source():
    return PINNED.read_text()


def _assignment_segment(source, name):
    """The source text of the top-level `name = ...` assignment, sliced from
    `source` by that name alone."""
    for node in ast.parse(source).body:
        if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == name for t in node.targets):
            return ast.get_source_segment(source, node)
    raise AssertionError("no top-level assignment named %s" % name)


def _renders_helper(source):
    """The one function in the pinned file that shells out to
    `--check --renders`."""
    found = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.FunctionDef):
            continue
        seg = ast.get_source_segment(source, node) or ""
        if "--check" in seg and "--renders" in seg:
            found.append(node)
    assert len(found) == 1, (
        "expected exactly one `--check --renders` helper, found %r"
        % [n.name for n in found])
    return found[0]


def _scratch_clone(dst):
    """A git tree at `dst` holding the working-tree text of every file git
    tracks under ROOT, with all of it staged."""
    listing = subprocess.run(
        ["git", "-C", str(ROOT), "ls-files", "-z"],
        capture_output=True, text=True, check=True).stdout
    for rel in filter(None, listing.split("\0")):
        src = ROOT / rel
        if not src.is_file():
            continue
        out = dst / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, out)
    subprocess.run(["git", "-C", str(dst), "init", "-q"], check=True)
    subprocess.run(["git", "-C", str(dst), "add", "-Af"], check=True)
    return dst


def _stage(dst, rel, text):
    path = dst / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    subprocess.run(["git", "-C", str(dst), "add", "-f", rel], check=True)


def _pytest(cwd, *node_ids):
    return subprocess.run(
        [sys.executable, "-m", "pytest", "-q", *node_ids],
        cwd=str(cwd), capture_output=True, text=True)


# --- (a) the frozen literal carries no tree-dependent line [M1] -------------

def test_pinned_literal_carries_no_blast_radius_line_and_no_file_bullets():
    source = _pinned_source()
    assert BLAST_PREFIX not in source, (
        "the pinned file still freezes a tree-dependent blast-radius render")
    bullets = [ln for ln in source.splitlines()
               if re.match(r"^\s+'  - tests/", ln)]
    assert bullets == [], bullets


# --- (b) a new tracked file mentioning the symbols leaves the pin green [M2]

def test_pin_is_indifferent_to_a_newly_tracked_file_naming_the_symbols(tmp_path):
    dst = _scratch_clone(tmp_path / "tree")
    _stage(dst, PROBE_REL, PROBE_TEXT)
    p = _pytest(dst, CHECK_NODE)
    assert p.returncode == 0, p.stdout + p.stderr


# --- (c) mutated compiler wording still turns the pin red [M2] --------------

def test_pin_still_catches_a_change_to_the_grammar_advisory_wording(tmp_path):
    dst = _scratch_clone(tmp_path / "tree")
    compiler = dst / "skills/ultrapowers/scripts/compile_plan.py"
    text = compiler.read_text()
    assert GRAMMAR_WORDING in text, "compiler no longer spells %r" % GRAMMAR_WORDING
    compiler.write_text(text.replace(
        GRAMMAR_WORDING, "ADVISORY grammar: Context spans %d words"))
    p = _pytest(dst, CHECK_NODE)
    assert p.returncode != 0, p.stdout + p.stderr


# --- (d) the helper's docstring names the render's dependence and the lines -

def test_renders_helper_docstring_names_the_lines_the_pin_compares():
    doc = ast.get_docstring(_renders_helper(_pinned_source())) or ""
    assert "function of the tree" in doc, doc
    assert "PLAN OK" in doc, doc
    assert "ADVISORY grammar:" in doc, doc


# --- (e) the two entry-value pins still pass by node id [M4] ----------------

def test_both_entry_value_pins_still_pass_by_node_id():
    p = _pytest(ROOT, *ENTRY_NODES)
    assert p.returncode == 0, p.stdout + p.stderr
    assert re.search(r"(?m)^2 passed\b", p.stdout), p.stdout


# --- (f) neither waves literal was rewritten [M4] ---------------------------

def test_base_waves_literals_are_byte_identical_to_base():
    source = _pinned_source()
    got = {name: hashlib.sha256(
        _assignment_segment(source, name).encode()).hexdigest()
        for name in BASE_WAVES_DIGESTS}
    assert got == BASE_WAVES_DIGESTS
