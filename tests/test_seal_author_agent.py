"""Single-channel effort knob for the seal author (2026-07-07 clock investigation).

The independent acceptance author used to inherit whatever model/effort the
operator's chat session happened to be set to — a session at xhigh effort made
sealing generate ~140k+ thinking tokens (~18+ min wall) with nobody having
chosen that spend. The fix pins effort in ONE channel: the plugin agent
definition `agents/seal-author.md` (`effort: high`), which the ultraplan
sealing step dispatches by type. Tier stays a dispatch-time decision
("most-capable tier"), so the definition must NOT carry a model key.

These pins keep the knob single-channel: the definition owns effort, the two
dispatch texts name the agent type, and neither dispatch text regrows its own
effort value.
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
AGENT = ROOT / "agents/seal-author.md"
PROMPT = ROOT / "skills/ultraplan/references/seal-author-prompt.md"
ULTRAPLAN = ROOT / "skills/ultraplan/SKILL.md"

AGENT_TYPE_TOKEN = "ultrapowers:seal-author"


def frontmatter():
    text = AGENT.read_text()
    match = re.match(r"\A---\n(.*?)\n---\n", text, re.S)
    assert match, "agents/seal-author.md must open with a --- frontmatter block"
    return match.group(1)


def test_agent_definition_exists():
    assert AGENT.is_file(), (
        "agents/seal-author.md is the single channel for the seal author's "
        "effort knob — it must ship with the plugin"
    )


def test_effort_pinned_high():
    assert re.search(r"^effort:\s*high\s*$", frontmatter(), re.M), (
        "the seal author's effort must be pinned to 'high' in the agent "
        "definition — omitting it re-inherits the session's ambient effort "
        "(the xhigh-inflation defect this knob exists to prevent)"
    )


def test_no_model_key_in_definition():
    assert not re.search(r"^model:", frontmatter(), re.M), (
        "tier is a dispatch-time decision ('most-capable tier' in the brief); "
        "a model key here would create a second channel for the tier knob"
    )


def test_dispatch_texts_name_the_agent_type():
    for path in (PROMPT, ULTRAPLAN):
        assert AGENT_TYPE_TOKEN in path.read_text(), (
            f"{path.relative_to(ROOT)} must dispatch the seal author by its "
            f"agent type {AGENT_TYPE_TOKEN!r} so the definition's effort pin "
            "actually applies"
        )


def test_dispatch_texts_do_not_regrow_effort_values():
    # The definition owns the effort VALUE. Dispatch texts may explain the
    # knob but must not state their own effort level, or the channels drift.
    pattern = re.compile(r"\b(?:low|medium|high|xhigh|max)\s+effort\b|\beffort:\s*(?:low|medium|high|xhigh|max)\b")
    for path in (PROMPT, ULTRAPLAN):
        assert not pattern.search(path.read_text()), (
            f"{path.relative_to(ROOT)} states an effort value; the only "
            "channel for that is agents/seal-author.md frontmatter"
        )


def test_brief_keeps_tier_with_dispatcher():
    assert "most-capable tier" in PROMPT.read_text(), (
        "the brief must keep tier selection at dispatch time — the agent "
        "definition deliberately carries no model key"
    )
