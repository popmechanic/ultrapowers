"""The proof gate's verdict is an artifact, not a memory (spec 2026-08-31 §4.5).

Two halves, one contract. `extract_gate_input.py` builds the gate's diet
mechanically — exactly the (Claim, Proof) pair of one task, hashed — so what the
gate reads is capped by the parser rather than by the reader's restraint. The
`claims-v1` compiler then refuses to compile a plan whose sibling
`<plan-stem>.gate-verdicts.json` is missing, stale, or carries a `fail`: the gate
is load-bearing, not a convention.

The record's `tally` is the production canary (§8) and only gate tooling writes
it — the compiler reads the file and never touches it.
"""
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
EXTRACTOR = ROOT / "skills/ultrawrite/scripts/extract_gate_input.py"
CLAIMS_FIXTURE = ROOT / "evals/fixtures/claims/plan.md"
LEGACY_FIXTURE = ROOT / "evals/fixtures/wide/plan.md"

sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
from compile_plan import (  # noqa: E402
    parse_claims_body,
    split_tasks,
    verdicts_path,
)

# The fixture's task 1 slots, verbatim. The gate's whole diet, written out: an
# operator sentence with its provenance tag, a machine restatement, and the
# exam. Nothing else about task 1 — and nothing at all about tasks 2 and 3.
TASK1_CLAIM = (
    "An operator asks for a widget of a given size and gets one back, or a clear\n"
    "error when the size is not a positive whole number. (quoted from #489)\n"
    "Machine: `make_widget(3)` returns a `Widget` whose `size` is `3`; "
    "`make_widget(0)` and\n"
    '`make_widget(-1)` each raise `ValueError("size must be positive")`.'
)
TASK1_PROOF = (
    "- Test: `tests/test_widget.py`\n"
    "\n"
    "```python\n"
    "assert make_widget(3).size == 3\n"
    "with pytest.raises(ValueError):\n"
    "    make_widget(0)\n"
    "```"
)
TASK1_HASH = "329fe5317295ed8635b51bdde717191bf45933fc37487d25ef944ae898817dad"


def _extract(plan, task, *extra):
    return subprocess.run(
        [sys.executable, str(EXTRACTOR), str(plan), "--task", task] + list(extra),
        capture_output=True, text=True)


def _compile(plan, *extra):
    return subprocess.run([sys.executable, str(COMPILER), str(plan)] + list(extra),
                          capture_output=True, text=True)


def _sign(plan, verdict="pass", tally=None, tasks=None):
    """Write an all-pass verdict record beside `plan`, keyed on live hashes."""
    record = {"tasks": tasks if tasks is not None else {
        t["id"]: {"hash": _hash(t), "verdict": verdict, "reason": "layer match"}
        for t in split_tasks(plan.read_text())},
        "tally": tally if tally is not None else {"dispatched": 3, "rejected": 0}}
    verdicts_path(plan).write_text(json.dumps(record, indent=2) + "\n")
    return record


def _hash(task):
    claims = parse_claims_body(task["body"], task["id"])
    return hashlib.sha256(
        (claims["claim"] + "\x00" + claims["proof"]).encode("utf-8")).hexdigest()


def _fixture(tmp_path):
    plan = tmp_path / "plan.md"
    shutil.copy(CLAIMS_FIXTURE, plan)
    return plan


def _refuses(plan, prefix):
    """A gate-verdict refusal closes BOTH channels — the compile and `--check`."""
    run = _compile(plan)
    assert run.returncode != 0, "expected a refusal, got:\n" + run.stdout[:400]
    assert any(line.startswith(prefix) for line in run.stderr.splitlines()), \
        "stderr carries no %r line:\n%s" % (prefix, run.stderr)
    check = _compile(plan, "--check")
    assert check.returncode == 2, check.stdout
    assert any(line.startswith(prefix) for line in check.stdout.splitlines()), \
        "--check carries no %r line:\n%s" % (prefix, check.stdout)


# ---------------------------------------------------------------------------
# The extractor: a mechanically capped diet
# ---------------------------------------------------------------------------

def test_the_extractor_yields_exactly_the_claim_and_proof_slots():
    r = _extract(CLAIMS_FIXTURE, "1")
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout) == {"task": "1", "claim": TASK1_CLAIM,
                                    "proof": TASK1_PROOF, "hash": TASK1_HASH}


def test_the_extractor_hash_is_sha256_of_claim_nul_proof():
    digest = hashlib.sha256(
        (TASK1_CLAIM + "\x00" + TASK1_PROOF).encode("utf-8")).hexdigest()
    assert digest == TASK1_HASH
    assert json.loads(_extract(CLAIMS_FIXTURE, "1").stdout)["hash"] == digest


def test_the_extractor_diet_is_capped_to_the_claim_and_the_proof():
    out = _extract(CLAIMS_FIXTURE, "1").stdout
    # Context — the slot the gate must not read.
    assert "flat package" not in out
    assert "no registry" not in out
    assert "new dataclass" not in out
    # Interfaces and Authorized-by — signed, but not the gate's business.
    assert "Produces:" not in out
    assert "Consumes:" not in out
    assert "Authorized-by" not in out
    assert "owned-authoring-skill" not in out
    # Stale-if.
    assert "path-exists" not in out
    assert "issue-closed" not in out
    # Sibling tasks 2 and 3 — nothing of theirs leaks in.
    assert "catalog" not in out
    assert "format_size" not in out
    assert "millimetres" not in out
    assert "widget catalog" not in out.lower()


def test_the_extractor_refuses_an_unknown_task(tmp_path):
    r = _extract(CLAIMS_FIXTURE, "99")
    assert r.returncode != 0
    assert "99" in r.stderr


def test_the_extractor_refuses_a_legacy_plan():
    r = _extract(LEGACY_FIXTURE, "1")
    assert r.returncode != 0
    assert "claims-v1" in r.stderr


# ---------------------------------------------------------------------------
# The verdict artifact
# ---------------------------------------------------------------------------

def test_verdicts_path_is_the_plans_sibling():
    assert verdicts_path(CLAIMS_FIXTURE) == \
        CLAIMS_FIXTURE.parent / "plan.gate-verdicts.json"
    assert verdicts_path(pathlib.Path("/tmp/a/2026-08-31-cutover.md")) == \
        pathlib.Path("/tmp/a/2026-08-31-cutover.gate-verdicts.json")


def test_a_claims_plan_with_no_verdict_record_is_refused(tmp_path):
    plan = _fixture(tmp_path)
    assert not verdicts_path(plan).exists()
    _refuses(plan, "grammar: gate verdicts missing")


def test_a_task_absent_from_the_record_is_refused(tmp_path):
    plan = _fixture(tmp_path)
    record = _sign(plan)
    del record["tasks"]["1"]
    verdicts_path(plan).write_text(json.dumps(record))
    _refuses(plan, "grammar: gate verdict missing for task 1")


def test_a_stale_hash_is_refused(tmp_path):
    plan = _fixture(tmp_path)
    record = _sign(plan)
    record["tasks"]["1"]["hash"] = "0" * 64
    verdicts_path(plan).write_text(json.dumps(record))
    _refuses(plan, "grammar: gate verdict stale for task 1")


def test_an_edited_claim_goes_stale(tmp_path):
    """The hash is over the signed pair: editing the Claim re-dispatches."""
    plan = _fixture(tmp_path)
    _sign(plan)
    plan.write_text(plan.read_text().replace("a positive whole number",
                                             "a positive integer"))
    _refuses(plan, "grammar: gate verdict stale for task 1")


def test_a_fail_verdict_is_refused(tmp_path):
    plan = _fixture(tmp_path)
    record = _sign(plan)
    record["tasks"]["1"].update(verdict="fail", reason="proof proves nothing")
    verdicts_path(plan).write_text(json.dumps(record))
    _refuses(plan, "grammar: gate verdict fail for task 1")


def test_all_pass_current_hashes_compiles(tmp_path):
    plan = _fixture(tmp_path)
    _sign(plan)
    run = _compile(plan)
    assert run.returncode == 0, run.stderr
    out = json.loads(run.stdout)
    assert [t["id"] for t in out["tasks"]] == ["1", "2", "3"]
    assert out["waves"] == [["1", "3"], ["2"]]
    check = _compile(plan, "--check")
    assert check.returncode == 0 and check.stdout.splitlines()[0] == "PLAN OK"


def test_the_tally_is_preserved_untouched(tmp_path):
    plan = _fixture(tmp_path)
    _sign(plan, tally={"dispatched": 7, "rejected": 2})
    before = verdicts_path(plan).read_bytes()
    assert _compile(plan).returncode == 0
    assert _compile(plan, "--check").returncode == 0
    after = verdicts_path(plan).read_bytes()
    assert after == before
    assert json.loads(after)["tally"] == {"dispatched": 7, "rejected": 2}


def test_a_legacy_plan_needs_no_verdict_record(tmp_path):
    plan = tmp_path / "plan.md"
    shutil.copy(LEGACY_FIXTURE, plan)
    assert not verdicts_path(plan).exists()
    run = _compile(plan)
    assert run.returncode == 0, run.stderr
    assert json.loads(run.stdout)["waves"] == [["1", "2", "3", "4", "5", "6"]]
    check = _compile(plan, "--check")
    assert check.returncode == 0 and check.stdout.splitlines()[0] == "PLAN OK"


def test_the_committed_claims_fixture_ships_a_current_all_pass_record():
    record = json.loads(verdicts_path(CLAIMS_FIXTURE).read_text())
    live = {t["id"]: _hash(t) for t in split_tasks(CLAIMS_FIXTURE.read_text())}
    assert sorted(record["tasks"]) == ["1", "2", "3"]
    assert {i: e["hash"] for i, e in record["tasks"].items()} == live
    assert record["tasks"]["1"]["hash"] == TASK1_HASH
    assert [e["verdict"] for e in record["tasks"].values()] == ["pass"] * 3
    assert sorted(record["tally"]) == ["dispatched", "rejected"]
