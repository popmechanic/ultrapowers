# fleet/tests probes

A `probe_*.mjs` file is a live measurement, not a test. Each one spends real
tokens against a real `claude -p`, so it is deliberately NOT named `test_*.mjs`:
`tests/test_fleet_suite.py` globs `test_*.mjs`, and CI has no credentials. The
naming is the whole mechanism — CI and the suite never run these. Run them by
hand where a credential lives (the orchestrator, or a sandbox with
`CLAUDE_CODE_OAUTH_TOKEN` exported):

    CLAUDE_CODE_OAUTH_TOKEN=… node fleet/tests/probe_confine_live.mjs

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
