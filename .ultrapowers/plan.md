# The lobby facts match today's exe.dev, and the factory's Jev readers are gone

**Grammar:** claims-v1
**Claim:** The fleet's record of how exe.dev behaves matches what exe.dev does today, and no readings tool is left that only reads the retired factory's Jev rows. (elicited)
**Summary:** This brings the fleet's notes on exe.dev up to date: exe.dev no longer holds on to a deleted machine's name (read twice, 2026-09-23 and 2026-09-29), and two of its commands gained a new option, so the probe and the doctor stop reporting both as drift on every run. It also deletes two readings tools and their tests that read only the Jev answers of the retired factory, which no run has written since the Flock replaced it. You get a doctor and a probe that report only real changes, and a smaller tree with nothing in it that reads data that no longer exists.

**Goal:** Update the exe.dev facts (name reservation, `--host-key`) and delete `evals/readings/jev_census.py` and `evals/readings/autoresearch.py` with their tests.
**Tech Stack:** Node (fleet tools), Python 3, Markdown
**Spec:** none — the probe reading of 2026-09-29; #1369's audit (the factory's Jev rows are no longer written)

## Global Constraints

- The practice around VM names is unchanged: a name is minted once per launch and never reused, because the run number is the identity.
- Check: python3 -m pytest -q tests/test_fleet_suite.py tests/test_catch_counter.py tests/test_plan_parse.py

### Task 1: The name-reservation fact reads as exe.dev behaves

**Type:** implementation

**Files:**
- Modify: `fleet/tests/probe_exe_facts.mjs`
- Modify: `fleet/CONTRACT.md`
- Modify: `fleet/RUNBOOK.md`
- Modify: `fleet/lobby.mjs`
- Modify: `fleet/launch.mjs`

**Claim:** The fleet's record of how exe.dev behaves matches what exe.dev does today. (derived)
Machine: M1. `fleet/tests/probe_exe_facts.mjs`'s recorded reading for `rm-reserves-name` is exactly `says: 'exe.dev does not reserve a deleted VM\'s name: a new VM may take it'`. M2. No line of `fleet/CONTRACT.md`, `fleet/lobby.mjs` or `fleet/launch.mjs` says exe.dev reserves a deleted name: none contains `reserves deleted`, `deleted name reserved` or `refused stays reserved`.

**Authorized-by:** the probe reading of 2026-09-29 (lobby `92465a0aa5e0141b`); `fleet/CONTRACT.md` `exe.dev facts (measured)`; operator, 2026-09-29

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** On 2026-09-29 the live probe (`node fleet/tests/probe_exe_facts.mjs`, run by hand on the laptop) printed `FACT rm-reserves-name: DRIFT — new --name probe-exe-facts-202609291944 … exited 0 — the name was not reserved, recorded exe.dev reserves a deleted VM's name for good (lobby 92465a0aa5e0141b, 2026-09-29)`. The other 11 facts held. That makes n=2 readings that the name is not reserved (the first was 2026-09-23, already noted at `CONTRACT.md` ~604 and `RUNBOOK.md` ~623).

What to change:
- **The probe's fact 11** (the `says` line and the `holds`/`drift` branches, ~368–373): flip it, so a `new --name <just-deleted>` that exits 0 scores `holds` and one that fails scores `DRIFT`. Keep it read last, after the cleanup, and keep it removing the VM its `new` creates, as it does today.
- **`CONTRACT.md` line ~38** (the VM name bullet): state that names are not reserved, and that a name is still one incarnation because the run number is the identity.
- **`CONTRACT.md` ~604 and `RUNBOOK.md` ~623:** update each reading to n=2, adding the 2026-09-29 read.
- **The comments at `lobby.mjs` ~62 and `launch.mjs` ~147:** reword them the same way; no code changes. `NEW_ATTEMPTS` and the per-attempt fresh name stay as they are.

This task cannot run the live probe (a sandbox has no lobby); `node --check` is its guard.

**Proof:**
- Run: grep -qF "says: 'exe.dev does not reserve a deleted VM\'s name: a new VM may take it'" fleet/tests/probe_exe_facts.mjs [M1]
- Run: bash -c '! grep -nE "reserves deleted|deleted name reserved|refused stays reserved" fleet/CONTRACT.md fleet/lobby.mjs fleet/launch.mjs' [M2]
- Run: node --check fleet/tests/probe_exe_facts.mjs
- Legs: (a) the probe's recorded reading is the new sentence [M1]; (b) none of the three files says a deleted name is reserved [M2].

**Stale-if:**
- path-absent: `fleet/tests/probe_exe_facts.mjs`

### Task 2: The recorded flag sets include --host-key

**Type:** implementation

**Files:**
- Modify: `fleet/exe-verbs.json`

**Claim:** The fleet's record of how exe.dev behaves matches what exe.dev does today. (derived)
Machine: M1. In `fleet/exe-verbs.json`, `verbs["integrations add"]` and `verbs["integrations edit"]` each contain `--host-key`, their other flags are unchanged, and `capturedAt` is `2026-09-29`.

**Authorized-by:** the doctor's verb-drift row on the run-265 launch (2026-09-29); the live `help` output below

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** On 2026-09-29 the launch's verb-drift row read: `drift since 2026-09-23: integrations add: --host-key appeared; integrations edit: --host-key appeared`. The live flags, from `ssh exe.dev "help <verb>"` on the laptop that day:
- **`integrations add`:** `--act-as-user --attach --bearer --comment --fields --for --header --host-key --name --no-auth --peer --readonly --repository --strip-prefix --target --team`
- **`integrations edit`:** `--act-as-user --bearer --clear-header --comment --fields --header --host-key --no-auth --readonly --repository --strip-prefix --target --team --webhook-url`

Each is the recorded list plus `--host-key`. Keep each list sorted as the file keeps it, and leave the other verbs alone.

**Proof:**
- Run: python3 -c "import json; d=json.load(open('fleet/exe-verbs.json')); v=d['verbs']; assert d['capturedAt']=='2026-09-29' and '--host-key' in v['integrations add'] and '--host-key' in v['integrations edit'] and len(v['integrations add'])==16 and len(v['integrations edit'])==14, d" [M1]
- Legs: (a) both verbs carry `--host-key`, with 16 and 14 flags (the recorded 15 and 13 plus one), and the capture date is 2026-09-29 [M1].

**Stale-if:**
- path-absent: `fleet/exe-verbs.json`

### Task 3: The factory's Jev readings tools are deleted

**Type:** implementation

**Files:**
- Delete: `evals/readings/jev_census.py`
- Delete: `evals/readings/autoresearch.py`
- Delete: `tests/test_jev_census.py`
- Delete: `tests/test_autoresearch.py`

**Claim:** No readings tool is left that only reads the retired factory's Jev rows. (derived)
Machine: M1. The four paths `evals/readings/jev_census.py`, `evals/readings/autoresearch.py`, `tests/test_jev_census.py` and `tests/test_autoresearch.py` do not exist. M2. No tracked file outside `docs/` and `.ultrapowers/` names `jev_census` or `autoresearch`.

**Authorized-by:** #1369's audit (2026-09-29); operator, 2026-09-29

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Both scripts read `kind: "jev"` rows, which only the factory wrote: its landing, supervisor and task-difficulty questions. The factory was deleted in #1365. The Flock writes only `jev:step` rows, which neither script reads. `autoresearch.py` imports `numeric_of` from `jev_census.py`, so the two go together; their only other users are their own tests. Other files under `evals/readings/` (`checker_kit.py`, `ab_auth.py`) stay.

**Proof:**
- Run: bash -c 'for p in evals/readings/jev_census.py evals/readings/autoresearch.py tests/test_jev_census.py tests/test_autoresearch.py; do test ! -e "$p" || exit 1; done' [M1]
- Run: bash -c 'test -z "$(git grep -l -E "jev_census|autoresearch" -- . ":!docs" ":!.ultrapowers")"' [M2]
- Legs: (a) all four paths are absent [M1]; (b) no tracked file outside `docs/` and `.ultrapowers/` names either script [M2].

**Stale-if:**
- path-absent: `evals/readings/jev_census.py`
