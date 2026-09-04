"""`Review: peer` is the documented review marker (#556).

`adversarial` named an attitude toward the author; `peer` names the shape —
a second independent read of the same patch. The compiler accepts both for
one release and emits `peer`; the driver's knob validator accepts all three;
the authoring docs say `peer` and no longer say `adversarial` at all.
"""
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
DRIVER = ROOT / "skills/ultrapowers/scripts/ultra_run.py"
VALIDATE_SKILL = ROOT / "skills/ultrapowers/scripts/validate_skill.py"
SKILL_MD = ROOT / "skills/ultrawrite/SKILL.md"
PLAN_MARKERS_MD = ROOT / "skills/ultrapowers/references/plan-markers.md"
REPORT_FORMAT_MD = ROOT / "skills/ultrapowers/references/report-format.md"
DEPENDENCY_ANALYSIS_MD = ROOT / "skills/ultrapowers/references/dependency-analysis.md"
ULTRADOCKET_SKILL_MD = ROOT / "skills/ultradocket/SKILL.md"
COMPILE_PLAN_TESTS = ROOT / "tests/test_compile_plan.py"
SKILLS_DIR = ROOT / "skills"

# The two code sites that keep the pre-#556 spelling on purpose: the compiler's
# alias table and the driver's knob vocabulary both name it to accept it.
LEGACY_CODE_SITES = [
    "skills/ultrapowers/scripts/compile_plan.py",
    "skills/ultrapowers/scripts/ultra_run.py",
]

sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
import ultra_run  # noqa: E402

# A legacy-grammar plan (no six-slot body) with one marked task and one
# unmarked follower — the smallest shape that exercises both emit paths.
PLAN = """# P

**Acceptance:** suite — test

### Task 1: Risky core

**Type:** implementation
**Depends-on:** none
**Review:** {value}

**Files:**
- Modify: `src/a.py`

- [ ] **Step 1: do it**

### Task 2: Quiet follower

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `src/b.py`

- [ ] **Step 1: do it**
"""

UNMARKED_PLAN = PLAN.replace("**Review:** {value}\n", "")


def sh(cmd, cwd=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)


def _args_entries(tmp_path, plan_markdown, name="plan.md"):
    """Compile plan_markdown and return the --emit-args wave entries keyed by
    task id — the single knob channel the engine reads."""
    plan = tmp_path / name
    plan.write_text(plan_markdown)
    launch = tmp_path / (name + ".launch.json")
    argsf = tmp_path / (name + ".args.json")
    p = sh([sys.executable, str(COMPILER), str(plan),
            "--emit-launch", str(launch), "--emit-args", str(argsf)])
    assert p.returncode == 0, p.stderr
    skel = json.loads(argsf.read_text())
    return {t["id"]: t for wave in skel["waves"] for t in wave}


# ── M1: the compiler accepts peer, accepts adversarial, emits peer for both ──

def test_peer_marker_emits_peer(tmp_path):
    by_id = _args_entries(tmp_path, PLAN.format(value="peer"), name="peer.md")
    assert by_id["1"]["review"] == "peer"


def test_adversarial_marker_still_compiles_and_emits_peer(tmp_path):
    by_id = _args_entries(tmp_path, PLAN.format(value="adversarial"),
                          name="adv.md")
    assert by_id["1"]["review"] == "peer"


def test_lean_marker_emits_lean(tmp_path):
    by_id = _args_entries(tmp_path, PLAN.format(value="lean"), name="lean.md")
    assert by_id["1"]["review"] == "lean"


def test_unmarked_task_emits_lean(tmp_path):
    by_id = _args_entries(tmp_path, UNMARKED_PLAN, name="unmarked.md")
    assert by_id["1"]["review"] == "lean"
    assert by_id["2"]["review"] == "lean"


def test_invalid_review_value_names_all_three_values(tmp_path):
    plan = tmp_path / "bad.md"
    plan.write_text(PLAN.format(value="paranoid"))
    p = sh([sys.executable, str(COMPILER), str(plan)])
    assert p.returncode != 0
    for value in ("peer", "adversarial", "lean"):
        assert value in p.stderr, "refusal does not name %r: %s" % (value, p.stderr)


def test_the_base_compile_plan_pin_now_expects_peer():
    """The one BASE pin this change owns: test_review_marker_emits_adversarial_slot
    asserted `adversarial`; it asserts `peer` now, and it passes."""
    src = COMPILE_PLAN_TESTS.read_text()
    body = src.split("def test_review_marker_emits_adversarial_slot(")[1]
    body = body.split("\ndef ")[0]
    assert 'review"] == "peer"' in body, body
    p = sh([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider",
            "tests/test_compile_plan.py::test_review_marker_emits_adversarial_slot"],
           cwd=ROOT)
    assert p.returncode == 0, p.stdout + p.stderr


# ── M2: the driver's knob vocabulary ────────────────────────────────────────

def test_valid_reviews_is_exactly_the_three_values():
    assert ultra_run.VALID_REVIEWS == {"lean", "adversarial", "peer"}


def _git_repo(tmp_path):
    """The driver resolves the repo root before it validates, so the knob
    check needs a real (offline, throwaway) repo to run in."""
    repo = tmp_path / "repo"
    repo.mkdir()
    for argv in (["git", "init", "-q", "-b", "main"],
                 ["git", "config", "user.email", "t@t"],
                 ["git", "config", "user.name", "t"]):
        assert sh(argv, cwd=repo).returncode == 0
    (repo / "seed.txt").write_text("seed\n")
    assert sh(["git", "add", "-A"], cwd=repo).returncode == 0
    assert sh(["git", "commit", "-qm", "base"], cwd=repo).returncode == 0
    return repo


def test_validate_knobs_accepts_a_peer_entry(tmp_path):
    repo = _git_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"waves": [[{"id": "1", "tier": None,
                                                 "review": "peer"}]]}))
    p = sh([sys.executable, str(DRIVER), "--validate-knobs", str(args_path)],
           cwd=repo)
    assert p.returncode == 0, p.stdout + p.stderr
    assert json.loads(p.stdout)["ok"] is True


# ── M4: the authoring docs say peer, and never say adversarial ──────────────

def test_authoring_docs_carry_no_adversarial():
    for doc in (SKILL_MD, PLAN_MARKERS_MD):
        hits = re.findall("adversarial", doc.read_text(), re.I)
        assert hits == [], "%s still says adversarial (%d times)" % (doc, len(hits))


def test_skill_md_documents_the_peer_marker():
    text = SKILL_MD.read_text()
    assert "**Review:** peer" in text


def test_ultrawrite_skill_still_validates():
    p = sh([sys.executable, str(VALIDATE_SKILL), "skills/ultrawrite"], cwd=ROOT)
    assert p.returncode == 0, p.stdout + p.stderr


# ── the reference docs say peer, and only the two code sites say adversarial ─

def _occurrences(path):
    """Every case-insensitive `adversarial` in path, for the failure message."""
    return re.findall("adversarial", path.read_text(), re.I)


def _review_row(text):
    """The one `tasks[].review` row of the report-format table."""
    rows = [line for line in text.splitlines()
            if line.startswith("| `tasks[].review` ")]
    assert len(rows) == 1, "expected exactly one tasks[].review row, got %r" % (rows,)
    return rows[0]


def test_report_format_review_row_documents_lean_and_peer():
    text = REPORT_FORMAT_MD.read_text()
    row = _review_row(text)
    assert "`lean` (one pass)" in row, row
    assert "`peer` (two)" in row, row
    hits = _occurrences(REPORT_FORMAT_MD)
    assert hits == [], "%s still says adversarial: %r" % (REPORT_FORMAT_MD, hits)


def test_dependency_analysis_review_knob_example_says_peer():
    text = DEPENDENCY_ANALYSIS_MD.read_text()
    assert "review: { T1: peer, default: lean }" in text
    hits = _occurrences(DEPENDENCY_ANALYSIS_MD)
    assert hits == [], "%s still says adversarial: %r" % (DEPENDENCY_ANALYSIS_MD, hits)


def test_ultradocket_skill_marks_review_peer():
    text = ULTRADOCKET_SKILL_MD.read_text()
    assert "`**Review:** peer`" in text
    hits = _occurrences(ULTRADOCKET_SKILL_MD)
    assert hits == [], "%s still says adversarial: %r" % (ULTRADOCKET_SKILL_MD, hits)


def test_only_the_two_code_sites_under_skills_say_adversarial():
    """Leg (d) widened from two authoring docs to the whole of `skills/`."""
    found = []
    for path in sorted(SKILLS_DIR.rglob("*")):
        if not path.is_file():
            continue
        # `__pycache__` is git-ignored: a .pyc is a compiled copy of a source
        # file already on this list, and it exists only if pytest ran here.
        if "__pycache__" in path.parts:
            continue
        text = path.read_bytes().decode("utf-8", "replace")
        if re.search("adversarial", text, re.I):
            found.append(str(path.relative_to(ROOT)))
    unexpected = [p for p in found if p not in LEGACY_CODE_SITES]
    assert found == LEGACY_CODE_SITES, (
        "unexpected adversarial under skills/: %r (missing: %r)"
        % (unexpected, [p for p in LEGACY_CODE_SITES if p not in found]))
