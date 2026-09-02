"""`pin_base_facts.py`: a task's BASE facts are generated, not typed (#555).

A claims-v1 plan names referents — paths, `path:line` sites, symbols. Under the
map of #551 a plan may name nothing it does not Produce/Consume *outside a
generated block*, so the block has to be machine-written from the tree at BASE:
path, symbol, first line, blob sha. This module pins the four machine clauses —
print (M1), `--write` (M2), `--verify` (M3), and the legacy-plan exit (M4).

Every fixture repo is built here, so every sha the tests assert is the test's
own; nothing reads the network.
"""
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills/ultrawrite/scripts/pin_base_facts.py"
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
CLAIMS_FIXTURE = ROOT / "evals/fixtures/claims/plan.md"
LEGACY_FIXTURE = ROOT / "evals/fixtures/wide/plan.md"

sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
from compile_plan import (  # noqa: E402
    parse_claims_body,
    split_tasks,
    verdicts_path,
)

# `pkg/a.py`, four lines: line 2 defines `alpha`, line 3 is a comment longer
# than the 60-character quote cap, line 4 defines `alpha` a SECOND time (the
# pin takes the first definition, not the last).
LONG_COMMENT = ("# a comment deliberately longer than sixty characters, so the "
                "pinned quote is truncated")
A_PY = "import os\ndef alpha():\n%s\ndef alpha():\n" % LONG_COMMENT
# The note mentions `alpha` in an indented code block and sorts BEFORE
# `pkg/a.py` in `git ls-files` order: without the code-file pathspec it would
# win the symbol search.
N_MD = "# Note\n\nThe alpha helper lives in the package:\n\n    def alpha():\n"


def git(repo, *args):
    p = subprocess.run(["git", "-C", str(repo), *args],
                       capture_output=True, text=True)
    assert p.returncode == 0, "git %s failed: %s" % (" ".join(args), p.stderr)
    return p.stdout


def commit(repo, files, msg="c"):
    """Write/delete `files` ({relpath: text or None}) and commit them."""
    for rel, text in files.items():
        p = repo / rel
        if text is None:
            p.unlink()
            continue
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", msg)


def new_repo(tmp_path, name="repo"):
    """A throwaway checkout holding `pkg/a.py` and `docs/n.md`, committed."""
    repo = tmp_path / name
    repo.mkdir()
    git(repo, "init", "-q")
    git(repo, "config", "user.email", "pin@example.com")
    git(repo, "config", "user.name", "Pin Test")
    commit(repo, {"pkg/a.py": A_PY, "docs/n.md": N_MD}, "base")
    return repo


def sha7(repo, path, rev="HEAD"):
    return git(repo, "rev-parse", "%s:%s" % (rev, path)).strip()[:7]


def base7(repo):
    return git(repo, "rev-parse", "HEAD").strip()[:7]


PLAN_TEMPLATE = """# Alpha Plan

**Grammar:** claims-v1

**Acceptance:** waived — pinning fixture; this plan is compiled, never executed

**Goal:** Two tasks over a two-file tree, so the pinner has referents to resolve.

---

### Task 1: The second helper

**Type:** implementation

**Files:**
- Create: `pkg/b.py`
- Test: `tests/test_b.py`

**Claim:** An operator calling the second helper gets the answer the first one
gives. (elicited)
Machine: M1. the second helper returns 1.

**Authorized-by:** #489

**Interfaces:**
- Consumes: nothing
- Produces: the second helper

**Context:** %s

**Proof:**
- Test: `tests/test_b.py`
- Leg: (a) the second helper returns 1, and returns nothing else [M1].

**Stale-if:**
- issue-closed: #489

### Task 2: The note beside it

**Type:** implementation

**Files:**
- Create: `pkg/c.py`
- Test: `tests/test_c.py`

**Claim:** An operator reading the note sees the comment it describes. (elicited)
Machine: M1. the third helper returns 2.

**Authorized-by:** #489

**Interfaces:**
- Consumes: nothing
- Produces: the third helper

**Context:** %s

**Proof:**
- Test: `tests/test_c.py`
- Leg: (a) the third helper returns 2, and returns nothing else [M1].

**Stale-if:**
- issue-closed: #489
"""

CTX1 = ("The definition to copy is at `pkg/a.py:2`, the note describing it is "
        "`docs/n.md`, the symbol is `alpha`, and the file to write beside it is "
        "`ghost/x.py`.")
CTX2 = "The comment to quote is at `pkg/a.py:3`."


def write_plan(tmp_path, ctx1=CTX1, ctx2=CTX2, name="plan.md"):
    plan = tmp_path / name
    plan.write_text(PLAN_TEMPLATE % (ctx1, ctx2))
    sign(plan)
    return plan


def sign(plan):
    """An all-pass gate-verdict record beside `plan`, keyed on live hashes —
    what `--check` needs before it will say `PLAN OK` about a claims-v1 plan."""
    tasks = split_tasks(plan.read_text())
    record = {"tasks": {}, "tally": {"dispatched": len(tasks), "rejected": 0}}
    for t in tasks:
        claims = parse_claims_body(t["body"], t["id"])
        h = hashlib.sha256(
            (claims["claim"] + "\x00" + claims["proof"]).encode("utf-8")).hexdigest()
        record["tasks"][t["id"]] = {"hash": h, "verdict": "pass",
                                    "reason": "fixture"}
    verdicts_path(plan).write_text(json.dumps(record, indent=2) + "\n")


def pin(plan, base, *extra):
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(plan), "--base", str(base)] + list(extra),
        capture_output=True, text=True)


def paragraphs(stdout):
    """The printed blocks, blank-line separated, trailing newline dropped."""
    return [p.strip("\n") for p in stdout.split("\n\n") if p.strip()]


def contexts(plan):
    return [parse_claims_body(t["body"], t["id"])["context"]
            for t in split_tasks(plan.read_text())]


def stale_lines(stdout):
    return [l for l in stdout.splitlines() if l.startswith("stale:")]


# --------------------------------------------------------------------------- #
# (a) M1 — the printed block                                                   #
# --------------------------------------------------------------------------- #
def test_print_pins_every_resolving_referent_in_task_order(tmp_path):
    repo = new_repo(tmp_path)
    plan = write_plan(tmp_path)
    r = pin(plan, repo)
    assert r.returncode == 0, r.stderr
    blocks = paragraphs(r.stdout)
    assert len(blocks) == 2, r.stdout

    a7, n7 = sha7(repo, "pkg/a.py"), sha7(repo, "docs/n.md")
    assert blocks[0] == "\n".join([
        "**BASE facts:** (generated at %s)" % base7(repo),
        "- `pkg/a.py:2` blob %s line 2 `def alpha():`" % a7,
        "- `docs/n.md` blob %s" % n7,
        "- `alpha` at `pkg/a.py:2` blob %s" % a7,
    ])
    assert "ghost" not in r.stdout

    quoted = LONG_COMMENT[:60]
    assert len(quoted) == 60
    assert blocks[1] == "\n".join([
        "**BASE facts:** (generated at %s)" % base7(repo),
        "- `pkg/a.py:3` blob %s line 3 `%s`" % (a7, quoted),
    ])


# --------------------------------------------------------------------------- #
# (b) M2 — `--write` splices in exactly the block and nothing else             #
# --------------------------------------------------------------------------- #
def test_write_inserts_the_block_and_touches_no_other_byte(tmp_path):
    repo = new_repo(tmp_path)
    plan = write_plan(tmp_path)
    original = plan.read_text()
    blocks = paragraphs(pin(plan, repo).stdout)

    r = pin(plan, repo, "--write")
    assert r.returncode == 0, r.stderr
    written = plan.read_text()
    assert written != original

    spliced = written
    for block in blocks:
        assert "\n" + block in spliced
        spliced = spliced.replace("\n" + block, "", 1)
    assert spliced == original

    for ctx, block in zip(contexts(plan), blocks):
        assert ctx.endswith(block), ctx

    check = subprocess.run(
        [sys.executable, str(COMPILER), "--check", str(plan)],
        capture_output=True, text=True)
    assert check.returncode == 0, check.stdout + check.stderr
    assert check.stdout.splitlines()[0] == "PLAN OK"

    again = plan.read_bytes()
    r2 = pin(plan, repo, "--write")
    assert r2.returncode == 0, r2.stderr
    assert plan.read_bytes() == again


# --------------------------------------------------------------------------- #
# (c) M3 — `--verify` holds at BASE and names every fact that moved            #
# --------------------------------------------------------------------------- #
def test_verify_passes_when_nothing_moved(tmp_path):
    repo = new_repo(tmp_path)
    plan = write_plan(tmp_path)
    assert pin(plan, repo, "--write").returncode == 0
    r = pin(plan, repo, "--verify")
    assert r.returncode == 0, r.stdout + r.stderr
    assert stale_lines(r.stdout) == []


def test_verify_names_every_fact_that_shares_a_changed_blob(tmp_path):
    repo = new_repo(tmp_path)
    plan = write_plan(tmp_path)
    assert pin(plan, repo, "--write").returncode == 0

    commit(repo, {"pkg/a.py": A_PY.replace("def alpha():\n%s" % LONG_COMMENT,
                                           "def alpha(x):\n%s" % LONG_COMMENT)},
           "move line 2")
    r = pin(plan, repo, "--verify")
    assert r.returncode == 2, r.stdout
    lines = stale_lines(r.stdout)
    assert len(lines) == 3, r.stdout
    prefixes = ["stale: task 1 `pkg/a.py:2` ", "stale: task 1 `alpha` ",
                "stale: task 2 `pkg/a.py:3` "]
    for line, prefix in zip(lines, prefixes):
        assert line.startswith(prefix), line
        assert line[len(prefix):].strip()

    commit(repo, {"docs/n.md": None}, "drop the note")
    r = pin(plan, repo, "--verify")
    assert r.returncode == 2, r.stdout
    lines = stale_lines(r.stdout)
    assert len(lines) == 4, r.stdout
    assert sum(l.startswith("stale: task 1 `docs/n.md` ") for l in lines) == 1


def test_verify_names_only_the_file_that_changed(tmp_path):
    repo = new_repo(tmp_path)
    plan = write_plan(tmp_path)
    assert pin(plan, repo, "--write").returncode == 0

    commit(repo, {"docs/n.md": N_MD + "\nA second paragraph.\n"}, "edit the note")
    r = pin(plan, repo, "--verify")
    assert r.returncode == 2, r.stdout
    lines = stale_lines(r.stdout)
    assert len(lines) == 1, r.stdout
    assert lines[0].startswith("stale: task 1 `docs/n.md` "), lines[0]


AAA_PY = "def alpha():\n    return 1\n"


def test_verify_catches_a_first_definition_that_moved(tmp_path):
    repo = new_repo(tmp_path)
    plan = write_plan(tmp_path)
    assert pin(plan, repo, "--write").returncode == 0

    # `aaa.py` sorts before `pkg/a.py`, so `alpha`'s FIRST definition moves
    # while every blob the other facts pin stays exactly where it was.
    commit(repo, {"aaa.py": AAA_PY}, "a new first definition")
    r = pin(plan, repo, "--verify")
    assert r.returncode == 2, r.stdout
    lines = stale_lines(r.stdout)
    assert len(lines) == 1, r.stdout
    assert lines[0].startswith("stale: task 1 `alpha` "), lines[0]


# --------------------------------------------------------------------------- #
# (g) M1 — the symbol fact follows `git ls-files` order                        #
# (f) M2 — re-writing at a moved base replaces the block, never duplicates it  #
# --------------------------------------------------------------------------- #
def test_regeneration_at_a_moved_base_replaces_the_block(tmp_path):
    repo = new_repo(tmp_path)
    plan = write_plan(tmp_path)
    assert pin(plan, repo, "--write").returncode == 0
    commit(repo, {"aaa.py": AAA_PY}, "a new first definition")

    # (g) generation with `aaa.py` present pins it, not `pkg/a.py`.
    blocks = paragraphs(pin(plan, repo).stdout)
    assert ("- `alpha` at `aaa.py:1` blob %s" % sha7(repo, "aaa.py")) in blocks[0]

    # (f) the second base moves `pkg/a.py` line 2 and drops the note.
    commit(repo, {"pkg/a.py": A_PY.replace("def alpha():\n%s" % LONG_COMMENT,
                                           "def alpha(x):\n%s" % LONG_COMMENT),
                  "docs/n.md": None}, "move line 2, drop the note")
    assert pin(plan, repo, "--write").returncode == 0

    ctx = contexts(plan)[0]
    assert ctx.count("**BASE facts:**") == 1, ctx
    block = ctx[ctx.index("**BASE facts:**"):]
    assert block == "\n".join([
        "**BASE facts:** (generated at %s)" % base7(repo),
        "- `pkg/a.py:2` blob %s line 2 `def alpha(x):`" % sha7(repo, "pkg/a.py"),
        "- `alpha` at `aaa.py:1` blob %s" % sha7(repo, "aaa.py"),
    ]), block
    assert "docs/n.md" not in block

    r = pin(plan, repo, "--verify")
    assert r.returncode == 0, r.stdout + r.stderr


# --------------------------------------------------------------------------- #
# (d) M4 — a legacy plan is not this script's business                         #
# --------------------------------------------------------------------------- #
def test_a_legacy_plan_exits_zero_with_one_line():
    r = pin(LEGACY_FIXTURE, ROOT)
    assert r.returncode == 0, r.stderr
    assert len(r.stdout.strip().splitlines()) == 1, r.stdout
    assert "not a claims-v1 plan" in r.stdout


# --------------------------------------------------------------------------- #
# (e) M1 — the committed claims fixture, at this checkout                      #
# --------------------------------------------------------------------------- #
def test_the_claims_fixture_pins_one_block_per_task():
    r = pin(CLAIMS_FIXTURE, ROOT)
    assert r.returncode == 0, r.stderr
    blocks = paragraphs(r.stdout)
    headings = [t["id"] for t in split_tasks(CLAIMS_FIXTURE.read_text())]
    assert len(blocks) == len(headings), r.stdout
    for block in blocks:
        assert block.splitlines()[0].startswith("**BASE facts:** (generated at ")
    for bullet in re.findall(r"^- .*$", r.stdout, re.M):
        # a symbol fact carries the path in its SECOND span, so it is read first
        path = re.match(r"^- `[^`]+` at `([^`]+):\d+` blob ", bullet) or \
            re.match(r"^- `([^`]+?)(?::\d+)?` blob ", bullet)
        assert path is not None, bullet
        assert (ROOT / path.group(1)).exists(), bullet


def test_usage_error_without_a_plan():
    r = subprocess.run([sys.executable, str(SCRIPT)],
                       capture_output=True, text=True)
    assert r.returncode != 0
