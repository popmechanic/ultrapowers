# tests/test_ab_runner.py
import json, os, pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "evals"))
import ab_runner
from ab_runner import main

CRED = json.dumps({"claudeAiOauth": {"accessToken": "tok-x"}})


def _fixture_tree(tmp_path):
    fx = tmp_path / "fixtures" / "mini"
    (fx / "project").mkdir(parents=True)
    (fx / "project" / "app.py").write_text("x = 1\n")
    (fx / "plan.md").write_text("# P\n\n### Task 1: A\n")
    return tmp_path / "fixtures"


def _stub_run(record, engine_exit=0):
    """One stub for every subprocess: answers the Keychain probe with CRED and
    fabricates a run dir when the engine command appears."""
    class R:
        def __init__(self, code, out=""):
            self.returncode, self.stdout, self.stderr = code, out, ""
    def run(cmd, **kw):
        record.append((cmd, kw))
        if cmd[0] == "security":
            return R(0, CRED)
        if cmd[0] == "node":
            cell = pathlib.Path(cmd[cmd.index("--repo") + 1])
            # `node fleet/run-main.mjs <plan.md> <runId>`: the runId is the
            # SECOND positional — cmd[3] — which is where run-main.mjs's
            # parseArgs reads it from and where ab_runner puts it.
            run_id = cmd[3]
            rd = cell / ".claude" / "ultrapowers" / ("run-" + run_id)
            rd.mkdir(parents=True)
            (rd / "events.jsonl").write_text(json.dumps(
                {"ts": "2026-08-30T10:00:00.000Z", "kind": "driver:stage",
                 "stage": "preflight"}) + "\n" + json.dumps(
                {"ts": "2026-08-30T10:01:00.000Z", "kind": "worker:end",
                 "label": "impl:1", "role": "implementer",
                 "meter": {"input": 1, "output": 7, "cacheRead": 0,
                           "cacheCreation": 0, "costUsd": 0.0, "models": []}}) + "\n")
            (rd / "args.json").write_text(json.dumps({"waves": [[{"id": "1"}]]}))
            return R(engine_exit)
        return R(0)  # git plumbing inside build_cell runs real; nothing else does
    return run


def test_one_cell_end_to_end_appends_a_row(tmp_path, monkeypatch):
    record = []
    results = tmp_path / "results"
    rc = main(["mini", "--overlap", "fold", "--run-id", "ab-t1",
               "--results-dir", str(results),
               "--fixtures-root", str(_fixture_tree(tmp_path)),
               "--workspace", str(tmp_path / "ws")],
              run=_stub_run(record))
    assert rc == 0
    rows = [json.loads(l) for l in
            (results / "runs.jsonl").read_text().splitlines()]
    assert len(rows) == 1
    row = rows[0]
    assert (row["fixture"], row["armOverlap"], row["runId"]) == ("mini", "fold", "ab-t1")
    assert row["engine"] == "one-driver"
    assert row["outputTokens"] == 7
    # the engine invocation used the assembled cell and the fold arm:
    node_cmd = next(c for c, kw in record if c[0] == "node")
    assert node_cmd[1].endswith("fleet/run-main.mjs")
    assert "--overlap" in node_cmd and node_cmd[node_cmd.index("--overlap") + 1] == "fold"
    # the engine env carried the seeded token; the parent env was not mutated:
    node_kw = next(kw for c, kw in record if c[0] == "node")
    assert node_kw["env"]["CLAUDE_CODE_OAUTH_TOKEN"] == "tok-x"
    assert "CLAUDE_CODE_OAUTH_TOKEN" not in os.environ or \
        os.environ.get("CLAUDE_CODE_OAUTH_TOKEN") != "tok-x"


def test_engine_failure_still_appends_a_row_and_exits_nonzero(tmp_path):
    record = []
    results = tmp_path / "results"
    rc = main(["mini", "--overlap", "serialize", "--run-id", "ab-t2",
               "--results-dir", str(results),
               "--fixtures-root", str(_fixture_tree(tmp_path)),
               "--workspace", str(tmp_path / "ws")],
              run=_stub_run(record, engine_exit=1))
    assert rc != 0
    rows = [json.loads(l) for l in
            (results / "runs.jsonl").read_text().splitlines()]
    assert len(rows) == 1 and rows[0]["verdict"] != "approved"


def test_unknown_fixture_refuses_before_spawning_anything(tmp_path):
    record = []
    rc = main(["nope", "--overlap", "fold",
               "--fixtures-root", str(_fixture_tree(tmp_path)),
               "--workspace", str(tmp_path / "ws"),
               "--results-dir", str(tmp_path / "results")],
              run=_stub_run(record))
    assert rc != 0
    assert not any(c[0] == "node" for c, kw in record)


def test_overlap_is_mandatory_and_validated(tmp_path):
    rc = main(["mini", "--overlap", "sideways",
               "--fixtures-root", str(_fixture_tree(tmp_path)),
               "--workspace", str(tmp_path / "ws"),
               "--results-dir", str(tmp_path / "results")],
              run=_stub_run([]))
    assert rc != 0


def test_overlap_omitted_is_refused(tmp_path):
    record = []
    rc = main(["mini",
               "--fixtures-root", str(_fixture_tree(tmp_path)),
               "--workspace", str(tmp_path / "ws"),
               "--results-dir", str(tmp_path / "results")],
              run=_stub_run(record))
    assert rc != 0
    assert not any(c[0] == "node" for c, kw in record)


def test_row_is_appended_never_rewritten(tmp_path):
    """runs.jsonl is append-only: a second cell leaves the first row byte-identical."""
    results = tmp_path / "results"
    results.mkdir()
    (results / "runs.jsonl").write_text(
        json.dumps({"fixture": "old", "runId": "ab-0.1.0"}) + "\n")
    fixtures = _fixture_tree(tmp_path)
    for run_id, ws in (("ab-t3", "ws3"), ("ab-t4", "ws4")):
        assert main(["mini", "--overlap", "fold", "--run-id", run_id,
                     "--results-dir", str(results),
                     "--fixtures-root", str(fixtures),
                     "--workspace", str(tmp_path / ws)],
                    run=_stub_run([])) == 0
    lines = (results / "runs.jsonl").read_text().splitlines()
    assert len(lines) == 3
    assert json.loads(lines[0]) == {"fixture": "old", "runId": "ab-0.1.0"}
    assert [json.loads(l)["runId"] for l in lines[1:]] == ["ab-t3", "ab-t4"]


def test_the_engine_is_pointed_at_the_assembled_cell_not_the_repo(tmp_path):
    record = []
    rc = main(["mini", "--overlap", "serialize", "--run-id", "ab-t5",
               "--results-dir", str(tmp_path / "results"),
               "--fixtures-root", str(_fixture_tree(tmp_path)),
               "--workspace", str(tmp_path / "ws")],
              run=_stub_run(record))
    assert rc == 0
    node_cmd, node_kw = next((c, kw) for c, kw in record if c[0] == "node")
    cell = tmp_path / "ws" / "mini"
    assert node_cmd[2:6] == ["plan.md", "ab-t5", "--repo", str(cell)]
    assert node_kw["cwd"] == str(ROOT)
    # the cell is a real committed repo carrying the fixture's project tree:
    assert (cell / "app.py").read_text() == "x = 1\n"
    assert (cell / "plan.md").is_file()
    # ...and the row points the operator at it:
    row = json.loads((tmp_path / "results" / "runs.jsonl").read_text())
    assert row["cellDir"] == str(cell)
    assert row["waveShape"] == [["1"]]


def test_no_credential_value_reaches_the_row_or_stdout(tmp_path, capsys):
    rc = main(["mini", "--overlap", "fold", "--run-id", "ab-t6",
               "--results-dir", str(tmp_path / "results"),
               "--fixtures-root", str(_fixture_tree(tmp_path)),
               "--workspace", str(tmp_path / "ws")],
              run=_stub_run([]))
    assert rc == 0
    captured = capsys.readouterr()
    assert "tok-x" not in captured.out and "tok-x" not in captured.err
    assert "tok-x" not in (tmp_path / "results" / "runs.jsonl").read_text()
    # the row itself is what lands on stdout, one line:
    printed = [l for l in captured.out.splitlines() if l.startswith("{")]
    assert len(printed) == 1
    assert json.loads(printed[0]) == json.loads(
        (tmp_path / "results" / "runs.jsonl").read_text().splitlines()[0])


def test_fixture_without_a_plan_is_refused_before_spawning_anything(tmp_path):
    record = []
    fixtures = _fixture_tree(tmp_path)
    (fixtures / "mini" / "plan.md").unlink()
    rc = main(["mini", "--overlap", "fold",
               "--fixtures-root", str(fixtures),
               "--workspace", str(tmp_path / "ws"),
               "--results-dir", str(tmp_path / "results")],
              run=_stub_run(record))
    assert rc == 2
    assert not any(c[0] == "node" for c, kw in record)
    assert not (tmp_path / "results" / "runs.jsonl").exists()


def test_default_run_id_is_stamped_and_engine_legal(tmp_path):
    record = []
    rc = main(["mini", "--overlap", "fold",
               "--results-dir", str(tmp_path / "results"),
               "--fixtures-root", str(_fixture_tree(tmp_path)),
               "--workspace", str(tmp_path / "ws")],
              run=_stub_run(record))
    assert rc == 0
    run_id = json.loads((tmp_path / "results" / "runs.jsonl").read_text())["runId"]
    assert run_id.startswith("ab-") and len(run_id) == len("ab-20260830120000")
    assert ab_runner.RUN_ID_RE.match(run_id)  # run-main.mjs's own runId shape rule


def test_illegal_run_id_is_refused_before_spawning_anything(tmp_path):
    record = []
    rc = main(["mini", "--overlap", "fold", "--run-id", "ab/../escape",
               "--results-dir", str(tmp_path / "results"),
               "--fixtures-root", str(_fixture_tree(tmp_path)),
               "--workspace", str(tmp_path / "ws")],
              run=_stub_run(record))
    assert rc == 2
    assert not any(c[0] == "node" for c, kw in record)


def test_fixtures_root_is_never_written_into(tmp_path):
    fixtures = _fixture_tree(tmp_path)
    before = sorted((p.relative_to(fixtures), p.read_text())
                    for p in fixtures.rglob("*") if p.is_file())
    assert main(["mini", "--overlap", "fold", "--run-id", "ab-t7",
                 "--results-dir", str(tmp_path / "results"),
                 "--fixtures-root", str(fixtures),
                 "--workspace", str(tmp_path / "ws")],
                run=_stub_run([])) == 0
    after = sorted((p.relative_to(fixtures), p.read_text())
                   for p in fixtures.rglob("*") if p.is_file())
    assert after == before


def test_test_cmd_defaults_and_overrides(tmp_path):
    """#402 follow-up (run-28 critic finding 1): fixture projects carry no
    pytest config and run-engine mandates a testCmd, so the runner threads
    --test-cmd to the engine — default 'python3 -m pytest', overridable."""
    fixtures = _fixture_tree(tmp_path)
    record = []
    rc = main(["mini", "--overlap", "fold", "--run-id", "ab-t7",
               "--results-dir", str(tmp_path / "results"),
               "--fixtures-root", str(fixtures),
               "--workspace", str(tmp_path / "ws")],
              run=_stub_run(record))
    assert rc == 0
    node_cmd = next(c for c, kw in record if c[0] == "node")
    assert node_cmd[node_cmd.index("--test-cmd") + 1] == "python3 -m pytest"

    record2 = []
    rc = main(["mini", "--overlap", "fold", "--run-id", "ab-t8",
               "--results-dir", str(tmp_path / "results2"),
               "--fixtures-root", str(fixtures),
               "--workspace", str(tmp_path / "ws2"),
               "--test-cmd", "make check"],
              run=_stub_run(record2))
    assert rc == 0
    node_cmd = next(c for c, kw in record2 if c[0] == "node")
    assert node_cmd[node_cmd.index("--test-cmd") + 1] == "make check"
