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

- `probe_substitution_in_allowed_tail.mjs` — whether `$(...)` inside an allowed
  command's argument tail executes. **Answered 2026-08-31: it does not** (#457
  gap 1) — the `*` tail is not an execution channel, matching the documented
  operator parsing for `&&`, `;`, `|`.
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
  UTC date. It creates three throwaway VMs (`probe-exe-facts-<stamp>` and two
  copies of it) and removes every one of them as its last mutating verbs, and
  it refuses outright, issuing no `new`, when a `fleet-r*` VM is already
  listed — a live run's VM, never to be created beside. Run it on a
  verb-drift finding from the doctor's `verb-drift` row or the launch line,
  and before any plan touching `fleet/launch.mjs` or `fleet/lobby.mjs` — the
  facts here are what those files' shape is argued from. Its exit codes:
  exit 0 every fact holds, 1 at least one drift or unreadable fact, 2 the
  lobby was unreachable, a live run's VM was listed, or a throwaway was left
  behind.
- `probe_readiness_fold_order.mjs` — the fold-order gate (#832, #810 Phase C):
  that for every fixture patch set, every sequential adoption order folds to
  the tree the simultaneous fold lands. The design gate of this list, not a
  live measurement — the kernel is the real one, every reply is a committed
  file, no model runs and no token is spent, so it costs about half a minute
  and needs no credential. Run it by hand before any change to the fold kernel
  or to the ready-set scheduler (`node fleet/tests/probe_readiness_fold_order.mjs`):
  five `wave-` lines, one `negative-control` line carrying `caught`, and
  `ALL TESTS PASSED` last is the pass. A fixture set under
  `fleet/tests/fixtures/readiness/` whose manifest names a `project` tree at
  neither resolution is skipped with one stderr line and no stdout line — at
  BASE all three are, and they read again the day their project trees return.
