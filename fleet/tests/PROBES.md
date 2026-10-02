# fleet/tests probes

A `probe_*.mjs` file is either a live measurement or a design gate — never a
suite test. A live measurement spends real tokens against a real `claude -p`; a
design gate is model-free and spends only minutes, but it is a reading a person
takes before a change rather than a verdict CI owes on every commit. Either way
the file is deliberately NOT named `test_*.mjs`: `tests/test_fleet_suite.py`
globs `test_*.mjs`, CI has no credentials, and the hermetic sweep
`test_sims_are_hermetic.mjs` never reads a `probe_*.mjs`. The naming is the
whole mechanism — CI and the suite never run these.

The kata probe spends no tokens and holds no bearer, reaching the hub over the
laptop's own ssh seam (the bearer is sourced on the hub), so it runs on the
LAPTOP and nowhere else — a sandbox reaches the hub through the edge and
cannot file a throwaway project:

    node fleet/tests/probe_kata_facts.mjs

The current probes:

- `probe_kata_facts.mjs` — whether the hub still behaves the way the fleet's
  contract says it does: the 24 kata facts (#978, #979, #993, #1023 and CLAUDE.md's
  seams paragraph), re-read one line per fact against a throwaway project, each
  line stamped with the version it was read on. Run it on every kata upgrade,
  and before any plan that touches `fleet/kata-client.mjs` — those facts are
  what that file's shape is argued from, and nothing in the suite talks to a
  hub, so an upgrade can falsify any of them with the tree still green. It
  removes its `probe-kata-facts-*` project with the very purge ladder its last
  fact measures. Exit 0 every fact holds, 1 at least one drift, 2 the hub was
  unreachable or the project was left behind.
- `probe_exe_facts.mjs` — whether exe.dev's lobby still behaves the way
  `fleet/RUNBOOK.md`'s §Traps (*Tags, keys and names*, *Reading the lobby*)
  and `fleet/CONTRACT.md`'s `exe.dev facts (measured)` list say it does: the
  twelve lobby facts, re-read one line per fact against the laptop's own ssh
  seam (`ssh exe.dev`), each line stamped with the sha256 of `help all
  --json` — exe.dev exposes no version verb, no `--version` and no
  changelog, so that digest is the only version marker there is — and the
  UTC date. It creates three throwaway VMs (`probe-exe-facts-<stamp>`, 1 vCPU and 2 GB —
  the lobby's floor — and two copies of it) and removes every one of them as its last mutating verbs, and
  it refuses outright, issuing no `new`, when a `fleet-r*` VM is already
  listed — a live run's VM, never to be created beside. Run it on a
  verb-drift finding from the doctor's `verb-drift` row or the launch line,
  and before any plan touching `fleet/launch.mjs` or `fleet/lobby.mjs` — the
  facts here are what those files' shape is argued from. Its exit codes:
  exit 0 every fact holds, 1 at least one drift or unreadable fact, 2 the
  lobby was unreachable, a live run's VM was listed, or a throwaway was left
  behind.

## Hand-run: the Jev authoring probes (need `bun`)

The bridge's `sim_env()` PATH holds node, python3, git, bash and sh only, so four
probes of the Bun authoring tools stay outside the suite (operator pick, #1447).
Each runs against a local stand-in Jev on 127.0.0.1 and spends nothing. Run all
four before any change to `skills/ultrawrite/stories/gate_jev.ts`,
`jev_checks.ts`, `jev.ts` or `skills/ultrawrite/stories/questions.json`:

    for c in record agreement; do node fleet/tests/gate_jev_probe.mjs $c; done
    for c in pinned-high pinned-low no-base; do node fleet/tests/gate_jev_base_probe.mjs $c; done
    for c in own-files own-only rollback; do node fleet/tests/gate_jev_reading_probe.mjs $c; done
    for c in bundle map decompose understanding; do node fleet/tests/jev_calls_probe.mjs $c; done

- `gate_jev_probe.mjs` — `record`: one request asking the five clause keys,
  the verdict record left alone and one `gate_rounds` entry written;
  `agreement`: the census's two lines over two records. Prints `GATE JEV <case> OK`.
- `gate_jev_base_probe.mjs` — prints one JSON line (`verdict`, `pinned`,
  `asked_pinned`, `state_base`); `pinned` is asked only when the diet has a
  `base`. Exits 1 only when it could not run; read the line.
- `gate_jev_reading_probe.mjs` — prints one JSON line (`requests`, `asked`,
  `state_base`, `caught_M1`, `verdict`, `pinned`, `round`) for policy.json's
  `gate_reading` (#1497): `own-files` sends only the sibling entry, unmarked, and
  asks `caught_v2`; `own-only` sends `files` as `[]` and asks no `pinned`;
  `rollback`, on a copy with both cells set back, sends both entries and asks the
  old `caught`. The round names its `reading`. Exits 1 only when it could not run.
- `jev_calls_probe.mjs` — the state `jev_checks.ts` sends Jev at each stage.
  Prints `JEV CALLS <case> OK`.

Everything else the Flock's scripted runs used to probe by hand (catch-up,
deletes, provenance, the Jev trials) is `test_flock_runs.mjs`, in the suite.

## Jev's peer-rewrite read, live

`jev_peer_probe.mjs` asks the real Jev (key in `~/.ultrapowers/typesafe.env`; it spends a few calls)
the `flock_peer_rewrite` question three ways, with five replays each:
- run-296's L:loose rewrite of `preview.ts` exactly as the engine sent it, as a bare agent name
  (reported, not judged);
- the same rewrite with the loose-ends side's title and reason, which must read `supersedes` or
  `keeps` in a majority;
- run-277's run-together words, which must still read `loses`.

Run it before any change to that question, to `factory/flock/engine.mjs`'s `peerRewrites`, or to the
`flock.jev_peer_rewrite` policy:

    node fleet/tests/jev_peer_probe.mjs 5

Readings, 2026-10-01, `jev-1.13.0`, n=5 each:

| Case | Answer |
|---|---|
| bare run-296 | loses 5/5 |
| run-296 with its reason | supersedes 5/5 |
| run-277 | loses 5/5 |

## Jev's gate reading, live

`gate_jev_replay_probe.mjs` replays every labelled gate disagreement in the operator's untracked
`docs/superpowers/plans/` through the real Jev (key in `~/.ultrapowers/typesafe.env`): each round where
the agent reader and Jev differ and `right` is set, its diet rebuilt by `extract_gate_input.py` (with the
tally's `base` when that round saw one) and skipped when the task no longer hashes the same, then read
by `gate_jev.ts` (never `--record`). Beside them, two known-bad controls (`uncaught-output`,
`pinned-by-sibling`) must each still read `fail` in a majority. It spends `reps` × (rounds + 2) calls.
It counts the wrong fails (agent right, Jev failed) that now pass and the right fails (Jev right) that
still fail; exit 0 when the controls hold and at least two thirds of the wrong fails now pass.

Run it before any change to the `authoring_gate` questions, to `gate_reading`, or to
`extract_gate_input.py`'s `base`:

    node fleet/tests/gate_jev_replay_probe.mjs docs/superpowers/plans 3

When a change moves two things at once, flipping one `gate_reading` cell back measures the other
change alone.

Readings, 2026-10-01, `jev-1.13.0`, n=15 wrong fails from 10 plans dated 2026-09-29..30, 3 reads each,
majority:

| Reading | Wrong fails still failing |
|---|---|
| caught/read (before) | 14 of 15 |
| caught/dropped | 6 of 15 |
| caught_v2/read | 9 of 15 |
| caught_v2/dropped | 2 of 15 |

Both controls failed 3 of 3 under every reading. The one round Jev was right on, rebuilt by hand (its
round-1 diet is not replayable), failed 1 of 3 before and 0 of 3 after: the change gives up that catch.
