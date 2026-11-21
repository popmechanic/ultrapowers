import importlib.util
import json
import os
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
CENSUS = ROOT / "skills/ultrawrite/scripts/authoring_census.py"


def tsv(*cells):
    return "\t".join(cells)


RECORD_131 = {
    "tasks": [{"id": "1", "verdict": "pass"}],
    "tally": {"dispatched": 4, "rejected": 1},
    "authoring": {
        "minutes": 118,
        "routing": {"branch": "risk", "lane": "ultrapowers"},
        "questions": [
            {"question": "Claim and summary", "options": ["A", "B"],
             "recommended": "A", "picked": "A", "explain_rounds": 2},
        ],
    },
}

RECORD_133 = {
    "tasks": [{"id": "1", "verdict": "pass"}],
    "tally": {"dispatched": 2},
    "authoring": {
        "minutes": 47,
        "routing": {"branch": "width", "lane": "ultrapowers"},
        "questions": [
            {"question": "Lane and shape",
             "options": ["ultrapowers", "subagent", "inline"],
             "recommended": None, "picked": "subagent"},
            {"question": "Probe budget", "options": ["8", "12"],
             "recommended": "12", "picked": "12"},
        ],
    },
}

RECORD_9 = {
    "tasks": [{"id": "1", "verdict": "pass"}],
    "tally": {"dispatched": 3, "rejected": 0},
}

STATUS_131 = {
    "run": "131",
    "state": "done",
    "phase": "merged",
    "pr": "https://github.com/o/r/pull/1",
    "prAuthor": "o",
    "merged": "a" * 40,
    "branch": "ultra/integration-run-131",
    "vm": "fleet-r131-x",
    "startedAt": "2026-08-30T22:40:00Z",
    "updatedAt": "2026-08-30T22:56:30Z",
    "error": None,
}


def blob(obj):
    return (json.dumps(obj, indent=2) + "\n").encode("utf-8")


COLUMN_NAMES = ("run", "authoring_min", "dispatched", "rejected",
                "routing", "lane", "questions", "recommended_picked",
                "run_min", "explain_rounds")

HEADER = tsv(*COLUMN_NAMES)

ROW_9 = tsv("9", "-", "3", "0", "-", "-", "-", "-", "-", "-")
ROW_131 = tsv("131", "118", "4", "1", "risk", "ultrapowers", "1",
              "1/1", "16", "2")
ROW_133 = tsv("133", "47", "2", "-", "width", "ultrapowers", "2",
              "1/1", "-", "0")
TOTALS = ("totals: plans=3 runs=9..133 risk_override=1/2 "
          "recommended_picked=2/2 authoring_min=165 run_min=16 "
          "explain_rounds=2")

TABLE = [HEADER, ROW_9, ROW_131, ROW_133, TOTALS]

REGISTER = [
    tsv("run-131", "q1", "Claim and summary", "A", "rec", "picked"),
    tsv("run-131", "q1", "Claim and summary", "B", "-", "-"),
    tsv("run-133", "q1", "Lane and shape", "ultrapowers", "-", "-"),
    tsv("run-133", "q1", "Lane and shape", "subagent", "-", "picked"),
    tsv("run-133", "q1", "Lane and shape", "inline", "-", "-"),
    tsv("run-133", "q2", "Probe budget", "8", "-", "-"),
    tsv("run-133", "q2", "Probe budget", "12", "rec", "picked"),
]


def census(*args, env=None):
    assert CENSUS.is_file(), (
        "the census script does not exist yet: %s" % CENSUS)
    return subprocess.run([sys.executable, str(CENSUS), *args],
                          capture_output=True, text=True, env=env)


def write_run(root, number, record, status=None):
    d = root / ("run-%s" % number)
    d.mkdir(parents=True)
    if record is not None:
        (d / "gate-verdicts.json").write_bytes(blob(record))
    if status is not None:
        (d / "status.json").write_bytes(blob(status))
    return d


def build_root(tmp_path, name="census", runs=None):
    if runs is None:
        runs = [(131, RECORD_131, STATUS_131),
                (133, RECORD_133, None),
                (9, RECORD_9, None)]
    root = tmp_path / name
    root.mkdir()
    for number, record, status in runs:
        write_run(root, number, record, status)
    return root


DECOY = """#!/bin/sh
printf '%s\\n' "$*" >> '{log}'
exit 1
"""


def decoy_env(tmp_path, name="decoy"):
    bindir = tmp_path / name
    bindir.mkdir()
    log = bindir / "bare-gh.log"
    gh = bindir / "gh"
    gh.write_text(DECOY.format(log=log))
    gh.chmod(0o755)
    env = dict(os.environ)
    env["PATH"] = str(bindir) + os.pathsep + env["PATH"]
    return env, log


FAKE_GH = '''#!/usr/bin/env python3
"""A `gh` that answers a contents read from a table keyed on argv[1]."""
import base64
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
argv = sys.argv[1:]
with (HERE / "calls.jsonl").open("a") as fh:
    fh.write(json.dumps(argv) + "\\n")
table = json.loads((HERE / "answers.json").read_text())
body = table.get(argv[1]) if len(argv) > 1 else None
if body is None:
    # No digits of its own: the one stderr line naming the skipped run can
    # then only be the script's.
    sys.stderr.write("gh: that ref carries no such file\\n")
    sys.exit(1)
payload = base64.b64encode(body.encode("utf-8")).decode("ascii")
wrapped = "\\n".join(payload[i:i + 60] for i in range(0, len(payload), 60))
sys.stdout.write(json.dumps({
    "name": Path(argv[1].split("?")[0]).name,
    "encoding": "base64",
    "content": wrapped + "\\n",
}) + "\\n")
'''


def fake_gh(tmp_path, answers, name="fakebin"):
    bindir = tmp_path / name
    bindir.mkdir()
    (bindir / "answers.json").write_text(json.dumps(answers))
    gh = bindir / "gh-fake"
    gh.write_text(FAKE_GH)
    gh.chmod(0o755)
    return gh, bindir / "calls.jsonl"


EVIDENCE = "ops/evidence"


def run_file_path(number, name, evidence=EVIDENCE):
    return ("repos/%s/contents/runs/o-r/%d/%s?ref=o-r/run-%d"
            % (evidence, number, name, number))


def plan_path(number, evidence=EVIDENCE):
    return run_file_path(number, "gate-verdicts.json", evidence)


def status_path(number, evidence=EVIDENCE):
    return run_file_path(number, "status.json", evidence)


def call_log(calls):
    return [json.loads(line) for line in lines(calls.read_text())
            if line.strip()]


def lines(text):
    return text.splitlines()


def test_a_the_table_over_three_runs(tmp_path):
    root = build_root(tmp_path)
    p = census("--from", str(root))
    assert p.returncode == 0, p.stdout + p.stderr
    assert lines(p.stdout) == TABLE, p.stdout


def test_a_the_header_line_is_exact(tmp_path):
    root = build_root(tmp_path)
    p = census("--from", str(root))
    assert lines(p.stdout)[0] == HEADER, p.stdout


def test_a_a_record_without_an_authoring_key_is_dashes_but_for_its_tally(
        tmp_path):
    root = build_root(tmp_path)
    p = census("--from", str(root))
    assert ROW_9 in lines(p.stdout), p.stdout
    assert lines(p.stdout)[1] == ROW_9, p.stdout


def test_a_a_tally_without_rejected_and_a_run_without_status_are_dashes(
        tmp_path):
    root = build_root(tmp_path)
    p = census("--from", str(root))
    assert ROW_133 in lines(p.stdout), p.stdout


def test_a_run_min_is_whole_minutes_rounded_down(tmp_path):
    root = build_root(tmp_path)
    p = census("--from", str(root))
    assert ROW_131 in lines(p.stdout), p.stdout
    assert lines(p.stdout)[2].split("\t")[-2] == "16", p.stdout


def test_a_the_totals_line_is_exact(tmp_path):
    root = build_root(tmp_path)
    p = census("--from", str(root))
    assert lines(p.stdout)[-1] == TOTALS, p.stdout


def test_b_a_run_directory_without_a_record_earns_no_row(tmp_path):
    root = build_root(tmp_path)
    write_run(root, 150, None, STATUS_131)
    p = census("--from", str(root))
    assert p.returncode == 0, p.stdout + p.stderr
    assert lines(p.stdout) == TABLE, p.stdout
    assert "150" not in p.stdout, p.stdout


def test_c_register_prints_one_line_per_option(tmp_path):
    root = build_root(tmp_path)
    p = census("--register", "--from", str(root))
    assert p.returncode == 0, p.stdout + p.stderr
    assert lines(p.stdout) == REGISTER, p.stdout
    assert HEADER not in p.stdout, p.stdout
    assert "totals:" not in p.stdout, p.stdout


def test_c_register_marks_the_recommended_and_the_picked_option(tmp_path):
    root = build_root(tmp_path)
    p = census("--register", "--from", str(root))
    got = [line for line in lines(p.stdout) if line.startswith("run-131\t")]
    assert got == [
        tsv("run-131", "q1", "Claim and summary", "A", "rec", "picked"),
        tsv("run-131", "q1", "Claim and summary", "B", "-", "-"),
    ], p.stdout


def test_c_register_leaves_the_rec_column_dashed_for_a_null_recommended(
        tmp_path):
    root = build_root(tmp_path)
    p = census("--register", "--from", str(root))
    q1 = [line.split("\t") for line in lines(p.stdout)
          if line.startswith("run-133\tq1\t")]
    assert len(q1) == 3, p.stdout
    assert [cells[4] for cells in q1] == ["-", "-", "-"], p.stdout
    assert [cells[5] for cells in q1] == ["-", "picked", "-"], p.stdout
    q2 = [line for line in lines(p.stdout) if line.startswith("run-133\tq2\t")]
    assert q2 == [
        tsv("run-133", "q2", "Probe budget", "8", "-", "-"),
        tsv("run-133", "q2", "Probe budget", "12", "rec", "picked"),
    ], p.stdout


def fetch_answers():
    return {
        plan_path(131): blob(RECORD_131).decode("utf-8"),
        plan_path(133): blob(RECORD_133).decode("utf-8"),
        status_path(131): blob(STATUS_131).decode("utf-8"),
    }


def run_fetch(tmp_path, answers=None, runs="131..133",
              repo_args=("--evidence-repo", EVIDENCE)):
    into = tmp_path / "fetched"
    into.mkdir()
    gh, calls = fake_gh(tmp_path, fetch_answers() if answers is None
                        else answers)
    env, bare_log = decoy_env(tmp_path)
    env["HOME"] = str(tmp_path / "home")
    p = census("--fetch", "o/r", "--runs", runs, "--into", str(into),
               "--gh", str(gh), *repo_args, env=env)
    return p, into, calls, bare_log


def test_d_fetch_writes_the_decoded_files(tmp_path):
    p, into, _calls, _bare = run_fetch(tmp_path)
    assert (into / "run-131/gate-verdicts.json").read_bytes() == \
        blob(RECORD_131), p.stdout + p.stderr
    assert (into / "run-131/status.json").read_bytes() == blob(STATUS_131), \
        p.stdout + p.stderr
    assert (into / "run-133/gate-verdicts.json").read_bytes() == \
        blob(RECORD_133), p.stdout + p.stderr


def test_d_a_plan_tag_without_a_record_is_skipped_with_one_stderr_line(
        tmp_path):
    p, into, _calls, _bare = run_fetch(tmp_path)
    assert not (into / "run-132").exists(), sorted(
        q.name for q in into.iterdir())
    named = [line for line in lines(p.stderr) if "132" in line]
    assert len(named) == 1, p.stderr


def test_d_a_missing_status_leaves_the_file_unwritten(tmp_path):
    p, into, _calls, _bare = run_fetch(tmp_path)
    assert not (into / "run-133/status.json").exists(), p.stdout + p.stderr
    assert ROW_133 in lines(p.stdout), p.stdout


def test_d_fetch_then_prints_the_table_over_the_directory(tmp_path):
    p, _into, _calls, _bare = run_fetch(tmp_path)
    assert lines(p.stdout) == [
        HEADER, ROW_131, ROW_133,
        ("totals: plans=2 runs=131..133 risk_override=1/2 "
         "recommended_picked=2/2 authoring_min=165 run_min=16 "
         "explain_rounds=2"),
    ], p.stdout + p.stderr


def test_d_every_gh_call_is_an_api_read_of_the_expected_ref(tmp_path):
    p, _into, calls, _bare = run_fetch(tmp_path)
    argvs = [json.loads(line) for line in lines(calls.read_text())
             if line.strip()]
    assert argvs, "the fake `gh` was never invoked: " + p.stdout + p.stderr
    expected = {plan_path(n) for n in (131, 132, 133)}
    expected |= {status_path(n) for n in (131, 132, 133)}
    for argv in argvs:
        assert argv[0] == "api", argv
        assert argv[1].startswith("repos/ops/evidence/contents/runs/o-r/"), \
            argv
        assert argv[1] in expected, argv
        for token in argv:
            for owner_repo in re.findall(r"repos/([^/]+/[^/?]+)", token):
                assert owner_repo == EVIDENCE, argv
    made = {argv[1] for argv in argvs}
    for required in (plan_path(131), plan_path(132), plan_path(133),
                     status_path(131), status_path(133)):
        assert required in made, sorted(made)
    assert status_path(132) not in made, sorted(made)


def test_d_the_bare_gh_on_path_is_never_resolved(tmp_path):
    p, _into, _calls, bare_log = run_fetch(tmp_path)
    assert not bare_log.exists(), bare_log.read_text() + p.stdout + p.stderr


def test_the_contents_path_is_byte_exact():
    module = load_module()
    assert module.evidence_contents_path(
        "ops/evidence", "o/r", 5, "status.json") == \
        "repos/ops/evidence/contents/runs/o-r/5/status.json?ref=o-r/run-5"


def test_the_flag_asks_for_exactly_the_two_run_folder_paths(tmp_path):
    answers = {
        plan_path(5): blob(RECORD_131).decode("utf-8"),
        status_path(5): blob(STATUS_131).decode("utf-8"),
    }
    p, into, calls, _bare = run_fetch(tmp_path, answers=answers, runs="5..5")
    assert p.returncode == 0, p.stdout + p.stderr
    assert sorted(argv[1] for argv in call_log(calls)) == sorted(answers), \
        call_log(calls)
    for name in ("gate-verdicts.json", "status.json"):
        assert (into / "run-5" / name).is_file(), name


def test_the_config_key_steers_the_reads(tmp_path):
    config = tmp_path / "fleet.json"
    config.write_text(json.dumps({"evidence": "cfg/ev"}))
    answers = {plan_path(5, "cfg/ev"): blob(RECORD_131).decode("utf-8")}
    p, into, calls, _bare = run_fetch(
        tmp_path, answers=answers, runs="5..5",
        repo_args=("--config", str(config)))
    assert p.returncode == 0, p.stdout + p.stderr
    assert sorted(argv[1] for argv in call_log(calls)) == sorted([
        plan_path(5, "cfg/ev"), status_path(5, "cfg/ev")]), call_log(calls)
    assert (into / "run-5/gate-verdicts.json").read_bytes() == \
        blob(RECORD_131)


def test_the_flag_wins_over_the_config(tmp_path):
    config = tmp_path / "fleet.json"
    config.write_text(json.dumps({"evidence": "cfg/ev"}))
    p, _into, calls, _bare = run_fetch(
        tmp_path, answers={}, runs="5..5",
        repo_args=("--evidence-repo", EVIDENCE, "--config", str(config)))
    assert [argv[1] for argv in call_log(calls)] == [plan_path(5)], \
        call_log(calls)


def test_a_config_without_the_key_exits_2_naming_it_and_calls_no_gh(tmp_path):
    config = tmp_path / "fleet.json"
    config.write_text(json.dumps({"other": "x"}))
    p, _into, calls, bare_log = run_fetch(
        tmp_path, runs="5..5", repo_args=("--config", str(config)))
    assert p.returncode == 2, p.stdout + p.stderr
    assert any("evidence" in line for line in lines(p.stderr)), p.stderr
    assert not calls.exists(), calls.read_text()
    assert not bare_log.exists(), bare_log.read_text()


def test_a_missing_default_config_exits_2_and_calls_no_gh(tmp_path):
    p, _into, calls, bare_log = run_fetch(tmp_path, runs="5..5", repo_args=())
    assert p.returncode == 2, p.stdout + p.stderr
    assert "evidence" in p.stderr, p.stderr
    assert not calls.exists(), calls.read_text()
    assert not bare_log.exists(), bare_log.read_text()


def load_module():
    assert CENSUS.is_file(), (
        "the census script does not exist yet: %s" % CENSUS)
    spec = importlib.util.spec_from_file_location("authoring_census", CENSUS)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
