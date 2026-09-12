"""The compiler emits each task's fact sheet (task 3, plan run-109).

The compiler computes each task's fact sheet ONCE — its files, its exam's
landing, what the driver writes, what its neighbours own — and nothing
downstream recomputes it. This exam pins the four Machine clauses leg by leg:

  M1 / leg (a) — `compile_plan.py <plan> [--stamp <run-id>]` accepts
    `--stamp`, whose value must match `^[A-Za-z0-9][A-Za-z0-9-]*$` (any other
    value exits 2 with a line beginning `error: --stamp`), and on a plain
    compile every `launch_waves` entry on stdout and every `tasks[]` entry of
    the `--emit-launch` payload carries `factsheet`, an object with exactly
    the keys `files`, `deletes`, `guards`, `proofTests`, `landing`,
    `driverOwned`, `siblingOwned`, `produces`, `consumes`.
  M2 / legs (b)-(f) — for a claims-v1 task each of those nine keys is
    computed from the task's own slots and its wave's other tasks.
  M3 / leg (g) — without `--stamp` every `landing` value is its own key, and
    `driverOwned` is therefore the sorted `proofTests` plus nothing.
  M4 / leg (h) — a legacy-grammar task's sheet has every list empty and
    `landing` `{}`, and `--check` output is unchanged: `--check --stamp run-7`
    on a plan that passes `--check` still prints `PLAN OK`.

The fixture plan is three claims-v1 tasks laid beside a verdicts record the
way `tests/test_compile_plan_guard.py` does. It layers as `[["1","2"],["3"]]`
— task 3 consumes the `make_a() -> A` token task 1 produces — so task 1 and
task 2 are wave neighbours and task 3 is alone in its wave, which is what
makes `siblingOwned` a live check.

Every expected value below is computed by hand from the Machine clauses, not
read back off the implementation.
"""
import json
import pathlib
import subprocess
import sys

# This exam lands at `tests/exams/<slug>/test_compile_plan_factsheet.py`, so
# the repo root is three directories up, not one.
ROOT = pathlib.Path(__file__).resolve().parents[3]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
# The legacy-grammar corpus fixture leg (h) reads: it carries no
# `**Grammar:** claims-v1` marker, so no task of it has a claims body at all.
WIDE_FIXTURE = ROOT / "evals/fixtures/wide/plan.md"

sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
from compile_plan import (  # noqa: E402
    gate_input_hash,
    parse_claims_body,
    split_tasks,
    verdicts_path,
)

STAMP = "run-7"
SLUG = "run_7"  # `examSlug`: every character outside [A-Za-z0-9_] becomes `_`

# The nine names M1 fixes, as a set — "exactly the keys", so neither a missing
# nor an extra name is tolerated.
SHEET_KEYS = {"files", "deletes", "guards", "proofTests", "landing",
              "driverOwned", "siblingOwned", "produces", "consumes"}


# --------------------------------------------------------------------------- #
# Fixture plan                                                                 #
# --------------------------------------------------------------------------- #
HEADER = ("# Plan: the compiler emits each task's fact sheet\n"
          "\n"
          "**Grammar:** claims-v1\n"
          "\n"
          "**Acceptance:** waived — inline test plan\n"
          "\n")

# The Machine line every fixture task restates, with NUMBERED clauses, so the
# clause-to-leg citation grammar is active on every fixture task here.
MACHINE = ("Machine: M1. The sheet rides every entry. "
           "M2. Its keys are computed from the task's own slots.\n")

LEGS = "- Legs: (a) the sheet rides beside the exam [M1][M2]."


def _task(task_id, title, files, proof, consumes, produces):
    """One claims-v1 task carrying all six slots.

    `files` is the Files-block bullet lines and `proof` the Proof-slot bullet
    lines (each without its trailing newline); `consumes`/`produces` are the
    verbatim values of the two Interfaces bullets.
    """
    return ("### Task %s: %s\n"
            "\n"
            "**Type:** implementation\n"
            "\n"
            "**Files:**\n"
            "%s"
            "\n"
            "**Claim:** The compiler computes task %s's fact sheet once. "
            "(quoted from #913)\n"
            "%s"
            "\n"
            "**Authorized-by:** #913\n"
            "\n"
            "**Interfaces:**\n"
            "- Consumes: %s\n"
            "- Produces: %s\n"
            "\n"
            "**Context:** The repo computes no fact sheet today, so nothing "
            "downstream can read one.\n"
            "\n"
            "**Proof:**\n"
            "%s"
            "\n"
            "**Stale-if:**\n"
            "- issue-open: #913\n"
            % (task_id, title,
               "".join(line + "\n" for line in files),
               task_id, MACHINE, consumes, produces,
               "".join(line + "\n" for line in proof)))


# Task 1 — a Create, a Modify, a Delete and two Test paths; its Proof names
# both tests (deep one second, so Proof order is NOT sorted order) and guards
# the shallow one.
TASK_1 = _task("1", "Sample one",
               ["- Create: `pkg/a.py`",
                "- Modify: `pkg/b.py`",
                "- Delete: `pkg/old.py`",
                "- Test: `tests/test_a.py`",
                "- Test: `tests/sub/test_deep.py`"],
               ["- Test: `tests/test_a.py`",
                "- Test: `tests/sub/test_deep.py`",
                "- Guard: `tests/test_a.py`",
                LEGS],
               "nothing", "`make_a() -> A`")

# Task 2 — the `fleet/tests/` root, and two placeholder Interfaces bullets.
TASK_2 = _task("2", "Sample two",
               ["- Create: `pkg/c.py`",
                "- Test: `fleet/tests/test_c.mjs`"],
               ["- Test: `fleet/tests/test_c.mjs`", LEGS],
               "none", "n/a")

# Task 3 — a Proof path under NEITHER test root, and the `make_a` token that
# orders it after task 1 into a wave of its own.
TASK_3 = _task("3", "Sample three",
               ["- Create: `pkg/d.py`",
                "- Test: `t1_test.sh`"],
               ["- Test: `t1_test.sh`", LEGS],
               "`make_a() -> A`", "nothing")

FIXTURE_TASKS = (TASK_1, TASK_2, TASK_3)


# --------------------------------------------------------------------------- #
# Driving the compiler                                                         #
# --------------------------------------------------------------------------- #
def _sign(plan):
    """Stamp an all-pass gate-verdict record beside a claims-v1 plan — the
    compiler refuses to compile one without (spec 4.5)."""
    record = {"tasks": {}, "tally": {"dispatched": 0, "rejected": 0}}
    for t in split_tasks(plan.read_text()):
        claims = parse_claims_body(t["body"], t["id"])
        record["tasks"][t["id"]] = {
            "hash": gate_input_hash(claims["claim"], claims["proof"]),
            "verdict": "pass", "reason": "layer match"}
        record["tally"]["dispatched"] += 1
    verdicts_path(plan).write_text(json.dumps(record, indent=2) + "\n")
    return plan


def _write_plan(tmp_path, name="plan.md", tasks=FIXTURE_TASKS):
    plan = tmp_path / name
    plan.write_text(HEADER + "\n".join(tasks))
    return _sign(plan)


def _run(*argv):
    return subprocess.run([sys.executable, str(COMPILER)] + [str(a) for a in argv],
                          capture_output=True, text=True, cwd=str(ROOT))


def _compile(plan_path, tmp_path, *extra, name="launch"):
    """Compile `plan_path` with `--emit-launch`; return `(stdout_json,
    launch_payload)`."""
    launch = tmp_path / (name + ".json")
    p = _run(plan_path, "--emit-launch", launch, *extra)
    assert p.returncode == 0, (
        "the fixture plan must compile cleanly; got rc=%d\n%s%s"
        % (p.returncode, p.stdout, p.stderr))
    return json.loads(p.stdout), json.loads(launch.read_text())


def _wave_entries(stdout_payload):
    """Every `launch_waves` entry, flattened, keyed by task id."""
    return {e["id"]: e for wave in stdout_payload["launch_waves"] for e in wave}


def _launch_entries(launch_payload):
    """Every `--emit-launch` `tasks[]` entry, keyed by task id."""
    return {e["id"]: e for e in launch_payload["tasks"]}


def _sheet(entry, where, leg):
    """The `factsheet` off one entry, with the absent-key failure named."""
    assert "factsheet" in entry, (
        "%s [M1]: every %s must carry `factsheet` — task %s has keys %s"
        % (leg, where, entry.get("id"), sorted(entry)))
    sheet = entry["factsheet"]
    assert isinstance(sheet, dict), (
        "%s [M1]: `factsheet` is an object; task %s carries %r"
        % (leg, entry.get("id"), sheet))
    return sheet


def _sheets(tmp_path, *extra, name="launch"):
    """The wave-entry fact sheets of the fixture plan, keyed by task id."""
    plan = _write_plan(tmp_path)
    stdout_payload, _ = _compile(plan, tmp_path, *extra, name=name)
    entries = _wave_entries(stdout_payload)
    return {tid: _sheet(e, "`launch_waves` entry", "leg (b)-(g)")
            for tid, e in entries.items()}


def _stamped(tmp_path, name="launch"):
    return _sheets(tmp_path, "--stamp", STAMP, name=name)


# --------------------------------------------------------------------------- #
# (a) [M1] the flag, its value rule, and the sheet on both emit sites          #
# --------------------------------------------------------------------------- #
def test_a_the_fixture_plan_layers_as_the_two_waves_the_legs_assume(tmp_path):
    """A precondition of legs (e) and (h), asserted so a layering change reads
    as itself rather than as a wrong `siblingOwned`."""
    stdout_payload, _ = _compile(_write_plan(tmp_path), tmp_path,
                                 "--stamp", STAMP)
    assert stdout_payload["waves"] == [["1", "2"], ["3"]], (
        "the fixture must layer as [[\"1\",\"2\"],[\"3\"]] — the "
        "`make_a() -> A` token orders task 3 after task 1; got %r"
        % (stdout_payload["waves"],))


def test_a_every_wave_entry_and_launch_entry_carries_the_nine_key_sheet(
        tmp_path):
    stdout_payload, launch_payload = _compile(
        _write_plan(tmp_path), tmp_path, "--stamp", STAMP)
    wave = _wave_entries(stdout_payload)
    launch = _launch_entries(launch_payload)
    assert sorted(wave) == ["1", "2", "3"], (
        "leg (a) [M1]: the fixture compiles to three wave entries; got %s"
        % sorted(wave))
    assert sorted(launch) == ["1", "2", "3"], (
        "leg (a) [M1]: the `--emit-launch` payload carries all three tasks; "
        "got %s" % sorted(launch))
    for tid in ("1", "2", "3"):
        for entries, where in ((wave, "`launch_waves` entry"),
                               (launch, "`--emit-launch` `tasks[]` entry")):
            keys = set(_sheet(entries[tid], where, "leg (a)"))
            assert keys == SHEET_KEYS, (
                "leg (a) [M1]: task %s's %s has a `factsheet` whose key set "
                "is EXACTLY {files, deletes, guards, proofTests, landing, "
                "driverOwned, siblingOwned, produces, consumes}; missing %s, "
                "extra %s"
                % (tid, where, sorted(SHEET_KEYS - keys),
                   sorted(keys - SHEET_KEYS)))


def test_a_the_two_sheets_for_one_task_id_are_equal(tmp_path):
    stdout_payload, launch_payload = _compile(
        _write_plan(tmp_path), tmp_path, "--stamp", STAMP)
    wave = _wave_entries(stdout_payload)
    launch = _launch_entries(launch_payload)
    for tid in ("1", "2", "3"):
        a = _sheet(wave[tid], "`launch_waves` entry", "leg (a)")
        b = _sheet(launch[tid], "`--emit-launch` `tasks[]` entry", "leg (a)")
        assert a == b, (
            "leg (a) [M1]: the compiler computes task %s's sheet ONCE — "
            "the object on the `launch_waves` entry and the one on the "
            "`--emit-launch` `tasks[]` entry are equal\n--- launch_waves "
            "---\n%s\n--- emit-launch ---\n%s"
            % (tid, json.dumps(a, indent=2, sort_keys=True),
               json.dumps(b, indent=2, sort_keys=True)))


def test_a_a_stamp_value_outside_the_pattern_exits_2_naming_the_flag(tmp_path):
    plan = _write_plan(tmp_path)
    p = _run(plan, "--stamp", "run 7")
    both = p.stdout + p.stderr
    assert p.returncode == 2, (
        "leg (a) [M1]: `--stamp 'run 7'` does not match "
        "`^[A-Za-z0-9][A-Za-z0-9-]*$`, so the compiler exits 2; got rc=%d\n%s"
        % (p.returncode, both))
    assert "error: --stamp" in both, (
        "leg (a) [M1]: `--stamp 'run 7'` exits 2 with stdout+stderr "
        "containing `error: --stamp`; got:\n%s" % both)
    assert [l for l in both.splitlines() if l.startswith("error: --stamp")], (
        "leg (a) [M1]: the refusal is a LINE BEGINNING `error: --stamp`, not "
        "an argparse usage line that merely mentions the flag; got:\n%s"
        % both)


def test_a_more_values_outside_the_stamp_pattern_are_refused(tmp_path):
    """The rest of M1's pattern: a leading `-`, a character outside the class,
    and the empty value are all refused the same way."""
    plan = _write_plan(tmp_path)
    for bad in ("-run7", "run/7", "run_7", ""):
        p = _run(plan, "--stamp", bad)
        both = p.stdout + p.stderr
        assert p.returncode == 2, (
            "leg (a) [M1]: `--stamp %r` does not match "
            "`^[A-Za-z0-9][A-Za-z0-9-]*$`, so the compiler exits 2; got "
            "rc=%d\n%s" % (bad, p.returncode, both))
        assert [l for l in both.splitlines()
                if l.startswith("error: --stamp")], (
            "leg (a) [M1]: `--stamp %r` exits 2 with a line beginning "
            "`error: --stamp`; got:\n%s" % (bad, both))


def test_a_a_stamp_value_inside_the_pattern_is_accepted(tmp_path):
    """The other half of M1's rule — a matching value compiles."""
    plan = _write_plan(tmp_path)
    for good in ("run-7", "Run7", "7"):
        p = _run(plan, "--stamp", good)
        assert p.returncode == 0, (
            "leg (a) [M1]: `--stamp %r` matches "
            "`^[A-Za-z0-9][A-Za-z0-9-]*$`, so the compile succeeds; got "
            "rc=%d\n%s%s" % (good, p.returncode, p.stdout, p.stderr))


# --------------------------------------------------------------------------- #
# (b) [M2] files / deletes / guards / proofTests                               #
# --------------------------------------------------------------------------- #
def test_b_task_1_files_is_the_sorted_union_including_the_deleted_path(
        tmp_path):
    sheet = _stamped(tmp_path)["1"]
    assert sheet["files"] == ["pkg/a.py", "pkg/b.py", "pkg/old.py",
                              "tests/sub/test_deep.py", "tests/test_a.py"], (
        "leg (b) [M2]: task 1's `files` is the sorted union of its `Create:`, "
        "`Modify:`, `Test:` AND `Delete:` paths — a sheet that omits the "
        "deleted `pkg/old.py` fails; got %r" % (sheet["files"],))


def test_b_task_1_deletes_is_its_sorted_delete_paths(tmp_path):
    sheet = _stamped(tmp_path)["1"]
    assert sheet["deletes"] == ["pkg/old.py"], (
        "leg (b) [M2]: task 1's `deletes` is its sorted `Delete:` paths; got "
        "%r" % (sheet["deletes"],))


def test_b_task_1_guards_is_its_proof_guard_paths(tmp_path):
    sheet = _stamped(tmp_path)["1"]
    assert sheet["guards"] == ["tests/test_a.py"], (
        "leg (b) [M2]: task 1's `guards` is its Proof `Guard:` paths in Proof "
        "order; got %r" % (sheet["guards"],))


def test_b_task_1_proof_tests_keep_proof_order_and_are_not_sorted(tmp_path):
    sheet = _stamped(tmp_path)["1"]
    assert sheet["proofTests"] == ["tests/test_a.py",
                                   "tests/sub/test_deep.py"], (
        "leg (b) [M2]: task 1's `proofTests` is its Proof `Test:` paths in "
        "PROOF order — `tests/test_a.py` first, `tests/sub/test_deep.py` "
        "second; a sheet that sorts them fails; got %r"
        % (sheet["proofTests"],))


def test_b_task_2_files_deletes_and_guards(tmp_path):
    sheet = _stamped(tmp_path)["2"]
    assert sheet["files"] == ["fleet/tests/test_c.mjs", "pkg/c.py"], (
        "leg (b) [M2]: task 2's `files` is the sorted union of its `Create:` "
        "and `Test:` paths; got %r" % (sheet["files"],))
    assert sheet["deletes"] == [], (
        "leg (b) [M2]: task 2 names no `Delete:`, so its `deletes` is `[]`; "
        "got %r" % (sheet["deletes"],))
    assert sheet["guards"] == [], (
        "leg (b) [M2]: task 2's Proof names no `Guard:`, so its `guards` is "
        "`[]`; got %r" % (sheet["guards"],))


# --------------------------------------------------------------------------- #
# (c) [M2] landing                                                             #
# --------------------------------------------------------------------------- #
def test_c_task_1_landing_keeps_the_guarded_path_and_reserves_the_other(
        tmp_path):
    sheet = _stamped(tmp_path)["1"]
    assert sheet["landing"] == {
        "tests/test_a.py": "tests/test_a.py",
        "tests/sub/test_deep.py": "tests/exams/%s/sub/test_deep.py" % SLUG}, (
        "leg (c) [M2]: task 1's `landing` has one key per `proofTests` entry; "
        "`tests/test_a.py` is in `guards` so it lands at ITSELF, and "
        "`tests/sub/test_deep.py` lands at `tests/exams/%s/sub/test_deep.py`. "
        "A landing that moves the guarded path fails; got %s"
        % (SLUG, json.dumps(sheet["landing"], indent=2, sort_keys=True)))


def test_c_task_2_landing_uses_the_fleet_tests_root_not_the_bare_one(tmp_path):
    sheet = _stamped(tmp_path)["2"]
    assert sheet["landing"] == {
        "fleet/tests/test_c.mjs": "fleet/tests/exams/%s/test_c.mjs" % SLUG}, (
        "leg (c) [M2]: a `fleet/tests/<rest>` path lands at "
        "`fleet/tests/exams/%s/<rest>` — the longest root is matched "
        "first, so a landing under `tests/exams/` fails; got %s"
        % (SLUG, json.dumps(sheet["landing"], indent=2, sort_keys=True)))


def test_c_task_3_landing_leaves_a_path_under_neither_root_alone(tmp_path):
    sheet = _stamped(tmp_path)["3"]
    assert sheet["landing"] == {"t1_test.sh": "t1_test.sh"}, (
        "leg (c) [M2]: `t1_test.sh` starts with neither `tests/` nor "
        "`fleet/tests/`, so it lands at itself; got %s"
        % json.dumps(sheet["landing"], indent=2, sort_keys=True))


# --------------------------------------------------------------------------- #
# (d) [M2] driverOwned                                                         #
# --------------------------------------------------------------------------- #
def test_d_task_1_driver_owned_carries_every_intermediate_package_init(
        tmp_path):
    sheet = _stamped(tmp_path)["1"]
    assert sheet["driverOwned"] == [
        "tests/exams/%s/__init__.py" % SLUG,
        "tests/exams/%s/sub/__init__.py" % SLUG,
        "tests/exams/%s/sub/test_deep.py" % SLUG,
        "tests/test_a.py"], (
        "leg (d) [M2]: task 1's `driverOwned` is the sorted set of every "
        "`landing` value plus, for the `.py` landing under `tests/exams/%s/`, "
        "the root `__init__.py` AND `<dir>/__init__.py` for each directory "
        "strictly between that root and the file — a sheet omitting the "
        "intermediate `sub/__init__.py` fails; got %s"
        % (SLUG, json.dumps(sheet["driverOwned"], indent=2)))


def test_d_task_2_driver_owned_writes_no_init_for_an_mjs_landing(tmp_path):
    sheet = _stamped(tmp_path)["2"]
    assert sheet["driverOwned"] == ["fleet/tests/exams/%s/test_c.mjs" % SLUG], (
        "leg (d) [M2]: the `.mjs` landing under `fleet/tests/` gets NO "
        "`__init__.py` — the rule fires only for `.py` landings under "
        "`tests/exams/%s/`; got %s"
        % (SLUG, json.dumps(sheet["driverOwned"], indent=2)))


def test_d_task_3_driver_owned_is_its_unmoved_landing(tmp_path):
    sheet = _stamped(tmp_path)["3"]
    assert sheet["driverOwned"] == ["t1_test.sh"], (
        "leg (d) [M2]: task 3's only landing value is `t1_test.sh`, under no "
        "reserved root, so nothing else is driver-owned; got %s"
        % json.dumps(sheet["driverOwned"], indent=2))


# --------------------------------------------------------------------------- #
# (e) [M2] siblingOwned                                                        #
# --------------------------------------------------------------------------- #
def test_e_task_1_sibling_owned_is_its_wave_neighbours_files_and_deletes(
        tmp_path):
    sheet = _stamped(tmp_path)["1"]
    assert sheet["siblingOwned"] == ["fleet/tests/test_c.mjs", "pkg/c.py"], (
        "leg (e) [M2]: task 1's `siblingOwned` is the sorted union of "
        "`files` ∪ `deletes` over the OTHER tasks of its own wave — "
        "task 2's paths only. A set naming the wave-2 task's `pkg/d.py`, or "
        "task 1's own paths, fails; got %s"
        % json.dumps(sheet["siblingOwned"], indent=2))


def test_e_task_2_sibling_owned_includes_task_1s_deleted_path(tmp_path):
    sheet = _stamped(tmp_path)["2"]
    assert sheet["siblingOwned"] == ["pkg/a.py", "pkg/b.py", "pkg/old.py",
                                     "tests/sub/test_deep.py",
                                     "tests/test_a.py"], (
        "leg (e) [M2]: task 2's `siblingOwned` is task 1's `files` ∪ "
        "`deletes` — `pkg/old.py` included; got %s"
        % json.dumps(sheet["siblingOwned"], indent=2))


def test_e_task_3_alone_in_its_wave_owns_no_siblings(tmp_path):
    sheet = _stamped(tmp_path)["3"]
    assert sheet["siblingOwned"] == [], (
        "leg (e) [M2]: task 3 is alone in wave 2, so its `siblingOwned` is "
        "`[]` — a wave-1 task's paths are NOT its neighbours' ; got %s"
        % json.dumps(sheet["siblingOwned"], indent=2))


# --------------------------------------------------------------------------- #
# (f) [M2] produces / consumes, placeholders dropped                           #
# --------------------------------------------------------------------------- #
def test_f_task_1_produces_its_symbol_and_drops_the_nothing_placeholder(
        tmp_path):
    sheet = _stamped(tmp_path)["1"]
    assert sheet["produces"] == ["`make_a() -> A`"], (
        "leg (f) [M2]: task 1's `produces` is its Interfaces bullet as the "
        "compiler already stores it — backticks kept; got %r"
        % (sheet["produces"],))
    assert sheet["consumes"] == [], (
        "leg (f) [M2]: task 1's `Consumes: nothing` bullet has a lead word in "
        "`PLACEHOLDER_TOKENS`, so it is DROPPED and `consumes` is `[]`; got "
        "%r" % (sheet["consumes"],))


def test_f_task_2_drops_both_placeholder_bullets(tmp_path):
    sheet = _stamped(tmp_path)["2"]
    assert sheet["consumes"] == [], (
        "leg (f) [M2]: task 2's `Consumes: none` is a placeholder and is "
        "dropped; got %r" % (sheet["consumes"],))
    assert sheet["produces"] == [], (
        "leg (f) [M2]: task 2's `Produces: n/a` is a placeholder and is "
        "dropped; got %r" % (sheet["produces"],))


def test_f_task_3_consumes_the_symbol_and_drops_its_nothing_placeholder(
        tmp_path):
    sheet = _stamped(tmp_path)["3"]
    assert sheet["consumes"] == ["`make_a() -> A`"], (
        "leg (f) [M2]: task 3's `consumes` is its Interfaces bullet verbatim; "
        "got %r" % (sheet["consumes"],))
    assert sheet["produces"] == [], (
        "leg (f) [M2]: task 3's `Produces: nothing` is a placeholder and is "
        "dropped; got %r" % (sheet["produces"],))


def test_f_no_sheet_anywhere_keeps_a_placeholder_bullet(tmp_path):
    """The general form of M2's last clause: `nothing`, `none`, `n/a` and `na`
    never survive into a sheet, on any task."""
    kept = []
    for tid, sheet in sorted(_stamped(tmp_path).items()):
        for key in ("produces", "consumes"):
            for bullet in sheet[key]:
                lead = bullet.strip().split()[0].strip("`.,;:").lower() \
                    if bullet.strip() else ""
                if lead in {"nothing", "none", "n/a", "na"}:
                    kept.append((tid, key, bullet))
    assert kept == [], (
        "leg (f) [M2]: a sheet keeping `nothing`, `none` or `n/a` as a bullet "
        "fails — a consumer must never see a placeholder; kept %r" % kept)


# --------------------------------------------------------------------------- #
# (g) [M3] without --stamp every landing is its own key                        #
# --------------------------------------------------------------------------- #
def test_g_unstamped_landing_maps_each_proof_path_to_itself(tmp_path):
    sheet = _sheets(tmp_path, name="unstamped")["1"]
    assert sheet["landing"] == {
        "tests/test_a.py": "tests/test_a.py",
        "tests/sub/test_deep.py": "tests/sub/test_deep.py"}, (
        "leg (g) [M3]: with no `--stamp`, every `landing` value is its own "
        "key — both of task 1's Proof paths map to themselves; got %s"
        % json.dumps(sheet["landing"], indent=2, sort_keys=True))


def test_g_unstamped_driver_owned_is_the_sorted_proof_tests_and_nothing_else(
        tmp_path):
    sheet = _sheets(tmp_path, name="unstamped")["1"]
    assert sheet["driverOwned"] == ["tests/sub/test_deep.py",
                                    "tests/test_a.py"], (
        "leg (g) [M3]: with no `--stamp`, `driverOwned` is the sorted "
        "`proofTests` plus NOTHING — no `__init__.py` is owned, because "
        "no landing sits under a reserved exam root; got %s"
        % json.dumps(sheet["driverOwned"], indent=2))


def test_g_unstamped_sheets_still_carry_all_nine_keys(tmp_path):
    for tid, sheet in sorted(_sheets(tmp_path, name="unstamped").items()):
        assert set(sheet) == SHEET_KEYS, (
            "leg (g) [M3] / [M1]: the sheet's nine keys do not depend on "
            "`--stamp`; task %s is missing %s and carries extra %s"
            % (tid, sorted(SHEET_KEYS - set(sheet)),
               sorted(set(sheet) - SHEET_KEYS)))


# --------------------------------------------------------------------------- #
# (h) [M4] the legacy grammar, and --check unchanged                           #
# --------------------------------------------------------------------------- #
def _legacy_sheets(tmp_path, *extra, name="wide"):
    stdout_payload, _ = _compile(WIDE_FIXTURE, tmp_path, *extra, name=name)
    entries = _wave_entries(stdout_payload)
    assert entries, "expected the legacy wide fixture to compile to wave entries"
    return {tid: _sheet(e, "`launch_waves` entry", "leg (h)")
            for tid, e in entries.items()}


def test_h_every_legacy_entry_carries_an_all_empty_sheet(tmp_path):
    for stamp_argv, label in ((("--stamp", STAMP), "with `--stamp run-7`"),
                              ((), "with no `--stamp`")):
        sheets = _legacy_sheets(tmp_path, *stamp_argv,
                                name="wide" + ("-stamped" if stamp_argv else ""))
        for tid, sheet in sorted(sheets.items()):
            assert set(sheet) == SHEET_KEYS, (
                "leg (h) [M4]: a legacy-grammar entry still carries all nine "
                "`factsheet` keys %s; task %s is missing %s and carries extra "
                "%s" % (label, tid, sorted(SHEET_KEYS - set(sheet)),
                        sorted(set(sheet) - SHEET_KEYS)))
            for key in ("files", "deletes", "guards", "proofTests",
                        "driverOwned", "siblingOwned", "produces", "consumes"):
                assert sheet[key] == [], (
                    "leg (h) [M4]: a legacy-grammar task's sheet has EVERY "
                    "list empty %s — task %s's `%s` is %r"
                    % (label, tid, key, sheet[key]))
            assert sheet["landing"] == {}, (
                "leg (h) [M4]: a legacy-grammar task's `landing` is `{}` %s "
                "— task %s carries %r" % (label, tid, sheet["landing"]))


def test_h_check_with_a_stamp_still_prints_plan_ok(tmp_path):
    plan = _write_plan(tmp_path)
    p = _run("--check", plan, "--stamp", STAMP)
    assert p.returncode == 0, (
        "leg (h) [M4]: `--check --stamp run-7` on a plan that passes "
        "`--check` exits 0; got rc=%d\n%s%s" % (p.returncode, p.stdout, p.stderr))
    assert p.stdout.splitlines()[:1] == ["PLAN OK"], (
        "leg (h) [M4]: it prints `PLAN OK` — any other verdict line "
        "fails; got:\n%s" % p.stdout)


def test_h_the_stamp_leaves_check_stdout_byte_identical(tmp_path):
    """M4's "`--check` output is unchanged", in its strongest reading: the
    same plan checked with and without `--stamp` prints the same bytes."""
    plan = _write_plan(tmp_path)
    bare, stamped = _run("--check", plan), _run("--check", plan,
                                                "--stamp", STAMP)
    assert (bare.returncode, stamped.returncode) == (0, 0), (
        "leg (h) [M4]: the fixture checks clean both ways; got rc=%d and "
        "rc=%d\n%s%s%s%s" % (bare.returncode, stamped.returncode,
                             bare.stdout, bare.stderr,
                             stamped.stdout, stamped.stderr))
    assert bare.stdout == stamped.stdout, (
        "leg (h) [M4]: `--check` output is UNCHANGED by `--stamp`\n--- bare "
        "---\n%s--- stamped ---\n%s" % (bare.stdout, stamped.stdout))
