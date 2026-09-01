"""`--overlap serialize` is a measured-rollback knob, not authoring doctrine.

Sitting 3 of map #360 deleted the same-file-contention steering prose from
`dependency-analysis.md` (spec 2026-09-01-tier1-weave-persistence.md §4.1): the
failure class it steered around is retired by the fold tier. This file is the
durable regression pin for that deletion — the precedent is
`test_marker_contract.py` pinning the ABSENCE of the deleted edge tiers. The
knob's own behavior tests (`test_compile_overlap.py`) are untouched: the code
path stays, only its authoring documentation goes.
"""
from pathlib import Path

DOC = Path(__file__).resolve().parents[1] / "skills/ultrapowers/references/dependency-analysis.md"

KNOB_LINE = ("`--overlap serialize` remains as the measured-rollback knob; "
             "it is not an authoring consideration.")


def test_serialize_is_a_knob_mention_not_authoring_doctrine():
    text = DOC.read_text()
    assert text.count("serialize") <= 2
    for retired in ("serialize the scaffolding task",
                    "do not assume it is safe to write concurrently",
                    "write-after-write"):
        assert retired not in text.lower().replace("'", "")


def test_the_knob_is_named_once_as_a_rollback_knob():
    # The ONE line the deletion adds, verbatim, where the knob is introduced.
    assert KNOB_LINE in DOC.read_text()


def test_the_live_scheduling_contract_survives():
    # The deletion is prose-only: the fold tier, the surviving `why` vocabulary,
    # the cycle refusal, and the 1-task degrade rule are all live contract.
    text = DOC.read_text()
    for kept in ("`--overlap fold`",
                 "Edge `why` labels emitted by the compiler: `marker`, `text`, "
                 "`interface`, `write-after-create`.",
                 "refusing to guess an ordering",
                 "Implementation task count is exactly 1",
                 "compile-time refusal"):
        assert kept in text
