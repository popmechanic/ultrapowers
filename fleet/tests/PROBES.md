# fleet/tests probes

A `probe_*.mjs` file is a live measurement, not a test. Each one spends a real
credential — most of them real tokens against a real `claude -p` — so none is
named `test_*.mjs`: `tests/test_fleet_suite.py` globs `test_*.mjs`, and CI has
no credentials. The naming is the whole mechanism — CI and the suite never run
these. Run them by hand where a credential lives (the orchestrator, or a sandbox
with `CLAUDE_CODE_OAUTH_TOKEN` exported):

    CLAUDE_CODE_OAUTH_TOKEN=… node fleet/tests/probe_confine_live.mjs

The kata probe is the one exception to the credential: it spends no tokens and
holds no bearer, reaching the hub over the laptop's own ssh seam (the bearer is
sourced on the hub), so it runs on the LAPTOP and nowhere else — a sandbox
reaches the hub through the edge and cannot file a throwaway project:

    node fleet/tests/probe_kata_facts.mjs

The current probes:

- `probe_confine_live.mjs` — that Claude Code actually invokes the implementer's
  PreToolUse hook and honours its exit-2 denial, against a hostile task.
- `probe_run_worker_live.mjs` — that `runWorker` behaves like `agent()` against
  the real CLI: a conforming reply, a `--max-turns 1` failure, a per-run config dir.
- `probe_bypass_vs_hook.mjs` — whether a PreToolUse `deny` still blocks a tool
  call under `--permission-mode bypassPermissions`.
- `probe_disallowed_vs_bypass.mjs` — whether `--disallowedTools` still blocks a
  matching call under `bypassPermissions`, which is what the role's git-push
  escape hatch rides on.
- `probe_dontask_readonly_bash.mjs` — whether `dontAsk` permits read-only Bash
  outside `--allowedTools`. **Answered 2026-08-31: it does** (#457 gap 2), so a
  reviewer can `wc`/`cat` a file today; running a PROGRAM is still denied, which
  is why suite results must be threaded rather than re-run (#458).
- `probe_substitution_in_allowed_tail.mjs` — whether `$(...)` inside an allowed
  command's argument tail executes. **Answered 2026-08-31: it does not** (#457
  gap 1) — the `*` tail is not an execution channel, matching the documented
  operator parsing for `&&`, `;`, `|`.
- `probe_kata_facts.mjs` — whether the hub still behaves the way the fleet's
  contract says it does: the 22 kata facts (#978, #979, #993 and CLAUDE.md's
  seams paragraph), re-read one line per fact against a throwaway project, each
  line stamped with the version it was read on. Run it on every kata upgrade,
  and before any plan that touches `fleet/kata-client.mjs` — those facts are
  what that file's shape is argued from, and nothing in the suite talks to a
  hub, so an upgrade can falsify any of them with the tree still green. It
  removes its `probe-kata-facts-*` project with the very purge ladder its last
  fact measures. Exit 0 every fact holds, 1 at least one drift, 2 the hub was
  unreachable or the project was left behind.
