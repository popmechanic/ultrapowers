"""The proof-gate reader reads BASE (#989) — the exam of
`skills/ultrawrite/scripts/extract_gate_input.py --base`.

One test per leg of the 2026-09-15 plan `gate-reader-reads-base`, task 1:

  (a) [M1] `--base <sha>` and `--base <dir>` add exactly one key, `base`, whose
      `rev` is the value given; the hash equals the no-`--base` hash; and the
      no-`--base` output carries no `base` key.
  (b) [M2] `files` is the Files block's paths in written order, then the
      Proof's backticked path, then the `Run:` command's path, no duplicate;
      an absent path (or a directory) is `{"path", "status": "absent"}` alone.
  (c) [M3] headings per file kind; the excerpt is the numbered carrier regions,
      ±2 lines, no line twice, no non-carrier region, no 7-character literal.
  (d) [M4] the 8,000-byte per-file cap and the 24,000-byte total cap, with
      `truncated` exactly on the entries the cap cut.
  (e) [M5] `--plan --base` is refused (exit 2, one stderr line naming --base,
      empty stdout); an unknown sha exits non-zero with an `error:` line.
  (f) [M6] the skill's proof-gate section says the new things, in order, and
      still says the Stale-if things.

The fixture is a one-commit git repository under tmp_path holding the plan
itself, so a 40-hex `--base` names a commit of the plan's own repository.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills/ultrawrite/scripts/extract_gate_input.py"
SKILL = ROOT / "skills/ultrawrite/SKILL.md"

# A 7-character literal is under the compiler's `_LITERAL_MIN` of 8; the
# nine-character one is the carrier the exam looks for.
SHORT_LIT = "sevench"
LONG_LIT = "carrier_x"
OTHER_LIT = "second_carrier"


def _git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True,
                          capture_output=True, text=True).stdout


def _plan_text(md_path, py_path, mjs_path, absent_path, dir_path,
               proof_extra, run_path):
    return f"""# A plan for the exam

**Grammar:** claims-v1

**Claim:** After this run I can see the thing. (elicited)
**Summary:** One. Two. Three.

**Goal:** the exam's fixture.

**Tech Stack:** none

**Spec:** none

**Parallelization rationale:** one task.

## Global Constraints

- none

### Task 1: The fixture task

**Type:** implementation

**Files:**
- Modify: `{md_path}`
- Modify: `{py_path}`
- Create: `{absent_path}`
- Modify: `{mjs_path}`
- Create: `{dir_path}`

**Claim:** The thing holds `{LONG_LIT}` and `{SHORT_LIT}`. (derived)
Machine: M1. The file carries `{LONG_LIT}` and `{OTHER_LIT}`.

**Authorized-by:** none

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** none.

**Proof:**
- Legs: (a) [M1] the carrier is there and `{md_path}` is read again.
- Run: cat {proof_extra}
- Run: python3 -c 'print(1)' {run_path}

**Stale-if:**
- path-absent: `{py_path}`
"""


@pytest.fixture
def repo(tmp_path):
    """A one-commit repository holding the plan and its fixture files."""
    r = tmp_path / "repo"
    r.mkdir()
    _git(r, "init", "-q", ".")
    _git(r, "config", "user.email", "exam@example.invalid")
    _git(r, "config", "user.name", "exam")

    (r / "docs").mkdir()
    (r / "docs/guide.md").write_text(
        "# Title\n\nprose\n\n## Section one\n\nmore\n\n### Deep\n\nend\n")

    py_lines = ["import os", "", "# THE FIXTURE MODULE — its banner", "",
                "def test_alpha():", "    pass", "", "def test_beta():",
                "    x = 1", "    y = 2", "    z = 3", "    w = 4",
                f"    assert {LONG_LIT} == 1", "    a = 5", "    b = 6",
                "    c = 7", f"    assert {OTHER_LIT} == 2", "    d = 8",
                "    e = 9", "    f = 10", f"    print('{SHORT_LIT}')",
                "    g = 11", "    h = 12", "    i = 13", "    j = 14",
                "    k = 15", "def not_a_test():", "    pass", ""]
    (r / "tests").mkdir()
    (r / "tests/test_mod.py").write_text("\n".join(py_lines))

    (r / "tests/sim.mjs").write_text(
        "import x from 'y'\n\ndescribe('outer', () => {\n"
        "  test('one', () => {})\n  it('two', () => {})\n})\n"
        "// ─────────────────────────────────────────\n")

    (r / "tests/extra.py").write_text(f"# extra\nq = '{LONG_LIT}'\n")
    (r / "tests/runme.sh").write_text("echo hi\n")
    (r / "adir/sub").mkdir(parents=True)
    (r / "adir/sub/keep").write_text("k\n")

    plan = r / "plan.md"
    plan.write_text(_plan_text(
        "docs/guide.md", "tests/test_mod.py", "tests/sim.mjs",
        "docs/new.md", "adir/sub", "tests/extra.py", "tests/runme.sh"))
    _git(r, "add", "-A")
    _git(r, "commit", "-qm", "fixture")
    head = _git(r, "rev-parse", "HEAD").strip()
    assert re.fullmatch(r"[0-9a-f]{40}", head)
    return r, plan, head


def run(plan, *args):
    return subprocess.run([sys.executable, str(SCRIPT), str(plan), *args],
                          capture_output=True, text=True)


def load(p):
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_a_m1_base_adds_one_key_and_keeps_the_hash(repo):
    r, plan, head = repo
    plain = load(run(plan, "--task", "1"))
    assert "base" not in plain and sorted(plain) == ["claim", "hash", "proof", "task"]
    for rev in (head, str(r)):
        d = load(run(plan, "--task", "1", "--base", rev))
        assert sorted(d) == ["base", "claim", "hash", "proof", "task"], sorted(d)
        assert d["base"]["rev"] == rev
        assert d["hash"] == plain["hash"], "(a) [M1] the hash must not change"
        assert d["claim"] == plain["claim"] and d["proof"] == plain["proof"]


def test_b_m2_files_order_and_absent_entries(repo):
    r, plan, head = repo
    d = load(run(plan, "--task", "1", "--base", head))
    paths = [f["path"] for f in d["base"]["files"]]
    assert paths == ["docs/guide.md", "tests/test_mod.py", "docs/new.md",
                     "tests/sim.mjs", "adir/sub", "tests/extra.py",
                     "tests/runme.sh"], paths
    assert len(paths) == len(set(paths)), "(b) [M2] no duplicate path"
    by = {f["path"]: f for f in d["base"]["files"]}
    assert by["docs/new.md"] == {"path": "docs/new.md", "status": "absent"}
    assert by["adir/sub"] == {"path": "adir/sub", "status": "absent"}, \
        "(b) [M2] a directory is absent"
    for p in ("docs/guide.md", "tests/test_mod.py", "tests/sim.mjs",
              "tests/extra.py", "tests/runme.sh"):
        assert by[p]["status"] == "present", p


def test_c_m3_headings_and_carrier_excerpt(repo):
    r, plan, head = repo
    d = load(run(plan, "--task", "1", "--base", head))
    by = {f["path"]: f for f in d["base"]["files"]}
    assert by["docs/guide.md"]["headings"] == ["# Title", "## Section one", "### Deep"]
    assert by["docs/guide.md"]["lines"] == 11
    assert by["tests/test_mod.py"]["headings"] == [
        "# THE FIXTURE MODULE — its banner", "def test_alpha():", "def test_beta():"]
    assert by["tests/sim.mjs"]["headings"] == [
        "  test('one', () => {})", "  it('two', () => {})"], \
        by["tests/sim.mjs"]["headings"]
    ex = by["tests/test_mod.py"]["excerpt"].splitlines()
    nums = [int(l.split(":", 1)[0]) for l in ex]
    assert nums == sorted(nums) and len(nums) == len(set(nums)), \
        "(c) [M3] ascending, no line twice"
    # LONG_LIT sits on line 13, OTHER_LIT on 17: regions 11–15 and 15–19
    # overlap on 15 and print once; SHORT_LIT (line 21) is not a carrier.
    assert nums == list(range(11, 20)), nums
    assert ex[2] == f"13:     assert {LONG_LIT} == 1"
    assert not any(SHORT_LIT in l for l in ex), "(c) [M3] a 7-char literal is not a carrier"
    assert by["docs/guide.md"]["excerpt"] == "" and by["docs/guide.md"]["truncated"] is False
    assert by["tests/extra.py"]["excerpt"] == f"1: # extra\n2: q = '{LONG_LIT}'"


def test_d_m4_caps(tmp_path):
    r = tmp_path / "repo2"
    r.mkdir()
    _git(r, "init", "-q", ".")
    _git(r, "config", "user.email", "exam@example.invalid")
    _git(r, "config", "user.name", "exam")
    (r / "t").mkdir()
    big = "\n".join(f"line {i} {LONG_LIT} " + "x" * 60 for i in range(200)) + "\n"
    (r / "t/big.py").write_text(big)          # far over 8,000 bytes of carriers
    (r / "t/small.py").write_text(f"a = '{LONG_LIT}'\n")
    for i in range(4):                        # 4 × ~8 KB crosses 24,000
        (r / f"t/fill{i}.py").write_text(big)
    plan = r / "plan.md"
    # Files: big, small, (nothing — absent), fill0, fill1 (Create:); Proof:
    # fill2 (Run: cat) and fill3 (Run: python3). Present entries in order:
    # big, small, fill0, fill1, fill2, fill3 — the total cap lands inside fill1.
    plan.write_text(_plan_text("t/big.py", "t/small.py", "t/fill0.py",
                               "t/nothing.py", "t/fill1.py", "t/fill2.py",
                               "t/fill3.py"))
    _git(r, "add", "-A")
    _git(r, "commit", "-qm", "caps")
    head = _git(r, "rev-parse", "HEAD").strip()
    d = load(run(plan, "--task", "1", "--base", head))
    by = {f["path"]: f for f in d["base"]["files"]}
    e = by["t/big.py"]["excerpt"]
    assert len(e.encode()) <= 8000 and by["t/big.py"]["truncated"] is True
    assert not e.endswith("\n") and e.splitlines()[-1].startswith(tuple("0123456789")), \
        "(d) [M4] cut at a line boundary"
    assert by["t/small.py"]["truncated"] is False
    present = [f for f in d["base"]["files"] if f["status"] == "present"]
    total = sum(len(f["excerpt"].encode()) for f in present)
    assert 23000 < total <= 24000, total
    # big (file cap), small (whole), fill0 (file cap), fill1 (the total cap
    # cuts it, non-empty), then every later entry empty and truncated.
    order = [f["path"] for f in present]
    assert order == ["t/big.py", "t/small.py", "t/fill0.py", "t/fill1.py",
                     "t/fill2.py", "t/fill3.py"], order
    assert by["t/fill0.py"]["truncated"] is True and by["t/fill0.py"]["excerpt"]
    # The entry the TOTAL cap cut keeps what fit (non-empty, truncated); every
    # later entry is empty and truncated while still carrying lines/headings.
    nonempty = [i for i, f in enumerate(present) if f["excerpt"]]
    last = nonempty[-1]
    assert last >= order.index("t/fill1.py"), "(d) [M4] the total lands past fill1"
    assert last < len(present) - 1, "(d) [M4] at least one entry after the cut"
    assert present[last]["truncated"] is True
    for f in present[last + 1:]:
        assert f["excerpt"] == "" and f["truncated"] is True, f["path"]
        assert "lines" in f and "headings" in f, f["path"]


def test_e_m5_refusals(repo):
    r, plan, head = repo
    p = run(plan, "--plan", "--base", head)
    assert p.returncode == 2 and p.stdout == "" and "--base" in p.stderr, (p.returncode, p.stderr)
    assert len(p.stderr.strip().splitlines()) == 1, p.stderr
    zeros = "0" * 40
    q = run(plan, "--task", "1", "--base", zeros)
    assert q.returncode != 0 and q.stdout == ""
    assert q.stderr.strip().startswith("error:") and zeros in q.stderr, q.stderr


def _section():
    text = SKILL.read_text()
    start = text.index("## The proof gate")
    end = text.index("## The worktree-pure contract")
    return " ".join(text[start:end].splitlines())


def test_f_m6_skill_says_it_in_order():
    flat = _section()
    assert re.search(
        r"--base <sha>.*base.*excerpt.*8000.*24000.*already pins the opposite"
        r".*does not exist.*hash.*unchanged", flat), "(f) [M6] the new sentence, in order"
    assert re.search(r"STALE fact.*refus.*unreadable.*advisory", flat), \
        "(f) [M6] the Stale-if pin still holds"


# ── extractor-and-authoring-refusals task 1 (#1025): a base that is neither a
# checkout directory nor a 40-hex sha is refused on one line, exit 2 ─────────

REFUSAL = ("extract: --base %s is not a commit this repository has — "
           "pass the 40-hex sha or a checkout directory")


@pytest.mark.parametrize("label", ["abbrev", "word"])
def test_g_m1_a_short_or_unknown_base_is_refused_on_one_line(repo, label):
    """(a) [M1]: the fixture HEAD's first 8 characters, and the word
    `notasha` — exit 2, empty stdout, exactly one stderr line, the issue's
    message with the value substituted."""
    r, plan, head = repo
    value = head[:8] if label == "abbrev" else "notasha"
    p = run(plan, "--task", "1", "--base", value)
    assert p.returncode == 2, (p.returncode, p.stderr)
    assert p.stdout == "", p.stdout
    assert p.stderr.strip().splitlines() == [REFUSAL % value], p.stderr


def test_g_m3_a_real_sha_and_a_directory_still_read_present(repo):
    """(d) [M3]: the 40-hex sha and the checkout directory both print
    `present` for a file that exists, and the hash equals the no-base diet's."""
    r, plan, head = repo
    plain = load(run(plan, "--task", "1"))
    for rev in (head, str(r)):
        d = load(run(plan, "--task", "1", "--base", rev))
        by = {f["path"]: f for f in d["base"]["files"]}
        assert by["tests/test_mod.py"]["status"] == "present", rev
        assert d["hash"] == plain["hash"], rev


def test_g_m4_the_skill_names_the_refusal():
    """(e) [M4]: the proof-gate section says a value that is neither a
    checkout directory nor a 40-hex sha is refused with exit 2, not read as
    every file absent — and the two existing pins still hold."""
    flat = _section()
    assert re.search(r"neither a checkout directory nor a 40-hex sha.*exit 2"
                     r".*every file.*absent", flat)
    assert re.search(r"--base <sha>.*base.*excerpt.*8000.*24000.*already pins the opposite"
                     r".*does not exist.*hash.*unchanged", flat)
    assert re.search(r"STALE fact.*refus.*unreadable.*advisory", flat)
