# tests/test_residual_manifest.py
import hashlib
import json
import subprocess
import sys
from pathlib import Path

SCRIPT = (Path(__file__).resolve().parents[1] /
          "skills/ultrapowers/scripts/residual_manifest.py")

CF = "Task 2 endpoint lacks a timeout test"
JC = "degradation: task 3 budget-deferred (budget exhausted at wave 2)"
DV_BROWSER = {"deliverable": "viewer/swarm.html", "reason": "browser",
              "why": "live UI flow"}
DV_RUNTIME = {"deliverable": "deploy hook", "reason": "runtime",
              "why": "needs prod boot"}


def rid(family, text):
    norm = " ".join(text.split())
    return family + "-" + hashlib.sha256(norm.encode("utf-8")).hexdigest()[:12]


def report(**over):
    result = {"integrationBranch": "ultra/int-1", "waves": [["1"]],
              "tasks": [{"task": "1", "status": "done"}],
              "tests": {"passed": True}, "unfinished": [],
              "completenessFindings": [CF], "judgmentCalls": [JC],
              "deferredVerification": [DV_BROWSER, DV_RUNTIME]}
    result.update(over)
    return {"summary": "workflow envelope", "result": result}


def write(tmp_path, name, obj):
    p = tmp_path / name
    p.write_text(json.dumps(obj))
    return p


def run(*argv):
    return subprocess.run([sys.executable, str(SCRIPT), *map(str, argv)],
                          capture_output=True, text=True)


def manifest_rows(stdout):
    return [l for l in stdout.splitlines() if l.startswith("- ")]


def test_derive_emits_exact_rows_for_all_three_families(tmp_path):
    rp = write(tmp_path, "report.json", report())
    r = run(rp)
    assert r.returncode == 0, r.stderr
    dv_browser_text = "viewer/swarm.html (browser) — live UI flow"
    dv_runtime_text = "deploy hook (runtime) — needs prod boot"
    assert manifest_rows(r.stdout) == [
        "- %s [completenessFindings] %s — disposition:"
        % (rid("completenessFindings", CF), CF),
        "- %s [judgmentCalls] %s — disposition:"
        % (rid("judgmentCalls", JC), JC),
        "- %s [deferredVerification] %s — disposition:"
        % (rid("deferredVerification", dv_browser_text), dv_browser_text),
        "- %s [deferredVerification] %s — disposition:"
        % (rid("deferredVerification", dv_runtime_text), dv_runtime_text),
    ]


def test_multi_report_union_dedupes_by_content_id(tmp_path):
    r1 = write(tmp_path, "r1.json", report())
    r2 = write(tmp_path, "r2.json",
               report(completenessFindings=[CF, "second-round-only finding"]))
    rows_single = manifest_rows(run(r1).stdout)
    rows_union = manifest_rows(run(r1, r2).stdout)
    # the same finding in two rounds -> ONE row with the SAME id
    assert len(rows_union) == len(rows_single) + 1
    assert set(rows_single) < set(rows_union)
    assert any("second-round-only finding" in row for row in rows_union)


def test_byte_identical_duplicates_within_one_report_get_tiebreak_ids(tmp_path):
    rp = write(tmp_path, "r.json", report(judgmentCalls=[JC, JC, JC]))
    rows = manifest_rows(run(rp).stdout)
    base = rid("judgmentCalls", JC)
    ids = [row.split()[1] for row in rows if "[judgmentCalls]" in row]
    assert ids == [base, base + "-2", base + "-3"]


def test_gate_acks_prefills_only_recorded_items(tmp_path):
    rp = write(tmp_path, "r.json", report())
    sa = write(tmp_path, "standing-approval.json", {
        "grantedAt": "turn-3",
        "instruction": "approve if clean apart from the usual runtime acks",
        "ackList": [{"type": "deferred:runtime",
                     "detail": "deploy hook — needs prod boot "
                               "[structural false-green: sandbox could not "
                               "execute it against the target]"}]})
    rows = manifest_rows(run(rp, "--gate-acks", sa).stdout)
    runtime = [x for x in rows if "deploy hook (runtime)" in x]
    browser = [x for x in rows if "viewer/swarm.html (browser)" in x]
    assert runtime and runtime[0].endswith("— disposition: acked")
    assert browser and browser[0].endswith("— disposition:")


def test_gate_acks_prefill_is_item_specific_on_why(tmp_path):
    # same deliverable+reason, different why: a recorded ack for one must
    # not pre-fill the other
    dv_other = {"deliverable": "deploy hook", "reason": "runtime",
                "why": "needs secrets rotation"}
    rp = write(tmp_path, "r.json",
               report(deferredVerification=[DV_RUNTIME, dv_other]))
    sa = write(tmp_path, "standing-approval.json", {
        "ackList": [{"type": "deferred:runtime",
                     "detail": "deploy hook — needs prod boot "
                               "[structural false-green: sandbox could not "
                               "execute it against the target]"}]})
    rows = manifest_rows(run(rp, "--gate-acks", sa).stdout)
    boot = [x for x in rows if "needs prod boot" in x]
    other = [x for x in rows if "needs secrets rotation" in x]
    assert boot and boot[0].endswith("— disposition: acked")
    assert other and other[0].endswith("— disposition:")


def test_derive_dies_on_standing_approval_shaped_json(tmp_path):
    # a readable JSON dict that is NOT a report (no family keys, no report
    # markers) must die exit 1 naming the path, never emit a vacuous-green
    # empty manifest
    sa = write(tmp_path, "standing-approval.json", {
        "grantedAt": "turn-3",
        "instruction": "approve if clean apart from the usual runtime acks",
        "ackList": [{"type": "deferred:runtime",
                     "detail": "deploy hook — needs prod boot"}]})
    r = run(sa)
    assert r.returncode == 1
    assert str(sa) in r.stderr


def test_derive_dies_on_json_list(tmp_path):
    p = write(tmp_path, "list.json", [{"tasks": []}])
    r = run(p)
    assert r.returncode == 1
    assert str(p) in r.stderr


def test_derive_dies_on_non_dict_envelope_result(tmp_path):
    p = write(tmp_path, "env.json", {"summary": "s", "result": "oops"})
    r = run(p)
    assert r.returncode == 1
    assert str(p) in r.stderr


def test_derive_accepts_marker_report_with_zero_family_keys(tmp_path):
    # a genuine report that omits all three families still derives (zero rows)
    result = {"integrationBranch": "ultra/int-1", "waves": [["1"]],
              "tasks": [{"task": "1", "status": "done"}],
              "tests": {"passed": True}, "unfinished": []}
    rp = write(tmp_path, "r.json", {"summary": "workflow envelope",
                                    "result": result})
    r = run(rp)
    assert r.returncode == 0, r.stderr
    assert manifest_rows(r.stdout) == []


def test_bare_result_object_accepted(tmp_path):
    rp = write(tmp_path, "r.json", report()["result"])
    r = run(rp)
    assert r.returncode == 0
    assert len(manifest_rows(r.stdout)) == 4


def test_check_green_on_fully_dispositioned_manifest(tmp_path):
    rp = write(tmp_path, "r.json", report())
    values = iter(["fixed", "filed:#152", "acked",
                   "waived:sandbox cannot reach prod"])
    dispositioned = []
    for line in run(rp).stdout.splitlines():
        if line.startswith("- ") and line.endswith("disposition:"):
            line = line + " " + next(values)
        dispositioned.append(line)
    m = tmp_path / "residual-manifest.md"
    m.write_text("\n".join(dispositioned) + "\nfree commentary, ignored\n")
    r = run("--check", m)
    assert r.returncode == 0, r.stderr


def test_check_zero_row_manifest_passes_vacuously(tmp_path):
    m = tmp_path / "residual-manifest.md"
    m.write_text("# Residual manifest\n\nNo residual findings.\n")
    assert run("--check", m).returncode == 0


def test_check_red_names_undispositioned_and_invalid_rows(tmp_path):
    rp = write(tmp_path, "r.json", report())
    rows = manifest_rows(run(rp).stdout)
    fixed, empty, invalid = rows[0] + " fixed", rows[1], rows[2] + " done"
    m = tmp_path / "residual-manifest.md"
    m.write_text("\n".join([fixed, empty, invalid]) + "\n")
    r = run("--check", m)
    assert r.returncode == 2
    assert empty.split()[1] in r.stderr
    assert invalid.split()[1] in r.stderr
    assert fixed.split()[1] not in r.stderr


def test_check_red_pins_malformed_disposition_values(tmp_path):
    # each of these must stay red (exit 2): bare filed:, bare waived:,
    # waived: with trailing space only, wrong-case Fixed, freeform prose
    rp = write(tmp_path, "r.json", report())
    row = manifest_rows(run(rp).stdout)[0]
    for value in ("filed:", "waived:", "waived: ", "Fixed",
                  "acked because reasons"):
        m = tmp_path / "residual-manifest.md"
        m.write_text(row + " " + value + "\n")
        r = run("--check", m)
        assert r.returncode == 2, (value, r.stdout, r.stderr)
        assert row.split()[1] in r.stderr, value


def test_derive_without_reports_exits_1():
    r = run()
    assert r.returncode == 1
    assert "derive mode needs" in r.stderr
