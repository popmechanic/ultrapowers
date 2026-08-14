"""Anti-drift guard: the discipline baked into skills/ultrapowers/harnesses/waves.js
must match its single source of truth, references/reviewer-prompts.md.

reviewer-prompts.md wraps each canonical block in
    <!-- BAKE:NAME -->  ...  <!-- /BAKE -->
markers. We extract each block, normalize away all formatting (markdown
emphasis, backticks, punctuation, possessive 's, whitespace), and assert the
normalized words appear in the equally-normalized waves.js. If someone edits
one copy without the other, this test fails.
"""
import pathlib, re
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / "skills/ultrapowers/references/reviewer-prompts.md"
WORKFLOW = ROOT / "skills/ultrapowers/harnesses/waves.js"

MARKER = re.compile(r"<!-- BAKE:([\w-]+) -->(.*?)<!-- /BAKE -->", re.DOTALL)


def normalize(s: str) -> str:
    s = s.lower()
    s = re.sub(r"'s\b", "", s)          # drop possessive 's (implementer's -> implementer)
    s = re.sub(r"[^a-z0-9]+", " ", s)   # all other formatting/punctuation -> space
    return s.strip()


def baked_blocks():
    text = SOURCE.read_text()
    blocks = {name: body for name, body in MARKER.findall(text)}
    assert blocks, "no <!-- BAKE:NAME --> markers found in reviewer-prompts.md"
    return blocks


def test_expected_blocks_present():
    blocks = baked_blocks()
    for name in ("GUARD", "IMPLEMENTER_PROMPT", "REVIEWER_PROMPT",
                 "IMPLEMENTER_SCHEMA", "REVIEWER_SCHEMA"):
        assert name in blocks, "missing BAKE marker for " + name


@pytest.mark.parametrize("name", ["GUARD", "IMPLEMENTER_PROMPT", "REVIEWER_PROMPT"])
def test_block_is_baked_into_workflow(name):
    blocks = baked_blocks()
    wf = normalize(WORKFLOW.read_text())
    expected = normalize(blocks[name])
    assert expected, "empty source block for " + name
    assert expected in wf, (
        "drift: BAKE:" + name + " in reviewer-prompts.md does not match waves.js.\n"
        "Re-bake per references/workflow-template.md.\nexpected (normalized):\n" + expected
    )


# ── wave-merge.md prompts (setup/merge/reconcile/completeness) ────────────────
# These blocks contain {{PLACEHOLDER}} tokens where waves.js interpolates
# runtime values; we assert the static fragments appear in waves.js, in order.

WAVE_SOURCE = ROOT / "skills/ultrapowers/references/wave-merge.md"
PLACEHOLDER = re.compile(r"\{\{\w+\}\}")

# The parametrization is DERIVED from wave-merge.md's BAKE blocks, so a new block
# is pinned the moment it is authored (a hardcoded list silently shipped new
# blocks unpinned). KNOWN is the floor that keeps a deleted or renamed block
# failing red — derivation alone would make the existence check a tautology.
KNOWN = {"SETUP_PROMPT_CREATE", "SETUP_PROMPT_RESUME", "MERGE_PROMPT",
         "CONTENDED_MERGE_PROMPT", "RESOLVER_PROMPT",
         "RECONCILE_PROMPT", "COMPLETENESS_PROMPT", "COMPLETENESS_ANCESTRY"}


def wave_blocks():
    blocks = {name: body for name, body in MARKER.findall(WAVE_SOURCE.read_text())}
    assert blocks, "no <!-- BAKE:NAME --> markers found in wave-merge.md"
    return blocks


WAVE_PROMPTS = sorted(wave_blocks())


def test_wave_blocks_present():
    missing = KNOWN - set(wave_blocks())
    assert set(KNOWN) <= set(wave_blocks()), (
        "wave-merge.md lost BAKE markers that waves.js still bakes: " + repr(sorted(missing)))


@pytest.mark.parametrize("name", WAVE_PROMPTS)
def test_wave_prompt_is_baked(name):
    blocks = wave_blocks()
    wf = normalize(WORKFLOW.read_text())
    fragments = [normalize(f) for f in PLACEHOLDER.split(blocks[name])]
    fragments = [f for f in fragments if f]
    assert fragments, "empty source block for " + name
    pos = 0
    for frag in fragments:
        idx = wf.find(frag, pos)
        assert idx >= 0, (
            "drift: BAKE:" + name + " fragment missing or out of order in waves.js. "
            "Re-bake per references/workflow-template.md.\nfragment (normalized):\n" + frag)
        pos = idx + len(frag)


# ── JSON schemas: enum/key drift between reviewer-prompts.md and waves.js ──
SCHEMA_BLOCKS = ["IMPLEMENTER_SCHEMA", "REVIEWER_SCHEMA"]


@pytest.mark.parametrize("name", SCHEMA_BLOCKS)
def test_schema_block_is_baked(name):
    blocks = baked_blocks()
    assert name in blocks, "missing BAKE marker for " + name
    wf = normalize(WORKFLOW.read_text())
    expected = normalize(blocks[name])
    assert expected, "empty source block for " + name
    assert expected in wf, (
        "drift: BAKE:" + name + " in reviewer-prompts.md does not match waves.js.\n"
        "Re-bake per references/workflow-template.md.\nexpected (normalized):\n" + expected)


# ── merge/reconcile HEAD-assert + wave-barrier sweep (#151, reverses bea1875) ─
def test_merge_prompt_sweeps_worktrees_but_never_branches():
    wf = normalize(WORKFLOW.read_text())
    # #151 reverses bea1875's subtraction: the wave-barrier sweep step is IN
    # the merge/reconcile prompts again, identity-checked and worktree-only.
    # Branch deletion stays forbidden — branches carry the merged commits
    # until the deterministic Step-5 sweep.
    for required in ("git worktree list --porcelain",
                     "git worktree remove --force",
                     "never delete any branch"):
        assert normalize(required) in wf, f"merge prompt lost the sweep step: {required!r}"
    for forbidden in ("git branch d", "delete the branch",
                      "clean up the merged branches"):
        assert normalize(forbidden) not in wf, f"merge prompt instructs branch deletion: {forbidden!r}"


def test_merge_prompt_asserts_head():
    wf = normalize(WORKFLOW.read_text())
    assert normalize("git rev-parse HEAD") in wf and normalize("git branch --show-current") in wf
