# 0017. The test suite and fleet sims

Status: accepted (2026-11-21)  
Governs: `tests/conftest.py`, `tests/test_fleet_suite.py`, `fleet/tests/_helpers.mjs`, `evals/readings/wrong_plans.py`

Recovered from the code comments removed by `/delete-comment` on 2026-11-21: each entry is a
decision the code cannot show on its own. Symbols are named; line numbers are not.

## Fleet sim hermeticity

- **sim_env (tests/test_fleet_suite.py)** — Each fleet sim bridged by tests/test_fleet_suite.py runs with PATH reduced to the directories of its interpreters (a laptop PATH carries dozens of plugin bin dirs, CI's lives under hostedtoolcache) and HOME/TMPDIR set to a fresh directory, so no sim reads the box's ~/.ultrapowers/fleet.json or ~/.gitconfig. No FLEET_HOME is set: each sim mints its own.
- **sim_env (tests/test_fleet_suite.py)** — tests/test_fleet_suite.py drops env keys prefixed ULTRA_, TINYAPP_, FLEET_, ANTHROPIC_, CLAUDE_ and GH_ from what a sim sees, the same contract fleet/tests/_helpers.mjs simEnv holds for the children a sim spawns: a sim sees only what the bridge hands it.
- **sim_env (tests/test_fleet_suite.py)** — sim_env in tests/test_fleet_suite.py includes sh's directory on PATH because a sim's bash -c / sh -c children resolve on the PATH they inherit from the sim.
- **sim_env (tests/test_fleet_suite.py)** — sim_env in tests/test_fleet_suite.py silently omits an interpreter that is not installed; the sim that needs it fails where it spawns it, which names the problem more precisely than the bridge could.
- **sim_env (tests/test_fleet_suite.py)** — sim_env in tests/test_fleet_suite.py builds the environment from nothing rather than filtering the parent's, so its final prefix filter guards only what the bridge itself sets: a future key carrying a dropped prefix never reaches a sim.
- **_ensure_node_modules (tests/test_fleet_suite.py)** — Under pytest-xdist every worker runs _ensure_node_modules in tests/test_fleet_suite.py, so the node_modules check and npm install in factory/ sit inside an exclusive flock on factory/package.json (always present, never modified). There is no unlocked fast path because npm creates node_modules early, so a bare isdir check could pass while a peer's install is still writing.
- **MJS_TIMEOUT (tests/test_fleet_suite.py)** — MJS_TIMEOUT in tests/test_fleet_suite.py (300 s per sim) is a hang detector sized for the slowest machine running the suite under -n auto, not a performance budget; the longest sim takes about 12 s.
- **test_fleet_mjs (tests/test_fleet_suite.py)** — test_fleet_mjs in tests/test_fleet_suite.py binds the sim environment once so it can remove the sim's fleet-bridge-* HOME afterwards; without that, a hundred sims left a hundred temp dirs behind. Removal is in finally so red and timed-out sims are reaped, with ignore_errors since a sim may already have removed it.

## Test suite ordering

- **tests/conftest.py pytest_collection_modifyitems** — pytest-xdist's `--dist load` hands items to workers in collection order, so tests/conftest.py moves the fleet .mjs bridge (the slowest items) to the front, otherwise it starts last and every other worker waits on it. At import conftest also points ULTRAPOWERS_HOME at a fresh empty directory so no test reaching Jev (check_provenance.py, routing.py) finds a real key, making every reading a quick null.

## Fleet sim rig

- **whichDir** — fleet/tests/_helpers.mjs `whichDir` leaves an interpreter missing from PATH out silently: the sim that needs it fails where it spawns it, with a clearer error than the rig could give.
- **OWNED cleanup** — fleet/tests/_helpers.mjs removes the temporary homes it created at exit and ignores a removal that fails: a leftover directory is left to the machine's tmp reaper and never fails a sim.
- **evals/readings/wrong_plans.py** — The wrong-plans reading launches each planted-flaw plan of `evals/fixtures/wrong_plans/manifest.json` held (`--hold`), so no run merges and every run starts from the same base. Per run it reads `events.jsonl`, `engine.log` and `status.json` at the run's tag and prints counted facts: ending, wall seconds, builder sessions, tasks reopened red, given back, objections, conflicts, tasks the engine added, files written outside the plan, beliefs and dollars. `--jev` adds one judgment, `said so` (whether anything the builders wrote states the planted flaw, from `questions.json` beside it), and prints every message read so a person can check it.
