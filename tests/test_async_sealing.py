"""Async sealing contract (#93): dispatch at spec approval, collect at plan
approval, keyed by the spec content hash.

All four of the seal author's original inputs exist at spec approval, so the
ultraplan sealing step dispatches the author in the background when the skill
is invoked and collects the finished seal after plan approval. These pins hold
the two halves of the protocol in lockstep: the brief works in a per-dispatch
pending dir (the shared pending/ path was the two-seals race), records the
spec hash in the manifest (collection is content-addressed, so a spec edit
invalidates by construction), and leaves a durable failure record; the skill
text dispatches at invocation, writes the dispatch receipt, surfaces failures
at plan approval, and falls back to today's synchronous flow.
"""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROMPT = (ROOT / "skills/ultraplan/references/seal-author-prompt.md").read_text()
SKILL = (ROOT / "skills/ultraplan/SKILL.md").read_text()
AGENT = (ROOT / "agents/seal-author.md").read_text()


# --- the brief (author side) ---

def test_brief_works_in_the_per_dispatch_pending_dir():
    assert "<pendingDir>" in PROMPT, (
        "the pending dir must be a dispatch input, not a constant"
    )
    assert "<vault>/pending/" not in PROMPT, (
        "a shared pending/ path is the two-seals race the per-dispatch "
        "dir exists to prevent"
    )


def test_brief_records_spec_hash_in_manifest():
    assert "specSha256" in PROMPT, (
        "manifest.specSha256 is the collection key — without it a stale "
        "seal is indistinguishable from a fresh one"
    )


def test_brief_writes_durable_failure_record():
    assert "outcome.json" in PROMPT
    assert "durable failure record" in PROMPT, (
        "GREEN_AT_BASELINE / EXAM_BOOTSTRAP_ERROR must survive the session "
        "that dispatched them — a returned message alone is lost to "
        "compaction"
    )


# --- the agent definition (thin pointer) ---

def test_agent_definition_names_the_new_inputs():
    assert "six inputs" in AGENT
    assert "pending dir" in AGENT


# --- ultraplan SKILL.md (dispatcher side) ---

def test_skill_dispatches_at_invocation_in_background():
    assert "### Dispatch at invocation" in SKILL
    assert "in the background" in SKILL


def test_skill_writes_the_dispatch_receipt():
    assert "dispatch.json" in SKILL, (
        "the receipt is what makes crashed-dispatch detection and "
        "stale-spec cleanup read state instead of guessing"
    )


def test_skill_collects_content_addressed_at_plan_approval():
    assert "### Collect at plan approval" in SKILL
    assert "specSha256" in SKILL
    assert "shasum -a 256" in SKILL


def test_skill_surfaces_async_failures_at_plan_approval():
    assert "outcome.json" in SKILL
    assert "at plan approval, never silently after" in SKILL


def test_skill_falls_back_to_synchronous_dispatch():
    assert "dispatch synchronously" in SKILL, (
        "the fallback is the never-worse-than-status-quo guarantee"
    )
