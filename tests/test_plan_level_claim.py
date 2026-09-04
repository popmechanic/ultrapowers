"""One signature per plan (#552): the header `**Claim:**` and derived task claims.

A claims-v1 plan carries ONE elicited operator sentence above the first task —
what the operator will see after the run, in their words. Task claims may then
close `(derived)` instead of re-signing a sentence the operator never said. The
header sentence is a plan-level fact: it is not part of any task's gate-input
hash, and the gate reads it through `extract_gate_input.py --plan` alongside
every task's Machine restatement, never mixed into a task's diet.
"""
import hashlib
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
PROVENANCE = ROOT / "skills/ultrawrite/scripts/check_provenance.py"
EXTRACT = ROOT / "skills/ultrawrite/scripts/extract_gate_input.py"
SKILL = ROOT / "skills/ultrawrite/SKILL.md"
VALIDATE = ROOT / "skills/ultrapowers/scripts/validate_skill.py"

sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
sys.path.insert(0, str(ROOT / "tests"))
from compile_plan import (  # noqa: E402
    gate_input_hash,
    machine_restatement,
    parse_claims_body,
    parse_plan_claim,
    split_tasks,
    verdicts_path,
)
from test_compile_plan_claims import GOOD_PLAN  # noqa: E402

# The operator's one sentence, and the two header spellings of it: on one line
# and hard-wrapped the way an authoring agent actually writes it.
PLAN_CLAIM = ("After this run I can hand the catalog a list of sizes and see "
              "one widget back per size.")
HEADER_ONE_LINE = "**Claim:** " + PLAN_CLAIM + " (elicited)\n"
HEADER_WRAPPED = ("**Claim:** After this run I can hand the catalog a list of "
                  "sizes and see\n"
                  "one widget back per size. (elicited)\n")

OPERATOR = "An operator asks for a widget of a given size and gets one."
MACHINE_1 = "`make_widget(3)` returns a `Widget` whose `size` is `3`."
MACHINE_2 = "`make_widget(0)` raises `ValueError`."


def _plan(header_claim, *tasks):
    """A claims-v1 plan; `header_claim` is the verbatim header Claim block (or
    None for a plan that carries none — the BASE shape)."""
    head = "# Plan: Widget Kit\n\n**Grammar:** claims-v1\n\n"
    if header_claim is not None:
        head += header_claim + "\n"
    head += "**Acceptance:** waived — inline test plan\n\n"
    return head + "\n".join(tasks)


def _task(tid, tag, machine=MACHINE_1, authorized_by="#489"):
    return (
        "### Task %s: The widget constructor\n"
        "\n"
        "**Type:** implementation\n"
        "\n"
        "**Files:**\n"
        "- Create: `widgetkit/widget%s.py`\n"
        "\n"
        "**Claim:** %s %s\n"
        "Machine: %s\n"
        "\n"
        "**Authorized-by:** %s\n"
        "\n"
        "**Interfaces:**\n"
        "- Produces: `make_widget%s(n: int) -> Widget`\n"
        "\n"
        "**Context:** `widgetkit/` is a flat package with no registry.\n"
        "\n"
        "**Proof:**\n"
        "- Test: `tests/test_widget%s.py`\n"
        "\n"
        "**Stale-if:**\n"
        "- issue-closed: #489\n"
    ) % (tid, tid, OPERATOR, tag, machine, authorized_by, tid, tid)


def _write(tmp_path, text, name="plan.md"):
    p = tmp_path / name
    p.write_text(text, encoding="utf-8")
    return p


def _sign(plan):
    """Stamp an all-pass gate-verdict record beside a plan expected to compile."""
    record = {"tasks": {}, "tally": {"dispatched": 0, "rejected": 0}}
    for t in split_tasks(plan.read_text()):
        claims = parse_claims_body(t["body"], t["id"])
        record["tasks"][t["id"]] = {
            "hash": gate_input_hash(claims["claim"], claims["proof"]),
            "verdict": "pass", "reason": "layer match"}
        record["tally"]["dispatched"] += 1
    verdicts_path(plan).write_text(json.dumps(record, indent=2) + "\n")
    return plan


def _run(path, *extra):
    return subprocess.run([sys.executable, str(COMPILER), str(path)] + list(extra),
                          capture_output=True, text=True)


def _compile(path):
    p = _run(path)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def _refuses(tmp_path, plan_text, prefix):
    """Both channels close on it — the compile (SystemExit, stderr) and
    `--check` (exit 2, one line each), each with the spec'd prefix."""
    plan = _sign(_write(tmp_path, plan_text))
    run = _run(plan)
    assert run.returncode != 0, "expected a refusal, got:\n" + run.stdout[:400]
    assert any(line.startswith(prefix) for line in run.stderr.splitlines()), \
        "stderr carries no %r line:\n%s" % (prefix, run.stderr)
    check = _run(plan, "--check")
    assert check.returncode == 2, check.stdout
    assert any(line.startswith(prefix) for line in check.stdout.splitlines()), \
        "--check carries no %r line:\n%s" % (prefix, check.stdout)


def _body(plan_text, task_id="1"):
    return next(t["body"] for t in split_tasks(plan_text) if t["id"] == task_id)


# ---------------------------------------------------------------------------
# (a) parse_plan_claim — the header's one sentence [M1]
# ---------------------------------------------------------------------------

def test_parse_plan_claim_reads_the_header_sentence_and_strips_the_tag():
    text = _plan(HEADER_ONE_LINE, _task("1", "(derived)"))
    assert parse_plan_claim(text) == PLAN_CLAIM


def test_parse_plan_claim_joins_a_wrapped_sentence_with_one_space():
    text = _plan(HEADER_WRAPPED, _task("1", "(derived)"))
    assert parse_plan_claim(text) == PLAN_CLAIM


def test_parse_plan_claim_is_none_when_only_a_task_body_carries_a_claim():
    text = _plan(None, _task("1", "(quoted from #489)"))
    assert "**Claim:**" in text
    assert parse_plan_claim(text) is None


def test_parse_plan_claim_ignores_a_fenced_header_claim():
    text = _plan("```\n" + HEADER_ONE_LINE + "```\n", _task("1", "(quoted from #489)"))
    assert parse_plan_claim(text) is None


# ---------------------------------------------------------------------------
# (b) an untagged header Claim refuses on both channels [M1]
# ---------------------------------------------------------------------------

def test_header_claim_without_the_elicited_tag_is_refused(tmp_path):
    _refuses(tmp_path,
             _plan("**Claim:** " + PLAN_CLAIM + "\n",
                   _task("1", "(quoted from #489)")),
             "grammar: plan-level Claim")


# ---------------------------------------------------------------------------
# (c) `(derived)` under a header Claim [M2]
# ---------------------------------------------------------------------------

def test_a_derived_task_claim_compiles_under_a_header_claim(tmp_path):
    text = _plan(HEADER_ONE_LINE, _task("1", "(derived)"))
    out = _compile(_sign(_write(tmp_path, text)))
    assert [t["id"] for t in out["tasks"]] == ["1"]


def test_parse_claims_body_reads_derived_provenance_and_does_not_hash_the_header():
    body = _body(_plan(HEADER_ONE_LINE, _task("1", "(derived)")))
    claims = parse_claims_body(body, "1", plan_claim=PLAN_CLAIM)
    assert claims["claim_provenance"] == "derived"
    assert claims["claim"] == "%s (derived)\nMachine: %s" % (OPERATOR, MACHINE_1)
    assert claims["violations"] == []
    expected = hashlib.sha256(
        (claims["claim"] + "\x00" + claims["proof"]).encode("utf-8")).hexdigest()
    assert gate_input_hash(claims["claim"], claims["proof"]) == expected


def test_derived_without_a_plan_level_claim_is_a_violation():
    body = _body(_plan(None, _task("1", "(derived)")))
    claims = parse_claims_body(body, "1", plan_claim=None)
    assert claims["claim_provenance"] == "derived"
    prefix = ("grammar: Claim is marked (derived) but the plan carries no "
              "plan-level Claim")
    assert [v for v in claims["violations"] if v.startswith(prefix)], \
        claims["violations"]


def test_derived_without_a_plan_level_claim_refuses_the_plan(tmp_path):
    _refuses(tmp_path, _plan(None, _task("1", "(derived)")),
             "grammar: Claim is marked (derived) but the plan carries no "
             "plan-level Claim")


def test_the_base_good_plan_still_compiles_with_its_quoted_tag(tmp_path):
    out = _compile(_sign(_write(tmp_path, GOOD_PLAN)))
    assert [t["id"] for t in out["tasks"]] == ["1"]
    claims = parse_claims_body(_body(GOOD_PLAN), "1")
    assert claims["claim_provenance"] == "quoted:#489"
    assert claims["violations"] == []


def test_elicited_and_quoted_are_unchanged_under_a_header_claim(tmp_path):
    tasks = (_task("1", "(elicited)"),
             _task("2", "(quoted from #489)", machine=MACHINE_2))
    with_header = _plan(HEADER_ONE_LINE, *tasks)
    without_header = _plan(None, *tasks)
    out = _compile(_sign(_write(tmp_path, with_header, "with.md")))
    assert [t["id"] for t in out["tasks"]] == ["1", "2"]
    for tid, expected in (("1", "elicited"), ("2", "quoted:#489")):
        signed = parse_claims_body(_body(with_header, tid), tid,
                                   plan_claim=PLAN_CLAIM)
        bare = parse_claims_body(_body(without_header, tid), tid)
        assert signed["claim_provenance"] == expected
        assert bare["claim_provenance"] == expected
        assert (gate_input_hash(signed["claim"], signed["proof"])
                == gate_input_hash(bare["claim"], bare["proof"]))


# ---------------------------------------------------------------------------
# (d) check_provenance.py counts derived claims separately [M3]
# ---------------------------------------------------------------------------

ISSUE_489 = (
    "### What we want\n"
    "\n"
    + OPERATOR + "\n"
    "\n"
    "Filed after the 2026-08 corpus review.\n"
)


def _fake_gh(tmp_path):
    """A `gh` stand-in: prints #489's body, exits 3 for any other issue. No
    network, no real `gh`."""
    path = tmp_path / "fake_gh.py"
    path.write_text(
        "import sys\n"
        "num = sys.argv[sys.argv.index('view') + 1]\n"
        "if num != '489':\n"
        "    sys.exit(3)\n"
        "sys.stdout.write(%r)\n" % ISSUE_489, encoding="utf-8")
    return "%s %s" % (sys.executable, path)


def _provenance(plan, gh):
    return subprocess.run([sys.executable, str(PROVENANCE), str(plan), "--gh", gh],
                          capture_output=True, text=True)


def test_check_provenance_counts_a_derived_claim_in_its_success_line(tmp_path):
    plan = _write(tmp_path, _plan(
        HEADER_ONE_LINE,
        _task("1", "(quoted from #489)"),
        _task("2", "(derived)", machine=MACHINE_2, authorized_by="spec §3")))
    proc = _provenance(plan, _fake_gh(tmp_path))
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert proc.stdout == ("provenance: ok — 1 claim quote, 1 derived and "
                           "1 anchor resolve\n")


def test_check_provenance_prints_the_base_line_with_no_derived_claim(tmp_path):
    plan = _write(tmp_path, _plan(HEADER_ONE_LINE,
                                  _task("1", "(quoted from #489)")))
    proc = _provenance(plan, _fake_gh(tmp_path))
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert proc.stdout == "provenance: ok — 1 claim quote and 1 anchor resolve\n"


# ---------------------------------------------------------------------------
# (e) extract_gate_input.py --plan [M4]
# ---------------------------------------------------------------------------

def _extract(plan, *extra):
    return subprocess.run([sys.executable, str(EXTRACT), str(plan)] + list(extra),
                          capture_output=True, text=True)


def test_extract_gate_input_plan_prints_the_header_claim_and_every_machine(tmp_path):
    text = _plan(HEADER_WRAPPED,
                 _task("1", "(derived)"),
                 _task("2", "(derived)", machine=MACHINE_2))
    proc = _extract(_write(tmp_path, text), "--plan")
    assert proc.returncode == 0, proc.stderr
    got = json.loads(proc.stdout)
    machines = [machine_restatement(
        parse_claims_body(_body(text, tid), tid)["claim"]) for tid in ("1", "2")]
    assert machines == [MACHINE_1, MACHINE_2]
    assert got == {
        "claim": PLAN_CLAIM,
        "tasks": [{"id": "1", "machine": MACHINE_1},
                  {"id": "2", "machine": MACHINE_2}],
        "hash": hashlib.sha256(
            (PLAN_CLAIM + "\x00" + "\n".join(machines)).encode("utf-8")).hexdigest(),
    }


def test_extract_gate_input_plan_refuses_a_plan_with_no_header_claim(tmp_path):
    plan = _write(tmp_path, _plan(None, _task("1", "(quoted from #489)")))
    proc = _extract(plan, "--plan")
    assert proc.returncode != 0
    assert "plan-level Claim" in proc.stdout + proc.stderr


def test_extract_gate_input_refuses_plan_and_task_together(tmp_path):
    plan = _write(tmp_path, _plan(HEADER_ONE_LINE, _task("1", "(derived)")))
    proc = _extract(plan, "--plan", "--task", "1")
    assert proc.returncode != 0


def test_extract_gate_input_task_is_unchanged(tmp_path):
    text = _plan(HEADER_ONE_LINE, _task("1", "(derived)"))
    proc = _extract(_write(tmp_path, text), "--task", "1")
    assert proc.returncode == 0, proc.stderr
    got = json.loads(proc.stdout)
    claims = parse_claims_body(_body(text, "1"), "1", plan_claim=PLAN_CLAIM)
    assert got == {"task": "1", "claim": claims["claim"],
                   "proof": claims["proof"],
                   "hash": gate_input_hash(claims["claim"], claims["proof"])}


# ---------------------------------------------------------------------------
# (f) --emit-args carries planClaim [M5]
# ---------------------------------------------------------------------------

ARGS_KEYS = ["waves", "wavesPath", "edges", "dependencyEdges", "acceptance",
             "waveLabels", "globalConstraints", "constraintChecks", "planPath"]


def _emit_args(tmp_path, plan_text, name):
    plan = _sign(_write(tmp_path, plan_text, name + ".md"))
    launch = tmp_path / (name + ".launch.json")
    args_file = tmp_path / (name + ".args.json")
    proc = _run(plan, "--emit-launch", str(launch), "--emit-args", str(args_file))
    assert proc.returncode == 0, proc.stderr
    return json.loads(args_file.read_text())


def test_emit_args_writes_the_plan_claim(tmp_path):
    payload = _emit_args(tmp_path, _plan(HEADER_ONE_LINE, _task("1", "(derived)")),
                         "signed")
    assert payload["planClaim"] == PLAN_CLAIM
    assert sorted(k for k in payload if k != "planClaim") == sorted(ARGS_KEYS)


def test_emit_args_writes_null_without_a_plan_claim(tmp_path):
    payload = _emit_args(tmp_path, _plan(None, _task("1", "(quoted from #489)")),
                         "bare")
    assert payload["planClaim"] is None
    assert sorted(k for k in payload if k != "planClaim") == sorted(ARGS_KEYS)


# ---------------------------------------------------------------------------
# (g) SKILL.md names the header Claim and the derived tag [M6]
# ---------------------------------------------------------------------------

def _paragraph(text, lead):
    lines = text.splitlines()
    start = next(i for i, l in enumerate(lines) if l.startswith(lead))
    end = start
    while end < len(lines) and lines[end].strip():
        end += 1
    return "\n".join(lines[start:end])


def test_skill_the_document_names_the_header_claim_line():
    para = _paragraph(SKILL.read_text(encoding="utf-8"), "Above the first task:")
    assert para.count("**Claim:**") == 1, para


def test_skill_self_review_names_derived_and_the_plan_level_claim():
    text = SKILL.read_text(encoding="utf-8")
    tail = text.split("## Self-review", 1)[1]
    assert "(derived)" in tail
    assert "plan-level Claim" in tail


def test_skill_still_validates():
    proc = subprocess.run([sys.executable, str(VALIDATE), str(SKILL.parent)],
                          capture_output=True, text=True)
    assert proc.returncode == 0, proc.stdout + proc.stderr
