# confineDenials counts each denial once — the run-54 re-drive

**Grammar:** claims-v1

**Claim:** confineDenials counts each denial once: when a run's envelopes are read directly, the file's source=envelope rows are dropped (elicited)

**Goal:** one plan defect left over from run-54 (PR #782, parked `NEEDS_ACK` with a single
`deferred:plan-defect`). That run's second task taught `harvest_fleet_runs.py` to read each worker's
`workers/*/envelope.json` directly, but `fleet/run-worker.mjs`'s `recordEnvelopeDenials` had
already, since #476, appended one `source: "envelope"` line per `permission_denials` entry into
the same run's `confine-denials.jsonl` — so on a local run directory that carries both, every
envelope denial is emitted twice, and no Machine clause of that plan covered the
both-sources-present case. The same diff wrote a counting rule into `reading-lenses.md`
("count `envelope` lines when they are present, never the total") that described the double
count instead of fixing it. This plan re-drives on run-54's integration branch
(BASE `b3690485a734cd9c2fc4bfd094cc2707c406622e`, the tip of `ultra/integration-run-54`):
the harvester drops the file's `source == "envelope"` rows whenever it read this run's
envelopes itself, the exam file gains the both-sources leg, and the lens sentence says the
deduplicated rule. Its PR supersedes #782, which already carries `Closes` for #759 #760 #761
#698 — this plan closes nothing of its own.

**Tech Stack:** Python 3 stdlib only (`skills/ultralearn/scripts/harvest_fleet_runs.py`); pytest
exams under `tests/`. The committed suite is `python3 -m pytest` from the repo root
(`pytest.ini` scopes it to `tests/`). The exam is hermetic: every run directory is built under
`tmp_path` and goes through `hfr.build_fleet_bundle` with an explicit `engine_version`, so no
`gh`, no `git`, and no network.

**Exam command:** python3 -m pytest -q {paths}

**Parallelization rationale:** one wave, width 1. One task, because the three files are one
change: the reconciliation in `_confine_denials`, the leg that pins it, and the lens sentence
that states it. No chain exists, so none is owed.

## Global Constraints

- Check: `git diff --quiet $ULTRA_BASE -- fleet/`
- Check: `git diff --quiet $ULTRA_BASE -- skills/ultrapowers/scripts/gate_check.py skills/ultrapowers/scripts/ultra_gate.py skills/ultrapowers/scripts/run_acceptance.sh`
- Check: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultralearn`
- `fleet/` is untouched: `recordEnvelopeDenials` keeps writing its `source: "envelope"` lines
  (they are what a worker that dies before the harvester runs leaves behind); the harvester is
  the side that reconciles. The verification periphery is frozen (0.1.0). The first two Checks
  pin both.
- The bundle is the interface: `confineDenials` keeps its name and its three values — a list of
  denial lines each carrying `source`, `[]` for counted-zero, `null` for no source at all — and
  every existing pin of it in `tests/test_harvest_fleet_runs.py`,
  `tests/test_harvest_evidence.py` and `tests/test_harvest_fleet_runs_confine_denials.py` still
  passes unedited.
- The harvester stays advisory and loud: no new failure mode raises; an unreadable source is a
  stderr line, never a traceback.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The file's envelope rows are dropped when the envelopes were read directly

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultralearn/scripts/harvest_fleet_runs.py`
- Modify: `skills/ultralearn/references/reading-lenses.md`
- Test: `tests/test_harvest_fleet_runs_confine_denials.py`

**Claim:** confineDenials counts each denial once: when a run's envelopes are read directly, the file's source=envelope rows are dropped (derived)
Machine: M1. For a run directory holding one `workers/<dir>/envelope.json` whose
`permission_denials` lists one entry, and `confine-denials.jsonl` holding two object lines —
one with `source: "envelope"` describing that same denial, one with `source: "hook"` —
`bundle.confineDenials` is a list of exactly two objects, exactly one of which has
`source == "envelope"` and exactly one of which has `source == "hook"`.
M2. For a run directory holding `confine-denials.jsonl` whose lines include a
`source: "envelope"` line, and no `workers/*/envelope.json`, `bundle.confineDenials` still
carries that `source: "envelope"` line — the drop applies only when this run's envelopes were
read directly.
M3. The `1. **friction**` item of `skills/ultralearn/references/reading-lenses.md` no longer
contains the phrase `never the total` nor the phrase `23 lines`, and says, in order, that each
denial is counted once, that the harvester drops the file's `envelope` rows when it read the
envelopes itself, and that the `hook` lines are kept.

**Authorized-by:** run-54's gate receipt (PR #782, `deferred:plan-defect`, the reviewer's
finding on that run's envelope-read task); #760 (the envelope read); #476 (the `source` discriminator and `recordEnvelopeDenials`).

**Interfaces:**
- Consumes: none
- Produces: `_confine_denials(run_dir, workers) -> list | None` — the reconciled `bundle.confineDenials`

**Context:** At BASE, `_confine_denials` (in `skills/ultralearn/scripts/harvest_fleet_runs.py`,
the function just above `_carries_a_finding`) computes `envelopes = _envelope_denials(...)`,
`transcripts = _transcript_denials(...)`, `file_lines = _read_jsonl(run_dir /
"confine-denials.jsonl")`, returns `None` when none of the three sources exists, and otherwise
returns `envelopes + transcripts + file_lines` with no reconciliation. The writer on the other
side is `fleet/run-worker.mjs`'s `recordEnvelopeDenials`, which appends to that same
`confine-denials.jsonl` one line per `permission_denials` entry shaped `{ts, source:
"envelope", label, role, tool, reason, toolInput}` — so a local run directory that has both
`workers/*/envelope.json` and the file describes each envelope denial twice, once from each
reader. The rule this task installs: when `_envelope_denials` was able to read at least one
`workers/*/envelope.json` for this run — the glob matched, whatever its `permission_denials`
held — drop every file line whose `source` is the string `"envelope"` before concatenating;
keep every other file line, including lines with no `source` key at all (the fixtures in
`tests/test_harvest_fleet_runs.py` and `tests/test_harvest_evidence.py` write
`{"tool": "Bash", "reason": "outside clone"}` with no `source`, and they must still come
through verbatim). When no envelope file exists, the file's `envelope` lines are the only
record of those denials (a worker that died before the harvester ran) and are kept — that is
M2, and the existing leg (c) of the exam file already pins that shape with a `source:
"envelope"` row in the file and no `workers/`. The `has_source` test and the `None` answer are
unchanged. The exam file `tests/test_harvest_fleet_runs_confine_denials.py` already exists
(run-54's envelope-read task wrote it, legs (a)–(f) under that plan's M1–M5); this task's new legs go at
its end under a comment naming this task, and the new fixture reuses its helpers
(`_write_run`, `_worker_events`, `_write_envelope`, `_bundle`). The lens document's
`1. **friction**` item, between the lines `1. **friction**` and `2. **routing**`, currently
holds the bold sentence beginning `**THE SOURCES OVERLAP: count` and ending `never the
total.**`, followed by a sentence about a run-32-shaped run yielding `23 lines for 20
denials`; both are replaced by the deduplicated rule. The replacement wording is the
implementer's, but its three operative parts appear in this order: each denial is counted
once; the harvester drops the file's `envelope` rows when it read the envelopes itself; the
`hook` lines are kept (they carry the hook's own reason text and survive a worker that dies
before writing an envelope). The two `Run:` legs below are read through the same `sed` range
the existing leg (f) uses, joined with `tr`, so the sentence may wrap.

**Proof:**
- Test: `tests/test_harvest_fleet_runs_confine_denials.py`
- Run: sed -n '/^1\. \*\*friction\*\*/,/^2\. \*\*routing\*\*/p' skills/ultralearn/references/reading-lenses.md | tr '\n' ' ' | grep -q 'counted once.*drops.*envelope.*hook'
- Run: sed -n '/^1\. \*\*friction\*\*/,/^2\. \*\*routing\*\*/p' skills/ultralearn/references/reading-lenses.md | grep -c 'never the total' | grep -qx 0
- Run: sed -n '/^1\. \*\*friction\*\*/,/^2\. \*\*routing\*\*/p' skills/ultralearn/references/reading-lenses.md | grep -c '23 lines' | grep -qx 0
- Legs: (a) a run directory with `workers/review_1_1/envelope.json` carrying `session_id:
  "sess-r1"` and one `permission_denials` entry (`tool_name: "Bash"`), and
  `confine-denials.jsonl` holding one `{"source": "envelope", "label": "review:1:1", "tool":
  "Bash", …}` line and one `{"source": "hook", "label": "impl:1", "tool": "Write", …}` line,
  yields `bundle.confineDenials` of length exactly 2, with `[d["source"] for d in
  denials].count("envelope") == 1` and `.count("hook") == 1` — a harvester that concatenates
  without reconciling yields 3 and fails the length [M1]; (b) the existing leg
  `test_the_file_lines_are_carried_verbatim_in_file_order` — `confine-denials.jsonl` holding one
  `source: "hook"` and one `source: "envelope"` row, no `workers/`, no `transcripts/` — still
  yields exactly those two rows in file order, and a new leg beside it asserts that the
  `source: "envelope"` row is present in the result when no envelope file exists [M2]; (c) the
  first `Run:` exits 0 only when the friction item, joined, contains `counted once`, then
  `drops`, then `envelope`, then `hook`, in that order [M3]; (d) the second `Run:` exits 0 only
  when the phrase `never the total` is absent from the friction item [M3]; (e) the third `Run:`
  exits 0 only when the phrase `23 lines` is absent from the friction item [M3].

**Stale-if:**
- path-absent: `tests/test_harvest_fleet_runs_confine_denials.py`
- path-absent: `skills/ultralearn/scripts/harvest_fleet_runs.py`
- path-absent: `skills/ultralearn/references/reading-lenses.md`
