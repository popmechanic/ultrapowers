"""Anti-drift guard: the discipline baked into skills/ultrapowers/workflow.js
must match its single source of truth, references/reviewer-prompts.md.

reviewer-prompts.md wraps each canonical block in
    <!-- BAKE:NAME -->  ...  <!-- /BAKE -->
markers. We extract each block, normalize away all formatting (markdown
emphasis, backticks, punctuation, possessive 's, whitespace), and assert the
normalized words appear in the equally-normalized workflow.js. If someone edits
one copy without the other, this test fails.
"""
import pathlib, re
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / "skills/ultrapowers/references/reviewer-prompts.md"
WORKFLOW = ROOT / "skills/ultrapowers/workflow.js"

MARKER = re.compile(r"<!-- BAKE:(\w+) -->(.*?)<!-- /BAKE -->", re.DOTALL)


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
        "drift: BAKE:" + name + " in reviewer-prompts.md does not match workflow.js.\n"
        "Re-bake per references/workflow-template.md.\nexpected (normalized):\n" + expected
    )


# ── wave-merge.md prompts (setup/merge/reconcile/completeness) ────────────────
# These blocks contain {{PLACEHOLDER}} tokens where workflow.js interpolates
# runtime values; we assert the static fragments appear in workflow.js, in order.

WAVE_SOURCE = ROOT / "skills/ultrapowers/references/wave-merge.md"
PLACEHOLDER = re.compile(r"\{\{\w+\}\}")
WAVE_PROMPTS = ["SETUP_PROMPT_CREATE", "SETUP_PROMPT_RESUME", "MERGE_PROMPT",
                "RECONCILE_PROMPT", "COMPLETENESS_PROMPT"]


def wave_blocks():
    blocks = {name: body for name, body in MARKER.findall(WAVE_SOURCE.read_text())}
    assert blocks, "no <!-- BAKE:NAME --> markers found in wave-merge.md"
    return blocks


def test_wave_blocks_present():
    blocks = wave_blocks()
    for name in WAVE_PROMPTS:
        assert name in blocks, "missing BAKE marker for " + name


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
            "drift: BAKE:" + name + " fragment missing or out of order in workflow.js. "
            "Re-bake per references/workflow-template.md.\nfragment (normalized):\n" + frag)
        pos = idx + len(frag)


# ── JSON schemas: enum/key drift between reviewer-prompts.md and workflow.js ──
SCHEMA_BLOCKS = ["IMPLEMENTER_SCHEMA", "REVIEWER_SCHEMA"]


@pytest.mark.parametrize("name", SCHEMA_BLOCKS)
def test_schema_block_is_baked(name):
    blocks = baked_blocks()
    assert name in blocks, "missing BAKE marker for " + name
    wf = normalize(WORKFLOW.read_text())
    expected = normalize(blocks[name])
    assert expected, "empty source block for " + name
    assert expected in wf, (
        "drift: BAKE:" + name + " in reviewer-prompts.md does not match workflow.js.\n"
        "Re-bake per references/workflow-template.md.\nexpected (normalized):\n" + expected)
