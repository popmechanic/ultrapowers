"""The `**Acceptance:**` line leaves the grammar (task 1).

The claim: a plan with no `**Acceptance:**` line compiles, and a plan that
still carries one compiles the same way — the line is prose the compiler never
reads.

Each test names the Machine clause and the Proof leg it encodes:

* leg (a) [M1] — for each of four plan variants (no line, `suite`, `waived`,
  `sealed`) `--check` exits 0 with `PLAN OK` as its first stdout line, and the
  four plain-compile `waves` are pairwise equal.
* leg (b) [M2] — the plain-compile JSON of `evals/fixtures/claims/plan.md`
  carries none of `acceptance`, `gates`, `post_merge_runbook`, `allHeuristic`.
* leg (c) [M2] — that same JSON still carries each of the ten surviving keys.
* leg (d) [M3] — the source of `compile_plan.py` mentions none of the seven
  retired identifiers, and no line mentions the `sealed-acceptance-design`
  spec filename.

The four variant plans are written under the test's own `tmp_path`: a copy of
the claims fixture with only the Acceptance line varied.
"""
import itertools
import json
import pathlib
import shutil
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
CLAIMS_FIXTURE = ROOT / "evals/fixtures/claims/plan.md"
# The gate-verdict sidecar the claims-v1 grammar requires beside any claims
# plan. It travels with every variant copy — it is keyed on each task's
# (Claim, Proof) hash, and varying the header's Acceptance line touches
# neither, so the same record stays valid for all four variants.
CLAIMS_VERDICTS = CLAIMS_FIXTURE.with_name(
    CLAIMS_FIXTURE.stem + ".gate-verdicts.json")

SEALED_LINE = "**Acceptance:** sealed deadbeef (sha256:{})".format("0" * 64)

# The four variants of M1, in the clause's own order. `None` is the plan with
# no `**Acceptance:**` line at all.
VARIANTS = {
    "no-line": None,
    "suite": "**Acceptance:** suite — x",
    "waived": "**Acceptance:** waived — x",
    "sealed": SEALED_LINE,
}

# M2: the keys the compiled JSON must no longer carry...
DEAD_KEYS = ("acceptance", "gates", "post_merge_runbook", "allHeuristic")
# ...and the ten it must still carry.
SURVIVING_KEYS = ("waves", "launch_waves", "dag_edges", "tasks", "waveLabels",
                  "globalConstraints", "constraintChecks", "marker_conflicts",
                  "mode", "degrade_reason")

# M3: seven identifiers plus the spec filename, none of which may appear in
# the compiler's source.
RETIRED_TOKENS = ("parse_acceptance", "ACCEPT_SEALED", "ACCEPT_WAIVED",
                  "ACCEPT_SUITE", "ACCEPTANCE_MISSING_ERROR", "allHeuristic",
                  "post_merge_runbook", "sealed-acceptance-design")


def _plan_text(acceptance_line):
    """The claims fixture with its Acceptance line replaced or removed."""
    lines = CLAIMS_FIXTURE.read_text().splitlines()
    kept = [ln for ln in lines if not ln.startswith("**Acceptance:**")]
    if acceptance_line is None:
        return "\n".join(kept) + "\n"
    # Put the line back where the fixture keeps it: in the plan header, right
    # after the `**Grammar:**` marker.
    for i, ln in enumerate(kept):
        if ln.startswith("**Grammar:**"):
            out = kept[:i + 1] + ["", acceptance_line] + kept[i + 1:]
            return "\n".join(out) + "\n"
    raise AssertionError(
        "fixture {} carries no **Grammar:** line — cannot build the "
        "Acceptance variants from it".format(CLAIMS_FIXTURE))


def _write_variant(tmp_path, name, acceptance_line):
    """Write one variant plan (plus its verdict sidecar) and return its path."""
    d = tmp_path / name
    d.mkdir(parents=True, exist_ok=True)
    plan = d / "plan.md"
    plan.write_text(_plan_text(acceptance_line))
    shutil.copyfile(CLAIMS_VERDICTS, d / (plan.stem + ".gate-verdicts.json"))
    if acceptance_line is None:
        assert "**Acceptance:**" not in plan.read_text(), (
            "the no-line variant still carries an **Acceptance:** line")
    else:
        assert acceptance_line in plan.read_text(), (
            "variant {} lost its Acceptance line".format(name))
    return plan


def _compile(*argv):
    return subprocess.run([sys.executable, str(COMPILER), *argv],
                          capture_output=True, text=True, cwd=str(ROOT))


# --------------------------------------------------------------------------
# leg (a) [M1]: every variant checks green, and all four compile to the same
# waves — a variant that exits non-zero or whose waves differ names itself.
# --------------------------------------------------------------------------

@pytest.mark.parametrize("name", list(VARIANTS))
def test_check_exits_zero_with_plan_ok_for_every_acceptance_variant(
        name, tmp_path):
    """leg (a) [M1] — `--check <plan>` exits 0, first stdout line `PLAN OK`."""
    plan = _write_variant(tmp_path, name, VARIANTS[name])
    proc = _compile("--check", str(plan))
    assert proc.returncode == 0, (
        "variant {!r}: --check exited {} — stdout: {!r} stderr: {!r}".format(
            name, proc.returncode, proc.stdout, proc.stderr))
    first = proc.stdout.splitlines()[0] if proc.stdout.splitlines() else ""
    assert first == "PLAN OK", (
        "variant {!r}: first stdout line is {!r}, not 'PLAN OK'".format(
            name, first))


def test_all_four_acceptance_variants_compile_to_the_same_waves(tmp_path):
    """leg (a) [M1] — the four plain-compile `waves` are pairwise equal."""
    waves = {}
    for name, line in VARIANTS.items():
        plan = _write_variant(tmp_path, name, line)
        proc = _compile(str(plan))
        assert proc.returncode == 0, (
            "variant {!r}: plain compile exited {} — stderr: {!r}".format(
                name, proc.returncode, proc.stderr))
        waves[name] = json.loads(proc.stdout)["waves"]
    # The fixture has three implementation tasks, so equality here is never
    # the vacuous equality of two empty plans.
    assert waves["no-line"], (
        "the no-line variant compiled to empty waves: {!r}".format(
            waves["no-line"]))
    for a, b in itertools.combinations(VARIANTS, 2):
        assert waves[a] == waves[b], (
            "waves differ between variant {!r} ({!r}) and variant {!r} "
            "({!r})".format(a, waves[a], b, waves[b]))


# --------------------------------------------------------------------------
# legs (b) and (c) [M2]: the compiled shape of the claims fixture.
# --------------------------------------------------------------------------

@pytest.fixture(scope="module")
def claims_fixture_json():
    proc = _compile(str(CLAIMS_FIXTURE))
    assert proc.returncode == 0, (
        "plain compile of {} exited {} — stderr: {!r}".format(
            CLAIMS_FIXTURE, proc.returncode, proc.stderr))
    return json.loads(proc.stdout)


@pytest.mark.parametrize("key", DEAD_KEYS)
def test_dead_key_is_absent_from_the_compiled_json(key, claims_fixture_json):
    """leg (b) [M2] — the retired output key is gone from the compile."""
    assert key not in claims_fixture_json, (
        "compiled JSON of {} still carries the retired key {!r}".format(
            CLAIMS_FIXTURE.name, key))


@pytest.mark.parametrize("key", SURVIVING_KEYS)
def test_surviving_key_is_present_in_the_compiled_json(key,
                                                       claims_fixture_json):
    """leg (c) [M2] — each of the ten surviving keys is still emitted."""
    assert key in claims_fixture_json, (
        "compiled JSON of {} is missing the surviving key {!r} — keys: "
        "{}".format(CLAIMS_FIXTURE.name, key,
                    sorted(claims_fixture_json)))


# --------------------------------------------------------------------------
# leg (d) [M3]: the compiler's source mentions none of the retired names.
# --------------------------------------------------------------------------

@pytest.mark.parametrize("token", RETIRED_TOKENS)
def test_retired_identifier_is_gone_from_the_compiler_source(token):
    """leg (d) [M3] — `grep -c <token> compile_plan.py` is 0."""
    hits = [(n, ln) for n, ln in enumerate(
        COMPILER.read_text().splitlines(), 1) if token in ln]
    assert hits == [], (
        "{} still mentions {!r} on {} line(s): {}".format(
            COMPILER.name, token, len(hits),
            "; ".join("{}: {}".format(n, ln.strip()[:80]) for n, ln in hits[:3])))
