"""`ultrawrite` — the one owned authoring skill (#390, spec
`docs/superpowers/specs/2026-08-31-owned-authoring-skill.md` §§2–5).

What is pinned here is the part of the skill a machine can check: the six body
slots must be named in their one legal order, and the two refused markers must
be absent — including `Tier`, which is an intent-document field (One Driver
spec §7) and was never a plan marker.

The execution-fit rubric and its decision-tree branches are not pinned here:
`tests/test_recommendation_rubric.py` holds the rubric's agreement with
`hooks/session_start.sh`, which is the property that matters. A sentence pin on
this file would only establish that the sentence is present.
"""
import pathlib
import re
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/ultrawrite/SKILL.md"
VALIDATE = ROOT / "skills/ultrapowers/scripts/validate_skill.py"


def text():
    return SKILL.read_text()


def frontmatter():
    m = re.match(r"^---\n(.*?)\n---\n", text(), re.DOTALL)
    assert m, "SKILL.md has no YAML frontmatter"
    return dict(re.findall(r"^([A-Za-z0-9_-]+):\s*(.*)$", m.group(1), re.MULTILINE))


def test_skill_file_exists():
    assert SKILL.is_file(), f"{SKILL} not found"


def test_frontmatter_name_is_ultrawrite():
    assert frontmatter().get("name") == "ultrawrite"


def test_no_reflex_recommendation():
    assert "(recommended for marked plans)" not in text()


# --- the six body slots, in their one legal order ----------------------------
SLOTS = ["Claim", "Authorized-by", "Interfaces", "Context", "Proof", "Stale-if"]


@pytest.mark.parametrize("slot", SLOTS)
def test_slot_named(slot):
    assert "**%s:**" % slot in text(), f"skill never names the **{slot}:** slot"


def test_slots_documented_in_canonical_order():
    positions = [text().find("**%s:**" % s) for s in SLOTS]
    assert all(p >= 0 for p in positions), positions
    assert positions == sorted(positions), (
        "body slots are taught out of the one order the parser accepts: "
        + ", ".join(SLOTS))


# --- the refused markers ------------------------------------------------------
@pytest.mark.parametrize("refused", ["**Depends-on:**", "**Tier:**"])
def test_refused_marker_never_written_in_marker_form(refused):
    # `Depends-on` is refused by claims-v1 (ordering is derived); `Tier` never
    # existed as a plan marker at all. Neither may appear in marker form
    # anywhere in the file — an example is indistinguishable from a template.
    assert refused not in text(), f"skill writes the refused marker {refused}"


# --- the validation ritual ---------------------------------------------------
@pytest.mark.parametrize("named", [
    "extract_gate_input.py",
    "check_provenance.py",
    "compile_plan.py --check",
])
def test_validation_step_names_its_tooling(named):
    assert named in text(), f"skill never names {named!r}"


def test_no_mit_notice_because_no_verbatim_superpowers_text_is_carried():
    # Spec §2: the notice attaches only to carrying substantial verbatim
    # superpowers prose. None is carried, so the notice stays dormant.
    body = text()
    assert "MIT" not in body
    assert "Jesse Vincent" not in body
    assert "REQUIRED SUB-SKILL" not in body


def test_validate_skill_accepts_it():
    proc = subprocess.run(
        [sys.executable, str(VALIDATE), str(SKILL.parent)],
        capture_output=True, text=True)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert proc.stdout.strip() == "skill ok"
